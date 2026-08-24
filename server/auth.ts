import type { Request } from 'express';

import { AppError } from './errors.js';

interface EasyAuthClaim {
  typ?: unknown;
  val?: unknown;
}

interface EasyAuthPrincipal {
  claims?: unknown;
}

export interface VerifiedPrincipal {
  tenantId: string;
  objectId: string;
  email: string;
  name: string;
}

const TENANT_CLAIMS = ['tid', 'http://schemas.microsoft.com/identity/claims/tenantid'];
const OBJECT_CLAIMS = ['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier'];
const EMAIL_CLAIMS = [
  'preferred_username',
  'email',
  'upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
];
const NAME_CLAIMS = ['name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];

function claimValue(claims: EasyAuthClaim[], names: string[]): string {
  for (const name of names) {
    const match = claims.find((claim) => claim.typ === name);
    if (match && typeof match.val === 'string' && match.val.trim()) return match.val.trim();
  }
  return '';
}

export function parseEasyAuthPrincipal(encoded: string | undefined, allowedTenantId: string): VerifiedPrincipal {
  if (!encoded) throw new AppError(401, 'AUTH_REQUIRED', 'Microsoft sign-in is required.');

  let principal: EasyAuthPrincipal;
  try {
    principal = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as EasyAuthPrincipal;
  } catch {
    throw new AppError(401, 'AUTH_INVALID', 'The Microsoft identity supplied to the application is invalid.');
  }
  if (!Array.isArray(principal.claims)) {
    throw new AppError(401, 'AUTH_INVALID', 'The Microsoft identity does not contain claims.');
  }

  const claims = principal.claims.filter((item): item is EasyAuthClaim => !!item && typeof item === 'object');
  const tenantId = claimValue(claims, TENANT_CLAIMS).toLowerCase();
  const objectId = claimValue(claims, OBJECT_CLAIMS).toLowerCase();
  const email = claimValue(claims, EMAIL_CLAIMS).toLowerCase();
  const name = claimValue(claims, NAME_CLAIMS) || email.split('@')[0];

  if (!tenantId || tenantId !== allowedTenantId.toLowerCase()) {
    throw new AppError(403, 'TENANT_DENIED', 'Cross-tenant access is not permitted.');
  }
  if (!objectId || !email || !email.includes('@')) {
    throw new AppError(401, 'IDENTITY_INCOMPLETE', 'A verified Microsoft work identity is required.');
  }
  return { tenantId, objectId, email, name };
}

export function principalFromRequest(request: Request, allowedTenantId: string): VerifiedPrincipal {
  return parseEasyAuthPrincipal(request.get('x-ms-client-principal'), allowedTenantId);
}
