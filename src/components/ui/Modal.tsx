import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardBody, CardHeader } from './Card';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusables(node: HTMLElement | null): HTMLElement[] {
  return Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * A reusable GUI modal component.
 */
export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // A11Y-002: capture the trigger, move focus in, lock scroll on OPEN; restore on
  // CLOSE. Keyed on `isOpen` ONLY — so an unstable inline `onClose` re-running the
  // keydown effect below can never re-capture focus from *inside* the open modal
  // (which would restore focus to an unmounted node on close).
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    // Move initial focus into the dialog (first control, else the dialog itself).
    (getFocusables(dialogRef.current)[0] ?? dialogRef.current)?.focus();
    return () => {
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  // TRAP focus + close on Escape. Separate effect so it can re-bind to the latest
  // `onClose` without disturbing the focus capture/restore above.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const f = getFocusables(node);
      if (f.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const active = document.activeElement;
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop — decorative; closing is also exposed via the labelled button + Escape. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-primary/35 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Content */}
      <Card
        variant="glass"
        className={cn('relative z-10 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200', className)}
        role="dialog"
        aria-modal="true"
        {...(title ? { 'aria-labelledby': titleId } : {})}
      >
        <CardHeader className="flex items-center justify-between">
          <h3 id={titleId} className="text-lg font-bold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <XIcon className="size-5" />
          </button>
        </CardHeader>
        <CardBody className="pt-0">
          {children}
        </CardBody>
      </Card>
    </div>,
    document.body
  );
}
