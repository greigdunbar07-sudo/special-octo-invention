import sql from 'mssql';

import { parseArtifactIcon, PORTAL_NOTIFICATION_TYPES, type AccessRequestRecord, type AccessRequestState, type AdminSnapshot, type ArtifactSummary, type DatasetRecord, type NotificationFeed, type PortalGroup, type PortalIdentity, type PortalNotification, type PortalNotificationType, type PortalRole, type QlikCleanRecipe, type QlikDatasetBinding, type UsageInsights, type UsageInsightsRange, type UserStatus } from '../src/types/portal.js';
import { usageTelemetryEnabled, type AppConfig } from './config.js';
import type { VerifiedPrincipal } from './auth.js';
import { artifactEntryUrl, type ArtifactRegistry } from './artifacts.js';
import { getSqlPool } from './azure.js';
import { AppError } from './errors.js';
import { parseStoredQlikCleanRecipe } from './qlik-clean.js';
import { nextDueAt } from './qlik-extract.js';
import type { ValidatedUsageEvent } from './usage.js';

type Row = Record<string, unknown>;

function serialise(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

function identity(row: Row): PortalIdentity {
  return {
    id: String(row.id), tenantId: String(row.tenantId),
    entraObjectId: row.entraObjectId ? String(row.entraObjectId) : null,
    email: String(row.email), displayName: String(row.displayName),
    role: String(row.role) as PortalRole, status: String(row.status) as UserStatus,
    hasCompletedTour: row.tourCompletedAt != null,
  };
}

function artifact(row: Row): ArtifactSummary {
  return {
    id: String(row.id), slug: String(row.slug), title: String(row.title), description: String(row.description),
    kind: String(row.kind) as ArtifactSummary['kind'], version: String(row.version), owner: String(row.owner),
    dataDate: row.dataDate == null ? null : String(row.dataDate), entryUrl: String(row.entryUrl),
    publishedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt ? String(row.updatedAt) : undefined,
    capabilities: JSON.parse(String(row.capabilitiesJson)) as string[],
    datasetKeys: JSON.parse(String(row.datasetKeysJson)) as string[],
    accent: row.kind === 'report' ? 'teal' : 'blue',
    icon: artifactIcon(row.icon),
    source: String(row.source ?? 'bundled') === 'uploaded' ? 'uploaded' : 'bundled',
    isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    isFavorite: Boolean(row.isFavorite),
    lastOpenedAt: row.lastOpenedAt instanceof Date ? row.lastOpenedAt.toISOString() : row.lastOpenedAt ? String(row.lastOpenedAt) : null,
  };
}

function mergeUploadedDatasetKeys(summary: ArtifactSummary, extras: Array<{ artifactId: string; datasetKey: string }>): string[] {
  if (summary.source !== 'uploaded') return summary.datasetKeys;
  const keys = [...summary.datasetKeys];
  const seen = new Set(keys);
  for (const extra of extras) {
    const key = String(extra.datasetKey);
    if (String(extra.artifactId) !== summary.id || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export interface ArtifactRecord {
  summary: ArtifactSummary;
  bundleLocation: string | null;
  isActive: boolean;
}

function record(row: Row): ArtifactRecord {
  return {
    summary: artifact(row),
    bundleLocation: row.bundleLocation == null ? null : String(row.bundleLocation),
    isActive: Boolean(row.isActive),
  };
}

function group(row: Row): PortalGroup {
  return { id: String(row.id), name: String(row.name), description: String(row.description), memberCount: Number(row.memberCount ?? 0) };
}

function qlikBinding(row: Row): QlikDatasetBinding {
  return {
    artifactId: String(row.artifactId),
    datasetKey: String(row.datasetKey),
    appId: String(row.appId),
    objectId: String(row.objectId),
    refreshHourUtc: Number(row.refreshHourUtc),
    refreshMinuteUtc: Number(row.refreshMinuteUtc),
    enabled: Boolean(row.enabled),
    lastPulledAt: row.lastPulledAt instanceof Date ? row.lastPulledAt.toISOString() : row.lastPulledAt ? String(row.lastPulledAt) : null,
    lastError: row.lastError == null ? null : String(row.lastError),
    lastRecordCount: row.lastRecordCount == null ? null : Number(row.lastRecordCount),
    nextDueAt: row.nextDueAt instanceof Date ? row.nextDueAt.toISOString() : String(row.nextDueAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    transform: parseStoredQlikCleanRecipe(row.transformJson),
  };
}

const NOTIFICATION_TYPE_SET = new Set<string>(PORTAL_NOTIFICATION_TYPES);

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function notification(row: Row): PortalNotification {
  const type = String(row.type ?? 'dataset_refreshed');
  return {
    id: String(row.id),
    type: (NOTIFICATION_TYPE_SET.has(type) ? type : 'dataset_refreshed') as PortalNotificationType,
    artifactId: row.artifactId == null ? null : String(row.artifactId),
    artifactSlug: row.artifactSlug == null ? null : String(row.artifactSlug),
    artifactTitle: row.artifactTitle == null ? null : String(row.artifactTitle),
    artifactKind: row.artifactKind == null ? null : String(row.artifactKind) as ArtifactSummary['kind'],
    datasetKey: row.datasetKey == null ? null : String(row.datasetKey),
    subjectLabel: row.subjectLabel == null ? null : String(row.subjectLabel),
    generatedAt: isoOrNull(row.generatedAt),
    createdAt: isoOrNull(row.createdAt)!,
    readAt: isoOrNull(row.readAt),
  };
}

function accessRequest(row: Row): AccessRequestRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.displayName),
    note: String(row.note ?? ''),
    status: String(row.status) as AccessRequestState,
    createdAt: isoOrNull(row.createdAt)!,
    updatedAt: isoOrNull(row.updatedAt)!,
  };
}

function request(pool: sql.ConnectionPool | sql.Transaction, values: Record<string, unknown> = {}) {
  const result = pool instanceof sql.Transaction ? new sql.Request(pool) : pool.request();
  for (const [name, value] of Object.entries(values)) result.input(name, value as never);
  return result;
}

async function one(pool: sql.ConnectionPool | sql.Transaction, query: string, values: Record<string, unknown> = {}): Promise<Row | null> {
  return (await request(pool, values).query<Row>(query)).recordset[0] ?? null;
}

async function many(pool: sql.ConnectionPool | sql.Transaction, query: string, values: Record<string, unknown> = {}): Promise<Row[]> {
  return (await request(pool, values).query<Row>(query)).recordset;
}

export class PortalRepository {
  private readonly artifactSyncByAdmin = new Map<string, Promise<void>>();

  constructor(private readonly config: AppConfig, private readonly registry: ArtifactRegistry) {}

  private async pool() { return getSqlPool(this.config); }

  private async audit(pool: sql.ConnectionPool | sql.Transaction, actor: PortalIdentity, action: string, subjectType: string, subjectLabel: string, detail: string) {
    await request(pool, {
      id: crypto.randomUUID(), tenantId: actor.tenantId, occurredAt: new Date(), actorUserId: actor.id,
      actorEmail: actor.email, action, subjectType, subjectLabel: subjectLabel.slice(0, 200), detail: detail.slice(0, 2000),
    }).query(`INSERT INTO AuditEvent (id,tenantId,occurredAt,actorUserId,actorEmail,action,subjectType,subjectLabel,detail)
      VALUES (@id,@tenantId,@occurredAt,@actorUserId,@actorEmail,@action,@subjectType,@subjectLabel,@detail)`);
  }

  async resolveUser(principal: VerifiedPrincipal): Promise<PortalIdentity> {
    const pool = await this.pool();
    const principalValues = { tenantId: principal.tenantId, objectId: principal.objectId, email: principal.email };
    // Fast path: returning users already have a bound identity, so a plain read
    // avoids the SERIALIZABLE bind transaction on every request. Status is still
    // checked below, so disabling a user takes effect immediately.
    let row = await one(pool, 'SELECT TOP 1 * FROM PortalUser WHERE tenantId=@tenantId AND entraObjectId=@objectId', principalValues);
    if (!row) row = await this.bindPrincipal(pool, principal);
    if (!row) throw new AppError(403, 'PORTAL_ACCESS_REQUIRED', 'Your work identity has not been added to this portal yet.');
    const user = identity(row);
    if (user.status !== 'active') throw new AppError(403, 'USER_DISABLED', 'Your portal access is pending or disabled.');
    return user;
  }

  private async bindPrincipal(pool: sql.ConnectionPool, principal: VerifiedPrincipal): Promise<Row | null> {
    const principalValues = { tenantId: principal.tenantId, objectId: principal.objectId, email: principal.email };
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let row: Row | null = null;
    try {
      row = await one(transaction, 'SELECT TOP 1 * FROM PortalUser WITH (UPDLOCK,HOLDLOCK) WHERE tenantId=@tenantId AND entraObjectId=@objectId', principalValues);
      if (!row) {
        const pending = await one(transaction, "SELECT TOP 1 * FROM PortalUser WITH (UPDLOCK,HOLDLOCK) WHERE tenantId=@tenantId AND LOWER(email)=@email AND status='pending'", principalValues);
        if (pending) {
          await request(transaction, { id: pending.id, objectId: principal.objectId, updatedAt: new Date() })
            .query("UPDATE PortalUser SET entraObjectId=@objectId,status='active',updatedAt=@updatedAt WHERE id=@id AND status='pending'");
          row = await one(transaction, 'SELECT TOP 1 * FROM PortalUser WHERE id=@id', { id: pending.id });
          if (row) {
            await this.audit(transaction, identity(row), 'user.identity_bound', 'user', String(row.email), 'Verified Microsoft identity bound on first sign-in');
            // Confirm to the administrators that the invite worked.
            await request(transaction, { tenantId: principal.tenantId, userId: pending.id, subjectLabel: String(row.displayName).slice(0, 200), now: new Date() })
              .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],subjectLabel,createdAt,readAt)
                SELECT NEWID(),@tenantId,u.id,NULL,NULL,'user_joined',@subjectLabel,@now,NULL
                FROM PortalUser u
                WHERE u.tenantId=@tenantId AND u.role='admin' AND u.status='active' AND u.id<>@userId`);
          }
        }
      }
      if (!row) {
        const existing = await one(transaction, 'SELECT TOP 1 id FROM PortalUser WITH (UPDLOCK,HOLDLOCK)');
        if (!existing && principal.email === this.config.bootstrapAdminEmail) {
          const id = crypto.randomUUID(); const now = new Date();
          await request(transaction, { id, tenantId: principal.tenantId, objectId: principal.objectId, email: principal.email, displayName: principal.name, now })
            .query("INSERT INTO PortalUser (id,tenantId,entraObjectId,email,displayName,role,status,createdAt,updatedAt) VALUES (@id,@tenantId,@objectId,@email,@displayName,'admin','active',@now,@now)");
          row = await one(transaction, 'SELECT TOP 1 * FROM PortalUser WHERE id=@id', { id });
          if (row) await this.audit(transaction, identity(row), 'user.bootstrapped', 'user', String(row.email), 'Initial portal administrator created');
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return row;
  }

  requireAdmin(user: PortalIdentity): void {
    if (user.role !== 'admin') throw new AppError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  }

  async completeOnboarding(user: PortalIdentity): Promise<void> {
    await request(await this.pool(), { id: user.id, tenantId: user.tenantId, now: new Date() })
      .query('UPDATE PortalUser SET tourCompletedAt=COALESCE(tourCompletedAt,@now),updatedAt=@now WHERE id=@id AND tenantId=@tenantId');
  }

  async ensureArtifacts(admin: PortalIdentity): Promise<void> {
    this.requireAdmin(admin);
    // The bundled artifact registry is fixed for the lifetime of the container,
    // so the sync (and this admin's grants) only needs to run once per process.
    let pending = this.artifactSyncByAdmin.get(admin.id);
    if (!pending) {
      pending = this.syncArtifacts(admin);
      this.artifactSyncByAdmin.set(admin.id, pending);
      pending.catch(() => this.artifactSyncByAdmin.delete(admin.id));
    }
    return pending;
  }

  private async syncArtifacts(admin: PortalIdentity): Promise<void> {
    const pool = await this.pool(); const now = new Date();
    for (const item of this.registry.entries) {
      const manifest = item.manifest;
      const occupied = await one(pool, 'SELECT id,source FROM Artifact WHERE slug=@slug', { slug: manifest.id });
      if (occupied && String(occupied.source) === 'uploaded' && String(occupied.id).toLowerCase() !== item.databaseId.toLowerCase()) continue;
      await request(pool, {
        id: item.databaseId, slug: manifest.id, title: manifest.title, description: manifest.description ?? '', kind: manifest.kind,
        version: manifest.version, owner: manifest.owner, dataDate: manifest.dataDate ?? null,
        entryUrl: artifactEntryUrl(manifest), capabilitiesJson: JSON.stringify(manifest.capabilities), icon: null,
        datasetKeysJson: JSON.stringify(manifest.datasets.map((dataset) => dataset.key)), source: 'bundled', now,
      }).query(`MERGE Artifact AS target USING (SELECT @id AS id) AS incoming ON target.id=incoming.id
        WHEN MATCHED AND target.[source]='bundled' THEN UPDATE SET updatedAt=CASE WHEN target.version<>@version OR target.title<>@title OR target.description<>@description OR target.owner<>@owner OR target.capabilitiesJson<>@capabilitiesJson OR target.datasetKeysJson<>@datasetKeysJson THEN @now ELSE target.updatedAt END,slug=@slug,title=@title,description=@description,kind=@kind,version=@version,owner=@owner,dataDate=@dataDate,entryUrl=@entryUrl,capabilitiesJson=@capabilitiesJson,datasetKeysJson=@datasetKeysJson,[source]=@source,bundleLocation=NULL,isActive=1
        WHEN NOT MATCHED THEN INSERT (id,slug,title,description,kind,version,owner,dataDate,entryUrl,capabilitiesJson,datasetKeysJson,isActive,createdAt,updatedAt,[source],bundleLocation)
        VALUES (@id,@slug,@title,@description,@kind,@version,@owner,@dataDate,@entryUrl,@capabilitiesJson,@datasetKeysJson,1,@now,@now,@source,NULL);`);
      await request(pool, { id: crypto.randomUUID(), artifactId: item.databaseId, userId: admin.id, now })
        .query(`IF NOT EXISTS (SELECT 1 FROM ArtifactGrant WHERE artifactId=@artifactId AND targetType='user' AND targetId=@userId)
          INSERT INTO ArtifactGrant (id,artifactId,targetType,targetId,createdAt,createdByUserId) VALUES (@id,@artifactId,'user',@userId,@now,@userId)`);
    }
    await this.retireMissingBundledArtifacts(admin);
  }

  private async retireMissingBundledArtifacts(actor?: PortalIdentity): Promise<void> {
    const pool = await this.pool();
    const keep = new Set(this.registry.entries.map((item) => item.manifest.id));
    const leftover = await many(pool, "SELECT id, slug, title FROM Artifact WHERE source='bundled'");
    for (const row of leftover) {
      if (keep.has(String(row.slug))) continue;
      const id = String(row.id);
      await request(pool, { id }).query('DELETE FROM PortalNotification WHERE artifactId=@id');
      await request(pool, { id }).query('DELETE FROM QlikDatasetBinding WHERE artifactId=@id');
      await request(pool, { id }).query('DELETE FROM Dataset WHERE artifactId=@id');
      await request(pool, { id }).query("DELETE FROM Artifact WHERE id=@id AND source='bundled'");
      if (actor) await this.audit(pool, actor, 'artifact.unbundled', 'artifact', String(row.slug), String(row.title));
    }
  }

  async catalog(user: PortalIdentity): Promise<ArtifactSummary[]> {
    await this.retireMissingBundledArtifacts();
    const pool = await this.pool();
    const [rows, bindings, datasets] = await Promise.all([
      many(pool, `SELECT DISTINCT a.*,CAST(CASE WHEN f.userId IS NULL THEN 0 ELSE 1 END AS bit) isFavorite,recent.lastOpenedAt FROM Artifact a JOIN ArtifactGrant g ON g.artifactId=a.id
      LEFT JOIN ArtifactFavorite f ON f.artifactId=a.id AND f.userId=@userId
      OUTER APPLY (SELECT MAX(pue.occurredAt) lastOpenedAt FROM PortalUsageEvent pue WHERE pue.userId=@userId AND pue.artifactId=a.id AND pue.eventType='artifact_ready') recent
      WHERE a.isActive=1 AND ((g.targetType='user' AND g.targetId=@userId) OR
      (g.targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=g.targetId AND gm.userId=@userId)))
      ORDER BY a.kind,a.title`, { userId: user.id }),
      many(pool, 'SELECT artifactId, datasetKey FROM QlikDatasetBinding'),
      many(pool, "SELECT artifactId, datasetKey FROM Dataset WHERE status='active'"),
    ]);
    const extras = [...bindings, ...datasets].map((row) => ({ artifactId: String(row.artifactId), datasetKey: String(row.datasetKey) }));
    return rows.map((row) => {
      const summary = artifact(row);
      summary.datasetKeys = mergeUploadedDatasetKeys(summary, extras);
      return summary;
    });
  }

  async setFavorite(user: PortalIdentity, artifactId: string, enabled: boolean): Promise<void> {
    await this.canReadArtifact(user, artifactId);
    const pool = await this.pool();
    if (enabled) {
      await request(pool, { userId: user.id, artifactId, now: new Date() }).query(`IF NOT EXISTS (SELECT 1 FROM ArtifactFavorite WHERE userId=@userId AND artifactId=@artifactId)
        INSERT INTO ArtifactFavorite (userId,artifactId,createdAt) VALUES (@userId,@artifactId,@now)`);
    } else {
      await request(pool, { userId: user.id, artifactId }).query('DELETE FROM ArtifactFavorite WHERE userId=@userId AND artifactId=@artifactId');
    }
    if (usageTelemetryEnabled(this.config, user.role)) {
      try { await this.recordFavoriteUsage(user, artifactId, enabled); }
      catch (error) { console.error(JSON.stringify({ event: 'usage.favorite.failed', code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' })); }
    }
  }

  async recordUsageEvents(user: PortalIdentity, events: ValidatedUsageEvent[]): Promise<void> {
    const artifactIds = [...new Set(events.map((event) => event.artifactId).filter((value): value is string => Boolean(value)))];
    await Promise.all(artifactIds.map((artifactId) => this.canReadArtifact(user, artifactId)));
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const event of events) {
        await request(transaction, {
          id: event.id, tenantId: user.tenantId, userId: user.id, eventType: event.eventType,
          sessionId: event.sessionId, interactionId: event.interactionId ?? null, artifactId: event.artifactId ?? null,
          occurredAt: new Date(event.occurredAt), resultCount: event.resultCount ?? null, kindFilter: event.kindFilter ?? null,
          filterCount: event.filterCount ?? null, errorCode: event.errorCode ?? null, durationMs: event.durationMs ?? null,
        }).query(`IF NOT EXISTS (SELECT 1 FROM PortalUsageEvent WITH (UPDLOCK,HOLDLOCK) WHERE id=@id)
          INSERT INTO PortalUsageEvent (id,tenantId,userId,eventType,sessionId,interactionId,artifactId,occurredAt,resultCount,kindFilter,filterCount,errorCode,durationMs,favoriteEnabled)
          VALUES (@id,@tenantId,@userId,@eventType,@sessionId,@interactionId,@artifactId,@occurredAt,@resultCount,@kindFilter,@filterCount,@errorCode,@durationMs,NULL)`);
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async recordFavoriteUsage(user: PortalIdentity, artifactId: string, enabled: boolean): Promise<void> {
    await request(await this.pool(), {
      id: crypto.randomUUID(), tenantId: user.tenantId, userId: user.id, eventType: 'favorite_changed',
      sessionId: crypto.randomUUID(), artifactId, occurredAt: new Date(), favoriteEnabled: enabled,
    }).query(`INSERT INTO PortalUsageEvent (id,tenantId,userId,eventType,sessionId,interactionId,artifactId,occurredAt,favoriteEnabled)
      VALUES (@id,@tenantId,@userId,@eventType,@sessionId,NULL,@artifactId,@occurredAt,@favoriteEnabled)`);
  }

  async usageInsights(admin: PortalIdentity, range: UsageInsightsRange, now = new Date()): Promise<UsageInsights> {
    this.requireAdmin(admin);
    const pool = await this.pool();
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 28;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1));
    const weeklyFrom = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const monthlyFrom = new Date(now.getTime() - 28 * 24 * 60 * 60_000);
    const week2 = new Date(now.getTime() - 14 * 24 * 60 * 60_000);
    const week3 = new Date(now.getTime() - 21 * 24 * 60 * 60_000);
    const values = { tenantId: admin.tenantId, from, now, weeklyFrom, monthlyFrom, week2, week3 };
    const [summaryRow, activationRow, dailyRows, artifactRows] = await Promise.all([
      one(pool, `SELECT
        COUNT(DISTINCT CASE WHEN eventType='artifact_ready' AND occurredAt>=@weeklyFrom THEN userId END) weeklyActiveUsers,
        COUNT(DISTINCT CASE WHEN eventType='artifact_ready' AND occurredAt>=@monthlyFrom THEN userId END) monthlyActiveUsers,
        SUM(CASE WHEN eventType='artifact_ready' AND occurredAt>=@from THEN 1 ELSE 0 END) successfulLoads,
        SUM(CASE WHEN eventType='artifact_failed' AND occurredAt>=@from THEN 1 ELSE 0 END) failedLoads,
        SUM(CASE WHEN eventType='catalog_searched' AND occurredAt>=@from THEN 1 ELSE 0 END) searches,
        SUM(CASE WHEN eventType='catalog_searched' AND occurredAt>=@from AND resultCount=0 THEN 1 ELSE 0 END) zeroResultSearches,
        SUM(CASE WHEN eventType='favorite_changed' AND occurredAt>=@from AND favoriteEnabled=1 THEN 1 ELSE 0 END) favoriteAdds,
        SUM(CASE WHEN eventType='favorite_changed' AND occurredAt>=@from AND favoriteEnabled=0 THEN 1 ELSE 0 END) favoriteRemovals
        FROM PortalUsageEvent WHERE tenantId=@tenantId AND occurredAt<@now`, values),
      one(pool, `SELECT
        (SELECT COUNT(*) FROM PortalUser WHERE tenantId=@tenantId AND status='active') activePortalUsers,
        COUNT(DISTINCT CASE WHEN eventType='portal_session_started' AND occurredAt>=@from THEN userId END) usersWithPortalSession,
        COUNT(DISTINCT CASE WHEN eventType='artifact_ready' AND occurredAt>=@from THEN userId END) usersWithSuccessfulArtifact,
        (SELECT COUNT(*) FROM (
          SELECT currentWeek.userId FROM
            (SELECT DISTINCT userId FROM PortalUsageEvent WHERE tenantId=@tenantId AND eventType='artifact_ready' AND occurredAt>=@weeklyFrom AND occurredAt<@now) currentWeek
          JOIN PortalUsageEvent previous ON previous.userId=currentWeek.userId AND previous.tenantId=@tenantId AND previous.eventType='artifact_ready'
            AND previous.occurredAt>=@monthlyFrom AND previous.occurredAt<@weeklyFrom
          GROUP BY currentWeek.userId
          HAVING COUNT(DISTINCT CASE WHEN previous.occurredAt>=@week2 THEN 1 WHEN previous.occurredAt>=@week3 THEN 2 ELSE 3 END)>=2
        ) returning) repeatUsers
        FROM PortalUsageEvent WHERE tenantId=@tenantId AND occurredAt>=@from AND occurredAt<@now`, values),
      many(pool, `SELECT CONVERT(date,occurredAt) [date],
        COUNT(DISTINCT CASE WHEN eventType='artifact_ready' THEN userId END) activeUsers,
        SUM(CASE WHEN eventType='artifact_ready' THEN 1 ELSE 0 END) successfulLoads,
        SUM(CASE WHEN eventType='artifact_failed' THEN 1 ELSE 0 END) failedLoads,
        SUM(CASE WHEN eventType='catalog_searched' THEN 1 ELSE 0 END) searches,
        SUM(CASE WHEN eventType='catalog_searched' AND resultCount=0 THEN 1 ELSE 0 END) zeroResultSearches
        FROM PortalUsageEvent WHERE tenantId=@tenantId AND occurredAt>=@from AND occurredAt<@now
        GROUP BY CONVERT(date,occurredAt) ORDER BY [date]`, values),
      many(pool, `SELECT a.id artifactId,a.title,a.kind,
        COUNT(DISTINCT CASE WHEN pue.eventType='artifact_ready' THEN pue.userId END) uniqueUsers,
        SUM(CASE WHEN pue.eventType='artifact_ready' THEN 1 ELSE 0 END) successfulLoads,
        SUM(CASE WHEN pue.eventType='artifact_failed' THEN 1 ELSE 0 END) failedLoads,
        MAX(CASE WHEN pue.eventType='artifact_ready' THEN pue.occurredAt END) lastUsedAt,
        SUM(CASE WHEN pue.eventType='favorite_changed' AND pue.favoriteEnabled=1 THEN 1 ELSE 0 END) favoriteAdds
        FROM PortalUsageEvent pue JOIN Artifact a ON a.id=pue.artifactId
        WHERE pue.tenantId=@tenantId AND pue.occurredAt>=@from AND pue.occurredAt<@now
        GROUP BY a.id,a.title,a.kind
        ORDER BY successfulLoads DESC,a.title`, values),
    ]);
    const summary = summaryRow ?? {};
    const activation = activationRow ?? {};
    const successfulLoads = Number(summary.successfulLoads ?? 0);
    const failedLoads = Number(summary.failedLoads ?? 0);
    const searches = Number(summary.searches ?? 0);
    const zeroResultSearches = Number(summary.zeroResultSearches ?? 0);
    const weeklyActiveUsers = Number(summary.weeklyActiveUsers ?? 0);
    const repeatUsers = Number(activation.repeatUsers ?? 0);
    const percent = (part: number, total: number) => total > 0 ? Math.round((part / total) * 10_000) / 100 : 0;
    const dailyByDate = new Map(dailyRows.map((row) => [new Date(String(row.date)).toISOString().slice(0, 10), row]));
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + index)).toISOString().slice(0, 10);
      const row = dailyByDate.get(date) ?? {};
      return { date, activeUsers: Number(row.activeUsers ?? 0), successfulLoads: Number(row.successfulLoads ?? 0), failedLoads: Number(row.failedLoads ?? 0), searches: Number(row.searches ?? 0), zeroResultSearches: Number(row.zeroResultSearches ?? 0) };
    });
    return {
      range, from: from.toISOString(), to: now.toISOString(),
      summary: {
        weeklyActiveUsers, monthlyActiveUsers: Number(summary.monthlyActiveUsers ?? 0), repeatUsers,
        repeatUserRate: percent(repeatUsers, weeklyActiveUsers), successfulLoads, failedLoads,
        loadSuccessRate: percent(successfulLoads, successfulLoads + failedLoads), searches, zeroResultSearches,
        zeroResultRate: percent(zeroResultSearches, searches), favoriteAdds: Number(summary.favoriteAdds ?? 0), favoriteRemovals: Number(summary.favoriteRemovals ?? 0),
      },
      activation: { activePortalUsers: Number(activation.activePortalUsers ?? 0), usersWithPortalSession: Number(activation.usersWithPortalSession ?? 0), usersWithSuccessfulArtifact: Number(activation.usersWithSuccessfulArtifact ?? 0), repeatUsers },
      daily,
      artifacts: artifactRows.map((row) => {
        const ready = Number(row.successfulLoads ?? 0); const failed = Number(row.failedLoads ?? 0);
        return { artifactId: String(row.artifactId), title: String(row.title), kind: String(row.kind) as ArtifactSummary['kind'], uniqueUsers: Number(row.uniqueUsers ?? 0), successfulLoads: ready, failedLoads: failed, loadSuccessRate: percent(ready, ready + failed), lastUsedAt: isoOrNull(row.lastUsedAt), favoriteAdds: Number(row.favoriteAdds ?? 0) };
      }),
    };
  }

  async deleteUsageEventsBefore(cutoff: Date): Promise<number> {
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const row = await one(transaction, `DECLARE @lockResult int,@deleted int=0,@batch int=1;
        EXEC @lockResult=sp_getapplock @Resource='portal-usage-retention',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0;
        IF @lockResult>=0 BEGIN
          WHILE @batch>0 AND @deleted<100000 BEGIN
            DELETE TOP (10000) FROM PortalUsageEvent WHERE occurredAt<@cutoff;
            SET @batch=@@ROWCOUNT; SET @deleted=@deleted+@batch;
          END
        END
        SELECT @deleted deleted`, { cutoff });
      await transaction.commit();
      return Number(row?.deleted ?? 0);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async canReadArtifact(user: PortalIdentity, artifactId: string): Promise<void> {
    const allowed = await one(await this.pool(), `SELECT TOP 1 g.id FROM ArtifactGrant g JOIN Artifact a ON a.id=g.artifactId AND a.isActive=1
      WHERE g.artifactId=@artifactId AND ((g.targetType='user' AND g.targetId=@userId) OR
      (g.targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=g.targetId AND gm.userId=@userId)))`, { artifactId, userId: user.id });
    if (!allowed) throw new AppError(403, 'GRANT_REQUIRED', 'Artifact data access is denied.');
  }

  async activeDataset(artifactId: string, datasetKey: string): Promise<Row> {
    const row = await one(await this.pool(), "SELECT TOP 1 * FROM Dataset WHERE artifactId=@artifactId AND datasetKey=@datasetKey AND status='active' ORDER BY createdAt DESC", { artifactId, datasetKey });
    if (!row) throw new AppError(404, 'DATASET_MISSING', 'The requested dataset has not been uploaded yet.');
    return row;
  }

  async notifications(user: PortalIdentity): Promise<NotificationFeed> {
    const pool = await this.pool();
    // Artifact-scoped events stay visible only while the user still holds a
    // grant; admin events (access requests, joins) carry no artifact.
    const visible = `(pn.artifactId IS NULL OR (a.isActive=1 AND EXISTS (SELECT 1 FROM ArtifactGrant g WHERE g.artifactId=pn.artifactId AND
      ((g.targetType='user' AND g.targetId=@userId) OR
      (g.targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=g.targetId AND gm.userId=@userId))))))`;
    const [rows, count] = await Promise.all([
      many(pool, `SELECT TOP 50 pn.id,pn.[type],pn.subjectLabel,pn.artifactId,pn.createdAt,pn.readAt,
        a.slug artifactSlug,a.title artifactTitle,a.kind artifactKind,d.datasetKey,d.generatedAt
        FROM PortalNotification pn
        LEFT JOIN Artifact a ON a.id=pn.artifactId
        LEFT JOIN Dataset d ON d.id=pn.datasetId
        WHERE pn.userId=@userId AND pn.tenantId=@tenantId AND ${visible}
        ORDER BY pn.createdAt DESC`, { userId: user.id, tenantId: user.tenantId }),
      one(pool, `SELECT COUNT(*) unreadCount FROM PortalNotification pn
        LEFT JOIN Artifact a ON a.id=pn.artifactId
        WHERE pn.userId=@userId AND pn.tenantId=@tenantId AND pn.readAt IS NULL AND ${visible}`,
      { userId: user.id, tenantId: user.tenantId }),
    ]);
    return { items: rows.map(notification), unreadCount: Number(count?.unreadCount ?? 0) };
  }

  async markNotificationRead(user: PortalIdentity, id: string): Promise<void> {
    await request(await this.pool(), { id, userId: user.id, tenantId: user.tenantId, now: new Date() })
      .query('UPDATE PortalNotification SET readAt=COALESCE(readAt,@now) WHERE id=@id AND userId=@userId AND tenantId=@tenantId');
  }

  async markAllNotificationsRead(user: PortalIdentity): Promise<void> {
    await request(await this.pool(), { userId: user.id, tenantId: user.tenantId, now: new Date() })
      .query('UPDATE PortalNotification SET readAt=@now WHERE userId=@userId AND tenantId=@tenantId AND readAt IS NULL');
  }

  async registerDataset(admin: PortalIdentity, values: { artifactId: string; datasetKey: string; schemaVersion: number; generatedAt: Date; checksum: string; sizeBytes: number; recordCount: number; storageLocation: string }): Promise<void> {
    this.requireAdmin(admin); const pool = await this.pool(); const transaction = new sql.Transaction(pool); await transaction.begin();
    try {
      const datasetId = crypto.randomUUID(); const createdAt = new Date();
      await request(transaction, values).query("UPDATE Dataset SET status='superseded' WHERE artifactId=@artifactId AND datasetKey=@datasetKey AND status='active'");
      await request(transaction, { id: datasetId, ...values, createdAt, createdByUserId: admin.id })
        .query(`INSERT INTO Dataset (id,artifactId,datasetKey,schemaVersion,generatedAt,checksum,sizeBytes,recordCount,storageLocation,status,createdAt,createdByUserId)
          VALUES (@id,@artifactId,@datasetKey,@schemaVersion,@generatedAt,@checksum,@sizeBytes,@recordCount,@storageLocation,'active',@createdAt,@createdByUserId)`);
      await request(transaction, { tenantId: admin.tenantId, artifactId: values.artifactId, datasetId, createdAt })
        .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],createdAt,readAt)
          SELECT NEWID(),@tenantId,u.id,@artifactId,@datasetId,'dataset_refreshed',@createdAt,NULL
          FROM PortalUser u
          WHERE u.tenantId=@tenantId AND u.status='active' AND EXISTS (
            SELECT 1 FROM ArtifactGrant g WHERE g.artifactId=@artifactId AND
            ((g.targetType='user' AND g.targetId=u.id) OR
            (g.targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=g.targetId AND gm.userId=u.id)))
          )`);
      await this.audit(transaction, admin, 'dataset.seeded', 'dataset', `${values.artifactId}/${values.datasetKey}`, JSON.stringify({ checksum: values.checksum, sizeBytes: values.sizeBytes, recordCount: values.recordCount }));
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
  }

  async adminSnapshot(admin: PortalIdentity): Promise<AdminSnapshot> {
    this.requireAdmin(admin); await this.ensureArtifacts(admin); const pool = await this.pool();
    const [users, groups, memberships, grants, artifacts, datasets, qlikBindings, auditRows, accessRequests] = await Promise.all([
      many(pool, 'SELECT * FROM PortalUser ORDER BY displayName'),
      many(pool, 'SELECT g.*,(SELECT COUNT(*) FROM GroupMember gm WHERE gm.groupId=g.id) memberCount FROM AccessGroup g ORDER BY name'),
      many(pool, 'SELECT * FROM GroupMember'), many(pool, 'SELECT * FROM ArtifactGrant'),
      many(pool, 'SELECT * FROM Artifact ORDER BY title'), many(pool, 'SELECT * FROM Dataset ORDER BY createdAt DESC'),
      many(pool, 'SELECT * FROM QlikDatasetBinding ORDER BY datasetKey'),
      many(pool, 'SELECT TOP 500 * FROM AuditEvent ORDER BY occurredAt DESC'),
      many(pool, 'SELECT TOP 200 * FROM AccessRequest WHERE tenantId=@tenantId ORDER BY createdAt DESC', { tenantId: admin.tenantId }),
    ]);
    const summaries = artifacts.map(artifact);
    const bindings = qlikBindings.map(qlikBinding);
    const extras = [
      ...bindings.map((binding) => ({ artifactId: binding.artifactId, datasetKey: binding.datasetKey })),
      ...datasets.filter((row) => String(row.status) === 'active').map((row) => ({ artifactId: String(row.artifactId), datasetKey: String(row.datasetKey) })),
    ];
    for (const summary of summaries) {
      const next = mergeUploadedDatasetKeys(summary, extras);
      if (next.length === summary.datasetKeys.length && next.every((key, index) => key === summary.datasetKeys[index])) continue;
      summary.datasetKeys = next;
      await request(pool, { id: summary.id, datasetKeysJson: JSON.stringify(summary.datasetKeys), now: new Date() })
        .query("UPDATE Artifact SET datasetKeysJson=@datasetKeysJson,updatedAt=@now WHERE id=@id AND [source]='uploaded'");
    }
    return {
      users: users.map(identity), groups: groups.map(group),
      memberships: memberships.map((row) => ({ id: String(row.id), groupId: String(row.groupId), userId: String(row.userId) })),
      grants: grants.map((row) => ({ id: String(row.id), artifactId: String(row.artifactId), targetType: String(row.targetType) as 'user' | 'group', targetId: String(row.targetId) })),
      artifacts: summaries,
      datasets: datasets.map((row) => serialise(row) as unknown as DatasetRecord),
      qlikBindings: bindings,
      qlikConfigured: Boolean(this.config.qlikTenantUrl && this.config.qlikApiKey),
      audit: auditRows.map((row) => serialise(row) as unknown as AdminSnapshot['audit'][number]),
      accessRequests: accessRequests.map(accessRequest),
    };
  }

  async addUser(admin: PortalIdentity, input: { email: string; displayName: string; role: PortalRole }): Promise<PortalIdentity> {
    this.requireAdmin(admin);
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
    if (!email.includes('@') || !displayName || !['viewer', 'admin'].includes(input.role)) throw new AppError(400, 'INVALID_USER', 'Enter a valid name, email, and role.');
    const pool = await this.pool(); if (await one(pool, 'SELECT id FROM PortalUser WHERE LOWER(email)=@email', { email })) throw new AppError(409, 'USER_EXISTS', 'That user already exists.');
    const id = crypto.randomUUID(); const now = new Date();
    await request(pool, { id, tenantId: admin.tenantId, email, displayName, role: input.role, now })
      .query("INSERT INTO PortalUser (id,tenantId,entraObjectId,email,displayName,role,status,createdAt,updatedAt) VALUES (@id,@tenantId,NULL,@email,@displayName,@role,'pending',@now,@now)");
    await this.audit(pool, admin, 'user.created', 'user', email, 'Pending identity created');
    return identity((await one(pool, 'SELECT * FROM PortalUser WHERE id=@id', { id }))!);
  }

  async getUser(admin: PortalIdentity, id: string): Promise<PortalIdentity> {
    this.requireAdmin(admin);
    const row = await one(await this.pool(), 'SELECT * FROM PortalUser WHERE id=@id AND tenantId=@tenantId', { id, tenantId: admin.tenantId });
    if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'The user was not found.');
    return identity(row);
  }

  async updateUser(admin: PortalIdentity, id: string, patch: { status?: UserStatus; role?: PortalRole }): Promise<void> {
    this.requireAdmin(admin); const pool = await this.pool(); const target = await one(pool, 'SELECT * FROM PortalUser WHERE id=@id AND tenantId=@tenantId', { id, tenantId: admin.tenantId });
    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'The user was not found.');
    const status = patch.status ?? String(target.status); const role = patch.role ?? String(target.role);
    if (!['pending', 'active', 'disabled'].includes(status) || !['viewer', 'admin'].includes(role)) throw new AppError(400, 'INVALID_USER', 'The user update is invalid.');
    if (id === admin.id && (status === 'disabled' || role !== 'admin')) throw new AppError(409, 'SELF_LOCKOUT', 'You cannot remove your own administrator access.');
    await request(pool, { id, status, role, updatedAt: new Date() }).query('UPDATE PortalUser SET status=@status,role=@role,updatedAt=@updatedAt WHERE id=@id');
    await this.audit(pool, admin, 'user.updated', 'user', String(target.email), JSON.stringify({ status, role }));
  }

  async deleteUser(admin: PortalIdentity, id: string): Promise<void> {
    this.requireAdmin(admin);
    if (id === admin.id) throw new AppError(409, 'SELF_DELETE', 'You cannot remove your own administrator account.');
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const target = await one(transaction, 'SELECT TOP 1 * FROM PortalUser WITH (UPDLOCK,HOLDLOCK) WHERE id=@id AND tenantId=@tenantId', { id, tenantId: admin.tenantId });
      if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'The user was not found.');
      await request(transaction, { id, adminId: admin.id }).query('UPDATE ArtifactGrant SET createdByUserId=@adminId WHERE createdByUserId=@id');
      await request(transaction, { id, adminId: admin.id }).query('UPDATE Dataset SET createdByUserId=@adminId WHERE createdByUserId=@id');
      await request(transaction, { id }).query('UPDATE AccessRequest SET resolvedByUserId=NULL WHERE resolvedByUserId=@id');
      await request(transaction, { id }).query('DELETE FROM PortalNotification WHERE userId=@id');
      await request(transaction, { id }).query('DELETE FROM GroupMember WHERE userId=@id');
      await request(transaction, { id }).query("DELETE FROM ArtifactGrant WHERE targetType='user' AND targetId=@id");
      await request(transaction, { id }).query('DELETE FROM PortalUser WHERE id=@id');
      await this.audit(transaction, admin, 'user.deleted', 'user', String(target.email), 'Portal identity and access assignments removed');
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getAccessRequest(principal: VerifiedPrincipal): Promise<AccessRequestRecord | null> {
    const row = await one(await this.pool(), 'SELECT TOP 1 * FROM AccessRequest WHERE tenantId=@tenantId AND entraObjectId=@objectId', { tenantId: principal.tenantId, objectId: principal.objectId });
    return row ? accessRequest(row) : null;
  }

  async submitAccessRequest(principal: VerifiedPrincipal, note: unknown): Promise<AccessRequestRecord> {
    const trimmedNote = (typeof note === 'string' ? note : '').trim().slice(0, 500);
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const now = new Date();
      const values = {
        id: crypto.randomUUID(), tenantId: principal.tenantId, objectId: principal.objectId,
        email: principal.email, displayName: principal.name.slice(0, 200), note: trimmedNote, now,
      };
      await request(transaction, values).query(`MERGE AccessRequest AS target
        USING (SELECT @tenantId AS tenantId, @objectId AS entraObjectId) AS incoming
        ON target.tenantId=incoming.tenantId AND target.entraObjectId=incoming.entraObjectId
        WHEN MATCHED THEN UPDATE SET email=@email,displayName=@displayName,note=@note,status='requested',resolvedByUserId=NULL,updatedAt=@now
        WHEN NOT MATCHED THEN INSERT (id,tenantId,entraObjectId,email,displayName,note,status,createdAt,updatedAt)
        VALUES (@id,@tenantId,@objectId,@email,@displayName,@note,'requested',@now,@now);`);
      // Requesters have no PortalUser row yet, so the audit entry carries no actor id.
      await request(transaction, {
        auditId: crypto.randomUUID(), tenantId: principal.tenantId, occurredAt: now, actorEmail: principal.email,
        subjectLabel: principal.email.slice(0, 200), detail: (trimmedNote || 'Portal access requested').slice(0, 2000),
      }).query(`INSERT INTO AuditEvent (id,tenantId,occurredAt,actorUserId,actorEmail,action,subjectType,subjectLabel,detail)
        VALUES (@auditId,@tenantId,@occurredAt,NULL,@actorEmail,'access.requested','user',@subjectLabel,@detail)`);
      await request(transaction, { tenantId: principal.tenantId, subjectLabel: `${principal.name} (${principal.email})`.slice(0, 200), now })
        .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],subjectLabel,createdAt,readAt)
          SELECT NEWID(),@tenantId,u.id,NULL,NULL,'access_requested',@subjectLabel,@now,NULL
          FROM PortalUser u
          WHERE u.tenantId=@tenantId AND u.role='admin' AND u.status='active'
            AND NOT EXISTS (SELECT 1 FROM PortalNotification x WHERE x.userId=u.id AND x.[type]='access_requested' AND x.subjectLabel=@subjectLabel AND x.readAt IS NULL)`);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const saved = await this.getAccessRequest(principal);
    if (!saved) throw new AppError(500, 'ACCESS_REQUEST_FAILED', 'The access request could not be saved.');
    return saved;
  }

  async approveAccessRequest(admin: PortalIdentity, id: string, role: PortalRole): Promise<PortalIdentity> {
    this.requireAdmin(admin);
    if (!['viewer', 'admin'].includes(role)) throw new AppError(400, 'INVALID_USER', 'The requested role is invalid.');
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let approvedId: string;
    try {
      const target = await one(transaction, 'SELECT TOP 1 * FROM AccessRequest WITH (UPDLOCK,HOLDLOCK) WHERE id=@id AND tenantId=@tenantId', { id, tenantId: admin.tenantId });
      if (!target) throw new AppError(404, 'ACCESS_REQUEST_NOT_FOUND', 'The access request was not found.');
      const email = String(target.email).toLowerCase();
      const objectId = String(target.entraObjectId);
      const now = new Date();
      const existing = await one(transaction, 'SELECT TOP 1 * FROM PortalUser WITH (UPDLOCK,HOLDLOCK) WHERE tenantId=@tenantId AND (LOWER(email)=@email OR entraObjectId=@objectId)', { tenantId: admin.tenantId, email, objectId });
      if (existing) {
        approvedId = String(existing.id);
        await request(transaction, { userId: approvedId, objectId, now })
          .query("UPDATE PortalUser SET status='active',entraObjectId=COALESCE(entraObjectId,@objectId),updatedAt=@now WHERE id=@userId");
      } else {
        approvedId = crypto.randomUUID();
        await request(transaction, { userId: approvedId, tenantId: admin.tenantId, objectId, email, displayName: String(target.displayName), role, now })
          .query("INSERT INTO PortalUser (id,tenantId,entraObjectId,email,displayName,role,status,createdAt,updatedAt) VALUES (@userId,@tenantId,@objectId,@email,@displayName,@role,'active',@now,@now)");
      }
      await request(transaction, { id, adminId: admin.id, now }).query("UPDATE AccessRequest SET status='approved',resolvedByUserId=@adminId,updatedAt=@now WHERE id=@id");
      await this.audit(transaction, admin, 'access.approved', 'user', email, existing ? 'Existing identity re-activated from an access request' : 'Identity created from an access request');
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return identity((await one(pool, 'SELECT * FROM PortalUser WHERE id=@id', { id: approvedId }))!);
  }

  async dismissAccessRequest(admin: PortalIdentity, id: string): Promise<void> {
    this.requireAdmin(admin);
    const pool = await this.pool();
    const target = await one(pool, 'SELECT TOP 1 * FROM AccessRequest WHERE id=@id AND tenantId=@tenantId', { id, tenantId: admin.tenantId });
    if (!target) throw new AppError(404, 'ACCESS_REQUEST_NOT_FOUND', 'The access request was not found.');
    await request(pool, { id, adminId: admin.id, now: new Date() }).query("UPDATE AccessRequest SET status='dismissed',resolvedByUserId=@adminId,updatedAt=@now WHERE id=@id");
    await this.audit(pool, admin, 'access.dismissed', 'user', String(target.email), 'Access request dismissed');
  }

  async addGroup(admin: PortalIdentity, input: { name: string; description: string }): Promise<PortalGroup> {
    this.requireAdmin(admin);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    if (!name) throw new AppError(400, 'INVALID_GROUP', 'Enter a group name.');
    const pool = await this.pool(); const id = crypto.randomUUID(); const now = new Date();
    try { await request(pool, { id, tenantId: admin.tenantId, name, description, now }).query('INSERT INTO AccessGroup (id,tenantId,name,description,createdAt,updatedAt) VALUES (@id,@tenantId,@name,@description,@now,@now)'); }
    catch (error) { if ((error as { number?: number }).number === 2601 || (error as { number?: number }).number === 2627) throw new AppError(409, 'GROUP_EXISTS', 'That group already exists.'); throw error; }
    await this.audit(pool, admin, 'group.created', 'group', name, description);
    return group((await one(pool, 'SELECT *,0 memberCount FROM AccessGroup WHERE id=@id', { id }))!);
  }

  async setMembership(admin: PortalIdentity, groupId: string, userId: string, enabled: boolean): Promise<void> {
    this.requireAdmin(admin); const pool = await this.pool();
    if (enabled) {
      const inserted = await request(pool, { id: crypto.randomUUID(), groupId, userId, now: new Date() }).query(`IF NOT EXISTS (SELECT 1 FROM GroupMember WHERE groupId=@groupId AND userId=@userId)
        INSERT INTO GroupMember (id,groupId,userId,createdAt) VALUES (@id,@groupId,@userId,@now)`);
      if ((inserted.rowsAffected[0] ?? 0) > 0) {
        // The new member gains access to everything granted to the group.
        await request(pool, { tenantId: admin.tenantId, groupId, userId, actorId: admin.id, now: new Date() })
          .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],createdAt,readAt)
            SELECT NEWID(),@tenantId,@userId,g.artifactId,NULL,'access_granted',@now,NULL
            FROM ArtifactGrant g JOIN Artifact a ON a.id=g.artifactId AND a.isActive=1
            WHERE g.targetType='group' AND g.targetId=@groupId AND @userId<>@actorId
              AND NOT EXISTS (SELECT 1 FROM PortalNotification x WHERE x.userId=@userId AND x.artifactId=g.artifactId AND x.[type]='access_granted' AND x.readAt IS NULL)`);
      }
    } else {
      await request(pool, { groupId, userId }).query('DELETE FROM GroupMember WHERE groupId=@groupId AND userId=@userId');
    }
    await this.audit(pool, admin, enabled ? 'membership.created' : 'membership.removed', 'group', groupId, userId);
  }

  async setGrant(admin: PortalIdentity, input: { artifactId: string; targetType: 'user' | 'group'; targetId: string; enabled: boolean }): Promise<void> {
    this.requireAdmin(admin); if (!['user', 'group'].includes(input.targetType)) throw new AppError(400, 'INVALID_GRANT', 'The grant target is invalid.');
    const pool = await this.pool();
    const existing = await one(pool, 'SELECT TOP 1 id FROM ArtifactGrant WHERE artifactId=@artifactId AND targetType=@targetType AND targetId=@targetId', input);
    await request(pool, input).query('DELETE FROM ArtifactGrant WHERE artifactId=@artifactId AND targetType=@targetType AND targetId=@targetId');
    if (input.enabled) await request(pool, { id: crypto.randomUUID(), ...input, now: new Date(), actorId: admin.id }).query('INSERT INTO ArtifactGrant (id,artifactId,targetType,targetId,createdAt,createdByUserId) VALUES (@id,@artifactId,@targetType,@targetId,@now,@actorId)');
    if (input.enabled && !existing) {
      await request(pool, { tenantId: admin.tenantId, artifactId: input.artifactId, targetType: input.targetType, targetId: input.targetId, actorId: admin.id, now: new Date() })
        .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],createdAt,readAt)
          SELECT NEWID(),@tenantId,u.id,@artifactId,NULL,'access_granted',@now,NULL
          FROM PortalUser u
          WHERE u.tenantId=@tenantId AND u.id<>@actorId AND u.status<>'disabled'
            AND ((@targetType='user' AND u.id=@targetId)
              OR (@targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=@targetId AND gm.userId=u.id)))
            AND NOT EXISTS (SELECT 1 FROM PortalNotification x WHERE x.userId=u.id AND x.artifactId=@artifactId AND x.[type]='access_granted' AND x.readAt IS NULL)`);
    }
    await this.audit(pool, admin, input.enabled ? 'grant.created' : 'grant.removed', input.targetType, input.targetId, input.artifactId);
  }

  async bootstrapAdmin(): Promise<PortalIdentity | null> {
    const row = await one(await this.pool(), "SELECT TOP 1 * FROM PortalUser WHERE role='admin' AND status='active' AND LOWER(email)=@email", { email: this.config.bootstrapAdminEmail });
    if (row) return identity(row);
    const fallback = await one(await this.pool(), "SELECT TOP 1 * FROM PortalUser WHERE role='admin' AND status='active' ORDER BY createdAt");
    return fallback ? identity(fallback) : null;
  }

  async getQlikBinding(artifactId: string, datasetKey: string): Promise<QlikDatasetBinding | null> {
    const row = await one(await this.pool(), 'SELECT TOP 1 * FROM QlikDatasetBinding WHERE artifactId=@artifactId AND datasetKey=@datasetKey', { artifactId, datasetKey });
    return row ? qlikBinding(row) : null;
  }

  async upsertQlikBinding(admin: PortalIdentity, input: {
    artifactId: string; datasetKey: string; appId: string; objectId: string; refreshHourUtc: number; refreshMinuteUtc: number; enabled?: boolean; transform: QlikCleanRecipe;
  }): Promise<QlikDatasetBinding> {
    this.requireAdmin(admin);
    const now = new Date();
    const enabled = input.enabled !== false;
    const due = nextDueAt(now, input.refreshHourUtc, input.refreshMinuteUtc);
    const transformJson = JSON.stringify(input.transform);
    await request(await this.pool(), {
      artifactId: input.artifactId, datasetKey: input.datasetKey, appId: input.appId, objectId: input.objectId,
      refreshHourUtc: input.refreshHourUtc, refreshMinuteUtc: input.refreshMinuteUtc, enabled: enabled ? 1 : 0,
      nextDueAt: due, now, transformJson,
    }).query(`MERGE QlikDatasetBinding AS target
      USING (SELECT @artifactId AS artifactId, @datasetKey AS datasetKey) AS incoming
      ON target.artifactId=incoming.artifactId AND target.datasetKey=incoming.datasetKey
      WHEN MATCHED THEN UPDATE SET appId=@appId,objectId=@objectId,refreshHourUtc=@refreshHourUtc,refreshMinuteUtc=@refreshMinuteUtc,enabled=@enabled,nextDueAt=@nextDueAt,transformJson=@transformJson,leaseUntil=NULL,leaseOwner=NULL,updatedAt=@now
      WHEN NOT MATCHED THEN INSERT (artifactId,datasetKey,appId,objectId,refreshHourUtc,refreshMinuteUtc,enabled,nextDueAt,transformJson,createdAt,updatedAt)
        VALUES (@artifactId,@datasetKey,@appId,@objectId,@refreshHourUtc,@refreshMinuteUtc,@enabled,@nextDueAt,@transformJson,@now,@now);`);
    await this.audit(await this.pool(), admin, 'qlik.binding.saved', 'dataset', `${input.artifactId}/${input.datasetKey}`, JSON.stringify({ appId: input.appId, objectId: input.objectId, refreshHourUtc: input.refreshHourUtc, refreshMinuteUtc: input.refreshMinuteUtc, transform: input.transform }));
    const saved = await this.getQlikBinding(input.artifactId, input.datasetKey);
    if (!saved) throw new AppError(500, 'QLIK_BINDING_MISSING', 'The Qlik source could not be saved.');
    return saved;
  }

  async deleteQlikBinding(admin: PortalIdentity, artifactId: string, datasetKey: string): Promise<void> {
    this.requireAdmin(admin);
    const existing = await this.getQlikBinding(artifactId, datasetKey);
    if (!existing) throw new AppError(404, 'QLIK_BINDING_MISSING', 'No Qlik source is configured for this dataset.');
    await request(await this.pool(), { artifactId, datasetKey }).query('DELETE FROM QlikDatasetBinding WHERE artifactId=@artifactId AND datasetKey=@datasetKey');
    await this.audit(await this.pool(), admin, 'qlik.binding.removed', 'dataset', `${artifactId}/${datasetKey}`, existing.objectId);
  }

  async recordQlikPull(artifactId: string, datasetKey: string, outcome: { ok: boolean; recordCount?: number; error?: string }): Promise<QlikDatasetBinding> {
    const current = await this.getQlikBinding(artifactId, datasetKey);
    if (!current) throw new AppError(404, 'QLIK_BINDING_MISSING', 'No Qlik source is configured for this dataset.');
    const now = new Date();
    const due = nextDueAt(now, current.refreshHourUtc, current.refreshMinuteUtc);
    await request(await this.pool(), {
      artifactId, datasetKey, now, nextDueAt: due,
      lastPulledAt: outcome.ok ? now : current.lastPulledAt ? new Date(current.lastPulledAt) : null,
      lastError: outcome.ok ? null : (outcome.error ?? 'The Qlik pull failed.').slice(0, 2000),
      lastRecordCount: outcome.ok ? Number(outcome.recordCount ?? 0) : current.lastRecordCount,
    }).query(`UPDATE QlikDatasetBinding SET lastPulledAt=@lastPulledAt,lastError=@lastError,lastRecordCount=@lastRecordCount,nextDueAt=@nextDueAt,leaseUntil=NULL,leaseOwner=NULL,updatedAt=@now
      WHERE artifactId=@artifactId AND datasetKey=@datasetKey`);
    const saved = await this.getQlikBinding(artifactId, datasetKey);
    if (!saved) throw new AppError(500, 'QLIK_BINDING_MISSING', 'The Qlik source could not be updated.');
    return saved;
  }

  async claimDueQlikBindings(owner: string, now = new Date(), leaseMs = 10 * 60_000): Promise<QlikDatasetBinding[]> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const rows = (await request(await this.pool(), { owner, now, leaseUntil }).query<Row>(`UPDATE QlikDatasetBinding SET leaseOwner=@owner,leaseUntil=@leaseUntil,updatedAt=@now
      OUTPUT INSERTED.*
      WHERE enabled=1 AND nextDueAt<=@now AND (leaseUntil IS NULL OR leaseUntil<@now)`)).recordset;
    return rows.map(qlikBinding);
  }

  async getArtifactById(id: string): Promise<ArtifactRecord | null> {
    const row = await one(await this.pool(), 'SELECT TOP 1 * FROM Artifact WHERE id=@id', { id });
    return row ? record(row) : null;
  }

  async getArtifactBySlug(slug: string): Promise<ArtifactRecord | null> {
    const row = await one(await this.pool(), 'SELECT TOP 1 * FROM Artifact WHERE slug=@slug', { slug });
    return row ? record(row) : null;
  }

  async upsertUploadedArtifact(admin: PortalIdentity, input: {
    slug: string; title: string; description: string; kind: 'report' | 'tool'; version: string; owner: string;
    dataDate: string | null; entryUrl: string; capabilities: string[]; datasetKeys: string[]; bundleLocation: string; icon?: ArtifactSummary['icon'];
  }): Promise<ArtifactSummary> {
    this.requireAdmin(admin);
    const pool = await this.pool();
    const existing = await one(pool, 'SELECT TOP 1 * FROM Artifact WHERE slug=@slug', { slug: input.slug });
    if (existing && String(existing.source ?? 'bundled') !== 'uploaded') {
      throw new AppError(409, 'SLUG_RESERVED', 'That slug already ships in the container. Choose a different title.');
    }
    const now = new Date();
    const id = existing ? String(existing.id) : crypto.randomUUID();
    await request(pool, {
      id, slug: input.slug, title: input.title, description: input.description, kind: input.kind, version: input.version,
      owner: input.owner, dataDate: input.dataDate, entryUrl: input.entryUrl,
      capabilitiesJson: JSON.stringify(input.capabilities), datasetKeysJson: JSON.stringify(input.datasetKeys),
      bundleLocation: input.bundleLocation, icon: input.icon ?? null, now,
    }).query(`MERGE Artifact AS target USING (SELECT @id AS id) AS incoming ON target.id=incoming.id
      WHEN MATCHED AND target.[source]='uploaded' THEN UPDATE SET title=@title,description=@description,kind=@kind,version=@version,owner=@owner,dataDate=@dataDate,entryUrl=@entryUrl,capabilitiesJson=@capabilitiesJson,datasetKeysJson=@datasetKeysJson,bundleLocation=@bundleLocation,icon=@icon,isActive=1,updatedAt=@now
      WHEN NOT MATCHED THEN INSERT (id,slug,title,description,kind,version,owner,dataDate,entryUrl,capabilitiesJson,datasetKeysJson,isActive,createdAt,updatedAt,[source],bundleLocation,icon)
      VALUES (@id,@slug,@title,@description,@kind,@version,@owner,@dataDate,@entryUrl,@capabilitiesJson,@datasetKeysJson,1,@now,@now,'uploaded',@bundleLocation,@icon);`);
    await request(pool, { grantId: crypto.randomUUID(), artifactId: id, userId: admin.id, now })
      .query(`IF NOT EXISTS (SELECT 1 FROM ArtifactGrant WHERE artifactId=@artifactId AND targetType='user' AND targetId=@userId)
        INSERT INTO ArtifactGrant (id,artifactId,targetType,targetId,createdAt,createdByUserId) VALUES (@grantId,@artifactId,'user',@userId,@now,@userId)`);
    // Tell everyone who can already see the artifact that a new version is live.
    await request(pool, { tenantId: admin.tenantId, artifactId: id, actorId: admin.id, now })
      .query(`INSERT INTO PortalNotification (id,tenantId,userId,artifactId,datasetId,[type],createdAt,readAt)
        SELECT NEWID(),@tenantId,u.id,@artifactId,NULL,'artifact_published',@now,NULL
        FROM PortalUser u
        WHERE u.tenantId=@tenantId AND u.status='active' AND u.id<>@actorId AND EXISTS (
          SELECT 1 FROM ArtifactGrant g WHERE g.artifactId=@artifactId AND
          ((g.targetType='user' AND g.targetId=u.id) OR
          (g.targetType='group' AND EXISTS (SELECT 1 FROM GroupMember gm WHERE gm.groupId=g.targetId AND gm.userId=u.id))))
          AND NOT EXISTS (SELECT 1 FROM PortalNotification x WHERE x.userId=u.id AND x.artifactId=@artifactId AND x.[type]='artifact_published' AND x.readAt IS NULL)`);
    await this.audit(pool, admin, existing ? 'artifact.replaced' : 'artifact.published', 'artifact', input.slug, input.version);
    return artifact((await one(pool, 'SELECT * FROM Artifact WHERE id=@id', { id }))!);
  }

  async updateUploadedArtifact(admin: PortalIdentity, id: string, patch: { isActive?: boolean; title?: string; description?: string; owner?: string; dataDate?: string | null; icon?: ArtifactSummary['icon']; capabilities?: string[] }): Promise<void> {
    this.requireAdmin(admin);
    const pool = await this.pool();
    const target = await one(pool, "SELECT TOP 1 * FROM Artifact WHERE id=@id AND source='uploaded'", { id });
    if (!target) throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The published artifact was not found.');
    const isActive = patch.isActive ?? Boolean(target.isActive);
    const title = patch.title ?? String(target.title);
    const description = patch.description ?? String(target.description);
    const owner = patch.owner ?? String(target.owner);
    const dataDate = patch.dataDate === undefined ? target.dataDate : patch.dataDate;
    const icon = artifactIcon(patch.icon) ?? artifactIcon(target.icon) ?? null;
    const capabilitiesJson = patch.capabilities === undefined ? String(target.capabilitiesJson) : JSON.stringify(patch.capabilities.filter((item) => item === 'downloads'));
    await request(pool, { id, isActive: isActive ? 1 : 0, title, description, owner, dataDate, icon, capabilitiesJson, updatedAt: new Date() })
      .query('UPDATE Artifact SET isActive=@isActive,title=@title,description=@description,owner=@owner,dataDate=@dataDate,icon=@icon,capabilitiesJson=@capabilitiesJson,updatedAt=@updatedAt WHERE id=@id');
    await this.audit(pool, admin, isActive ? 'artifact.updated' : 'artifact.unpublished', 'artifact', String(target.slug), title);
  }

  async deleteUploadedArtifact(admin: PortalIdentity, id: string): Promise<{ slug: string; storageLocations: string[] }> {
    this.requireAdmin(admin);
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const target = await one(transaction, "SELECT TOP 1 * FROM Artifact WITH (UPDLOCK,HOLDLOCK) WHERE id=@id AND source='uploaded'", { id });
      if (!target) throw new AppError(404, 'ARTIFACT_NOT_FOUND', 'The published artifact was not found.');
      const slug = String(target.slug);
      const datasets = await many(transaction, 'SELECT storageLocation FROM Dataset WHERE artifactId=@id', { id });
      await request(transaction, { id }).query('DELETE FROM PortalNotification WHERE artifactId=@id');
      await request(transaction, { id }).query('DELETE FROM QlikDatasetBinding WHERE artifactId=@id');
      await request(transaction, { id }).query('DELETE FROM Dataset WHERE artifactId=@id');
      await request(transaction, { id }).query('DELETE FROM Artifact WHERE id=@id');
      await this.audit(transaction, admin, 'artifact.deleted', 'artifact', slug, String(target.title));
      await transaction.commit();
      return { slug, storageLocations: [...new Set(datasets.map((row) => String(row.storageLocation)))] };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function artifactIcon(value: unknown): ArtifactSummary['icon'] | undefined {
  return parseArtifactIcon(value);
}
