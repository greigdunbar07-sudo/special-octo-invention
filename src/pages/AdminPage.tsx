import { BarChart3, Check, FileStack, KeyRound, Link2, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck, Upload, UserRoundPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { PageState } from './HomePage';
import { useConfirm } from '@/components/ConfirmDialog';
import { usePortal } from '@/hooks/PortalContext';
import { useToast } from '@/hooks/ToastContext';
import { portalApi } from '@/services/portalApi';
import { downloadInviteFile } from '@/lib/invite-download';
import { linkedAppHost } from '@/lib/linked-url';
import type { AdminSnapshot, ArtifactCompatibilityReport, ArtifactSummary, GrantTargetType, InviteDelivery, QlikDatasetBinding, UsageInsights, UsageInsightsRange } from '@/types/portal';
import { ArtifactIcon, ArtifactIconPicker, defaultArtifactIcon } from '@/components/ArtifactIcon';

type Tab = 'users' | 'groups' | 'access' | 'artifacts' | 'insights' | 'audit';
const BASE_ADMIN_TABS: Tab[] = ['users', 'groups', 'access', 'artifacts', 'audit'];
type RunMutation = (operation: () => Promise<unknown>, success?: string) => Promise<boolean>;

export function AdminPage() {
  const { identity, loading: portalLoading, refreshCatalog, refreshNotifications, features = { usageTelemetry: false, usageInsights: false } } = usePortal();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const adminTabs = features.usageInsights ? [...BASE_ADMIN_TABS.slice(0, 4), 'insights' as const, 'audit' as const] : BASE_ADMIN_TABS;
  const tab = adminTabs.includes(params.get('tab') as Tab) ? params.get('tab') as Tab : 'users';
  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'users') nextParams.delete('tab'); else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError('');
    try { setSnapshot(await portalApi.getAdminSnapshot()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Administration data could not be loaded.'); }
    finally { setBusy(false); }
  }
  async function runMutation(operation: () => Promise<unknown>, success?: string) {
    setBusy(true); setError('');
    try {
      await operation();
      await load();
      if (success) toast({ kind: 'success', title: success });
      return true;
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The change could not be saved.'); return false; }
    finally { setBusy(false); }
  }
  const pendingRequests = snapshot?.accessRequests.filter((item) => item.status === 'requested').length ?? 0;
  useEffect(() => { if (identity?.role === 'admin') void load(); }, [identity?.role]);
  if (portalLoading) return <PageState title="Loading administration" body="Verifying administrator access…" />;
  if (identity?.role !== 'admin') return <Navigate to="/" replace />;
  if (error && !snapshot) return <PageState title="Administration unavailable" body={error} action={<button className="button primary" onClick={() => void load()}>Try again</button>} />;
  return <>
    <section className="admin-heading"><div><p className="eyebrow">Portal controls</p><h1>Administration</h1><p>Add coworkers, create groups, and control what appears in each library—all from this portal.</p></div><button className="button" onClick={() => void load()} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /> Refresh</button></section>
    <div className="admin-tabs" role="tablist" aria-label="Administration sections">{adminTabs.map((key, index, items) => {
      const meta = { users: ['Users', UserRoundPlus], groups: ['Groups', UsersRound], access: ['Access matrix', KeyRound], artifacts: ['Library', FileStack], insights: ['Insights', BarChart3], audit: ['Audit log', ShieldCheck] } as const;
      const [label, Icon] = meta[key];
      return <button id={`admin-tab-${key}`} role="tab" aria-label={key === 'users' && pendingRequests > 0 ? `${label}, ${pendingRequests} pending access request${pendingRequests === 1 ? '' : 's'}` : label} aria-selected={tab === key} aria-controls="admin-tabpanel" tabIndex={tab === key ? 0 : -1} key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} onKeyDown={(event) => { const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : offset ? (index + offset + items.length) % items.length : -1; if (next >= 0) { event.preventDefault(); const nextKey = items[next]; setTab(nextKey); requestAnimationFrame(() => document.getElementById(`admin-tab-${nextKey}`)?.focus()); } }}><Icon size={16} /><span className="admin-tab-label" data-short={key === 'access' ? 'Access' : key === 'artifacts' ? 'Library' : key === 'audit' ? 'Audit' : label}>{label}</span>{key === 'users' && pendingRequests > 0 && <span className="tab-badge" aria-hidden="true">{pendingRequests}</span>}</button>;
    })}</div>
    {error && snapshot && <div className="import-notice import-notice-error admin-error" role="alert"><strong>The change could not be completed.</strong><span>{error}</span></div>}
    {snapshot && <div id="admin-tabpanel" className="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
      {tab === 'users' && <UsersPanel snapshot={snapshot} currentUserId={identity.id} runMutation={runMutation} busy={busy} />}
      {tab === 'groups' && <GroupsPanel snapshot={snapshot} runMutation={runMutation} busy={busy} />}
      {tab === 'access' && <AccessPanel snapshot={snapshot} runMutation={runMutation} busy={busy} />}
      {tab === 'artifacts' && <ArtifactsPanel snapshot={snapshot} reload={load} refreshPortal={refreshCatalog} refreshNotifications={refreshNotifications} />}
      {tab === 'insights' && <InsightsPanel />}
      {tab === 'audit' && <AuditPanel snapshot={snapshot} />}
    </div>}
  </>;
}

function PanelHeader({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{body}</p></div>{action}</div>;
}

function UsersPanel({ snapshot, currentUserId, runMutation, busy }: { snapshot: AdminSnapshot; currentUserId: string; runMutation: RunMutation; busy: boolean }) {
  const confirm = useConfirm();
  const [show, setShow] = useState(false);
  const [newRole, setNewRole] = useState<'viewer' | 'admin'>('viewer');
  const [inviteNotice, setInviteNotice] = useState<InviteDelivery | null>(null);
  const pendingRequests = snapshot.accessRequests.filter((item) => item.status === 'requested');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const displayName = String(data.get('displayName'));
    const groupId = String(data.get('groupId') ?? '');
    let invite: InviteDelivery | undefined;
    const saved = await runMutation(async () => {
      const created = await portalApi.addUser({ email: String(data.get('email')), displayName, role: data.get('role') === 'admin' ? 'admin' : 'viewer' });
      if (groupId) await portalApi.addMembership(groupId, created.id);
      invite = downloadInviteFile(created.invite);
    }, `${displayName} was added${groupId ? ' with group access' : ''}.`);
    if (saved) {
      setShow(false);
      if (invite) setInviteNotice(invite);
    }
  }
  return <><PanelHeader title="Users" body="Add a coworker by work email. Send invite downloads a branded .eml you can open in Outlook and send—including to yourself for a test." action={<button className="button primary" onClick={() => setShow((value) => !value)}><Plus size={16} /> Add user</button>} />
    {pendingRequests.length > 0 && <section className="access-requests" aria-label="Access requests">
      <div className="access-requests-heading"><h3><UserRoundPlus size={16} /> Access requests <span className="tab-badge">{pendingRequests.length}</span></h3><p>People who signed in with a Microsoft work account but are not portal members yet.</p></div>
      {pendingRequests.map((request) => <AccessRequestRow key={request.id} request={request} groups={snapshot.groups} busy={busy} runMutation={runMutation} />)}
    </section>}
    {inviteNotice && <div className={`import-notice import-notice-${inviteNotice.status === 'failed' ? 'error' : 'success'}`} role="status"><strong>{inviteNotice.status === 'failed' ? 'Invite not downloaded' : 'Invite downloaded'}</strong><span>{inviteNotice.message} No email is sent automatically—the .eml file is an Outlook draft.</span></div>}
    {show && <form className="inline-form" onSubmit={(event) => void submit(event)}><label>Name<input required name="displayName" /></label><label>Email<input required type="email" name="email" /></label><label>Role<select name="role" value={newRole} onChange={(event) => setNewRole(event.target.value === 'admin' ? 'admin' : 'viewer')}><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label>{snapshot.groups.length > 0 && <label>Add to group<select name="groupId" defaultValue=""><option value="">No group yet</option>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<button className="button primary" disabled={busy}>{busy ? 'Adding…' : newRole === 'admin' ? 'Add administrator' : 'Add viewer'}</button><p className="invite-hint">Adding a user downloads an Outlook draft (.eml). Open it and press Send to deliver the invite—nothing is emailed automatically. Assigning a group means their library has content on day one.</p></form>}
    <div className="table-wrap responsive-table"><table><thead><tr><th>User</th><th>Sign-in</th><th>Role</th><th>Status</th><th>Controls</th></tr></thead><tbody>{snapshot.users.map((user) => { const isSelf = user.id === currentUserId; return <tr key={user.id}><td data-label="User"><strong>{user.displayName}</strong><small>{user.email}</small></td><td data-label="Sign-in"><span className="bound">Microsoft SSO</span></td><td data-label="Role"><span>{user.role === 'admin' ? 'Workspace administrator' : 'Viewer'}</span></td><td data-label="Status"><span className={`status status-${user.status}`}>{user.status}</span></td><td data-label="Controls"><button className="text-button" disabled={busy} aria-label={`${user.status === 'pending' ? 'Resend' : 'Send'} invite to ${user.displayName}`} onClick={() => void runMutation(async () => { setInviteNotice(downloadInviteFile(await portalApi.resendUserInvite(user.id))); })}><Mail size={14} /> {user.status === 'pending' ? 'Resend invite' : 'Send invite'}</button><button className="text-button" disabled={busy || user.role === 'admin'} onClick={() => { void (async () => { const nextStatus = user.status === 'disabled' ? 'active' : 'disabled'; if (nextStatus === 'active' || await confirm({ title: `Disable ${user.displayName}?`, body: 'They will immediately lose portal access. You can enable them again at any time.', confirmLabel: 'Disable', danger: true })) await runMutation(() => portalApi.updateUser(user.id, { status: nextStatus }), `${user.displayName} was ${nextStatus === 'active' ? 'enabled' : 'disabled'}.`); })(); }}>{user.role === 'admin' ? 'Protected' : user.status === 'disabled' ? 'Enable' : 'Disable'}</button><button className="text-button" disabled={busy || isSelf} onClick={() => { void (async () => { const role = user.role === 'admin' ? 'viewer' : 'admin'; if (await confirm({ title: role === 'admin' ? `Make ${user.displayName} an administrator?` : `Remove administrator access from ${user.displayName}?`, body: role === 'admin' ? 'Workspace administrators can manage people, access, and the library.' : 'They will keep viewer access to their assigned items.', confirmLabel: role === 'admin' ? 'Make admin' : 'Make viewer' })) await runMutation(() => portalApi.updateUser(user.id, { role }), `${user.displayName} is now ${role === 'admin' ? 'a workspace administrator' : 'a viewer'}.`); })(); }}>{isSelf ? 'Current admin' : user.role === 'admin' ? 'Make viewer' : 'Make admin'}</button>{user.role !== 'admin' && <button className="text-button danger" disabled={busy} onClick={() => { void (async () => { if (await confirm({ title: `Permanently remove ${user.displayName}?`, body: 'Their memberships and direct access assignments will also be deleted. This cannot be undone.', confirmLabel: 'Remove', danger: true })) await runMutation(() => portalApi.deleteUser(user.id), `${user.displayName} was removed.`); })(); }}>Remove</button>}</td></tr>; })}</tbody></table></div>
  </>;
}

function AccessRequestRow({ request, groups, busy, runMutation }: { request: AdminSnapshot['accessRequests'][number]; groups: AdminSnapshot['groups']; busy: boolean; runMutation: RunMutation }) {
  const confirm = useConfirm();
  const [groupId, setGroupId] = useState('');
  const requestedOn = new Date(request.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return <article className="access-request-row">
    <div className="access-request-copy">
      <strong>{request.displayName}</strong>
      <small>{request.email} · requested {requestedOn}</small>
      {request.note && <p>“{request.note}”</p>}
    </div>
    <div className="access-request-actions">
      {groups.length > 0 && <select aria-label={`Group for ${request.displayName}`} value={groupId} disabled={busy} onChange={(event) => setGroupId(event.target.value)}><option value="">No group yet</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
      <button className="button primary" disabled={busy} onClick={() => { void (async () => { await runMutation(async () => { const user = await portalApi.approveAccessRequest(request.id, { role: 'viewer' }); if (groupId) await portalApi.addMembership(groupId, user.id); }, `${request.displayName} now has portal access${groupId ? ' with group content' : ''}. Assign more items on the Access matrix tab.`); })(); }}><Check size={15} /> Approve</button>
      <button className="button" disabled={busy} onClick={() => { void (async () => { if (await confirm({ title: `Dismiss the request from ${request.displayName}?`, body: 'They stay signed out of the portal and can send a new request later.', confirmLabel: 'Dismiss', danger: true })) await runMutation(() => portalApi.dismissAccessRequest(request.id), 'The access request was dismissed.'); })(); }}><X size={15} /> Dismiss</button>
    </div>
  </article>;
}

function GroupsPanel({ snapshot, runMutation, busy }: { snapshot: AdminSnapshot; runMutation: RunMutation; busy: boolean }) {
  const confirm = useConfirm();
  const [show, setShow] = useState(false);
  const [groupId, setGroupId] = useState(snapshot.groups[0]?.id ?? '');
  const [userId, setUserId] = useState(snapshot.users[0]?.id ?? '');
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); if (await runMutation(() => portalApi.addGroup({ name: String(data.get('name')), description: String(data.get('description')) }), `The ${String(data.get('name'))} group was created.`)) setShow(false); }
  return <><PanelHeader title="Groups" body="Group membership makes repeated artifact assignments easier to maintain." action={<button className="button primary" onClick={() => setShow((value) => !value)}><Plus size={16} /> Add group</button>} />
    {show && <form className="inline-form" onSubmit={(event) => void submit(event)}><label>Group name<input required name="name" /></label><label>Description<input required name="description" /></label><button className="button primary" disabled={busy}>Create group</button></form>}
    <div className="group-grid">{snapshot.groups.map((group) => <article className="group-card" key={group.id}><span className="group-icon"><UsersRound /></span><h3>{group.name}</h3><p>{group.description}</p><strong>{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</strong><div className="member-chips">{snapshot.memberships.filter((item) => item.groupId === group.id).map((item) => { const user = snapshot.users.find((candidate) => candidate.id === item.userId); return <button title="Remove membership" aria-label={`Remove ${user?.displayName ?? 'user'} from ${group.name}`} disabled={busy} key={item.id} onClick={() => { void (async () => { if (await confirm({ title: `Remove ${user?.displayName ?? 'this user'} from ${group.name}?`, body: 'They lose access to anything assigned through this group.', confirmLabel: 'Remove', danger: true })) await runMutation(() => portalApi.removeMembership(group.id, item.userId), 'The membership was removed.'); })(); }}>{user?.displayName} ×</button>; })}</div></article>)}</div>
    <form className="membership-form" onSubmit={(event) => { event.preventDefault(); void runMutation(() => portalApi.addMembership(groupId, userId), 'The membership was added.'); }}><strong>Add membership</strong><select disabled={busy} value={userId} onChange={(event) => setUserId(event.target.value)}>{snapshot.users.filter((user) => user.status !== 'disabled').map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select><span>to</span><select disabled={busy} value={groupId} onChange={(event) => setGroupId(event.target.value)}>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="button" disabled={busy || !groupId || !userId}>Add</button></form>
  </>;
}

function AccessPanel({ snapshot, runMutation, busy }: { snapshot: AdminSnapshot; runMutation: RunMutation; busy: boolean }) {
  const [targetType, setTargetType] = useState<GrantTargetType>('group');
  const [artifactId, setArtifactId] = useState(snapshot.artifacts[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const artifact = snapshot.artifacts.find((item) => item.id === artifactId) ?? snapshot.artifacts[0];
  const targets = (targetType === 'group' ? snapshot.groups : snapshot.users).filter((target) => ('displayName' in target ? target.displayName : target.name).toLowerCase().includes(query.toLowerCase()));
  const assigned = artifact ? snapshot.grants.filter((grant) => grant.artifactId === artifact.id && grant.targetType === targetType).length : 0;
  return <><PanelHeader title="Access assignments" body="Choose one library item, then assign groups or individual users. This view remains manageable as the library grows." />
    <div className="access-toolbar"><label>Library item<select value={artifact?.id ?? ''} onChange={(event) => setArtifactId(event.target.value)}>{snapshot.artifacts.map((item) => <option key={item.id} value={item.id}>{item.title} ({item.kind})</option>)}</select></label><label className="access-search"><Search size={15} /><input aria-label="Search access targets" placeholder={`Search ${targetType === 'group' ? 'groups' : 'users'}`} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="access-toggle"><button className={targetType === 'group' ? 'active' : ''} onClick={() => setTargetType('group')}>Groups</button><button className={targetType === 'user' ? 'active' : ''} onClick={() => setTargetType('user')}>Users</button></div>
    <div className="assignment-summary"><strong>{artifact?.title ?? 'No library items'}</strong><span>{assigned} {targetType}{assigned === 1 ? '' : 's'} assigned</span></div>
    <div className="assignment-list"><table><tbody>{artifact && targets.map((target) => { const targetName = 'displayName' in target ? target.displayName : target.name; const checked = snapshot.grants.some((grant) => grant.artifactId === artifact.id && grant.targetType === targetType && grant.targetId === target.id); return <tr className="assignment-row" key={target.id}><td><strong>{targetName}</strong>{'email' in target && <small>{target.email}</small>}</td><td><input aria-label={`${checked ? 'Remove' : 'Grant'} ${artifact.title} ${checked ? 'from' : 'to'} ${targetName}`} type="checkbox" checked={checked} disabled={busy} onChange={(event) => { const enabled = event.currentTarget.checked; void runMutation(() => portalApi.setGrant({ artifactId: artifact.id, targetType, targetId: target.id, enabled }), enabled ? `${targetName} was granted ${artifact.title}.` : `${artifact.title} was removed from ${targetName}.`); }} /></td></tr>; })}</tbody></table>{artifact && targets.length === 0 && <p className="empty-inline">No matching {targetType === 'group' ? 'groups' : 'users'}.</p>}</div>
  </>;
}

function ArtifactsPanel({ snapshot, reload, refreshPortal, refreshNotifications }: { snapshot: AdminSnapshot; reload: () => Promise<void>; refreshPortal: () => Promise<void>; refreshNotifications: () => Promise<void> }) {
  const confirm = useConfirm();
  const [notice, setNotice] = useState<{ kind: 'progress' | 'success' | 'error'; text: string; detail?: string } | null>(null);
  const [uploading, setUploading] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [modeHint, setModeHint] = useState('Self-contained HTML, or attach JSON to keep data separate.');
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [jsonFiles, setJsonFiles] = useState<File[]>([]);
  const [preflight, setPreflight] = useState<ArtifactCompatibilityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [editingId, setEditingId] = useState('');
  const previewRef = useRef<HTMLIFrameElement>(null);
  const preflightSequence = useRef(0);

  useEffect(() => {
    function receivePreview(event: MessageEvent) {
      if (event.source !== previewRef.current?.contentWindow || event.data?.protocol !== 'covetrus.portal.preflight' || event.data?.version !== 1) return;
      if (event.data.type === 'error') { setPreviewStatus('error'); setPreviewError(String(event.data.detail || 'The preview reported an error.')); }
      if (event.data.type === 'ready') setPreviewStatus((current) => current === 'error' ? current : 'ready');
    }
    window.addEventListener('message', receivePreview);
    return () => window.removeEventListener('message', receivePreview);
  }, []);

  async function checkCompatibility(file: File | null, json: File[]) {
    const sequence = ++preflightSequence.current;
    setPreflight(null); setPreviewStatus('idle'); setPreviewError('');
    if (!file || file.size === 0) return;
    setChecking(true); setNotice({ kind: 'progress', text: `Checking ${file.name}…`, detail: 'Dependencies are being secured for offline use.' });
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      const report = await portalApi.preflightArtifact({ html: isZip ? undefined : file, zip: isZip ? file : undefined, jsonFiles: json });
      if (sequence !== preflightSequence.current) return;
      setPreflight(report);
      if (report.status === 'ready') {
        setPreviewStatus('loading');
        setNotice({ kind: 'success', text: `${file.name} is ready to publish.`, detail: `${report.transformations.length} dependenc${report.transformations.length === 1 ? 'y was' : 'ies were'} secured.` });
      } else {
        setNotice({ kind: 'error', text: `${file.name} needs attention.`, detail: report.blockers[0]?.message || 'The file cannot run safely in the portal.' });
      }
    } catch (caught) {
      if (sequence !== preflightSequence.current) return;
      setNotice({ kind: 'error', text: 'Compatibility check failed.', detail: caught instanceof Error ? caught.message : 'The file could not be checked.' });
    } finally { if (sequence === preflightSequence.current) setChecking(false); }
  }

  async function upload(artifactId: string, datasetKey: string, file?: File) {
    if (!file) return; setUploading(`${artifactId}:${datasetKey}`); setNotice({ kind: 'progress', text: `Reading ${file.name}…` });
    try {
      const payload = JSON.parse(await file.text());
      setNotice({ kind: 'progress', text: `Importing ${file.name} into protected Azure storage…` });
      await portalApi.seedDataset(artifactId, datasetKey, payload);
      setNotice({ kind: 'success', text: `${file.name} was stored securely.`, detail: `${datasetKey} is now available to assigned users.` });
      await Promise.all([reload(), refreshPortal(), refreshNotifications()]);
    }
    catch (caught) { setNotice({ kind: 'error', text: `Import failed for ${file.name}.`, detail: caught instanceof Error ? caught.message : 'The dataset could not be stored.' }); }
    finally { setUploading(''); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!packageFile || packageFile.size === 0) { setNotice({ kind: 'error', text: 'Choose an HTML file or zip to publish.' }); return; }
    if (preflight?.status !== 'ready' || !preflight.preflightToken || previewStatus !== 'ready') { setNotice({ kind: 'error', text: 'Complete compatibility checking before publishing.', detail: previewError || 'Choose the file again and wait for the protected preview to finish.' }); return; }
    setPublishing(true); setNotice({ kind: 'progress', text: `Publishing ${packageFile.name}…` });
    try {
      const artifact = await portalApi.publishArtifact({
        title: String(data.get('title')), description: String(data.get('description')),
        kind: String(data.get('kind')) === 'tool' ? 'tool' : 'report', owner: String(data.get('owner')),
        capabilities: data.get('downloads') ? ['downloads'] : [],
        icon: String(data.get('icon')) as Parameters<typeof portalApi.publishArtifact>[0]['icon'],
        preflightToken: preflight.preflightToken,
      });
      setNotice({ kind: 'success', text: `${artifact.title} is live for you.`, detail: 'Assign it to a group on the Access matrix tab so others can see it.' });
      setShowPublish(false); form.reset(); setPackageFile(null); setJsonFiles([]); setPreflight(null); setPreviewStatus('idle'); setModeHint('Self-contained HTML, or attach JSON to keep data separate.');
      await Promise.all([reload(), refreshPortal(), refreshNotifications()]);
    }
    catch (caught) { setNotice({ kind: 'error', text: 'Publish failed.', detail: caught instanceof Error ? caught.message : 'The artifact could not be stored.' }); }
    finally { setPublishing(false); }
  }

  async function linkApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setLinking(true); setNotice({ kind: 'progress', text: `Linking ${String(data.get('title'))}…` });
    try {
      const artifact = await portalApi.linkArtifact({
        title: String(data.get('title')), description: String(data.get('description')),
        kind: String(data.get('kind')) === 'report' ? 'report' : 'tool', owner: String(data.get('owner')),
        url: String(data.get('url')),
        icon: String(data.get('icon')) as Parameters<typeof portalApi.linkArtifact>[0]['icon'],
      });
      setNotice({ kind: 'success', text: `${artifact.title} is linked for you.`, detail: 'Assign it to a group on the Access matrix tab so others can see it. The destination app keeps its own sign-in.' });
      setShowLink(false); form.reset();
      await Promise.all([reload(), refreshPortal(), refreshNotifications()]);
    }
    catch (caught) { setNotice({ kind: 'error', text: 'Link failed.', detail: caught instanceof Error ? caught.message : 'The app could not be linked.' }); }
    finally { setLinking(false); }
  }

  async function replaceBundle(artifactId: string, file?: File) {
    if (!file) return; setUploading(`${artifactId}:bundle`); setNotice({ kind: 'progress', text: `Replacing ${file.name}…` });
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip');
      await portalApi.replaceArtifactBundle(artifactId, { html: isZip ? undefined : file, zip: isZip ? file : undefined });
      setNotice({ kind: 'success', text: `${file.name} replaced the published bundle.` });
      await Promise.all([reload(), refreshPortal()]);
    }
    catch (caught) { setNotice({ kind: 'error', text: 'Replace failed.', detail: caught instanceof Error ? caught.message : 'The bundle could not be stored.' }); }
    finally { setUploading(''); }
  }

  async function deleteArtifact(artifactId: string, title: string) {
    setUploading(`${artifactId}:delete`); setNotice({ kind: 'progress', text: `Deleting ${title}…` });
    try {
      await portalApi.deletePublishedArtifact(artifactId);
      setNotice({ kind: 'success', text: `${title} was permanently deleted.`, detail: 'Its assignments, datasets, notifications, and stored files were removed.' });
      await Promise.all([reload(), refreshPortal(), refreshNotifications()]);
    }
    catch (caught) { setNotice({ kind: 'error', text: 'Delete failed.', detail: caught instanceof Error ? caught.message : 'The published item could not be deleted.' }); }
    finally { setUploading(''); }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>, artifactId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const current = snapshot.artifacts.find((item) => item.id === artifactId);
    setUploading(`${artifactId}:metadata`); setNotice({ kind: 'progress', text: 'Saving library details…' });
    try {
      await portalApi.updatePublishedArtifact(artifactId, current?.source === 'linked'
        ? { title: String(data.get('title')), description: String(data.get('description')), owner: String(data.get('owner')), icon: String(data.get('icon')) as Parameters<typeof portalApi.updatePublishedArtifact>[1]['icon'], url: String(data.get('url')) }
        : { title: String(data.get('title')), description: String(data.get('description')), owner: String(data.get('owner')), icon: String(data.get('icon')) as Parameters<typeof portalApi.updatePublishedArtifact>[1]['icon'], capabilities: data.get('downloads') ? ['downloads'] : [] });
      setEditingId(''); setNotice({ kind: 'success', text: 'Library details were updated.', detail: current?.source === 'linked' ? 'The title, icon, description and URL are live now.' : 'The title, icon, description and download setting are live now.' });
      await Promise.all([reload(), refreshPortal()]);
    } catch (caught) { setNotice({ kind: 'error', text: 'Update failed.', detail: caught instanceof Error ? caught.message : 'The library details could not be saved.' }); }
    finally { setUploading(''); }
  }

  return <>
    <PanelHeader title="Publish a report or tool" body="Drop Cowork HTML here to go live without a redeploy, or paste an HTTPS URL to link an existing app. For a versioned container release, use npm run artifacts:import instead." action={<div className="panel-heading-actions"><button className="button" type="button" onClick={() => { setShowPublish(false); setShowLink((value) => !value); }}><Link2 size={16} /> Link an app</button><button className="button primary" type="button" onClick={() => { setShowLink(false); setShowPublish((value) => !value); }}><Upload size={16} /> Publish</button></div>} />
    {showLink && <form className="publish-form" onSubmit={(event) => void linkApp(event)}>
      <label>Title<input required name="title" /></label>
      <label>Description<input required name="description" /></label>
      <label>Kind<select name="kind" defaultValue="tool"><option value="tool">Tool</option><option value="report">Report</option></select></label>
      <label>Owner<input required name="owner" /></label>
      <div className="icon-picker-field"><span>Icon</span><ArtifactIconPicker name="icon" defaultValue="wrench" /></div>
      <label className="publish-url">App URL<input required name="url" type="url" placeholder="https://" autoComplete="off" /></label>
      <p className="publish-hint">The destination app keeps its own sign-in. Microsoft Entra apps such as Better Buying will prompt in the new tab. After linking, grant access on the Access matrix.</p>
      <button className="button primary" disabled={linking}>{linking ? 'Linking…' : 'Link now'}</button>
    </form>}
    {showPublish && <form className="publish-form" onSubmit={(event) => void publish(event)}>
      <label>Title<input required name="title" /></label>
      <label>Description<input required name="description" /></label>
      <label>Kind<select name="kind"><option value="report">Report</option><option value="tool">Tool</option></select></label>
      <label>Owner<input required name="owner" /></label>
      <div className="icon-picker-field"><span>Icon</span><ArtifactIconPicker name="icon" defaultValue="chart" /></div>
      <label className="publish-file">HTML or zip<input required name="package" type="file" accept=".html,.htm,.zip,text/html,application/zip" onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; setPackageFile(file); setModeHint(file?.name.toLowerCase().endsWith('.zip') ? 'Zip package — local and public HTTPS assets will be secured automatically.' : 'HTML dependencies will be secured automatically for offline use.'); void checkCompatibility(file, jsonFiles); }} /></label>
      <label className="publish-file">Optional JSON<input name="json" type="file" accept="application/json,.json" multiple onChange={(event) => { const files = [...(event.currentTarget.files ?? [])]; setJsonFiles(files); setModeHint(files.length > 0 ? 'Data-separated: JSON is stored in private storage and injected at runtime.' : 'Self-contained HTML, or attach JSON to keep data separate.'); void checkCompatibility(packageFile, files); }} /></label>
      <label className="publish-check"><input type="checkbox" name="downloads" defaultChecked /> Allow generated file downloads (Excel, PowerPoint, CSV, PDF or zip)</label>
      <p className="publish-hint">{modeHint} After publish, grant access on the Access matrix.</p>
      {(checking || preflight) && <section className={`compatibility-report compatibility-${preflight?.status ?? 'checking'}`} aria-live="polite">
        <header><strong>{checking ? 'Checking compatibility…' : preflight?.status === 'ready' ? 'Ready for Launchpad' : 'Changes required'}</strong>{preflight && <span>{formatBytes(preflight.normalizedBytes || preflight.inputBytes)}</span>}</header>
        {preflight?.transformations.length ? <div><b>Secured automatically</b><ul>{preflight.transformations.map((item, index) => <li key={`${item.code}-${index}`}>{item.message} <small>{item.source}</small></li>)}</ul></div> : null}
        {preflight?.warnings.length ? <div><b>Warnings</b><ul>{preflight.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message} <small>{item.remediation}</small></li>)}</ul></div> : null}
        {preflight?.blockers.length ? <div role="alert"><b>Blocking issues</b><ul>{preflight.blockers.map((item, index) => <li key={`${item.code}-${index}`}>{item.message} <small>{item.remediation}</small></li>)}</ul></div> : null}
        {preflight?.status === 'ready' && preflight.previewUrl && <div className="compatibility-preview"><b>Protected preview</b><span>{previewStatus === 'loading' ? 'Loading…' : previewStatus === 'ready' ? 'Passed' : previewStatus === 'error' ? 'Failed' : 'Waiting'}</span><iframe ref={previewRef} title="Artifact compatibility preview" src={preflight.previewUrl} sandbox="allow-scripts" /></div>}
        {previewError && <p className="compatibility-error" role="alert">{previewError}</p>}
      </section>}
      <details className="cowork-brief"><summary>Instructions to paste into Cowork</summary><pre>{`Build a static HTML report or tool. Public HTTPS dependencies and zip-relative assets are secured automatically for offline use.
If data must stay separate, include JSON beside the HTML in a zip or attach it here; relative fetch('data.json') calls are supported.
Do not use live APIs, modules, workers, WebSockets, or embedded external applications. An administrator publishes it in Launchpad.`}</pre></details>
      <button className="button primary" disabled={publishing || checking || preflight?.status !== 'ready' || previewStatus !== 'ready'}>{publishing ? 'Publishing…' : checking ? 'Checking…' : 'Publish now'}</button>
    </form>}
    {notice && <div className={`import-notice import-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><strong>{notice.text}</strong>{notice.detail && <span>{notice.detail}</span>}</div>}
    <PanelHeader title="Library items" body="Bundled items ship in the container. Live items were published here. Import JSON, or point a Qlik Sense table at a dataset slot, for data-separated models and reports." />
    <div className="artifact-admin-list">{snapshot.artifacts.map((artifact) => {
      const datasetKeys = artifact.datasetKeys.concat(snapshot.qlikBindings.filter((item) => item.artifactId === artifact.id && !artifact.datasetKeys.includes(item.datasetKey)).map((item) => item.datasetKey));
      const primaryDatasetKey = datasetKeys[0];
      const primaryBinding = snapshot.qlikBindings.find((item) => item.artifactId === artifact.id && item.datasetKey === primaryDatasetKey);
      return <article key={artifact.id}>
        <span className={`artifact-icon accent-${artifact.accent}`}><ArtifactIcon name={artifact.icon} kind={artifact.kind} /></span>
        {editingId === artifact.id ? <form className="artifact-edit-form" onSubmit={(event) => void saveMetadata(event, artifact.id)}><label>Title<input required name="title" defaultValue={artifact.title} /></label><label>Description<input required name="description" defaultValue={artifact.description} /></label><label>Owner<input required name="owner" defaultValue={artifact.owner} /></label>{artifact.source === 'linked' ? <label className="publish-url">App URL<input required name="url" type="url" defaultValue={artifact.entryUrl} autoComplete="off" /></label> : <label className="publish-check"><input type="checkbox" name="downloads" defaultChecked={artifact.capabilities.includes('downloads')} /> Allow generated file downloads</label>}<div className="icon-picker-field"><span>Icon</span><ArtifactIconPicker name="icon" defaultValue={artifact.icon ?? defaultArtifactIcon(artifact.kind)} /></div><div className="artifact-edit-actions"><button className="button primary" disabled={Boolean(uploading)}><Check size={15} /> Save</button><button className="button" type="button" onClick={() => setEditingId('')}><X size={15} /> Cancel</button></div></form> : <div className="artifact-admin-copy"><h3>{artifact.title}</h3><p>{artifact.slug} · owned by {artifact.owner}{artifact.source === 'linked' ? ` · ${linkedAppHost(artifact.entryUrl)}` : primaryDatasetKey ? ` · ${qlikSourceStatus(primaryBinding)}` : ''}</p></div>}
        {editingId !== artifact.id && <>
          <div className="artifact-admin-badges"><span className="version-pill">v{artifact.version}</span><span className="source-pill">{librarySourceLabel(artifact)}</span></div>
          <div className="artifact-admin-actions">
            {primaryDatasetKey && artifact.source !== 'linked' && <QlikSourceLaunch artifact={artifact} datasetKey={primaryDatasetKey} binding={primaryBinding} />}
            {(artifact.source === 'uploaded' || artifact.source === 'linked') && <button className="button" disabled={Boolean(uploading)} onClick={() => setEditingId(artifact.id)}><Pencil size={15} /> Edit details</button>}
            {artifact.source === 'linked' && <button className="button danger" disabled={Boolean(uploading)} onClick={() => { void (async () => { if (await confirm({ title: `Permanently delete ${artifact.title}?`, body: 'Its assignments and notifications will also be removed. This cannot be undone.', confirmLabel: 'Delete', danger: true })) await deleteArtifact(artifact.id, artifact.title); })(); }}>Delete</button>}
            {(artifact.source === 'uploaded' || datasetKeys.length > 0) && artifact.source !== 'linked' && <details className="artifact-actions-menu">
              <summary role="button" aria-label={`More actions for ${artifact.title}`} title="More actions"><MoreHorizontal size={18} /></summary>
              <div className="artifact-actions-popover">
                {artifact.source === 'uploaded' && <label>Replace HTML<input hidden disabled={Boolean(uploading)} type="file" accept=".html,.htm,.zip,text/html,application/zip" onChange={(event) => { const input = event.currentTarget; void replaceBundle(artifact.id, input.files?.[0]).finally(() => { input.value = ''; }); }} /></label>}
                {datasetKeys.map((datasetKey, index) => { const busy = uploading === `${artifact.id}:${datasetKey}`; const seeded = snapshot.datasets.some((dataset) => dataset.artifactId === artifact.id && dataset.datasetKey === datasetKey && dataset.status === 'active'); const label = artifact.kind === 'tool' ? 'model' : 'report'; const binding = snapshot.qlikBindings.find((item) => item.artifactId === artifact.id && item.datasetKey === datasetKey); return <div key={datasetKey}>
                  <label>{busy ? 'Importing…' : seeded ? `Replace ${label} JSON` : `Import ${label} JSON`}<input hidden disabled={Boolean(uploading)} type="file" accept="application/json,.json" onChange={(event) => { const input = event.currentTarget; void upload(artifact.id, datasetKey, input.files?.[0]).finally(() => { input.value = ''; }); }} /></label>
                  {index > 0 && <QlikSourceLaunch artifact={artifact} datasetKey={datasetKey} binding={binding} />}
                </div>; })}
                {artifact.source === 'uploaded' && <button className="danger" disabled={Boolean(uploading)} onClick={() => { void (async () => { if (await confirm({ title: `Permanently delete ${artifact.title}?`, body: 'Its assignments, datasets, notifications, and stored files will also be removed. This cannot be undone.', confirmLabel: 'Delete', danger: true })) await deleteArtifact(artifact.id, artifact.title); })(); }}>Delete</button>}
              </div>
            </details>}
          </div>
        </>}
      </article>;
    })}</div>
  </>;
}

function librarySourceLabel(artifact: ArtifactSummary) {
  if (artifact.source === 'linked') return 'Linked app';
  if (artifact.source === 'uploaded') return artifact.isActive === false ? 'Unpublished' : 'Published live';
  return 'Ships in the container';
}

function QlikSourceLaunch({ artifact, datasetKey, binding }: { artifact: ArtifactSummary; datasetKey: string; binding?: QlikDatasetBinding }) {
  return <Link className="button" to={`/admin/artifacts/${encodeURIComponent(artifact.id)}/datasets/${encodeURIComponent(datasetKey)}/qlik`}>
    {binding ? 'Open Qlik editor' : 'Qlik editor'}
  </Link>;
}

function qlikSourceStatus(binding?: QlikDatasetBinding) {
  if (binding?.lastError) return `Last error: ${binding.lastError}`;
  if (binding?.lastPulledAt) return `Last pulled ${new Date(binding.lastPulledAt).toLocaleString('en-GB')} UTC · ${binding.lastRecordCount ?? 0} rows`;
  return 'Find a Qlik table and transform it in the query editor';
}

function AuditPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const rows = useMemo(() => [...snapshot.audit].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [snapshot.audit]);
  return <><PanelHeader title="Audit log" body="Administrative and data publishing changes are retained for review." /><div className="table-wrap responsive-table"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th></tr></thead><tbody>{rows.map((event) => <tr key={event.id}><td data-label="When">{new Date(event.occurredAt).toLocaleString('en-GB')}</td><td data-label="Actor">{event.actorEmail}</td><td data-label="Action"><code>{event.action}</code></td><td data-label="Subject">{event.subjectLabel}</td><td data-label="Detail">{event.detail}</td></tr>)}</tbody></table></div></>;
}

function InsightsPanel() {
  const [range, setRange] = useState<UsageInsightsRange>('28d');
  const [insights, setInsights] = useState<UsageInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    portalApi.getUsageInsights(range).then((value) => { if (active) setInsights(value); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Usage insights could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, reload]);
  return <>
    <PanelHeader title="Usage insights" body="Aggregate adoption and reliability measures. Search terms and individual viewing histories are not collected or shown." action={<div className="insights-ranges" role="group" aria-label="Insight range">{(['7d', '28d', '90d'] as UsageInsightsRange[]).map((value) => <button className={range === value ? 'active' : ''} type="button" aria-pressed={range === value} key={value} onClick={() => setRange(value)}>{value === '7d' ? '7 days' : value === '28d' ? '28 days' : '90 days'}</button>)}</div>} />
    {loading && <div className="insights-state" role="status"><span className="spinner" /> Loading usage insights…</div>}
    {error && !loading && <div className="insights-state error" role="alert"><strong>Insights unavailable</strong><span>{error}</span><button className="button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
    {insights && !loading && !error && <>
      <div className="insights-kpis">
        <InsightKpi label="Weekly active users" value={insights.summary.weeklyActiveUsers} />
        <InsightKpi label="Monthly active users" value={insights.summary.monthlyActiveUsers} />
        <InsightKpi label="Repeat-user rate" value={`${formatPercent(insights.summary.repeatUserRate)}`} />
        <InsightKpi label="Load success" value={`${formatPercent(insights.summary.loadSuccessRate)}`} />
        <InsightKpi label="Zero-result searches" value={`${formatPercent(insights.summary.zeroResultRate)}`} />
      </div>
      <section className="insights-section" aria-labelledby="activation-title"><h3 id="activation-title">Activation</h3><div className="activation-steps"><span><strong>{insights.activation.activePortalUsers}</strong> Active members</span><span><strong>{insights.activation.usersWithPortalSession}</strong> Opened portal</span><span><strong>{insights.activation.usersWithSuccessfulArtifact}</strong> Used an item</span><span><strong>{insights.activation.repeatUsers}</strong> Repeat users</span></div></section>
      <section className="insights-section" aria-labelledby="daily-title"><h3 id="daily-title">Daily activity</h3><div className="table-wrap responsive-table"><table><thead><tr><th>Date</th><th>Active users</th><th>Successful loads</th><th>Failures</th><th>Searches</th><th>No results</th></tr></thead><tbody>{insights.daily.map((day) => <tr key={day.date}><td data-label="Date">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB')}</td><td data-label="Active users">{day.activeUsers}</td><td data-label="Successful loads">{day.successfulLoads}</td><td data-label="Failures">{day.failedLoads}</td><td data-label="Searches">{day.searches}</td><td data-label="No results">{day.zeroResultSearches}</td></tr>)}</tbody></table></div></section>
      <section className="insights-section" aria-labelledby="artifact-performance-title"><h3 id="artifact-performance-title">Library-item performance</h3>{insights.artifacts.length === 0 ? <p className="empty-inline">No library-item usage has been recorded in this period.</p> : <div className="table-wrap responsive-table"><table><thead><tr><th>Item</th><th>Unique users</th><th>Loads</th><th>Failures</th><th>Success</th><th>Last used</th><th>Favourite adds</th></tr></thead><tbody>{insights.artifacts.map((item) => <tr key={item.artifactId}><td data-label="Item"><strong>{item.title}</strong><small>{item.kind}</small></td><td data-label="Unique users">{item.uniqueUsers}</td><td data-label="Loads">{item.successfulLoads}</td><td data-label="Failures">{item.failedLoads}</td><td data-label="Success">{formatPercent(item.loadSuccessRate)}</td><td data-label="Last used">{item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString('en-GB') : '—'}</td><td data-label="Favourite adds">{item.favoriteAdds}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </>;
}

function InsightKpi({ label, value }: { label: string; value: string | number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function formatPercent(value: number) { return `${value.toFixed(value % 1 ? 1 : 0)}%`; }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
