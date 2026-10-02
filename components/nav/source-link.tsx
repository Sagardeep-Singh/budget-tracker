import { cn } from '@/lib/cn';
import { sourceCodeUrl } from '@/lib/http/sourceUrl';

/** AGPLv3 section 13 notice: offers every user the source of this deployment. */
export const SourceLink = ({ className }: { className?: string }): React.ReactElement => (
  <p className={cn('text-ink-muted text-xs', className)}>
    Track a Loonie is free software under the{' '}
    <a
      href="https://www.gnu.org/licenses/agpl-3.0.html"
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-ink underline underline-offset-2"
    >
      AGPLv3
    </a>
    .{' '}
    <a
      href={sourceCodeUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-ink underline underline-offset-2"
    >
      Source code
    </a>
  </p>
);
