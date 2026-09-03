import { cn } from '@/lib/cn';

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement => (
  <div
    className={cn(
      'border-line bg-paper-raised rounded-2xl border p-6 shadow-[0_1px_2px_rgba(22,35,31,0.04)]',
      className,
    )}
  >
    {children}
  </div>
);
