import { describe, expect, it } from 'vitest';

import { AppError } from '../../server/errors';
import { parseEasyAuthPrincipal } from '../../server/auth';

const tenantId = 'f5a44614-2e0f-46dd-89af-a59b298f02af';

function header(claims: Array<{ typ: string; val: string }>) {
  return Buffer.from(JSON.stringify({ claims })).toString('base64');
}

describe('App Service principal validation', () => {
  it('maps a verified single-tenant work identity', () => {
    const principal = parseEasyAuthPrincipal(header([
      { typ: 'tid', val: tenantId }, { typ: 'oid', val: '11111111-1111-1111-1111-111111111111' },
      { typ: 'preferred_username', val: 'Greig.Dunbar@Covetrus.com' }, { typ: 'name', val: 'Greig Dunbar' },
    ]), tenantId);
    expect(principal).toEqual({ tenantId, objectId: '11111111-1111-1111-1111-111111111111', email: 'greig.dunbar@covetrus.com', name: 'Greig Dunbar' });
  });

  it('rejects missing, malformed, and cross-tenant principals with safe errors', () => {
    expect(() => parseEasyAuthPrincipal(undefined, tenantId)).toThrowError(AppError);
    expect(() => parseEasyAuthPrincipal('not-base64-json', tenantId)).toThrow('identity supplied to the application is invalid');
    expect(() => parseEasyAuthPrincipal(header([{ typ: 'tid', val: 'another-tenant' }, { typ: 'oid', val: 'id' }, { typ: 'email', val: 'user@example.com' }]), tenantId)).toThrow('Cross-tenant access');
  });

  it('requires immutable object ID and work email claims', () => {
    expect(() => parseEasyAuthPrincipal(header([{ typ: 'tid', val: tenantId }, { typ: 'name', val: 'No identity' }]), tenantId)).toThrow('verified Microsoft work identity');
  });
});
