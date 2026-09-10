import { signInWithGoogleAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

export const GoogleSignInButton = ({ label }: { label: string }): React.ReactElement => (
  <form action={signInWithGoogleAction}>
    <Button type="submit" variant="secondary" className="w-full">
      {label}
    </Button>
  </form>
);
