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

  const sizeStyles = {
    sm: 'max-w-[400px]',
    md: 'max-w-[600px]',
    lg: 'max-w-[800px]',
    xl: 'max-w-[1000px]',
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4 text-center">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        <div
          className={`panel ${sizeStyles[size]} w-full my-8`}
        >
          <div
            className="panel-header flex items-center justify-between px-4 py-2 text-sm font-bold uppercase tracking-[0.5px] text-white"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <span>{title}</span>
            <button
              aria-label="Close modal"
              onClick={onClose}
              className="flex items-center justify-center rounded-md p-1 text-white transition-colors hover:bg-white/10"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="panel-content max-h-[calc(90vh-80px)] overflow-y-auto p-4">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
