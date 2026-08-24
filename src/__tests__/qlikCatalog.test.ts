// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { listQlikApps } from '../../server/qlik-catalog.js';

describe('Qlik app catalog', () => {
  it('pages the items API and maps resourceId to app id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('next=2')) {
        return new Response(JSON.stringify({
          data: [{ name: 'Damages', resourceId: 'd51760fc-8121-4222-b1cf-e3ae6345178a', description: 'Warehouse', resourceUpdatedAt: '2026-08-20T09:00:00.000Z' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{ name: 'COSI', resourceId: '1df4cf94-0a3b-4246-848e-40200247bfba', description: 'Commercial' }],
        links: { next: { href: '/api/v1/items?resourceType=app&next=2' } },
      }), { status: 200 });
    });

    const apps = await listQlikApps({
      tenantUrl: 'https://example.eu.qlikcloud.com',
      apiKey: 'secret',
      query: 'co',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(apps).toEqual([
      { id: '1df4cf94-0a3b-4246-848e-40200247bfba', name: 'COSI', description: 'Commercial', updatedAt: null },
      { id: 'd51760fc-8121-4222-b1cf-e3ae6345178a', name: 'Damages', description: 'Warehouse', updatedAt: '2026-08-20T09:00:00.000Z' },
    ]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('name=co');
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://example.eu.qlikcloud.com/api/v1/items?resourceType=app&next=2');
  });
});
