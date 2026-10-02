'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/** Opens `?overlay=add` while keeping the current URL's other params. */
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
