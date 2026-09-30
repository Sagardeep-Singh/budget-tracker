import Link from 'next/link';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { Money } from '@/components/ui/money';
import type { FrontendReimbursementPendingSummary } from '@/lib/services/reimbursements';

export const ReimbursementSummaryCard = ({
  summary,
}: {
  summary: FrontendReimbursementPendingSummary;
}): React.ReactElement => (
  <div className="border-line bg-paper-raised mb-4 flex items-center justify-between gap-3 rounded-[14px] border px-6 py-3.5">
    <div>
      <div className="text-sm font-medium">Pending reimbursements</div>
      <div className="text-ink-muted text-xs">All-time, across accounts</div>
    </div>
    {summary.pendingCount > 0 ? (
      <Link
        href="/transactions?pendingReimbursementsOnly=true"
        className="hover:text-iris flex items-center gap-2"
        aria-label={`View ${summary.pendingCount} pending reimbursement${summary.pendingCount === 1 ? '' : 's'}`}
      >
        <div className="text-right">
          <Money value={summary.pendingTotal} tone="neutral" className="text-[22px]" />
          <div className="text-ink-muted mt-0.5 text-xs">
            {summary.pendingCount} transaction{summary.pendingCount === 1 ? '' : 's'} outstanding
          </div>
        </div>
        <ChevronRight size={18} aria-hidden />
      </Link>
    ) : (
      <div className="text-sky flex items-center gap-1.5 text-sm font-medium">
        <CheckCircle2 size={16} aria-hidden />
        All settled up
      </div>
    )}
  </div>
);
