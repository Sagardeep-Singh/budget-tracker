import type { ButtonHTMLAttributes } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-iris text-paper-raised hover:opacity-90',
  secondary: 'border border-line bg-paper-raised text-ink hover:border-iris',
  ghost: 'text-ink-muted hover:text-ink',
  danger: 'border border-rose/40 text-rose hover:bg-rose-soft',
};

export const Button = ({
  variant = 'primary',
  icon: Icon,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps): React.ReactElement => (
  <button
    className={cn(
      'focus-visible:outline-iris inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      children ? 'gap-2' : undefined,
      variantClasses[variant],
      className,
    )}
    disabled={disabled || loading}
    {...props}
  >
    {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
    {children}
  </button>
);
