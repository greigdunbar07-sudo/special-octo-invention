import type { Request } from 'express';

import { portalHomeUrl, prepareInviteFile } from '../src/lib/invite-email.js';
import type { InviteDelivery, PortalIdentity } from '../src/types/portal.js';
import type { AppConfig } from './config.js';

export { buildInviteEml, inviteFilename, prepareInviteFile, renderInviteEmail, renderInviteText } from '../src/lib/invite-email.js';

export function resolveInvitePortalUrl(
  config: Pick<AppConfig, 'portalPublicUrl'>,
  request: Pick<Request, 'protocol' | 'get'>,
): string {
  const host = request.get('x-forwarded-host') || request.get('host') || '';
  const forwarded = request.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwarded || request.protocol;
  return portalHomeUrl(config.portalPublicUrl) || portalHomeUrl(host ? `${protocol}://${host}` : undefined);
}

export function inviteFileForRequest(
  config: Pick<AppConfig, 'portalPublicUrl'>,
  request: Pick<Request, 'protocol' | 'get'>,
  input: { user: PortalIdentity; invitedBy: PortalIdentity },
): InviteDelivery {
  return prepareInviteFile({ ...input, portalUrl: resolveInvitePortalUrl(config, request) });
}
