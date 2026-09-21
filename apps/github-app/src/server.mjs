import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { GitHubAppClient } from './github-client.mjs';
import { acceptReviewResult } from './results.mjs';
import { JsonFileStateStore } from './state.mjs';
import { handleWebhook, verifyWebhookSignature } from './webhooks.mjs';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function bearerMatches(header, expected) {
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice('Bearer '.length));
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function createGitHubAppServer({
  store,
  github,
  webhookSecret,
  resultToken,
  appBaseUrl = null,
}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');

      if (request.method === 'GET' && url.pathname === '/healthz') {
        return json(response, 200, { ok: true });
      }

      if (request.method === 'POST' && url.pathname === '/github/webhooks') {
        const rawBody = await readBody(request);
        const signature = request.headers['x-hub-signature-256'];
        if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
          return json(response, 401, { ok: false, error: 'invalid_signature' });
        }

        const event = request.headers['x-github-event'];
        const deliveryId = request.headers['x-github-delivery'];
        if (!event || !deliveryId) {
          return json(response, 400, { ok: false, error: 'missing_github_headers' });
        }

        const payload = JSON.parse(rawBody.toString('utf8'));
        const result = await handleWebhook({
          event,
          deliveryId,
          payload,
          store,
          github,
          appBaseUrl,
        });
        return json(response, 202, result);
      }

      const resultMatch = url.pathname.match(/^\/api\/reviews\/(.+)\/result$/);
      if (request.method === 'POST' && resultMatch) {
        if (!bearerMatches(request.headers.authorization, resultToken)) {
          return json(response, 401, { ok: false, error: 'invalid_result_token' });
        }

        const rawBody = await readBody(request);
        const payload = JSON.parse(rawBody.toString('utf8'));
        const reviewId = decodeURIComponent(resultMatch[1]);
        const result = await acceptReviewResult({
          reviewId,
          exitCode: payload.exitCode,
          report: payload.report,
          detailsUrl: payload.detailsUrl ?? null,
          store,
          github,
        });
        return json(response, 200, { ok: true, ...result });
      }

      return json(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      process.stderr.write(`${error.stack ?? error}\n`);
      return json(response, 500, { ok: false, error: 'internal_error' });
    }
  });
}

async function main() {
  const appId = required('VIEWPORTABLE_GITHUB_APP_ID');
  const privateKey = required('VIEWPORTABLE_GITHUB_PRIVATE_KEY').replaceAll('\\n', '\n');
  const webhookSecret = required('VIEWPORTABLE_GITHUB_WEBHOOK_SECRET');
  const resultToken = required('VIEWPORTABLE_RESULT_TOKEN');
  const statePath =
    process.env.VIEWPORTABLE_GITHUB_STATE_PATH ?? '.viewportable/github-app-state.json';
  const port = Number(process.env.PORT ?? 8787);

  const store = await JsonFileStateStore.open(statePath);
  const github = new GitHubAppClient({
    appId,
    privateKey,
    apiUrl: process.env.GITHUB_API_URL,
    apiVersion: process.env.VIEWPORTABLE_GITHUB_API_VERSION,
  });
  const server = await createGitHubAppServer({
    store,
    github,
    webhookSecret,
    resultToken,
    appBaseUrl: process.env.VIEWPORTABLE_APP_BASE_URL ?? null,
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Viewportable GitHub App listening on :${port}\n`);
  });
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
