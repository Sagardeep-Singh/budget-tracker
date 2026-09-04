'use client';

import { useEffect } from 'react';

export const Toast = ({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo?: () => void;
  onDismiss: () => void;
}): React.ReactElement => {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="bg-ink text-paper fixed bottom-7 left-[280px] z-30 flex items-center gap-4.5 rounded-[14px] px-4.5 py-3.5 shadow-[0_18px_40px_rgba(0,0,0,.28)]">
      <span className="text-[13.5px]">{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} className="text-iris text-[13.5px] font-semibold">
          Undo
        </button>
      )}
    </div>
  );
};
