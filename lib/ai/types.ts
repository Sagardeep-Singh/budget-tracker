/**
 * The SDK-free boundary between the provider transport and everything above
 * it. Nothing below this file leaks a provider-specific type to a service or a
 * route handler, which is what makes swapping or adding a provider one new
 * file plus one enum value.
 */

export type AiProviderName = 'ANTHROPIC' | 'OPENAI';

export type AiSuggestionRequest = {
  payee: string;
  type: 'INCOME' | 'EXPENSE';
  categories: Array<{ id: string; name: string }>;
  /** present only when the user opted in via `sendNote` */
  note?: string;
  /** present only when the user opted in via `sendAmount`, e.g. "123.45" */
  amount?: string;
};

export type AiSuggestionResult = { outcome: 'match'; categoryId: string } | { outcome: 'none' };

/** One selectable model. `label` is display-only; `id` is what goes on the wire. */
export type AiModelSummary = { id: string; label: string };

export type AiProviderClient = {
  readonly provider: AiProviderName;
  /**
   * Cheap GET, used both as the save-time verification probe and as the
   * Settings-page picker source. Sends no user data: no body, and no header or
   * query parameter derived from user data (Anthropic sends a constant
   * `limit`). Returns provider-filtered, chat-capable models in a deterministic
   * order — `[0]` is the auto-pick default. The return value is a list of model
   * ids only; nothing about the user is sent to obtain it.
   */
  listModels: (apiKey: string, signal: AbortSignal) => Promise<AiModelSummary[]>;
  suggestCategory: (
    apiKey: string,
    /** resolved by the service; deliberately NOT part of AiSuggestionRequest */
    model: string,
    request: AiSuggestionRequest,
    signal: AbortSignal,
  ) => Promise<AiSuggestionResult>;
};

/** Display label for a provider, used in every user-facing error message. */
export const PROVIDER_LABELS: Record<AiProviderName, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
};
