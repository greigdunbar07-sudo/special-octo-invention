import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastInput {
  kind: ToastKind;
  title: string;
  body?: string;
}

interface ToastItem extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const DISMISS_MS = { success: 5_000, info: 5_000, error: 8_000 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) { window.clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const item: ToastItem = { ...input, id: crypto.randomUUID() };
    setItems((current) => [...current.slice(-3), item]);
    timers.current.set(item.id, window.setTimeout(() => dismiss(item.id), DISMISS_MS[input.kind]));
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <div className={`toast toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'} key={item.id}>
              <Icon className="toast-icon" size={18} aria-hidden="true" />
              <div className="toast-copy">
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
              </div>
              <button className="toast-dismiss" type="button" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={15} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
