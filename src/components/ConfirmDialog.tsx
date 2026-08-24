import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog, pending !== null);

  const confirm = useCallback<ConfirmFn>((options) => new Promise((resolve) => {
    setPending((current) => {
      // A second confirmation while one is open cancels the first.
      current?.resolve(false);
      return { options, resolve };
    });
  }), []);

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    dialog.current?.querySelector<HTMLButtonElement>('.confirm-cancel')?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') settle(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [pending, settle]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <div className="confirm-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) settle(false); }}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" ref={dialog} tabIndex={-1}>
            <h2 id="confirm-title">{pending.options.title}</h2>
            <p>{pending.options.body}</p>
            <div className="confirm-actions">
              <button className="button confirm-cancel" type="button" onClick={() => settle(false)}>{pending.options.cancelLabel ?? 'Cancel'}</button>
              <button className={`button primary${pending.options.danger ? ' confirm-danger' : ''}`} type="button" onClick={() => settle(true)}>{pending.options.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}
