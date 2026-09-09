type LogoMarkProps = {
  size?: number;
  className?: string;
  /**
   * "tile" (default) draws the rounded iris-soft tile behind the mark, for
   * use on a plain paper background. "bare" skips the tile and uses
   * paper-raised for the track instead of paper-sunk, for use on top of an
   * iris-soft surface (the tile fill would otherwise vanish into it).
   */
  variant?: 'tile' | 'bare';
};

const OUTER_R = 25.83;
const INNER_R = 11.685;
const STROKE = 8;
const outerC = 2 * Math.PI * OUTER_R;
const innerC = 2 * Math.PI * INNER_R;

/**
 * The "Stack" mark from the app icon (concentric arcs, offset so the sweeps
 * never align), rendered with theme CSS vars instead of the icon's frozen
 * hex values — so it follows the live palette/appearance in-app, unlike
 * app/icon.svg and app/apple-icon.tsx which must stay static browser assets.
 */
export const LogoMark = ({
  size = 28,
  className,
  variant = 'tile',
}: LogoMarkProps): React.ReactElement => {
  const track = variant === 'tile' ? 'var(--paper-sunk)' : 'var(--paper-raised)';

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      {variant === 'tile' && <rect width="100" height="100" rx="22" fill="var(--iris-soft)" />}
      <circle
        cx="50"
        cy="50"
        r={OUTER_R}
        fill="none"
        stroke={track}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${outerC} ${outerC}`}
        transform="rotate(-90 50 50)"
      />
      <circle
        cx="50"
        cy="50"
        r={OUTER_R}
        fill="none"
        stroke="var(--iris)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${outerC * 0.72} ${outerC}`}
        transform="rotate(-90 50 50)"
      />
      <circle
        cx="50"
        cy="50"
        r={INNER_R}
        fill="none"
        stroke={track}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${innerC} ${innerC}`}
        transform="rotate(-90 50 50)"
      />
      <circle
        cx="50"
        cy="50"
        r={INNER_R}
        fill="none"
        stroke="var(--iris)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${innerC * 0.42} ${innerC}`}
        transform="rotate(30 50 50)"
      />
    </svg>
  );
};
