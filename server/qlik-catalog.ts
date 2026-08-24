import type { QlikAppSummary } from '../src/types/portal.js';
import { AppError } from './errors.js';
import { parseQlikTenantUrl } from './qlik-extract.js';

const MAX_QUERY = 80;
const MAX_PAGES = 20;

export async function listQlikApps(options: {
  tenantUrl: string;
  apiKey: string;
  query?: string;
  fetchImpl?: typeof fetch;
}): Promise<QlikAppSummary[]> {
  const tenant = parseQlikTenantUrl(options.tenantUrl);
  const query = (options.query ?? '').trim();
  if (query.length > MAX_QUERY) throw new AppError(400, 'QLIK_APP_QUERY_INVALID', 'Keep the Qlik app search under 80 characters.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const apps: QlikAppSummary[] = [];
  let url: string | null = `${tenant.origin}/api/v1/items?resourceType=app&limit=100&noActions=true${query ? `&name=${encodeURIComponent(query)}` : ''}`;
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    pages += 1;
    const response = await qlikItemsGet(url, options.apiKey, fetchImpl);
    const body = await parseItemsBody(response);
    for (const item of body.data) {
      const id = String(item.resourceId ?? '').trim();
      if (!id) continue;
      apps.push({
        id,
        name: String(item.name ?? id).trim() || id,
        description: String(item.description ?? '').trim(),
        updatedAt: typeof item.resourceUpdatedAt === 'string' ? item.resourceUpdatedAt : typeof item.updatedAt === 'string' ? item.updatedAt : null,
      });
    }
    url = nextItemsUrl(body.links?.next?.href, tenant.origin);
  }
  return apps;
}

async function qlikItemsGet(url: string, apiKey: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new AppError(502, 'QLIK_UNAVAILABLE', 'Launchpad could not reach Qlik Cloud. Check QLIK_TENANT_URL and that App Service can make outbound HTTPS calls.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(401, 'QLIK_AUTH_FAILED', 'The Qlik API key was rejected. Generate a new key and update QLIK_API_KEY.');
  }
  if (!response.ok) {
    throw new AppError(502, 'QLIK_UNAVAILABLE', `Qlik Cloud could not list apps (HTTP ${response.status}).`);
  }
  return response;
}

async function parseItemsBody(response: Response): Promise<{
  data: Array<{ name?: string; resourceId?: string; description?: string; updatedAt?: string; resourceUpdatedAt?: string }>;
  links?: { next?: { href?: string } };
}> {
  try {
    const body = await response.json() as {
      data?: Array<{ name?: string; resourceId?: string; description?: string; updatedAt?: string; resourceUpdatedAt?: string }>;
      links?: { next?: { href?: string } };
    };
    return { data: Array.isArray(body.data) ? body.data : [], links: body.links };
  } catch {
    throw new AppError(502, 'QLIK_UNAVAILABLE', 'Qlik Cloud returned an invalid app list.');
  }
}

function nextItemsUrl(href: string | undefined, origin: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, origin).toString();
  } catch {
    return null;
  }
}
