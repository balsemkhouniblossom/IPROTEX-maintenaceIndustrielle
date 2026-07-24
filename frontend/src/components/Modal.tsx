'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
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
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        <div
          className="panel modal-panel my-4 w-full overflow-hidden text-left sm:my-6"
          style={{ maxWidth: `min(${sizeWidths[size]}, calc(100vw - 1.5rem))` }}
        >
          <div
            className="modal-header flex min-w-0 items-center justify-between gap-3 px-4 py-2 text-sm font-bold uppercase tracking-[0.5px] text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span className="min-w-0 truncate" title={title}>{title}</span>
            <button
              aria-label="Close modal"
              onClick={onClose}
              className="flex shrink-0 items-center justify-center rounded-md p-1 text-white transition-colors hover:bg-white/10"
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
