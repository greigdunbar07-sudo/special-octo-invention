import { ArrowLeft, ArrowRight, Bell, Grid2X2, Rocket, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useFocusTrap } from '@/hooks/useFocusTrap';

const steps = [
  {
    eyebrow: 'Welcome',
    title: (name: string) => `Welcome to Covetrus Launchpad, ${name}.`,
    body: 'Launchpad brings the reports and tools you can use into one secure, personalised workspace.',
    Icon: Rocket,
  },
  {
    eyebrow: 'Your library',
    title: () => 'Everything available to you, in one place.',
    body: 'Start in Library for the full collection, then use the All, Reports, and Tools tabs to narrow the view. Search makes it easy to find a specific item.',
    Icon: Grid2X2,
  },
  {
    eyebrow: 'Stay current',
    title: () => 'See what has changed.',
    body: 'The notification bell lets you know when data has been refreshed. Open an item to work with it in its protected viewer.',
    Icon: Bell,
  },
  {
    eyebrow: 'Secure by design',
    title: () => 'Your Launchpad is personalised.',
    body: 'Microsoft protects your sign-in and your library reflects your direct and group access. You can replay this tour from your account menu at any time.',
    Icon: ShieldCheck,
  },
];

export function WelcomeTour({ open, displayName, onFinish }: { open: boolean; displayName: string; onFinish: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog, open);
  const current = steps[step];
  const firstName = displayName.trim().split(/\s+/)[0] || 'there';

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    dialog.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try { await onFinish(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The tour could not be completed.'); }
    finally { setFinishing(false); }
  };

  return (
    <div className="tour-backdrop" role="presentation">
      <div className="tour-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-title" ref={dialog} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && !finishing) void finish(); }}>
        <div className="tour-visual" aria-hidden="true"><current.Icon /></div>
        <div className="tour-copy">
          <p className="eyebrow">{current.eyebrow}</p>
          <h2 id="tour-title">{current.title(firstName)}</h2>
          <p>{current.body}</p>
        </div>
        <div className="tour-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => <span key={item.eyebrow} className={index === step ? 'active' : ''} />)}
        </div>
        {error && <p className="tour-error" role="alert">{error}</p>}
        <div className="tour-actions">
          {step === 0 ? <button className="text-action tour-skip" type="button" disabled={finishing} onClick={() => void finish()}>Skip tour</button> : <button className="button" type="button" disabled={finishing} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={16} /> Back</button>}
          {step < steps.length - 1 ? <button className="button primary" type="button" onClick={() => setStep((value) => value + 1)}>Next <ArrowRight size={16} /></button> : <button className="button primary" type="button" disabled={finishing} onClick={() => void finish()}>{finishing ? 'Finishing…' : 'Start exploring'}</button>}
        </div>
      </div>
    </div>
  );
}
