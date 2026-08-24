import type { InviteDelivery } from '../types/portal';
import { inviteNotice } from './invite-email';

export function downloadInviteFile(invite: InviteDelivery): InviteDelivery {
  if (invite.eml && invite.filename && typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([invite.eml], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = invite.filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  return inviteNotice(invite);
}
