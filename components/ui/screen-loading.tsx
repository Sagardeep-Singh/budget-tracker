const pulse = 'bg-paper-sunk [animation:om-pulse_1.4s_ease-in-out_infinite]';

/** Generic screen-body skeleton — a title bar, a control row, and a few
 * card-height blocks. Used by routes whose design skeleton isn't specified
 * beyond the Overview example. */
export const ScreenLoading = ({ rows = 3 }: { rows?: number }): React.ReactElement => (
  <div className="mt-6.5 flex flex-col gap-4">
    <div className={`border-line bg-paper-raised h-[64px] rounded-2xl border ${pulse}`} />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={`border-line bg-paper-raised h-[92px] rounded-2xl border ${pulse}`} />
    ))}
  </div>
);
