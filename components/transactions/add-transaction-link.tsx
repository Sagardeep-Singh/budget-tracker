'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Opens the `?overlay=add` overlay on top of the current URL, keeping its
 * other params. A bare `?overlay=add` dropped them, so on Transactions it
 * swapped the period and filters for "All time" while the overlay was open
 * and reset the paginated list's loaded pages.
 */
export const AddTransactionLink = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement => {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams);
  params.set('overlay', 'add');
  return (
    <Link href={`?${params.toString()}`} className={className}>
      {children}
    </Link>
  );
};
