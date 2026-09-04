'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';

export const Drawer = ({
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
}): React.ReactElement | null => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'border-line bg-paper-raised fixed top-0 right-0 bottom-0 z-40 w-[420px] overflow-auto border-l p-7 pb-8 shadow-[-18px_0_48px_rgba(0,0,0,.16)]',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-ink-muted text-[11px] font-semibold tracking-[0.1em] uppercase">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-ink-muted text-lg"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
};
