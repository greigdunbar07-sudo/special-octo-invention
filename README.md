# Covetrus Launchpad

An internal React/TypeScript portal hosted as one Linux container in Azure App Service. It provides a personalised report and tool library, first-login welcome tour, isolated HTML viewers, user/group access administration, audit history, and protected JSON delivery.

The library starts empty. Administrators publish reports and tools from **Administration → Library**, or import a bundle into `artifacts/` for a versioned git deploy. Keep operational JSON out of git.

## Production security boundary

1. App Service Authentication performs single-tenant Microsoft Entra sign-in before application requests reach the container.
2. The API validates the tenant, immutable object ID, and work email from the App Service principal.
3. The portal database separately enforces active-user, administrator, direct-grant, and group-grant access.
4. Azure SQL stores identity, authorization, artifact metadata, and audit records.
5. Protected JSON is schema-validated, checksummed, and stored in a private-endpoint-only Blob container.
6. Managed identities access SQL, Blob Storage, ACR, and the Entra app registration without application credentials.
7. SQL and Blob traffic leaves App Service through VNet integration and private endpoints; their public endpoints are disabled outside the migration window.
8. Console, HTTP, SQL audit, Blob audit, and platform metrics flow to Log Analytics with 90-day retention and security alerts.
9. Artifact iframes and direct artifact responses are sandboxed without same-origin, forms, top-navigation, or popup privileges. New tabs open the portal viewer rather than raw HTML.

## Repository layout

```text
artifacts/       validated static artifact bundles and JSON Schemas
infra/           Bicep for App Service, ACR, Azure SQL, Storage and monitoring
server/          Express API, identity checks, SQL access, Blob access and migrations
scripts/         validation, build and Azure release commands
src/             React portal and same-origin HTTP adapters
private-seed/    sensitive source datasets; git- and container-ignored
```

Azure App Service is the only supported deployment target. The legacy `fabric/` folder remains as migration reference and is excluded from TypeScript, lint, Docker builds, and Azure releases.

## Local development

```powershell
npm install --cache .npm-cache
npm run dev
```

Vite uses browser-backed authentication, catalog, and administration fixtures. Changes persist across reloads and tabs in the same browser profile; separate browser profiles do not share the fixture. Production uses the same-origin API, Azure SQL, and Blob Storage, so its catalog and administration changes are shared across browsers. Production API behavior is covered by unit and integration tests; Azure resources use managed identity.

Quality commands:

```powershell
npm run artifacts:validate
npm run lint
npm test
npm run build:all
npm run security:dependencies
npm run smoke
```

## Azure deployment

Prerequisites:

- Azure CLI, an Azure subscription, and permission to create resources, private endpoints, managed identities, monitoring resources, and role assignments.
- Permission to set the deploying user as the Azure SQL Microsoft Entra administrator.
- A single-tenant workforce Entra web registration for App Service Authentication.
- Application Administrator, Application Developer, Cloud Application Administrator, or application-owner permission to add a federated identity credential to that registration.

Provision the private-networked UK South baseline:

```powershell
./scripts/deploy-infrastructure.ps1 -SubscriptionId '<subscription-guid>'
```

The script creates the resource group, VNet, private endpoints and DNS, runs `az deployment group what-if`, and deploys Bicep. Record the deployment outputs. Configure the existing registration to trust the dedicated authentication managed identity; no client secret is created or passed to the CLI:

```powershell
./scripts/configure-app-auth.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName '<web-app-name>' `
  -TenantId 'f5a44614-2e0f-46dd-89af-a59b298f02af' `
  -ClientId '<application-client-id>' `
  -AuthIdentityName '<auth-identity-name-output>'
```

Build in ACR, temporarily enable SQL only for the deploying client IP, migrate, restore private-only access in `finally`, grant the App Service identity a custom least-privilege database role, and release an immutable container tag:

```powershell
./scripts/release-azure.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName '<web-app-name>' `
  -RegistryName '<acr-name>' `
  -SqlServerName '<sql-server-name>'
```

The release script constructs an explicit temporary build context containing only the Dockerfile, package manifests, frontend/server source, artifact bundles, and required artifact-build scripts. `.env*`, `private-seed/`, legacy Fabric sources, build output, and local dependencies never reach ACR. The Node base image is digest-pinned and Dependabot proposes digest updates.

Validate live security settings after provisioning and after infrastructure changes:

```powershell
./scripts/validate-azure-security.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName '<web-app-name>' `
  -SqlServerName '<sql-server-name>' `
  -StorageAccountName '<storage-account-name>'
```

### Future releases to the current Azure environment

ACR Tasks are disabled for this subscription, so use the repository's local Crane build path. The current resource names are:

```powershell
./scripts/release-azure.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName 'covetrus-insight-hub-svyxxufqwhwec' `
  -RegistryName 'covetrusinsighthubsvyxxufqwhwec' `
  -SqlServerName 'covetrus-insight-hub-sql-francecentral-svyxxufqwhwec' `
  -BuildMethod Crane
```

For frontend-only releases with no database or server migration, add `-SkipDatabase`. This leaves SQL private throughout and does not require the deploying machine to reach Azure SQL on port 1433:

```powershell
./scripts/release-azure.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName 'covetrus-insight-hub-svyxxufqwhwec' `
  -RegistryName 'covetrusinsighthubsvyxxufqwhwec' `
  -SqlServerName 'covetrus-insight-hub-sql-francecentral-svyxxufqwhwec' `
  -BuildMethod Crane `
  -SkipDatabase
```

If the deploying machine cannot reach Azure SQL on port 1433, release the image with `-SkipDatabase`, record the immutable image tag printed by the release, and run the migrations from a disposable Container Instance inside the portal VNet:

```powershell
./scripts/run-private-migration.ps1 `
  -ResourceGroup 'rg-covetrus-insight-hub' `
  -WebAppName 'covetrus-insight-hub-svyxxufqwhwec' `
  -RegistryName 'covetrusinsighthubsvyxxufqwhwec' `
  -SqlServerName 'covetrus-insight-hub-sql-francecentral-svyxxufqwhwec' `
  -Image '<acr-login-server>/insight-hub:<immutable-tag>'
```

The private runner temporarily makes its managed identity the SQL Entra administrator, restores the original administrator in `finally`, and removes its container, subnet, and temporary ACR pull assignment. Register the `Microsoft.ContainerInstance` resource provider once per subscription before first use.

The Crane executable is expected at `.tools/crane/crane.exe`. Azure CLI must be installed and authenticated with `az login` before running either command. Do not use `-SkipDatabase` when the release includes migrations unless it is immediately followed by the private migration runner above.

## First production initialization

1. Verify anonymous `/healthz` returns `200` and opening `/` redirects through Covetrus Microsoft sign-in.
2. Sign in as `greig.dunbar@covetrus.com`; the empty database bootstraps this identity as the sole administrator and registers any committed artifact manifests.
3. Publish reports and tools from **Administration → Library**. For data-separated items, import JSON on the same Library tab after publish.
4. Recreate users, groups, memberships, and grants. Adding a user, or clicking **Send invite**, downloads a branded `.eml` to open in Outlook and send. New users remain pending until their first verified sign-in.
5. Confirm dataset checksums, direct/group access, disabled-user denial, audit history, iframe sandboxing, and application logs before making the Azure URL primary.
6. Run `validate-azure-security.ps1` and confirm SQL and Storage public network access are disabled after initialization.
7. Confirm Azure App Service is the sole live deployment. Fabric and Rayfin deployment paths are deprecated.

## User invite email

Launchpad does not send mail. When an administrator adds a coworker or clicks **Send invite** / **Resend invite**, the browser downloads a branded `.eml` draft (`X-Unsent: 1`) addressed to that person. Open the file in Outlook and click Send from your own mailbox. The same action works for your own account as a test.

`PORTAL_PUBLIC_URL` defaults to the App Service hostname so the button in the message opens Launchpad. Local Vite fixtures download the same `.eml`.

## Security automation and recovery

The `Security` GitHub Actions workflow runs the complete smoke suite, dependency audit, CycloneDX SBOM generation, production container build, and Trivy high/critical image scan on pull requests, `main`, and weekly. Retain the SBOM artifact with each release. Azure SQL retains point-in-time backups for 14 days plus 12 weekly long-term backups. Blob versioning and soft deletion retain recoverable content for 30 days.

If `configure-app-auth.ps1` was previously run with `-ClientSecret`, verify a fresh managed-identity-backed sign-in, rerun the current command with `-RemoveLegacySecret`, and then rotate/delete the credential from the Entra app registration. The two-step cutover prevents an authentication outage while the federated credential propagates.

## Usage insights

Usage telemetry is disabled by default. After migration `012_portal_usage_events.sql` is deployed, set `USAGE_TELEMETRY_MODE` to `admins` for a pilot and set `ENABLE_USAGE_INSIGHTS=true` to expose the aggregate Administration → Insights view. Switch the mode to `all` only after validating the event volume and privacy boundary. Detailed events retain no search terms, report data, iframe content, or arbitrary errors and are deleted after `USAGE_EVENT_RETENTION_DAYS` (180 by default).

## Adding an artifact

Cowork-made HTML can be published in two ways. Both accept a self-contained HTML file, or HTML plus JSON (data stays out of the bundle).

**Live upload (no redeploy).** In **Administration → Library**, use **Publish**. Drop an `.html` file or a Cowork `.zip`, fill in title/kind/owner, and optionally attach JSON. The item is stored in private Blob storage and is visible to the publishing administrator until you grant a group on the Access matrix. Self-contained HTML (no JSON) is grant-gated because the file is the data.

Keep **Allow generated file downloads** selected for tools that create Excel, PowerPoint, CSV, PDF, JSON, or zip outputs. The packager preserves the model's browser-generated Blob and the protected viewer relays it to the top-level portal for a validated download. Replacing an existing HTML bundle retains its current download setting; it can also be changed under **Library items → Edit details**.

**Git redeploy (versioned).** Import the same package into the repo, commit, and release a new container image:

```powershell
npm run artifacts:import -- --from path\to\report.html --title "Weekly fill rate" --kind report --owner "Operations"
npm run artifacts:validate
./scripts/release-azure.ps1 -ResourceGroup 'rg-covetrus-insight-hub' -WebAppName '<web-app-name>' -RegistryName '<acr-name>' -SqlServerName '<sql-server-name>'
```

Operational JSON is written to gitignored `private-seed/<slug>/`. After the new image is live, sign in as administrator so manifests synchronize, then import that JSON on **Administration → Library**.

Git-deployed items live in `artifacts/<stable-slug>/` with `manifest.json`, entry HTML, and one JSON Schema per declared dataset. Keep protected data out of git. You can still add a bundle by hand in that folder if you prefer not to use `artifacts:import`. The container ships with an empty `artifacts/` folder; publish from Administration if you do not want a git redeploy.

Give Cowork authors this brief:

- Prefer one self-contained HTML file with inline CSS/JS.
- Do not rely on CDNs; Chart.js 4.4, Hammer, and chartjs-plugin-zoom are rewritten if they match the portal allowlist.
- If data must stay separate, read `window.__PORTAL_DATA__` (or listen for `portaldata`) instead of `fetch('data.json')`.
- Zip the folder when there are local assets.

## Qlik Sense Cloud as a JSON source

Data-separated artifacts (those with a JSON dataset slot) can be bound to a Qlik Sense straight table in **Administration → Library**. Open **Qlik editor** on the dataset slot for a full-screen query workspace: paste the Qlik app GUID and straight-table object ID, preview the first 200 source rows, then keep columns, filter rows, and drop blanks. The HTML viewer still cannot call Qlik. App Service pulls the table, flattens it to JSON, and stores it through the same grant, schema, checksum, and private-blob path as a manual JSON import.

Transforms run **after** the extract. Launchpad does not rewrite the Qlik object. Keep-columns, filters, and drop-empty change what is stored. JSON shape (Qlik envelope, named row array, or asOf plus rows) is applied when the report reads the dataset.

**Pull now** runs the same extract immediately against the saved source. Manual **Import / Replace JSON** remains as a fallback. Choose a **daily pull (UTC)** after the Qlik app reload (COSI last finished around 07:18 UTC in testing).

Server settings (App Service application settings, or local env). Do not put the API key in the admin form or in git:

```text
QLIK_TENANT_URL=https://your-tenant.eu.qlikcloud.com
QLIK_API_KEY=<api-key>
```

Limits: **10 MB** per manual JSON import. Qlik extracts are stored as compact **9 MB chunks** (50 MB assembled max); the report still receives one JSON object when it opens. Cleaning columns before storage is the way to keep a large table inside the HTML timeout. Qlik serves at most **10,000 cells per page**. Opening a large app can take about a minute. Bind only to a schema that accepts the chosen JSON shape.

Use a dedicated Qlik user with access only to the source app, not a Tenant Admin key. When the key expires, generate a new one in Qlik (**Profile → API keys**), revoke the old key, update `QLIK_API_KEY`, and confirm with **Pull now**. The portal cannot rotate the key by itself.
