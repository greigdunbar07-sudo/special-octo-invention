// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { startQlikScheduler } from '../../server/qlik-scheduler.js';
import type { QlikPullService } from '../../server/qlik.js';
import type { PortalRepository } from '../../server/repository.js';
import type { PortalIdentity, QlikDatasetBinding } from '../../src/types/portal.js';

const admin: PortalIdentity = {
  id: 'admin-1', tenantId: 't', entraObjectId: 'o', email: 'greig.dunbar@covetrus.com', displayName: 'Greig', role: 'admin', status: 'active',
};

describe('Qlik scheduler', () => {
  it('pulls claimed due bindings as the bootstrap administrator', async () => {
    const binding: QlikDatasetBinding = {
      artifactId: 'artifact-1', datasetKey: 'report', appId: '1df4cf94-0a3b-4246-848e-40200247bfba', objectId: 'obj',
      refreshHourUtc: 8, refreshMinuteUtc: 0, enabled: true, lastPulledAt: null, lastError: null, lastRecordCount: null,
      nextDueAt: '2026-08-21T08:00:00.000Z', updatedAt: '2026-08-21T07:00:00.000Z',
      transform: { output: 'qlik', keys: 'slug', keepColumns: [], dropEmptyRows: false, rowFilterMode: 'and', rowFilters: [] },
    };
    const repository = {
      bootstrapAdmin: vi.fn(async () => admin),
      claimDueQlikBindings: vi.fn(async () => [binding]),
    } as unknown as PortalRepository;
    const qlik = { pull: vi.fn(async () => binding) } as unknown as QlikPullService;

    const stop = startQlikScheduler(repository, qlik, 60_000);
    await vi.waitFor(() => expect(qlik.pull).toHaveBeenCalledWith(admin, 'artifact-1', 'report'));
    stop();
  });
});
