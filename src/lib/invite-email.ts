import type { InviteDelivery, PortalIdentity } from '../types/portal.js';

const NAVY = '#021660';
const TEAL = '#27bdbe';
const INK = '#17203a';
const MUTED = '#65708a';
const LINE = '#dfe4ed';
const PAGE = '#f4f6fa';

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || 'there';
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

export function portalHomeUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function roleCopy(role: PortalIdentity['role']): { label: string; blurb: string } {
  if (role === 'admin') {
    return {
      label: 'Workspace administrator',
      blurb: 'You can manage people, access, and the report library.',
    };
  }
  return {
    label: 'Viewer',
    blurb: 'Reports and tools appear in your library as soon as they are assigned to you.',
  };
}

export function inviteFilename(user: Pick<PortalIdentity, 'displayName'>): string {
  const slug = user.displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
  return `launchpad-invite-${slug}.eml`;
}

export function renderInviteText(input: {
  user: PortalIdentity;
  invitedBy: PortalIdentity;
  portalUrl: string;
}): string {
  const portalUrl = portalHomeUrl(input.portalUrl);
  const role = roleCopy(input.user.role);
  return [
    `Hi ${firstName(input.user.displayName)},`,
    '',
    `${input.invitedBy.displayName} added you to Covetrus Launchpad. Sign in with your Microsoft work account to open the reports and tools assigned to you.`,
    '',
    'Your access is waiting. Microsoft verifies your identity the first time you open the portal.',
    '',
    `Open Launchpad: ${portalUrl}`,
    '',
    `Your role: ${role.label}`,
    role.blurb,
    '',
    `This invitation was sent to ${input.user.email} for ${input.user.displayName}.`,
  ].join('\r\n');
}

export function renderInviteEmail(input: {
  user: PortalIdentity;
  invitedBy: PortalIdentity;
  portalUrl: string;
}): { subject: string; html: string } {
  const portalUrl = portalHomeUrl(input.portalUrl);
  const greeting = escapeHtml(firstName(input.user.displayName));
  const fullName = escapeHtml(input.user.displayName);
  const inviter = escapeHtml(input.invitedBy.displayName);
  const role = roleCopy(input.user.role);
  const href = escapeHtml(portalUrl);
  const subject = 'You are invited to Covetrus Launchpad';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    body { margin: 0; padding: 0; width: 100% !important; background: ${PAGE}; }
    @media screen and (max-width: 620px) {
      .card { width: 100% !important; }
      .px { padding-left: 22px !important; padding-right: 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${inviter} added you to Covetrus Launchpad. Open it with your Microsoft work account.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAGE};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="card" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE};">
          <tr>
            <td class="px" style="background:${NAVY};padding:28px 40px 22px;">
              <p style="margin:0 0 6px;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${TEAL};font-weight:700;">Covetrus</p>
              <h1 style="margin:0;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:28px;line-height:1.2;color:#ffffff;font-weight:700;">Launchpad</h1>
              <p style="margin:10px 0 0;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:14px;color:#c8d7ff;">Your library of reports and tools</p>
            </td>
          </tr>
          <tr>
            <td style="height:6px;background:${TEAL};font-size:0;line-height:6px;">&nbsp;</td>
          </tr>
          <tr>
            <td class="px" style="padding:36px 40px 8px;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;color:${INK};">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${TEAL};font-weight:700;">You are invited</p>
              <h2 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;color:${NAVY};">Hi ${greeting},</h2>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">
                <strong>${inviter}</strong> added you to <strong>Covetrus Launchpad</strong>.
                Sign in with your Microsoft work account to open the reports and tools assigned to you.
              </p>
              <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:${INK};">
                Your access is waiting. Microsoft verifies your identity the first time you open the portal.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" bgcolor="${NAVY}" style="border-radius:8px;background:${NAVY};">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="${NAVY}" strokecolor="${NAVY}">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Calibri,sans-serif;font-size:16px;font-weight:bold;">Open Launchpad</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;">Open Launchpad</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAGE};border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;">Your role</p>
                    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:${NAVY};font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;">${escapeHtml(role.label)}</p>
                    <p style="margin:0;font-size:14px;line-height:1.5;color:${MUTED};font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;">${escapeHtml(role.blurb)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:${MUTED};font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;">
                This invitation was sent to ${escapeHtml(input.user.email)} for ${fullName}.
                If the button does not work, copy this address into your browser:<br />
                <a href="${href}" style="color:${NAVY};word-break:break-all;">${href}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:28px 40px 32px;font-family:Aptos,Calibri,'Segoe UI',Arial,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
                Covetrus Launchpad is an internal workspace. If you were not expecting this email, you can ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function foldBase64(value: string): string {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += 76) {
    lines.push(value.slice(index, index + 76));
  }
  return lines.join('\r\n');
}

function formatMailbox(name: string, email: string): string {
  const trimmed = name.trim() || email;
  const encoded = /[^\x20-\x7e]/.test(trimmed)
    ? `=?UTF-8?B?${utf8ToBase64(trimmed)}?=`
    : `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `${encoded} <${email}>`;
}

export function buildInviteEml(input: {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
  date?: Date;
}): string {
  const boundary = `----=_Launchpad_${crypto.randomUUID().replace(/-/g, '')}`;
  const date = (input.date ?? new Date()).toUTCString();
  return [
    'X-Unsent: 1',
    `From: ${formatMailbox(input.fromName, input.from)}`,
    `To: ${formatMailbox(input.toName, input.to)}`,
    `Subject: ${input.subject}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(utf8ToBase64(input.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(utf8ToBase64(input.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function prepareInviteFile(input: {
  user: PortalIdentity;
  invitedBy: PortalIdentity;
  portalUrl: string;
}): InviteDelivery {
  const portalUrl = portalHomeUrl(input.portalUrl);
  const from = input.invitedBy.email.trim();
  if (!from.includes('@')) {
    return { status: 'failed', message: 'Your signed-in account needs an email address so Outlook can send the invite from you.' };
  }
  if (!portalUrl) {
    return { status: 'failed', message: 'The invite file could not be created because the portal URL is missing.' };
  }

  const rendered = renderInviteEmail({ user: input.user, invitedBy: input.invitedBy, portalUrl });
  const filename = inviteFilename(input.user);
  return {
    status: 'downloaded',
    message: `Open ${filename} in Outlook and click Send to invite ${input.user.email}.`,
    filename,
    eml: buildInviteEml({
      from,
      fromName: input.invitedBy.displayName,
      to: input.user.email,
      toName: input.user.displayName,
      subject: rendered.subject,
      html: rendered.html,
      text: renderInviteText({ user: input.user, invitedBy: input.invitedBy, portalUrl }),
    }),
  };
}

export function inviteNotice(invite: InviteDelivery): InviteDelivery {
  return { status: invite.status, message: invite.message, filename: invite.filename };
}
