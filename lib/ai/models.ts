import { AiInvalidResponseError } from '@/lib/ai/errors';
import type { AiModelSummary, AiProviderName } from '@/lib/ai/types';

/**
 * Shared parsing and filtering for the two adapters' `/v1/models` responses,
 * kept out of the adapters themselves so both are unit-testable without a
 * `fetch` mock.
 *
 * Both providers answer with `{ data: [...] }` and differ only in what a list
 * entry carries: Anthropic supplies a `display_name`, OpenAI supplies a
 * `created` timestamp and no display name at all. Only the fields we need are
 * read; everything else in the body is ignored, and an unparseable body throws
 * `AiInvalidResponseError` with no detail so the provider's own body is never
 * echoed (`lib/ai/errors.ts` rule 2).
 */

type RawEntry = { id: string; display_name?: string; created?: number };

/** `{ data: [...] }` or nothing we are willing to guess at. */
const readEntries = (provider: AiProviderName, body: unknown): RawEntry[] => {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new AiInvalidResponseError(provider);
  }
  return data.map((entry: unknown) => {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id !== 'string' || id.length === 0) {
      // A malformed *entry* is a malformed body: we cannot put a nameless
      // option in the picker, and silently dropping it would hide a real
      // contract break behind a shorter list.
      throw new AiInvalidResponseError(provider);
    }
    const displayName = (entry as { display_name?: unknown }).display_name;
    const created = (entry as { created?: unknown }).created;
    return {
      id,
      display_name: typeof displayName === 'string' ? displayName : undefined,
      created: typeof created === 'number' ? created : undefined,
    };
  });
};

/**
 * Newest first, tie-broken by id ascending. `/v1/models` ordering is neither
 * stable nor documented for OpenAI, so "the first entry" — which is what the
 * auto-pick default means — would otherwise have no deterministic meaning.
 * Entries with no `created` sort last rather than being dropped.
 */
const sortNewestFirst = (entries: RawEntry[]): RawEntry[] =>
  [...entries].sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));

/**
 * Provider body → the picker's model list.
 *
 * - Anthropic: `label = display_name ?? id`, order left exactly as returned
 *   (Anthropic's list is already newest-first, and re-sorting it on a field it
 *   does not supply would only scramble it).
 * - OpenAI: `label = id` (the API supplies no display name), re-sorted
 *   newest-first because its ordering is undocumented.
 *
 * An empty `data: []` parses to `[]` without throwing: "the provider listed
 * nothing for this key" is a real answer, distinct from a malformed body.
 */
export const parseModelsResponse = (provider: AiProviderName, body: unknown): AiModelSummary[] => {
  const entries = readEntries(provider, body);
  if (provider === 'OPENAI') {
    return sortNewestFirst(entries).map((entry) => ({ id: entry.id, label: entry.id }));
  }
  return entries.map((entry) => ({ id: entry.id, label: entry.display_name ?? entry.id }));
};

/**
 * OpenAI's `/v1/models` mixes in embeddings, whisper, tts, dall-e, moderation
 * and friends, none of which can satisfy the `strict: true` structured-output
 * contract `suggestCategory` relies on.
 *
 * Coarse deny-substring heuristic on the whole id, NOT a capability matrix. The
 * list is not ground truth for what `/v1/chat/completions` accepts (which is
 * exactly why the `AiModelRejectedError` path exists regardless) — this only
 * keeps obviously-wrong entries out of the picker.
 */
const DENY_SUBSTRINGS = [
  'embedding',
  'whisper',
  'tts',
  'dall-e',
  'moderation',
  'audio',
  'realtime',
  'image',
  'transcribe',
  'search',
  'babbage',
  'davinci',
  'codex',
];

export const filterChatModels = (models: AiModelSummary[]): AiModelSummary[] => {
  const kept = models.filter((model) => !DENY_SUBSTRINGS.some((term) => model.id.includes(term)));
  // If the heuristic ate everything, hand back the unfiltered list rather than
  // an empty picker: a wrong-looking picker is recoverable, an empty one is a
  // dead end, and a model that turns out to be unusable surfaces as
  // `AiModelRejectedError`, which points the user back at the picker.
  return kept.length === 0 ? models : kept;
};
