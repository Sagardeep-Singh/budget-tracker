import { ServiceValidationError } from '@/lib/services/common';
import { PROVIDER_LABELS, type AiProviderName } from '@/lib/ai/types';

/**
 * Typed error taxonomy for the BYOK AI path, following the
 * `lib/services/common.ts` pattern: named `Error` subclasses carrying a
 * user-safe message.
 *
 * Two rules hold across every class here:
 * 1. The user-facing string is built in the constructor from the provider and
 *    a `reason` discriminator, so each message exists in exactly one place and
 *    the route layer only has to read `error.message`.
 * 2. No message ever contains the API key, the request payload, or the
 *    provider's own response body — classification is by status code and error
 *    shape only.
 */

export class AiProviderAuthError extends Error {
  constructor(public readonly provider: AiProviderName) {
    super(
      `Your ${PROVIDER_LABELS[provider]} API key was rejected. Check it in Settings and save it again.`,
    );
    this.name = 'AiProviderAuthError';
  }
}

export type AiRateLimitReason = 'provider' | 'cap';

/**
 * Two distinct situations share one class because they share one status (429)
 * and one user action (wait). `reason` is the discriminator that keeps their
 * messages from collapsing into each other.
 */
export class AiRateLimitedError extends Error {
  readonly reason: AiRateLimitReason;

  constructor(
    args: { reason: 'provider'; provider: AiProviderName } | { reason: 'cap'; limit: number },
  ) {
    super(
      args.reason === 'provider'
        ? `${PROVIDER_LABELS[args.provider]} is rate-limiting your key right now. Wait a minute and try again.`
        : `You've hit today's limit of ${args.limit} AI suggestions. Try again tomorrow.`,
    );
    this.name = 'AiRateLimitedError';
    this.reason = args.reason;
  }
}

export type AiUnavailableReason = 'server' | 'timeout' | 'other';

export class AiProviderUnavailableError extends Error {
  readonly reason: AiUnavailableReason;

  constructor(
    public readonly provider: AiProviderName,
    reason: AiUnavailableReason,
  ) {
    const label = PROVIDER_LABELS[provider];
    super(
      reason === 'server'
        ? `${label} is having trouble right now. Try again in a few minutes.`
        : reason === 'timeout'
          ? `The request to ${label} timed out. Try again in a few minutes.`
          : `${label} couldn't handle that request. Try again in a few minutes.`,
    );
    this.name = 'AiProviderUnavailableError';
    this.reason = reason;
  }
}

/** `SECRET_ENCRYPTION_KEY` is unset, so the feature cannot run here at all. */
export class AiUnavailableError extends Error {
  constructor() {
    super("AI suggestions aren't available on this deployment.");
    this.name = 'AiUnavailableError';
  }
}

export class AiDisclosureRequiredError extends Error {
  constructor(public readonly provider: AiProviderName) {
    super(`Review what gets sent to ${PROVIDER_LABELS[provider]}, then try again.`);
    this.name = 'AiDisclosureRequiredError';
  }
}

/**
 * The model ignored its structured-output constraint, returned prose, or named
 * a category id outside the user's set. Never reaches a route handler: it is
 * thrown by an adapter, caught inside `suggestCategoryWithAi`, logged as a
 * signal (name only, never the body) and converted to `{ outcome: 'none' }`.
 */
export class AiInvalidResponseError extends Error {
  constructor(public readonly provider: AiProviderName) {
    super(`${PROVIDER_LABELS[provider]} returned a response we could not read.`);
    this.name = 'AiInvalidResponseError';
  }
}

/**
 * The model id stored in the user's Settings was rejected by the completion
 * endpoint. Distinct from `AiProviderUnavailableError` because the user action
 * is different and actionable: pick another model, not "try again in a few
 * minutes".
 *
 * The id is carried on `modelId` and never interpolated into the message. It is
 * the user's own stored setting rather than provider body content, but keeping
 * messages id-free stays consistent with rule 2 above.
 */
export class AiModelRejectedError extends Error {
  constructor(
    public readonly provider: AiProviderName,
    public readonly modelId: string,
  ) {
    super(
      `${PROVIDER_LABELS[provider]} wouldn't accept the AI model saved in your Settings. Pick a different model in Settings.`,
    );
    this.name = 'AiModelRejectedError';
  }
}

/**
 * Status → typed error, shared by both adapters so neither can drift. Exhaustive
 * by construction: `401|403`, `429`, `>=500`, then *everything else* non-2xx
 * falls to `AiProviderUnavailableError`. No status falls through unclassified,
 * and the provider's own response body is never read, let alone forwarded.
 *
 * `context` is passed only by the `suggestCategory` call sites, which know which
 * model id was on the wire. Without it the function behaves exactly as it always
 * has — `listModels` passes nothing, so a 404 from the probe stays an
 * `AiProviderUnavailableError`.
 *
 * - 404 → model rejected. This is the unpermitted/retired-id status.
 * - 400 → also mapped, deliberately. 400 is ambiguous (malformed payload,
 *   oversized enum, bad model id), which is why the message says the provider
 *   "wouldn't accept the model saved in your Settings" rather than "that model
 *   doesn't exist": it is not actively false in the malformed-payload case, and
 *   a payload bug is our bug, surfaced to the user either way.
 */
export const classifyProviderStatus = (
  provider: AiProviderName,
  status: number,
  context?: { modelId: string },
): Error => {
  if (status === 401 || status === 403) {
    return new AiProviderAuthError(provider);
  }
  if (status === 429) {
    return new AiRateLimitedError({ reason: 'provider', provider });
  }
  if (context && (status === 404 || status === 400)) {
    return new AiModelRejectedError(provider, context.modelId);
  }
  if (status >= 500) {
    return new AiProviderUnavailableError(provider, 'server');
  }
  return new AiProviderUnavailableError(provider, 'other');
};

/**
 * Maps one of our errors to an HTTP status and a user-safe message. Returns
 * `null` for anything that isn't ours, so the route rethrows instead of
 * swallowing an unrecognized failure into a fake 400.
 */
export const aiErrorToResponse = (error: unknown): { status: number; message: string } | null => {
  if (error instanceof AiProviderAuthError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof AiRateLimitedError) {
    return { status: 429, message: error.message };
  }
  if (error instanceof AiProviderUnavailableError) {
    return { status: 502, message: error.message };
  }
  if (error instanceof AiUnavailableError) {
    return { status: 503, message: error.message };
  }
  if (error instanceof AiDisclosureRequiredError) {
    return { status: 409, message: error.message };
  }
  // A 400 the user can actually act on: the stored model, not the key, is what
  // the provider refused.
  if (error instanceof AiModelRejectedError) {
    return { status: 400, message: error.message };
  }
  // Checked last: subclasses above are standalone, and a plain
  // ServiceValidationError (no key, ineligible row, rule already matched) is a
  // generic 400 carrying its own message.
  if (error instanceof ServiceValidationError) {
    return { status: 400, message: error.message };
  }
  return null;
};
