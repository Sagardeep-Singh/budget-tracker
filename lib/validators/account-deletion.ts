import { z } from 'zod';

export const deleteAccountSchema = z.object({
  confirmEmail: z.string().min(1, 'Type your email to confirm.'),
  // Optional at the schema level: a Google-only user (no password) sends
  // none, and the service branches on the account's actual passwordHash
  // state, not on whether this field is present.
  currentPassword: z.string().optional(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
