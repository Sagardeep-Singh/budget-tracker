import { z } from 'zod';

export const listImportBatchesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListImportBatchesQuery = z.infer<typeof listImportBatchesQuerySchema>;
