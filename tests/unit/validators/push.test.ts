import { describe, expect, it } from 'vitest';
import { savePushSubscriptionSchema, unsubscribePushSchema } from '@/lib/validators/push';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BPublicKey', auth: 'AuthSecret' },
};

describe('savePushSubscriptionSchema', () => {
  it('accepts the browser PushSubscription.toJSON() shape', () => {
    const parsed = savePushSubscriptionSchema.parse(subscription);
    expect(parsed).toEqual(subscription);
  });

  it('rejects a malformed endpoint', () => {
    expect(
      savePushSubscriptionSchema.safeParse({ ...subscription, endpoint: 'not-a-url' }).success,
    ).toBe(false);
    expect(savePushSubscriptionSchema.safeParse({ ...subscription, endpoint: '' }).success).toBe(
      false,
    );
  });

  it('rejects a missing keys object', () => {
    expect(savePushSubscriptionSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(
      false,
    );
  });

  it('rejects an empty p256dh or auth', () => {
    expect(
      savePushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { p256dh: '', auth: 'AuthSecret' },
      }).success,
    ).toBe(false);
    expect(
      savePushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { p256dh: 'BPublicKey', auth: '' },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing auth key entirely', () => {
    expect(
      savePushSubscriptionSchema.safeParse({
        ...subscription,
        keys: { p256dh: 'BPublicKey' },
      }).success,
    ).toBe(false);
  });

  it('trims surrounding whitespace on the endpoint so it matches the stored unique key', () => {
    const parsed = savePushSubscriptionSchema.parse({
      ...subscription,
      endpoint: `  ${subscription.endpoint}  `,
    });
    expect(parsed.endpoint).toBe(subscription.endpoint);
  });

  it('rejects null and non-object bodies', () => {
    expect(savePushSubscriptionSchema.safeParse(null).success).toBe(false);
    expect(savePushSubscriptionSchema.safeParse('endpoint').success).toBe(false);
  });

  it('drops the browser-supplied expirationTime rather than storing it', () => {
    const parsed = savePushSubscriptionSchema.parse({ ...subscription, expirationTime: null });
    expect('expirationTime' in parsed).toBe(false);
  });
});

describe('unsubscribePushSchema', () => {
  it('accepts a bare endpoint', () => {
    expect(unsubscribePushSchema.parse({ endpoint: subscription.endpoint })).toEqual({
      endpoint: subscription.endpoint,
    });
  });

  it('rejects a missing or malformed endpoint', () => {
    expect(unsubscribePushSchema.safeParse({}).success).toBe(false);
    expect(unsubscribePushSchema.safeParse({ endpoint: 'nope' }).success).toBe(false);
  });
});
