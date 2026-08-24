// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { QlikAppSessionCache } from '../../server/qlik-session.js';

describe('Qlik engine session cache', () => {
  it('reuses one open app session until closeAll', async () => {
    const session = { rpc: vi.fn(), close: vi.fn() };
    let connects = 0;
    const cache = new QlikAppSessionCache(async () => {
      connects += 1;
      return { session, appHandle: 1 };
    }, { idleMs: 60_000, maxApps: 2 });

    await cache.run('app-a', async (open, handle) => {
      expect(open).toBe(session);
      expect(handle).toBe(1);
      return 'one';
    });
    await cache.run('app-a', async () => 'two');
    expect(connects).toBe(1);
    expect(session.close).not.toHaveBeenCalled();
    cache.closeAll();
    expect(session.close).toHaveBeenCalledOnce();
  });
});
