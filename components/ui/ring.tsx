import { cn } from '@/lib/cn';

export type RingSize = 'hero' | 'budget' | 'category' | 'day' | 'row';

const SIZE: Record<RingSize, { box: number; radius: number; stroke: number }> = {
  hero: { box: 152, radius: 64, stroke: 14 },
  budget: { box: 96, radius: 40, stroke: 9 },
  category: { box: 88, radius: 36, stroke: 9 },
  day: { box: 108, radius: 46, stroke: 10 },
  row: { box: 76, radius: 31, stroke: 8 },
};

type RingProps = {
  /** Fraction of the ring that is filled, clamped to [0, 1]. */
  fraction: number;
  size?: RingSize;
  /** Ring turns rose past this fraction (0.85 for budgets, 1.0 for day-vs-pace). */
  alertAt?: number;
  /** Rotation (0-1 of a full turn) for the in-progress pace marker dot. Omit to hide it. */
  paceMarkerAt?: number;
  className?: string;
  children?: React.ReactNode;
};

export const Ring = ({
  fraction,
  size = 'budget',
  alertAt = 0.85,
  paceMarkerAt,
  className,
  children,
}: RingProps): React.ReactElement => {
  const { box, radius, stroke } = SIZE[size];
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const circumference = 2 * Math.PI * radius;
  const center = box / 2;
  const color = clamped > alertAt ? 'var(--rose)' : 'var(--iris)';
  const markerRadius = size === 'hero' ? 4 : 3.5;

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: box, height: box }}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--paper-sunk)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
        {paceMarkerAt !== undefined && (
          <circle
            cx={center}
            cy={center - radius}
            r={markerRadius}
            fill="var(--rose)"
            transform={`rotate(${paceMarkerAt * 360} ${center} ${center})`}
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      )}
    </div>
  );
};
