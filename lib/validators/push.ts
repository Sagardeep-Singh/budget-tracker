import { z } from 'zod';

/**
 * Mirrors the browser's native `PushSubscription.toJSON()` shape so the client can
 * post the subscription through untouched. `expirationTime` is deliberately not
 * modelled: browsers set it to null in practice and nothing in the send path reads
 * it, so accepting it would be storing a field we never use.
 */
export const savePushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url('A push endpoint URL is required'),
  keys: z.object({
    p256dh: z.string().min(1, 'The subscription is missing its p256dh key'),
    auth: z.string().min(1, 'The subscription is missing its auth secret'),
  }),
});

export const unsubscribePushSchema = z.object({
  endpoint: z.string().trim().url('A push endpoint URL is required'),
});

export type SavePushSubscriptionInput = z.infer<typeof savePushSubscriptionSchema>;
export type UnsubscribePushInput = z.infer<typeof unsubscribePushSchema>;
