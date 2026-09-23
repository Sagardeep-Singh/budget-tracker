import { describe, expect, it } from 'vitest';

import { AiInvalidResponseError } from '@/lib/ai/errors';
import { filterChatModels, parseModelsResponse } from '@/lib/ai/models';
import type { AiModelSummary } from '@/lib/ai/types';

const summary = (id: string): AiModelSummary => ({ id, label: id });

describe('filterChatModels', () => {
  it('drops every deny-substring id and keeps the clean ones in order', () => {
    const models = [
      summary('text-embedding-3-small'),
      summary('gpt-4o'),
      summary('whisper-1'),
      summary('tts-1'),
      summary('dall-e-3'),
      summary('omni-moderation-latest'),
      summary('gpt-4o-audio-preview'),
      summary('gpt-4o-realtime-preview'),
      summary('gpt-image-1'),
      summary('gpt-4o-mini-transcribe'),
      summary('gpt-4o-search-preview'),
      summary('babbage-002'),
      summary('davinci-002'),
      summary('codex-mini-latest'),
      summary('gpt-4o-mini'),
    ];
    expect(filterChatModels(models)).toEqual([summary('gpt-4o'), summary('gpt-4o-mini')]);
  });

  it('matches the deny terms as substrings of the whole id, not whole segments', () => {
    // `gpt-4o-mini-transcribe` is chat-shaped but is a transcription model.
    expect(filterChatModels([summary('gpt-4o-mini-transcribe'), summary('gpt-4o')])).toEqual([
      summary('gpt-4o'),
    ]);
  });

  it('falls back to the unfiltered list rather than emptying the picker', () => {
    const allDenied = [summary('whisper-1'), summary('text-embedding-3-small')];
    expect(filterChatModels(allDenied)).toEqual(allDenied);
  });

  it('leaves a list with nothing to filter exactly as it was', () => {
    const clean = [summary('gpt-4o'), summary('gpt-4.1'), summary('o3')];
    expect(filterChatModels(clean)).toEqual(clean);
  });

  it('returns [] unchanged for an empty list', () => {
    expect(filterChatModels([])).toEqual([]);
  });
});

describe('parseModelsResponse — Anthropic', () => {
  it('labels from display_name, falling back to the id', () => {
    expect(
      parseModelsResponse('ANTHROPIC', {
        data: [{ id: 'claude-a', display_name: 'Claude A' }, { id: 'claude-b' }],
      }),
    ).toEqual([
      { id: 'claude-a', label: 'Claude A' },
      { id: 'claude-b', label: 'claude-b' },
    ]);
  });

  it('leaves the order exactly as returned — no re-sort', () => {
    // Deliberately neither alphabetical nor `created`-ordered: Anthropic's list
    // is already newest-first and re-sorting it would scramble it.
    const body = {
      data: [
        { id: 'm-zulu', display_name: 'Zulu', created: 1 },
        { id: 'm-alpha', display_name: 'Alpha', created: 900 },
        { id: 'm-mike', display_name: 'Mike', created: 50 },
      ],
    };
    expect(parseModelsResponse('ANTHROPIC', body).map((m) => m.id)).toEqual([
      'm-zulu',
      'm-alpha',
      'm-mike',
    ]);
  });
});

describe('parseModelsResponse — OpenAI', () => {
  it('labels by id and sorts newest first', () => {
    expect(
      parseModelsResponse('OPENAI', {
        data: [
          { id: 'gpt-middle', created: 200 },
          { id: 'gpt-oldest', created: 100 },
          { id: 'gpt-newest', created: 300 },
        ],
      }),
    ).toEqual([
      { id: 'gpt-newest', label: 'gpt-newest' },
      { id: 'gpt-middle', label: 'gpt-middle' },
      { id: 'gpt-oldest', label: 'gpt-oldest' },
    ]);
  });

  it('tie-breaks an identical created timestamp by id ascending', () => {
    expect(
      parseModelsResponse('OPENAI', {
        data: [
          { id: 'gpt-b', created: 500 },
          { id: 'gpt-a', created: 500 },
        ],
      }).map((m) => m.id),
    ).toEqual(['gpt-a', 'gpt-b']);
  });
});

describe('parseModelsResponse — malformed bodies', () => {
  it.each([
    ['a body with no data key', { models: [] }],
    ['a body whose data is not an array', { data: 'nope' }],
    ['a null body', null],
    ['an entry with no id', { data: [{ display_name: 'Nameless' }] }],
    ['an entry whose id is not a string', { data: [{ id: 7 }] }],
  ])('throws AiInvalidResponseError for %s, echoing nothing', (_label, body) => {
    const error = (() => {
      try {
        parseModelsResponse('ANTHROPIC', body);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(AiInvalidResponseError);
    expect(error!.message).toBe('Anthropic returned a response we could not read.');
  });

  it('parses an empty data array to [] without throwing', () => {
    expect(parseModelsResponse('ANTHROPIC', { data: [] })).toEqual([]);
    expect(parseModelsResponse('OPENAI', { data: [] })).toEqual([]);
  });
});
