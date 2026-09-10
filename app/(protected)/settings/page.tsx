import { getServerAuthSession } from '@/lib/auth/session';
import { SettingsView } from '@/components/settings/settings-view';
import { ScreenHeader } from '@/components/nav/screen-header';
import { userHasPassword } from '@/lib/services/users';

const SettingsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const hasPassword = await userHasPassword(session!.user.id);

  return (
    <div className="max-w-[720px] animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader title="Settings" description="Your account and how Ledger looks." />
      <SettingsView email={session!.user.email ?? ''} hasPassword={hasPassword} />
    </div>
  );
};

export default SettingsPage;
