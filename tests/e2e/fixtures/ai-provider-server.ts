/**
 * Test-only stand-in for the Anthropic and OpenAI HTTP APIs.
 *
 * Why this exists: the provider calls happen inside the Next.js server process
 * (API route handlers), so Playwright's `page.route()` — which only sees
 * browser-originated requests — can never intercept them. The adapters read
 * their base URL from `AI_ANTHROPIC_BASE_URL` / `AI_OPENAI_BASE_URL`, which the
 * e2e `webServer` config points here. That override is server-side deploy
 * config, never request input, so it is not an SSRF surface (see the
 * architecture doc's §8 carve-out, approved 2026-09-18).
 *
 * Isolation under `fullyParallel: true`: all state is keyed by the API key the
 * caller presents. Each spec saves its own unique key, so two workers
 * programming different responses never collide.
 *
 * Run standalone: `npx tsx tests/e2e/fixtures/ai-provider-server.ts`
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const AI_FIXTURE_PORT = Number(process.env.AI_FIXTURE_PORT ?? 4599);

type Programmed = {
  status: number;
  delayMs: number;
  /** For a 200 suggest: which category id the model "picks" ("none" allowed). */
  categoryId?: string;
  /** For a 200 suggest: a raw body, used to simulate a malformed response. */
  raw?: unknown;
};

type KeyState = {
  probe: Programmed | null;
  suggest: Programmed | null;
  lastRequest: { url: string; method: string; body: unknown } | null;
};

const state = new Map<string, KeyState>();

const stateFor = (key: string): KeyState => {
  let existing = state.get(key);
  if (!existing) {
    existing = { probe: null, suggest: null, lastRequest: null };
    state.set(key, existing);
  }
  return existing;
};

/** The presented key is the isolation token: `x-api-key` (Anthropic) or the
 * bearer token (OpenAI), falling back to an explicit `?key=` on control calls. */
const keyOf = (req: IncomingMessage, url: URL): string => {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.length > 0) return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return url.searchParams.get('key') ?? 'anonymous';
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Shape a 200 the way the provider the caller is talking to would. */
const suggestBody = (pathname: string, categoryId: string): unknown =>
  pathname.includes('/v1/messages')
    ? { content: [{ type: 'tool_use', name: 'pick_category', input: { categoryId } }] }
    : { choices: [{ message: { content: JSON.stringify({ categoryId }) } }] };

const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${AI_FIXTURE_PORT}`);
  const key = keyOf(req, url);

  // ---- control API -------------------------------------------------------
  if (url.pathname === '/__control/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__control/reset') {
    state.delete(key);
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__control/probe' || url.pathname === '/__control/suggest') {
    const body = (await readBody(req)) as Partial<Programmed> | null;
    const programmed: Programmed = {
      status: body?.status ?? 200,
      delayMs: body?.delayMs ?? 0,
      categoryId: body?.categoryId,
      raw: body?.raw,
    };
    const target = stateFor(key);
    if (url.pathname === '/__control/probe') target.probe = programmed;
    else target.suggest = programmed;
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/__control/last-request') {
    send(res, 200, { lastRequest: stateFor(key).lastRequest });
    return;
  }

  // ---- provider API ------------------------------------------------------
  const body = await readBody(req);
  const entry = stateFor(key);
  entry.lastRequest = { url: url.pathname, method: req.method ?? 'GET', body };

  const programmed =
    url.pathname === '/v1/models' && req.method === 'GET' ? entry.probe : entry.suggest;

  if (programmed?.delayMs) {
    await sleep(programmed.delayMs);
  }

  const status = programmed?.status ?? 200;
  if (status !== 200) {
    // Deliberately echoes the key back in the error body: the adapter must
    // classify by status alone, so this is what proves nothing leaks through.
    send(res, status, { error: { type: 'fixture_error', message: `rejected ${key}` } });
    return;
  }

  if (url.pathname === '/v1/models') {
    send(res, 200, { data: [{ id: 'fixture-model' }] });
    return;
  }

  if (programmed?.raw !== undefined) {
    send(res, 200, programmed.raw);
    return;
  }
  send(res, 200, suggestBody(url.pathname, programmed?.categoryId ?? 'none'));
};

const server = createServer((req, res) => {
  void handler(req, res).catch(() => send(res, 500, { error: 'fixture failure' }));
});

server.listen(AI_FIXTURE_PORT, '127.0.0.1', () => {
  console.log(`ai provider fixture listening on http://127.0.0.1:${AI_FIXTURE_PORT}`);
});
