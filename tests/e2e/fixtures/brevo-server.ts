/**
 * Test-only stand-in for Brevo's transactional email API. Same reasoning as
 * ai-provider-server.ts: the send happens inside the Next.js server process
 * (a server action / route handler), so `page.route()` can never see it. The
 * client reads its base URL from `BREVO_BASE_URL`, which the e2e `webServer`
 * config points here.
 *
 * Isolation under `fullyParallel: true`: state is keyed by recipient email,
 * and each spec signs up with its own unique address.
 *
 * Run standalone: `npx tsx tests/e2e/fixtures/brevo-server.ts`
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const BREVO_FIXTURE_PORT = Number(process.env.BREVO_FIXTURE_PORT ?? 4598);

type SentEmail = { subject: string; html: string };

const sentByRecipient = new Map<string, SentEmail[]>();

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${BREVO_FIXTURE_PORT}`);

  if (url.pathname === '/__control/health') {
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/__control/reset' && req.method === 'POST') {
    sentByRecipient.clear();
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/__control/last' && req.method === 'GET') {
    const to = url.searchParams.get('to') ?? '';
    const emails = sentByRecipient.get(to) ?? [];
    const last = emails.at(-1);
    if (!last) return send(res, 404, { error: 'no email sent to this address' });
    return send(res, 200, last);
  }

  if (url.pathname === '/v3/smtp/email' && req.method === 'POST') {
    const raw = await readBody(req);
    let parsed: { to?: Array<{ email?: string }>; subject?: string; htmlContent?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid json' });
    }
    const to = parsed.to?.[0]?.email;
    if (!to) return send(res, 400, { error: 'missing recipient' });
    const existing = sentByRecipient.get(to) ?? [];
    existing.push({ subject: parsed.subject ?? '', html: parsed.htmlContent ?? '' });
    sentByRecipient.set(to, existing);
    return send(res, 201, { messageId: `fixture-${Date.now()}` });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(BREVO_FIXTURE_PORT, '127.0.0.1', () => {
  console.log(`brevo fixture listening on http://127.0.0.1:${BREVO_FIXTURE_PORT}`);
});
