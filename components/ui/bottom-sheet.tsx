'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { isDesktopViewport } from '@/lib/ui/viewport';
import { cn } from '@/lib/cn';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile bottom sheet. Same focus-trap / Escape / scroll-lock contract as
 * `Drawer` (which is hard-coded to a right-side panel and can't be
 * parameterised into this without conditionalising every style line), plus a
 * dimming backdrop — a sheet without one reads as broken rather than modal.
 */
export const BottomSheet = ({
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
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    // Callers render this behind an `lg:hidden` wrapper, which hides it but
    // does not unmount it — without this guard an open desktop popover would
    // lock body scroll through its hidden mobile twin.
    if (isDesktopViewport()) return;

    triggerRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';

    const focusable = (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    focusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // Cleared outright rather than restored from a snapshot: a sheet can be
      // mounted alongside another (hidden) overlay whose own cleanup runs in
      // tree order, and restoring 'hidden' afterwards would leave the page
      // permanently unscrollable.
      document.body.style.removeProperty('overflow');
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-40 bg-black/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'border-line bg-paper-raised fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-[20px] border-t p-5 shadow-[0_-18px_48px_rgba(0,0,0,.18)]',
          className,
        )}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-ink-muted text-[11px] font-semibold tracking-[0.1em] uppercase">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted focus-visible:ring-iris rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
};
