import { getServerAuthSession } from '@/lib/auth/session';
import { SettingsView } from '@/components/settings/settings-view';
import { ScreenHeader } from '@/components/nav/screen-header';

const SettingsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();

  return (
    <div className="max-w-[720px] animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader title="Settings" description="Your account and how Ledger looks." />
      <SettingsView email={session!.user.email ?? ''} />
    </div>
  );
};

export default SettingsPage;
