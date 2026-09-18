import { z } from 'zod';

export const matchTransfersRequestSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((data) => (data.from == null) === (data.to == null), {
    message: 'from and to must both be set, or both omitted',
  })
  .refine((data) => data.from == null || data.to == null || data.from <= data.to, {
    message: 'from must not be after to',
  });

export type MatchTransfersRequest = z.infer<typeof matchTransfersRequestSchema>;
