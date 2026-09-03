import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-teal text-paper-raised hover:opacity-90',
  secondary: 'border border-line bg-paper-raised text-ink hover:border-teal',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-brick/40 text-brick hover:bg-brick-soft',
};

export const Button = ({
  variant = 'primary',
  className,
  ...props
}: ButtonProps): React.ReactElement => (
  <button
    className={cn(
      'focus-visible:outline-teal inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      variantClasses[variant],
      className,
    )}
    {...props}
  />
);
