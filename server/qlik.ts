import type { AppConfig } from './config.js';
import { qlikIsConfigured } from './config.js';
import type { DatasetService } from './datasets.js';
import { AppError } from './errors.js';
import { applyQlikClean, parseQlikCleanRecipe } from './qlik-clean.js';
import { listQlikApps } from './qlik-catalog.js';
import {
  extractQlikTable,
  extractQlikTableSample,
  listQlikTables,
  QLIK_PREVIEW_MAX_ROWS,
  validateQlikAppId,
  validateQlikObjectRef,
  validateRefreshTime,
} from './qlik-extract.js';
import { QlikAppSessionCache } from './qlik-session.js';
import type { PortalRepository } from './repository.js';
import type {
  PortalIdentity,
  QlikAppSummary,
  QlikBindingInput,
  QlikDatasetBinding,
  QlikPreviewSample,
  QlikTableSummary,
} from '../src/types/portal.js';

const TABLE_LIST_TTL_MS = 5 * 60_000;

export class QlikPullService {
  private readonly tableLists = new Map<string, { at: number; tables: QlikTableSummary[] }>();

  constructor(
    private readonly config: AppConfig,
    private readonly repository: PortalRepository,
    private readonly datasets: DatasetService,
    private readonly sessions = QlikAppSessionCache.fromExtractOptions({
      tenantUrl: config.qlikTenantUrl ?? '',
      apiKey: config.qlikApiKey ?? '',
    }),
  ) {}

  close(): void {
    this.sessions.closeAll();
    this.tableLists.clear();
  }

  async save(admin: PortalIdentity, artifactId: string, datasetKey: string, input: QlikBindingInput): Promise<QlikDatasetBinding> {
    this.repository.requireAdmin(admin);
    await this.datasets.resolve(artifactId, datasetKey);
    const ref = validateQlikObjectRef(input);
    const schedule = validateRefreshTime(Number(input.refreshHourUtc), Number(input.refreshMinuteUtc));
    return this.repository.upsertQlikBinding(admin, {
      artifactId, datasetKey, ...ref, ...schedule, enabled: input.enabled !== false, transform: parseQlikCleanRecipe(input.transform),
    });
  }

  async remove(admin: PortalIdentity, artifactId: string, datasetKey: string): Promise<void> {
    await this.repository.deleteQlikBinding(admin, artifactId, datasetKey);
  }

  async listApps(admin: PortalIdentity, query = ''): Promise<QlikAppSummary[]> {
    this.repository.requireAdmin(admin);
    this.requireConfigured();
    return listQlikApps({ tenantUrl: this.config.qlikTenantUrl!, apiKey: this.config.qlikApiKey!, query });
  }

  async listTables(admin: PortalIdentity, appId: string): Promise<QlikTableSummary[]> {
    this.repository.requireAdmin(admin);
    this.requireConfigured();
    const id = validateQlikAppId(appId);
    const cached = this.tableLists.get(id);
    if (cached && Date.now() - cached.at < TABLE_LIST_TTL_MS) return cached.tables;
    const tables = await this.sessions.run(id, (session, appHandle) => listQlikTables(session, appHandle));
    this.tableLists.set(id, { at: Date.now(), tables });
    return tables;
  }

  async preview(admin: PortalIdentity, input: { appId: string; objectId: string }): Promise<QlikPreviewSample> {
    this.repository.requireAdmin(admin);
    this.requireConfigured();
    const ref = validateQlikObjectRef(input);
    return this.sessions.run(ref.appId, async (session, appHandle) => {
      const extracted = await extractQlikTableSample({
        tenantUrl: this.config.qlikTenantUrl!,
        apiKey: this.config.qlikApiKey!,
        appId: ref.appId,
        objectId: ref.objectId,
        session,
        appHandle,
        maxRows: QLIK_PREVIEW_MAX_ROWS,
      });
      return {
        appId: extracted.payload.appId,
        objectId: extracted.payload.objectId,
        columns: extracted.payload.columns,
        rows: extracted.payload.rows,
        sourceRowCount: extracted.sourceRowCount,
        truncated: extracted.payload.rows.length < extracted.sourceRowCount,
      };
    });
  }

  async pull(admin: PortalIdentity, artifactId: string, datasetKey: string): Promise<QlikDatasetBinding> {
    this.repository.requireAdmin(admin);
    await this.datasets.resolve(artifactId, datasetKey);
    const binding = await this.repository.getQlikBinding(artifactId, datasetKey);
    if (!binding) throw new AppError(404, 'QLIK_BINDING_MISSING', 'Save a Qlik app ID and object ID before pulling.');
    this.requireConfigured();
    try {
      const extracted = await this.sessions.run(binding.appId, (session, appHandle) => extractQlikTable({
        tenantUrl: this.config.qlikTenantUrl!,
        apiKey: this.config.qlikApiKey!,
        appId: binding.appId,
        objectId: binding.objectId,
        session,
        appHandle,
      }));
      const payload = applyQlikClean(extracted, binding.transform);
      await this.datasets.upload(admin, artifactId, datasetKey, payload);
      return await this.repository.recordQlikPull(artifactId, datasetKey, { ok: true, recordCount: payload.rows.length });
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'The Qlik pull failed.';
      await this.repository.recordQlikPull(artifactId, datasetKey, { ok: false, error: message }).catch(() => undefined);
      throw error;
    }
  }

  private requireConfigured(): void {
    if (!qlikIsConfigured(this.config)) {
      throw new AppError(503, 'QLIK_NOT_CONFIGURED', 'Set QLIK_TENANT_URL and QLIK_API_KEY on the App Service, then try again.');
    }
  }
}
