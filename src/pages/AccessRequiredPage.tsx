import { CheckCircle2, LogOut, RefreshCw, ShieldQuestion } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import logo from '@/assets/covetrus-logo.png';
import { useAuth } from '@/hooks/AuthContext';
import { usePortal } from '@/hooks/PortalContext';
import { portalApi } from '@/services/portalApi';
import type { AccessRequestRecord } from '@/types/portal';

/**
 * Shown to people who signed in with a valid Microsoft work account but have
 * no active portal identity yet (PORTAL_ACCESS_REQUIRED) or whose identity is
 * pending or disabled (USER_DISABLED). Instead of a dead end, they can send a
 * request that portal administrators see in the Admin area.
 */
export function AccessRequiredPage({ code }: { code: 'PORTAL_ACCESS_REQUIRED' | 'USER_DISABLED' }) {
  const { user, signOut } = useAuth();
  const { refresh, loading } = usePortal();
  const [existing, setExisting] = useState<AccessRequestRecord | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi.getMyAccessRequest()
      .then((request) => { if (!cancelled) setExisting(request); })
      .catch(() => { /* No stored request is the same as none; the form still works. */ })
      .finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try { setExisting(await portalApi.submitAccessRequest(note)); }
    catch (caught) { setSubmitError(caught instanceof Error ? caught.message : 'The request could not be sent.'); }
    finally { setSubmitting(false); }
  }

  const disabled = code === 'USER_DISABLED';
  const pending = existing?.status === 'requested';
  const approved = existing?.status === 'approved';

  return (
    <div className="auth-screen access-screen">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <div className="auth-center">
        <div className="auth-card-wrap access-card-wrap">
          <div className="auth-card">
            <div className="auth-head">
              <img className="auth-logo" src={logo} alt="Covetrus" />
              <span className="access-mark" aria-hidden="true"><ShieldQuestion size={22} /></span>
              <h1 className="auth-title">{disabled ? 'Your access is on hold' : 'Almost there'}</h1>
              <p className="auth-subtitle">
                {disabled
                  ? 'Your portal account is pending or has been disabled by an administrator.'
                  : 'Your Microsoft sign-in worked, but this account has not been added to Covetrus Launchpad yet.'}
              </p>
            </div>
            {user?.email && <p className="access-identity">Signed in as <strong>{user.email}</strong></p>}
            {!checked && <p className="access-status" role="status">Checking for an earlier request…</p>}
            {checked && pending && (
              <div className="access-submitted" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <div>
                  <strong>Request sent</strong>
                  <span>A portal administrator has been notified. You will get in as soon as it is approved — check back later.</span>
                </div>
              </div>
            )}
            {checked && approved && (
              <div className="access-submitted" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <div>
                  <strong>Your request was approved</strong>
                  <span>Use “Check again” below to open your workspace. If it still does not open, contact a portal administrator.</span>
                </div>
              </div>
            )}
            {checked && !pending && (
              <form className="access-form" onSubmit={(event) => void submit(event)}>
                {!approved && (
                  <label>
                    Why do you need access? <small>(optional)</small>
                    <textarea
                      name="note"
                      rows={3}
                      maxLength={500}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="For example: I need the weekly operations reports."
                    />
                  </label>
                )}
                <button className="auth-button" type="submit" disabled={submitting}>
                  {submitting ? 'Sending request…' : approved ? 'Request access again' : 'Request access'}
                </button>
                {submitError && <p className="auth-error" role="alert">{submitError}</p>}
              </form>
            )}
            <div className="access-actions">
              <button className="button" type="button" disabled={loading} onClick={() => void refresh()}>
                <RefreshCw size={15} className={loading ? 'spin' : ''} /> Check again
              </button>
              <button className="button" type="button" onClick={() => void signOut()}>
                <LogOut size={15} /> Sign out and use a different account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
