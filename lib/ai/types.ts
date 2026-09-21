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

export type AiProviderClient = {
  readonly provider: AiProviderName;
  /** cheap GET used by save-time validation; sends no user data */
  listModels: (apiKey: string, signal: AbortSignal) => Promise<void>;
  suggestCategory: (
    apiKey: string,
    request: AiSuggestionRequest,
    signal: AbortSignal,
  ) => Promise<AiSuggestionResult>;
};

/** Display label for a provider, used in every user-facing error message. */
export const PROVIDER_LABELS: Record<AiProviderName, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
};
