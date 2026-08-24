const DEFAULT_TENANT_ID = 'f5a44614-2e0f-46dd-89af-a59b298f02af';
const DEFAULT_BOOTSTRAP_ADMIN = 'greig.dunbar@covetrus.com';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

export interface AppConfig {
  port: number;
  tenantId: string;
  bootstrapAdminEmail: string;
  sqlServer: string;
  sqlDatabase: string;
  storageAccount: string;
  storageContainer: string;
  staticRoot: string;
  artifactRoot: string;
  bundleRoot: string;
  production: boolean;
  qlikTenantUrl?: string;
  qlikApiKey?: string;
  portalPublicUrl?: string;
  usageTelemetryMode: 'off' | 'admins' | 'all';
  usageInsightsEnabled: boolean;
  usageEventRetentionDays: number;
}

function usageTelemetryMode(): AppConfig['usageTelemetryMode'] {
  const value = (process.env.USAGE_TELEMETRY_MODE ?? 'off').trim().toLowerCase();
  if (value !== 'off' && value !== 'admins' && value !== 'all') {
    throw new Error('USAGE_TELEMETRY_MODE must be off, admins, or all.');
  }
  return value;
}

function booleanSetting(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function retentionDays(): number {
  const value = Number(process.env.USAGE_EVENT_RETENTION_DAYS ?? 180);
  if (!Number.isInteger(value) || value < 30 || value > 365) {
    throw new Error('USAGE_EVENT_RETENTION_DAYS must be an integer from 30 to 365.');
  }
  return value;
}

export function loadConfig(requireAllAzureResources = true): AppConfig {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? process.env.WEBSITES_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }

  return {
    port,
    tenantId: (process.env.ALLOWED_TENANT_ID ?? DEFAULT_TENANT_ID).toLowerCase(),
    bootstrapAdminEmail: (process.env.BOOTSTRAP_ADMIN_EMAIL ?? DEFAULT_BOOTSTRAP_ADMIN).toLowerCase(),
    sqlServer: production && requireAllAzureResources ? required('AZURE_SQL_SERVER') : (process.env.AZURE_SQL_SERVER ?? ''),
    sqlDatabase: production && requireAllAzureResources ? required('AZURE_SQL_DATABASE') : (process.env.AZURE_SQL_DATABASE ?? ''),
    storageAccount: production && requireAllAzureResources ? required('AZURE_STORAGE_ACCOUNT') : (process.env.AZURE_STORAGE_ACCOUNT ?? ''),
    storageContainer: process.env.AZURE_STORAGE_CONTAINER ?? 'portal-data',
    staticRoot: process.env.STATIC_ROOT ?? 'dist',
    artifactRoot: process.env.ARTIFACT_ROOT ?? 'artifacts',
    bundleRoot: process.env.PORTAL_DATA_DIR ?? 'tmp/portal-data',
    production,
    qlikTenantUrl: process.env.QLIK_TENANT_URL?.trim() || undefined,
    qlikApiKey: process.env.QLIK_API_KEY?.trim() || undefined,
    portalPublicUrl: process.env.PORTAL_PUBLIC_URL?.trim()
      || (process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : undefined),
    usageTelemetryMode: usageTelemetryMode(),
    usageInsightsEnabled: booleanSetting('ENABLE_USAGE_INSIGHTS', false),
    usageEventRetentionDays: retentionDays(),
  };
}

export function usageTelemetryEnabled(config: Pick<AppConfig, 'usageTelemetryMode'>, role: 'viewer' | 'admin'): boolean {
  return config.usageTelemetryMode === 'all' || (config.usageTelemetryMode === 'admins' && role === 'admin');
}

export function qlikIsConfigured(config: Pick<AppConfig, 'qlikTenantUrl' | 'qlikApiKey'>): boolean {
  return Boolean(config.qlikTenantUrl && config.qlikApiKey);
}
