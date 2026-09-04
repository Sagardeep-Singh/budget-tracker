import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const fieldClass =
  'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-iris';

export const Label = ({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}): React.ReactElement => (
  <label htmlFor={htmlFor} className="text-ink-muted mb-1 block text-xs font-medium">
    {children}
  </label>
);

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.ReactElement => (
  <input className={cn(fieldClass, className)} {...props} />
);

export const Select = ({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement => (
  <select className={cn(fieldClass, className)} {...props} />
);
