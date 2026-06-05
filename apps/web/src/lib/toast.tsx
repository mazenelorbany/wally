// =============================================================================
// Toast — the app's single transient-feedback primitive.
//
// One <ToastProvider> mounted at the root (above RouterProvider, so every route
// can fire toasts). Call `const toast = useToast(); toast.success('Saved')`.
// Colour-blind-safe: every toast carries an icon + text, never hue alone.
// =============================================================================
import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@wally/ui';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  show: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = React.useCallback(
    (kind: ToastKind, message: string) => {
      const id = (idRef.current += 1);
      setToasts((t) => [...t, { id, kind, message }]);
      // Errors linger; success/info auto-dismiss faster.
      window.setTimeout(() => remove(id), kind === 'error' ? 6000 : 3500);
    },
    [remove],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      info: (m) => show('info', m),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onClose={remove} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const META: Record<
  ToastKind,
  { Icon: typeof Info; cls: string; ring: string }
> = {
  success: { Icon: CheckCircle2, cls: 'text-pass', ring: 'border-pass/40' },
  error: { Icon: AlertTriangle, cls: 'text-signal', ring: 'border-signal/50' },
  info: { Icon: Info, cls: 'text-graphite', ring: 'border-mist/70' },
};

function Toaster({
  toasts,
  onClose,
}: {
  toasts: Toast[];
  onClose: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => {
        const m = META[t.kind];
        const Icon = m.Icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-paper px-3.5 py-3 shadow-lift animate-fade-up',
              m.ring,
            )}
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', m.cls)} aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words text-sm text-ink">{t.message}</p>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 text-steel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
