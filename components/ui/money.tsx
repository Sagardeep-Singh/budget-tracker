import { cn } from '@/lib/cn';

const formatMoney = (value: string | number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    signDisplay: 'never',
  }).format(Math.abs(Number(value)));

export const Money = ({
  value,
  tone,
  className,
}: {
  value: string | number;
  tone?: 'income' | 'expense' | 'neutral';
  className?: string;
}): React.ReactElement => {
  const negative = Number(value) < 0;
  const resolvedTone = tone ?? (negative ? 'expense' : 'neutral');
  const toneClass =
    resolvedTone === 'income'
      ? 'text-moss'
      : resolvedTone === 'expense'
        ? 'text-brick'
        : 'text-ink';

  return (
    <span className={cn('font-money tabular-nums', toneClass, className)}>
      {resolvedTone === 'expense' && '-'}
      {resolvedTone === 'income' && '+'}
      {formatMoney(value)}
    </span>
  );
};
