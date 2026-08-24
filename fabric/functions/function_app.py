"""Covetrus portal authorization boundary for Microsoft Fabric User Data Functions.

All authorization derives from UserDataFunctionContext. Browser-supplied identity,
tenant, role and administrator flags are intentionally absent from every signature.
"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fabric.functions as fn
from jsonschema import Draft202012Validator

udf = fn.UserDataFunctions()
SQL_ALIAS = "portalSql"
LAKEHOUSE_ALIAS = "portalStorage"
BOOTSTRAP_ADMIN_EMAIL = "greig.dunbar@covetrus.com"
ALLOWED_TENANT_ID = "f5a44614-2e0f-46dd-89af-a59b298f02af"
MAX_DATASET_BYTES = 10 * 1024 * 1024
SCHEMA_ROOT = Path(__file__).parent / "schemas"


def _identity(invocationContext: fn.UserDataFunctionContext) -> tuple[str, str, str]:
    user = invocationContext.executing_user
    oid = str(user.get("Oid", "")).lower()
    tenant_id = str(user.get("TenantId", "")).lower()
    email = str(user.get("PreferredUsername", "")).strip().lower()
    if not oid or not tenant_id:
        raise fn.UserThrownError("A verified Entra identity is required.", {"code": "IDENTITY_REQUIRED"})
    if tenant_id != ALLOWED_TENANT_ID.lower():
        raise fn.UserThrownError("Cross-tenant access is not permitted.", {"code": "CROSS_TENANT"})
    return oid, tenant_id, email


def _row(cursor, query: str, params: tuple = ()) -> dict[str, Any] | None:
    cursor.execute(query, params)
    value = cursor.fetchone()
    if value is None:
        return None
    columns = [item[0] for item in cursor.description]
    return dict(zip(columns, value))


def _rows(cursor, query: str, params: tuple = ()) -> list[dict[str, Any]]:
    cursor.execute(query, params)
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, value)) for value in cursor.fetchall()]


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _serialise(row: dict[str, Any]) -> dict[str, Any]:
    return {key[0].lower() + key[1:]: _json_value(value) for key, value in row.items()}


def _audit(cursor, actor: dict[str, Any], action: str, subject_type: str, subject_label: str, detail: str) -> None:
    cursor.execute(
        "INSERT INTO AuditEvent (id, tenantId, occurredAt, actorUserId, actorEmail, action, subjectType, subjectLabel, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), actor["tenantId"], datetime.now(timezone.utc), actor["id"], actor["email"], action, subject_type, subject_label[:200], detail[:2000]),
    )


def _ensure_schema(connection) -> None:
    """Create the isolated portal tables when the Rayfin database is first attached."""
    cursor = connection.cursor()
    cursor.execute("""
    IF OBJECT_ID(N'dbo.PortalUser', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.PortalUser (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        tenantId nvarchar(36) NOT NULL,
        entraObjectId nvarchar(36) NULL,
        email nvarchar(320) NOT NULL,
        displayName nvarchar(200) NOT NULL,
        role nvarchar(16) NOT NULL CHECK (role IN ('viewer','admin')),
        status nvarchar(16) NOT NULL CHECK (status IN ('pending','active','disabled')),
        createdAt datetime2 NOT NULL,
        updatedAt datetime2 NOT NULL
      );
      CREATE UNIQUE INDEX UX_PortalUser_Email ON dbo.PortalUser(email);
      CREATE UNIQUE INDEX UX_PortalUser_EntraObjectId ON dbo.PortalUser(entraObjectId) WHERE entraObjectId IS NOT NULL;
    END;

    IF OBJECT_ID(N'dbo.AccessGroup', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.AccessGroup (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        tenantId nvarchar(36) NOT NULL,
        name nvarchar(160) NOT NULL,
        description nvarchar(500) NOT NULL,
        createdAt datetime2 NOT NULL,
        updatedAt datetime2 NOT NULL
      );
      CREATE UNIQUE INDEX UX_AccessGroup_Name ON dbo.AccessGroup(name);
    END;

    IF OBJECT_ID(N'dbo.GroupMember', N'U') IS NULL
      CREATE TABLE dbo.GroupMember (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        groupId uniqueidentifier NOT NULL,
        userId uniqueidentifier NOT NULL,
        createdAt datetime2 NOT NULL
      );

    IF OBJECT_ID(N'dbo.Artifact', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Artifact (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        slug nvarchar(100) NOT NULL,
        title nvarchar(200) NOT NULL,
        description nvarchar(800) NOT NULL,
        kind nvarchar(16) NOT NULL CHECK (kind IN ('report','tool')),
        version nvarchar(32) NOT NULL,
        owner nvarchar(200) NOT NULL,
        dataDate nvarchar(20) NULL,
        entryUrl nvarchar(500) NOT NULL,
        capabilitiesJson nvarchar(500) NOT NULL,
        datasetKeysJson nvarchar(1000) NOT NULL,
        isActive bit NOT NULL CONSTRAINT DF_Artifact_IsActive DEFAULT 1,
        createdAt datetime2 NOT NULL,
        updatedAt datetime2 NOT NULL
      );
      CREATE UNIQUE INDEX UX_Artifact_Slug ON dbo.Artifact(slug);
    END;

    IF OBJECT_ID(N'dbo.ArtifactGrant', N'U') IS NULL
      CREATE TABLE dbo.ArtifactGrant (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        artifactId uniqueidentifier NOT NULL,
        targetType nvarchar(16) NOT NULL CHECK (targetType IN ('user','group')),
        targetId uniqueidentifier NOT NULL,
        createdAt datetime2 NOT NULL,
        createdByUserId uniqueidentifier NOT NULL
      );

    IF OBJECT_ID(N'dbo.Dataset', N'U') IS NULL
      CREATE TABLE dbo.Dataset (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        artifactId uniqueidentifier NOT NULL,
        datasetKey nvarchar(100) NOT NULL,
        schemaVersion int NOT NULL,
        generatedAt datetime2 NOT NULL,
        checksum nvarchar(80) NOT NULL,
        sizeBytes int NOT NULL,
        recordCount int NOT NULL,
        storageLocation nvarchar(1000) NOT NULL,
        status nvarchar(16) NOT NULL CHECK (status IN ('active','superseded')),
        createdAt datetime2 NOT NULL,
        createdByUserId uniqueidentifier NOT NULL
      );

    IF OBJECT_ID(N'dbo.AuditEvent', N'U') IS NULL
      CREATE TABLE dbo.AuditEvent (
        id uniqueidentifier NOT NULL PRIMARY KEY,
        tenantId nvarchar(36) NOT NULL,
        occurredAt datetime2 NOT NULL,
        actorUserId uniqueidentifier NULL,
        actorEmail nvarchar(320) NOT NULL,
        action nvarchar(100) NOT NULL,
        subjectType nvarchar(100) NOT NULL,
        subjectLabel nvarchar(200) NOT NULL,
        detail nvarchar(2000) NOT NULL
      );
    """)
    connection.commit()


def _caller(connection, invocationContext: fn.UserDataFunctionContext, require_admin: bool = False) -> dict[str, Any]:
    oid, tenant_id, email = _identity(invocationContext)
    _ensure_schema(connection)
    cursor = connection.cursor()
    user = _row(cursor, "SELECT * FROM PortalUser WHERE tenantId = ? AND entraObjectId = ?", (tenant_id, oid))
    if user is None and email:
        pending = _row(cursor, "SELECT * FROM PortalUser WHERE tenantId = ? AND LOWER(email) = ? AND status = 'pending'", (tenant_id, email))
        if pending:
            cursor.execute("UPDATE PortalUser SET entraObjectId = ?, status = 'active', updatedAt = ? WHERE id = ?", (oid, datetime.now(timezone.utc), pending["id"]))
            _audit(cursor, pending, "user.identity_bound", "user", pending["email"], "Verified tenant and immutable Entra object ID bound on first sign-in")
            connection.commit()
            user = _row(cursor, "SELECT * FROM PortalUser WHERE id = ?", (pending["id"],))
    if user is None:
        count = _row(cursor, "SELECT COUNT(*) AS total FROM PortalUser")
        if count and count["total"] == 0 and email == BOOTSTRAP_ADMIN_EMAIL:
            user_id = str(uuid.uuid4())
            cursor.execute("INSERT INTO PortalUser (id, tenantId, entraObjectId, email, displayName, role, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?)", (user_id, tenant_id, oid, email, email.split('@')[0], datetime.now(timezone.utc), datetime.now(timezone.utc)))
            connection.commit()
            user = _row(cursor, "SELECT * FROM PortalUser WHERE id = ?", (user_id,))
    if user is None:
        raise fn.UserThrownError("This identity is not entitled to the portal.", {"code": "UNENTITLED"})
    if user["status"] != "active":
        raise fn.UserThrownError("This portal identity is disabled or pending.", {"code": "USER_DISABLED"})
    if require_admin and user["role"] != "admin":
        raise fn.UserThrownError("Administrator access is required.", {"code": "ADMIN_REQUIRED"})
    return user


def _has_grant(cursor, user_id: str, artifact_id: str) -> bool:
    row = _row(cursor, """
        SELECT TOP 1 g.id FROM ArtifactGrant g
        WHERE g.artifactId = ? AND (
          (g.targetType = 'user' AND g.targetId = ?) OR
          (g.targetType = 'group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId = g.targetId AND gm.userId = ?))
        )
    """, (artifact_id, user_id, user_id))
    return row is not None


def _connect(sqlDb: fn.FabricSqlConnection):
    return sqlDb.connect()


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def whoAmI(sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    connection = _connect(sqlDb)
    try:
        return _serialise(_caller(connection, invocationContext))
    finally:
        connection.close()


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def getMyCatalog(sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> list[dict]:
    connection = _connect(sqlDb)
    try:
        caller = _caller(connection, invocationContext)
        cursor = connection.cursor()
        rows = _rows(cursor, """
          SELECT DISTINCT a.* FROM Artifact a JOIN ArtifactGrant g ON g.artifactId = a.id
          WHERE a.isActive = 1 AND ((g.targetType = 'user' AND g.targetId = ?) OR
            (g.targetType = 'group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId = g.targetId AND gm.userId = ?)))
          ORDER BY a.kind, a.title
        """, (caller["id"], caller["id"]))
        result = []
        for row in rows:
            item = _serialise(row)
            item["capabilities"] = json.loads(item.pop("capabilitiesJson"))
            item["datasetKeys"] = json.loads(item.pop("datasetKeysJson"))
            item["accent"] = "teal" if item["kind"] == "report" else "blue"
            result.append(item)
        return result
    finally:
        connection.close()


@udf.connection(alias="portalStorage", argName="lakehouse")
@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def getArtifactData(artifactId: str, datasetKey: str, lakehouse: fn.FabricLakehouseClient, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    connection = _connect(sqlDb)
    try:
        caller = _caller(connection, invocationContext)
        cursor = connection.cursor()
        artifact = _row(cursor, "SELECT * FROM Artifact WHERE id = ? AND isActive = 1", (artifactId,))
        if artifact is None or not _has_grant(cursor, caller["id"], artifactId):
            raise fn.UserThrownError("Artifact data access is denied.", {"code": "GRANT_REQUIRED"})
        dataset = _row(cursor, "SELECT TOP 1 * FROM Dataset WHERE artifactId = ? AND datasetKey = ? AND status = 'active' ORDER BY createdAt DESC", (artifactId, datasetKey))
        if dataset is None:
            raise fn.UserThrownError("The requested dataset is not available.", {"code": "DATASET_MISSING"})
        files = lakehouse.connectToFiles()
        try:
            content = files.get_file_client(dataset["storageLocation"]).download_file().readall()
        finally:
            files.close()
        envelope = json.loads(content.decode("utf-8"))
        if envelope.get("checksum") != dataset["checksum"]:
            raise fn.UserThrownError("Dataset integrity check failed.", {"code": "CHECKSUM_MISMATCH"})
        return envelope
    finally:
        connection.close()


def _snapshot(cursor) -> dict[str, list[dict]]:
    users = [_serialise(row) for row in _rows(cursor, "SELECT * FROM PortalUser ORDER BY displayName")]
    groups = [_serialise(row) for row in _rows(cursor, "SELECT g.*, (SELECT COUNT(*) FROM GroupMember gm WHERE gm.groupId = g.id) AS memberCount FROM AccessGroup g ORDER BY name")]
    memberships = [_serialise(row) for row in _rows(cursor, "SELECT * FROM GroupMember")]
    grants = [_serialise(row) for row in _rows(cursor, "SELECT * FROM ArtifactGrant")]
    artifacts = []
    for row in _rows(cursor, "SELECT * FROM Artifact ORDER BY title"):
        item = _serialise(row); item["capabilities"] = json.loads(item.pop("capabilitiesJson")); item["datasetKeys"] = json.loads(item.pop("datasetKeysJson")); item["accent"] = "teal" if item["kind"] == "report" else "blue"; artifacts.append(item)
    datasets = [_serialise(row) for row in _rows(cursor, "SELECT * FROM Dataset ORDER BY createdAt DESC")]
    audit = [_serialise(row) for row in _rows(cursor, "SELECT TOP 500 * FROM AuditEvent ORDER BY occurredAt DESC")]
    return {"users": users, "groups": groups, "memberships": memberships, "grants": grants, "artifacts": artifacts, "datasets": datasets, "audit": audit}


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def getAdminSnapshot(sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    connection = _connect(sqlDb)
    try:
        _caller(connection, invocationContext, True)
        return _snapshot(connection.cursor())
    finally:
        connection.close()


def _admin_mutation(sqlDb, invocationContext, callback):
    connection = _connect(sqlDb)
    try:
        actor = _caller(connection, invocationContext, True); result = callback(connection.cursor(), actor); connection.commit(); return result
    except Exception:
        connection.rollback(); raise
    finally:
        connection.close()


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def addUser(email: str, displayName: str, role: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    def operation(cursor, actor):
        if role not in ("viewer", "admin") or "@" not in email: raise fn.UserThrownError("Invalid user input.", {"code": "INVALID_USER"})
        user_id = str(uuid.uuid4()); timestamp = datetime.now(timezone.utc)
        cursor.execute("INSERT INTO PortalUser (id, tenantId, entraObjectId, email, displayName, role, status, createdAt, updatedAt) VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, ?)", (user_id, actor["tenantId"], email.strip().lower(), displayName.strip(), role, timestamp, timestamp))
        _audit(cursor, actor, "user.created", "user", email, "Pending identity created")
        return _serialise(_row(cursor, "SELECT * FROM PortalUser WHERE id = ?", (user_id,)))
    return _admin_mutation(sqlDb, invocationContext, operation)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def updateUser(id: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext, status: str = "", role: str = "") -> dict:
    def operation(cursor, actor):
        target = _row(cursor, "SELECT * FROM PortalUser WHERE id = ? AND tenantId = ?", (id, actor["tenantId"]));
        if target is None: raise fn.UserThrownError("User was not found.", {"code": "NOT_FOUND"})
        next_status = status or target["status"]; next_role = role or target["role"]
        if next_status not in ("pending", "active", "disabled") or next_role not in ("viewer", "admin"): raise fn.UserThrownError("Invalid user update.", {"code": "INVALID_USER"})
        if target["id"] == actor["id"] and (next_status == "disabled" or next_role != "admin"): raise fn.UserThrownError("Administrators cannot remove their own access.", {"code": "SELF_LOCKOUT"})
        cursor.execute("UPDATE PortalUser SET status = ?, role = ?, updatedAt = ? WHERE id = ?", (next_status, next_role, datetime.now(timezone.utc), id)); _audit(cursor, actor, "user.updated", "user", target["email"], json.dumps({"status": next_status, "role": next_role})); return {"ok": True}
    return _admin_mutation(sqlDb, invocationContext, operation)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def addGroup(name: str, description: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    def operation(cursor, actor):
        group_id = str(uuid.uuid4()); timestamp = datetime.now(timezone.utc); cursor.execute("INSERT INTO AccessGroup (id, tenantId, name, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)", (group_id, actor["tenantId"], name.strip(), description.strip(), timestamp, timestamp)); _audit(cursor, actor, "group.created", "group", name, description); result = _serialise(_row(cursor, "SELECT * FROM AccessGroup WHERE id = ?", (group_id,))); result["memberCount"] = 0; return result
    return _admin_mutation(sqlDb, invocationContext, operation)


def _membership_change(sqlDb, invocationContext, group_id: str, user_id: str, add: bool) -> dict:
    def operation(cursor, actor):
        if add: cursor.execute("IF NOT EXISTS (SELECT 1 FROM GroupMember WHERE groupId = ? AND userId = ?) INSERT INTO GroupMember (id, groupId, userId, createdAt) VALUES (?, ?, ?, ?)", (group_id, user_id, str(uuid.uuid4()), group_id, user_id, datetime.now(timezone.utc)))
        else: cursor.execute("DELETE FROM GroupMember WHERE groupId = ? AND userId = ?", (group_id, user_id))
        _audit(cursor, actor, "membership.created" if add else "membership.removed", "group", group_id, user_id); return {"ok": True}
    return _admin_mutation(sqlDb, invocationContext, operation)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def addMembership(groupId: str, userId: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict: return _membership_change(sqlDb, invocationContext, groupId, userId, True)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def removeMembership(groupId: str, userId: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict: return _membership_change(sqlDb, invocationContext, groupId, userId, False)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def setGrant(artifactId: str, targetType: str, targetId: str, enabled: bool, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    def operation(cursor, actor):
        if targetType not in ("user", "group"): raise fn.UserThrownError("Invalid grant target.", {"code": "INVALID_GRANT"})
        cursor.execute("DELETE FROM ArtifactGrant WHERE artifactId = ? AND targetType = ? AND targetId = ?", (artifactId, targetType, targetId))
        if enabled: cursor.execute("INSERT INTO ArtifactGrant (id, artifactId, targetType, targetId, createdAt, createdByUserId) VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), artifactId, targetType, targetId, datetime.now(timezone.utc), actor["id"]))
        _audit(cursor, actor, "grant.created" if enabled else "grant.removed", targetType, targetId, artifactId); return {"ok": True}
    return _admin_mutation(sqlDb, invocationContext, operation)


@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def syncArtifact(manifestJson: str, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    """Upsert one validated, committed manifest and grant the publishing admin access."""
    def operation(cursor, actor):
        manifest = json.loads(manifestJson); required = ("schemaVersion", "id", "title", "kind", "version", "entry", "owner", "capabilities", "datasets")
        if any(key not in manifest for key in required) or manifest["schemaVersion"] != 1 or manifest["kind"] not in ("report", "tool"):
            raise fn.UserThrownError("Artifact manifest is invalid.", {"code": "INVALID_MANIFEST"})
        if any(capability not in ("downloads",) for capability in manifest["capabilities"]):
            raise fn.UserThrownError("Artifact capability is not allowed.", {"code": "UNSAFE_CAPABILITY"})
        slug = manifest["id"]; artifact_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"covetrus-portal:{slug}")); timestamp = datetime.now(timezone.utc)
        values = (artifact_id, slug, manifest["title"], manifest.get("description", ""), manifest["kind"], manifest["version"], manifest["owner"], manifest.get("dataDate"), f"/artifacts/{slug}/{manifest['entry']}", json.dumps(manifest["capabilities"]), json.dumps([item["key"] for item in manifest["datasets"]]), timestamp, timestamp)
        cursor.execute("""
          MERGE Artifact AS target USING (SELECT ? AS id) AS source ON target.id = source.id
          WHEN MATCHED THEN UPDATE SET slug=?, title=?, description=?, kind=?, version=?, owner=?, dataDate=?, entryUrl=?, capabilitiesJson=?, datasetKeysJson=?, isActive=1, updatedAt=?
          WHEN NOT MATCHED THEN INSERT (id, slug, title, description, kind, version, owner, dataDate, entryUrl, capabilitiesJson, datasetKeysJson, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
        """, (artifact_id, *values[1:11], timestamp, *values))
        cursor.execute("IF NOT EXISTS (SELECT 1 FROM ArtifactGrant WHERE artifactId=? AND targetType='user' AND targetId=?) INSERT INTO ArtifactGrant (id, artifactId, targetType, targetId, createdAt, createdByUserId) VALUES (?, ?, 'user', ?, ?, ?)", (artifact_id, actor["id"], str(uuid.uuid4()), artifact_id, actor["id"], timestamp, actor["id"]))
        _audit(cursor, actor, "artifact.synced", "artifact", slug, manifest["version"]); return {"ok": True, "artifactId": artifact_id}
    return _admin_mutation(sqlDb, invocationContext, operation)


@udf.connection(alias="portalStorage", argName="lakehouse")
@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def seedDatasetChunk(uploadId: str, chunkIndex: int, totalChunks: int, chunkBase64: str, lakehouse: fn.FabricLakehouseClient, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    connection = _connect(sqlDb)
    try: _caller(connection, invocationContext, True)
    finally: connection.close()
    if not (0 <= chunkIndex < totalChunks <= 8) or len(chunkBase64) > 2_500_000: raise fn.UserThrownError("Invalid dataset chunk.", {"code": "INVALID_CHUNK"})
    files = lakehouse.connectToFiles()
    try: files.get_file_client(f"portal-data/.uploads/{uploadId}/{chunkIndex:03d}.txt").upload_data(chunkBase64.encode("ascii"), overwrite=True)
    finally: files.close()
    return {"ok": True, "chunkIndex": chunkIndex}


@udf.connection(alias="portalStorage", argName="lakehouse")
@udf.connection(alias="portalSql", argName="sqlDb")
@udf.context(argName="invocationContext")
@udf.function()
def finalizeSeedDataset(uploadId: str, artifactId: str, datasetKey: str, schemaVersion: int, sizeBytes: int, recordCount: int, checksum: str, totalChunks: int, lakehouse: fn.FabricLakehouseClient, sqlDb: fn.FabricSqlConnection, invocationContext: fn.UserDataFunctionContext) -> dict:
    connection = _connect(sqlDb); files = lakehouse.connectToFiles()
    try:
        actor = _caller(connection, invocationContext, True); cursor = connection.cursor()
        artifact = _row(cursor, "SELECT * FROM Artifact WHERE slug = ? AND isActive = 1", (artifactId,))
        if artifact is None: raise fn.UserThrownError("Artifact was not found.", {"code": "NOT_FOUND"})
        encoded = b"".join(files.get_file_client(f"portal-data/.uploads/{uploadId}/{index:03d}.txt").download_file().readall() for index in range(totalChunks))
        content = base64.b64decode(encoded, validate=True)
        envelope = json.loads(content.decode("utf-8")); payload = envelope.get("payload")
        if envelope.get("artifactId") != artifactId or envelope.get("datasetKey") != datasetKey or envelope.get("schemaVersion") != schemaVersion: raise fn.UserThrownError("Dataset contract does not match the request.", {"code": "CONTRACT_MISMATCH"})
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        # The checksum covers compact canonical JSON produced by the seed client.
        if len(payload_bytes) > MAX_DATASET_BYTES or len(payload_bytes) != sizeBytes: raise fn.UserThrownError("Dataset size validation failed.", {"code": "SIZE_LIMIT"})
        computed_checksum = "sha256:" + hashlib.sha256(payload_bytes).hexdigest()
        if envelope.get("checksum") != checksum or computed_checksum != checksum: raise fn.UserThrownError("Checksum validation failed.", {"code": "CHECKSUM_MISMATCH"})
        schema_path = SCHEMA_ROOT / f"{artifactId}--{datasetKey}.schema.json"
        if not schema_path.exists(): raise fn.UserThrownError("No server schema is registered for this dataset.", {"code": "SCHEMA_MISSING"})
        errors = sorted(Draft202012Validator(json.loads(schema_path.read_text())).iter_errors(payload), key=lambda item: list(item.path))
        if errors: raise fn.UserThrownError("Dataset schema validation failed.", {"code": "SCHEMA_INVALID", "detail": errors[0].message})
        location = f"portal-data/{artifactId}/{datasetKey}/{checksum.removeprefix('sha256:')}.json"
        files.get_file_client(location).upload_data(content, overwrite=True)
        cursor.execute("UPDATE Dataset SET status = 'superseded' WHERE artifactId = ? AND datasetKey = ? AND status = 'active'", (artifact["id"], datasetKey))
        cursor.execute("INSERT INTO Dataset (id, artifactId, datasetKey, schemaVersion, generatedAt, checksum, sizeBytes, recordCount, storageLocation, status, createdAt, createdByUserId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)", (str(uuid.uuid4()), artifact["id"], datasetKey, schemaVersion, datetime.fromisoformat(envelope["generatedAt"].replace("Z", "+00:00")), checksum, sizeBytes, recordCount, location, datetime.now(timezone.utc), actor["id"]))
        _audit(cursor, actor, "dataset.seeded", "dataset", f"{artifactId}/{datasetKey}", json.dumps({"checksum": checksum, "sizeBytes": sizeBytes, "recordCount": recordCount})); connection.commit(); return {"ok": True, "location": location, "payloadBytes": len(payload_bytes)}
    except Exception: connection.rollback(); raise
    finally: files.close(); connection.close()
