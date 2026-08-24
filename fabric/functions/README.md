# Fabric User Data Function deployment

Create or import one User Data Functions item and include `function_app.py`, `requirements.txt`, and `schemas/` in its definition.

Configure:

- Function setting `ALLOWED_TENANT_ID` — the one permitted Entra tenant GUID.
- Function setting `BOOTSTRAP_ADMIN_OBJECT_ID` — Greig's immutable Entra object ID.
- Connection alias `portalSql` — the SQL database created for this Rayfin App.
- Connection alias `portalStorage` — a protected Lakehouse Files endpoint.

Publish these functions and enable public REST access:

- `whoAmI`
- `getMyCatalog`
- `getArtifactData`
- `getAdminSnapshot`
- `addUser`
- `updateUser`
- `addGroup`
- `addMembership`
- `removeMembership`
- `setGrant`
- `syncArtifact`
- `seedDatasetChunk`
- `finalizeSeedDataset`

Each public function has a unique URL. Put the browser-used URLs into `VITE_UDF_ENDPOINTS_JSON`; keep the sync and seed URLs in process environment variables only. The external response wrapper (`status`, `output`, `errors`) is unwrapped by the portal client.

The 4 MB User Data Function request limit is handled by the chunked seed operation. Temporary chunks live below `portal-data/.uploads/`; final active envelopes live below `portal-data/<artifact>/<dataset>/<checksum>.json`. Dataset metadata, active/superseded state, and the audit event are committed together in SQL after schema and checksum validation.
