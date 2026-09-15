import { getServerAuthSession } from '@/lib/auth/session';
import { SettingsView } from '@/components/settings/settings-view';
import { ScreenHeader } from '@/components/nav/screen-header';
import { userHasPassword } from '@/lib/services/users';
import { getReminderPreference } from '@/lib/services/reminders';
import { listPushSubscriptions } from '@/lib/services/pushSubscriptions';

const SettingsPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const [hasPassword, reminderPreference, pushDevices] = await Promise.all([
    userHasPassword(session!.user.id),
    getReminderPreference(session!.user.id),
    listPushSubscriptions(session!.user.id),
  ]);

  return (
    <div className="max-w-[720px] animate-[fade-up_0.3s_ease-out]">
      <ScreenHeader title="Settings" description="Your account and how Ledger looks." />
      <SettingsView
        email={session!.user.email ?? ''}
        hasPassword={hasPassword}
        // Read on the server so a deployment without VAPID keys renders the
        // unavailable copy in the first HTML, not after a client-side check.
        remindersAvailable={Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)}
        reminderPreference={reminderPreference}
        pushDevices={pushDevices}
      />
    </div>
  );
};

export default SettingsPage;
