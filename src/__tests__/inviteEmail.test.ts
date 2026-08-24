// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildInviteEml,
  escapeHtml,
  firstName,
  inviteFilename,
  portalHomeUrl,
  prepareInviteFile,
  renderInviteEmail,
} from '../../src/lib/invite-email';
import type { PortalIdentity } from '../../src/types/portal';

function identity(overrides: Partial<PortalIdentity> = {}): PortalIdentity {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    entraObjectId: null,
    email: 'alex.morgan@covetrus.com',
    displayName: 'Alex Morgan',
    role: 'viewer',
    status: 'pending',
    ...overrides,
  };
}

function htmlFromEml(eml: string): string {
  const match = /Content-Type: text\/html[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(eml);
  if (!match) throw new Error('The HTML part was missing from the invite file.');
  return Buffer.from(match[1].replace(/\s/g, ''), 'base64').toString('utf8');
}

describe('invite email', () => {
  it('uses the first name and escapes HTML in the branded template', () => {
    expect(firstName('Alex Morgan')).toBe('Alex');
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(portalHomeUrl('https://launchpad.example.com/admin?x=1#y')).toBe('https://launchpad.example.com/admin');
    expect(inviteFilename(identity())).toBe('launchpad-invite-alex-morgan.eml');

    const rendered = renderInviteEmail({
      user: identity({ displayName: 'Alex <Admin>', email: 'alex+test@covetrus.com' }),
      invitedBy: identity({ id: 'admin-1', email: 'greig.dunbar@covetrus.com', displayName: 'Greig Dunbar', role: 'admin', status: 'active' }),
      portalUrl: 'https://covetrus-insight-hub.azurewebsites.net/',
    });

    expect(rendered.subject).toBe('You are invited to Covetrus Launchpad');
    expect(rendered.html).toContain('Hi Alex,');
    expect(rendered.html).toContain('Greig Dunbar');
    expect(rendered.html).toContain('Open Launchpad');
    expect(rendered.html).toContain('https://covetrus-insight-hub.azurewebsites.net');
    expect(rendered.html).toContain('Viewer');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('Alex &lt;Admin&gt;');
  });

  it('builds an unsent Outlook draft addressed from the signed-in admin', () => {
    const invitedBy = identity({ id: 'admin-1', email: 'greig.dunbar@covetrus.com', displayName: 'Greig Dunbar', role: 'admin', status: 'active' });
    const invite = prepareInviteFile({
      user: identity(),
      invitedBy,
      portalUrl: 'https://launchpad.covetrus.com',
    });

    expect(invite.status).toBe('downloaded');
    expect(invite.filename).toBe('launchpad-invite-alex-morgan.eml');
    expect(invite.message).toContain('launchpad-invite-alex-morgan.eml');
    expect(invite.eml).toContain('X-Unsent: 1');
    expect(invite.eml).toContain('From: "Greig Dunbar" <greig.dunbar@covetrus.com>');
    expect(invite.eml).toContain('To: "Alex Morgan" <alex.morgan@covetrus.com>');
    expect(htmlFromEml(invite.eml ?? '')).toContain('Open Launchpad');
  });

  it('fails when the portal URL or inviter mailbox is missing', () => {
    const invitedBy = identity({ role: 'admin', status: 'active', email: 'greig.dunbar@covetrus.com', displayName: 'Greig Dunbar' });
    expect(prepareInviteFile({ user: identity(), invitedBy, portalUrl: '' })).toMatchObject({ status: 'failed' });
    expect(prepareInviteFile({
      user: identity(),
      invitedBy: { ...invitedBy, email: 'not-an-email' },
      portalUrl: 'https://launchpad.covetrus.com',
    })).toMatchObject({ status: 'failed' });
  });

  it('uses CRLF line endings in the .eml', () => {
    const eml = buildInviteEml({
      from: 'greig.dunbar@covetrus.com',
      fromName: 'Greig Dunbar',
      to: 'alex.morgan@covetrus.com',
      toName: 'Alex Morgan',
      subject: 'You are invited to Covetrus Launchpad',
      html: '<p>Welcome</p>',
      text: 'Welcome',
      date: new Date('2026-08-23T12:00:00Z'),
    });
    expect(eml).toContain('\r\nX-Unsent: 1\r\n'.slice(2));
    expect(eml.split('\n').every((line) => line.endsWith('\r') || line === '')).toBe(true);
  });
});
