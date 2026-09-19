import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const pageRoot = path.resolve('.cache/redecheck/pages/AirBnb');

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.gif': 'image/gif',
      '.htm': 'text/html; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }[extension] ?? 'application/octet-stream'
  );
}

const server = http.createServer(async (request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  let filePath = path.resolve(pageRoot, `.${requestPath}`);

  if (filePath !== pageRoot && !filePath.startsWith(`${pageRoot}${path.sep}`)) {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html');
    response.writeHead(200, { 'content-type': mimeType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('No diagnostic server port');

const url = `http://127.0.0.1:${address.port}/index.html`;
const widths = [320, 321, 328, 335, 341, 356, 375, 390, 395, 398, 399, 400, 405, 410, 430];
function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 900 } });

try {
  await page.goto(url);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    const state = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('ul.list-layout.list-inline')];
      const target = candidates.find(
        (list) =>
          list.closest('.show-sm') &&
          [...list.querySelectorAll(':scope > li')].some((item) =>
            item.textContent?.includes('Terms & Privacy'),
          ),
      );

      if (!(target instanceof HTMLElement)) return null;

      return {
        list: target.getBoundingClientRect().toJSON(),
        items: [...target.querySelectorAll(':scope > li')].map((item) => ({
          text: item.textContent?.trim() ?? '',
          rect: item.getBoundingClientRect().toJSON(),
          display: getComputedStyle(item).display,
        })),
      };
    });

    process.stdout.write(`${width}: ${JSON.stringify(state)}\n`);
  }
  const cli = await runProcess(process.execPath, [
    'dist/cli.mjs',
    url,
    '--widths',
    '390,430',
    '--wait',
    '0',
    '--no-boundary',
    '--json',
    '--out',
    '.slice/airbnb-wrap-diagnostic',
  ]);

  process.stdout.write(`CLI_EXIT: ${cli.status}\n`);
  process.stdout.write(`CLI_STDOUT:\n${cli.stdout}\n`);
  if (cli.stderr) process.stdout.write(`CLI_STDERR:\n${cli.stderr}\n`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
