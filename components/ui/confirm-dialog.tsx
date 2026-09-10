'use client';

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement => (
  <Modal open={open} onClose={onCancel} title={title} className="max-w-sm">
    <p className="text-ink-muted text-sm">{description}</p>
    <div className="mt-6 flex justify-end gap-2.5">
      <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant={danger ? 'danger' : 'primary'}
        onClick={onConfirm}
        disabled={pending}
      >
        {pending ? 'Working…' : confirmLabel}
      </Button>
    </div>
  </Modal>
);
