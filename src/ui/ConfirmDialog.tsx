import { useEffect, useRef } from 'react';

/**
 * In-page confirmation.
 *
 * Deliberately hand-rolled rather than `window.confirm` or `<dialog>`:
 * ChatGPT's in-app browser — the browser this project is primarily judged in —
 * never surfaces `window.confirm`, so the destructive action behind it was
 * simply unreachable there. Plain DOM has no such failure mode.
 */
export function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;
    confirmRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      // keep focus inside the dialog
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
      data-testid="confirm-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="card w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-sm font-semibold tracking-tight">{title}</h2>
        <p id="confirm-body" className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          {body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink-2)' }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded px-3 py-1.5 text-xs font-medium text-black"
            style={{ background: 'var(--critical)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
