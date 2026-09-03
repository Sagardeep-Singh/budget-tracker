'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export const Modal = ({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={cn(
        'border-line bg-paper-raised text-ink w-full max-w-md rounded-2xl border p-6 backdrop:bg-transparent',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-ink-muted hover:text-ink"
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
};
