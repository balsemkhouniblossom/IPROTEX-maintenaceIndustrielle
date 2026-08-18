'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus management: move focus into the dialog on open (WCAG 2.1
  // 2.4.3 Focus Order) and restore it to whatever triggered the modal on
  // close, so keyboard/screen-reader users never lose their place.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      // Keep keyboard focus trapped inside the dialog (WCAG 2.1 2.4.3 /
      // 2.1.2 No Keyboard Trap — the trap is deliberate and scoped here,
      // released again the moment the dialog closes).
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeWidths: Record<NonNullable<ModalProps['size']>, string> = {
    sm: '22rem',
    md: '30rem',
    lg: '38rem',
    xl: '46rem',
  };

  return createPortal(
    <div className="fixed inset-0 z-1000 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-3 text-center sm:p-4">
        <button
          type="button"
          aria-label="Close modal"
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="panel modal-panel my-4 w-full overflow-hidden text-left sm:my-6"
          style={{ maxWidth: `min(${sizeWidths[size]}, calc(100vw - 1.5rem))` }}
        >
          <div
            className="modal-header flex min-w-0 items-center justify-between gap-3 px-4 py-2 text-sm font-bold uppercase tracking-[0.5px] text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span id={titleId} className="min-w-0 truncate" title={title}>{title}</span>
            <button type="button"
              aria-label="Close modal"
              onClick={onClose}
              style={{ minWidth: 24, minHeight: 24 }}
              className="flex shrink-0 items-center justify-center rounded-md p-2 text-white transition-colors hover:bg-white/10"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="panel-content modal-body max-h-[calc(100vh-5.5rem)] min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:max-h-[calc(100vh-7rem)] sm:p-4">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
