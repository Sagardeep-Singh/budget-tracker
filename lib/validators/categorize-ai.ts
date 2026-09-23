import { z } from 'zod';

/**
 * Deliberately just an id. The client sends no payee, no note, no amount and no
 * category list: the server re-reads the transaction scoped by `userId`,
 * re-derives the category list, re-checks queue eligibility and re-checks that
 * no rule matched. If the client supplied any of that, the note/amount opt-in
 * and the "only unmatched rows" rule would be client-enforced — i.e. not
 * enforced.
 */
export const suggestWithAiSchema = z.object({ transactionId: z.string().min(1) });

export type SuggestWithAiInput = z.infer<typeof suggestWithAiSchema>;
