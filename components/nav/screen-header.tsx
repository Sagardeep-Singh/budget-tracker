export const ScreenHeader = ({
  title,
  description,
  periodSlot,
  actions,
}: {
  title: string;
  description?: string;
  /** Period pill + popover, rendered beside the title. Overview-only in the design. */
  periodSlot?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement => (
  <div className="relative flex items-end justify-between gap-6">
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-ink text-[32px] font-semibold tracking-[-0.025em]">
          {title}
        </h1>
        {periodSlot}
      </div>
      {description && (
        <p className="text-ink-muted mt-1.5 max-w-xl text-sm text-pretty">{description}</p>
      )}
    </div>
    {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
  </div>
);
