import { Money } from '@/components/ui/money';
import { cn } from '@/lib/cn';
import type { TransactionSummary } from '@/lib/transactions/transaction-summary';

const Stat = ({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement => (
  <div className={cn('flex min-w-0 flex-col gap-1 px-2.5 first:pl-0 last:pr-0 lg:px-6', className)}>
    <dt className="text-ink-muted text-[10.5px] font-semibold tracking-[0.06em] uppercase lg:text-[11px]">
      {label}
    </dt>
    <dd className="text-sm break-all lg:text-lg">{children}</dd>
  </div>
);

/** Period totals for the transactions list. Credit/Debit/Net sit in their own
 * columns so they read at a glance; amounts kept out of those totals (card
 * payments, transfers, reimbursements) go in a quieter footer line. */
export const TransactionTotals = ({
  summary,
  className,
}: {
  summary: TransactionSummary;
  className?: string;
}): React.ReactElement => {
  const excluded = [
    { label: 'Payments', value: summary.payments },
    { label: 'Transfers', value: summary.transfers },
    { label: 'Reimbursements', value: summary.reimbursementIncome },
  ].filter((item) => item.value > 0);

  return (
    <section
      data-testid="transaction-totals"
      aria-label="Transaction totals"
      className={cn(
        'border-line bg-paper-raised rounded-[14px] border px-4 py-3.5 lg:px-6 lg:py-4',
        className,
      )}
    >
      <p className="text-ink-muted text-[12.5px] font-medium">
        {summary.count} transaction{summary.count === 1 ? '' : 's'}
      </p>
      <dl className="divide-line mt-2.5 grid grid-cols-3 divide-x">
        <Stat label="Credit">
          <Money value={summary.credit} tone="income" />
        </Stat>
        <Stat label="Debit">
          <Money value={summary.debit} tone="expense" />
        </Stat>
        <Stat label="Net">
          <Money
            value={summary.net}
            tone={summary.net >= 0 ? 'income' : 'expense'}
            className="font-semibold"
          />
        </Stat>
      </dl>
      {excluded.length > 0 && (
        <p className="border-line text-ink-muted mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-2.5 text-xs">
          <span>Not in totals:</span>
          {excluded.map((item) => (
            <span key={item.label} className="flex items-baseline gap-1.5">
              {item.label}
              <Money value={item.value} tone="neutral" className="text-ink-muted" />
            </span>
          ))}
        </p>
      )}
    </section>
  );
};
