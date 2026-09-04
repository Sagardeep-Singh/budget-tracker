import { ScreenHeader } from '@/components/nav/screen-header';

const pulse = 'bg-paper-sunk [animation:om-pulse_1.4s_ease-in-out_infinite]';
const ringPulse = 'border-paper-sunk rounded-full [animation:om-pulse_1.4s_ease-in-out_infinite]';

const DashboardLoading = (): React.ReactElement => (
  <div>
    <ScreenHeader title="Overview" description="Here's where things stand this month." />
    <div className="mt-6.5 grid grid-cols-[1.5fr_1fr] items-start gap-5">
      <div className="flex flex-col gap-5">
        <div className="border-line bg-paper-raised flex items-center gap-7.5 rounded-[18px] border p-6.5">
          <div className={`h-[152px] w-[152px] shrink-0 border-[14px] ${ringPulse}`} />
          <div className="flex-1">
            <div className={`h-[11px] w-[110px] rounded-md ${pulse}`} />
            <div className={`mt-3.5 h-[34px] w-[230px] rounded-lg ${pulse}`} />
            <div className={`mt-4 h-[11px] w-[180px] rounded-md ${pulse}`} />
          </div>
        </div>
        <div className="border-line bg-paper-raised grid grid-cols-4 gap-2.5 rounded-[18px] border p-6.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2.5">
              <div className={`h-[88px] w-[88px] border-[9px] ${ringPulse}`} />
              <div className={`h-2.5 w-16 rounded-md ${pulse}`} />
            </div>
          ))}
        </div>
        <div className={`border-line bg-paper-raised h-[150px] rounded-[18px] border ${pulse}`} />
      </div>
      <div className="flex flex-col gap-5">
        <div className={`border-line bg-paper-raised h-[280px] rounded-[18px] border ${pulse}`} />
        <div className={`border-line bg-paper-raised h-[150px] rounded-[18px] border ${pulse}`} />
      </div>
    </div>
  </div>
);

export default DashboardLoading;
