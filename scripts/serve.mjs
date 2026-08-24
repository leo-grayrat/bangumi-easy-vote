import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { exportYucAssets } from './yuc-exporter.mjs';

const PUBLIC_ROOT_FILES = new Set([
  'index.html',
  'images.html',
  'bangumi-components.css',
  'styles.css',
  'form-import-findings.md',
]);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

export function contentType(filename) {
  return MIME_TYPES.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
}

export function resolveRequestPath(requestUrl, rootDirectory) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(requestUrl ?? '/').split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }

  const segments = pathname.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) {
    return null;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const isRootFile = PUBLIC_ROOT_FILES.has(relativePath);
  const isSourceModule = /^src\/[a-z0-9-]+\.js$/i.test(relativePath);

  if (!isRootFile && !isSourceModule) {
    return null;
  }

  const root = path.resolve(rootDirectory);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

export function resolveExportPath(requestUrl, rootDirectory) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(requestUrl ?? '').split(/[?#]/, 1)[0]).replaceAll('\\', '/');
  } catch {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 3 || segments[0] !== 'exports' || segments.includes('..')) {
    return null;
  }

  const exportsRoot = path.resolve(rootDirectory, 'exports');
  const resolved = path.resolve(rootDirectory, ...segments);
  return resolved.startsWith(`${exportsRoot}${path.sep}`) ? resolved : null;
}

function readJsonBody(request, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容过大。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求不是有效的 JSON。'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export function startServer({
  rootDirectory = process.cwd(),
  host = '127.0.0.1',
  port = 4173,
  yucExporter = exportYucAssets,
} = {}) {
  const server = createServer(async (request, response) => {
    const requestPath = String(request.url ?? '').split(/[?#]/, 1)[0];

    if (request.method === 'POST' && requestPath === '/api/yuc/import') {
      try {
        const body = await readJsonBody(request);
        if (!Array.isArray(body.entries) || body.entries.length === 0) {
          throw new Error('当前项目没有可匹配的动画。');
        }
        const entries = body.entries.map((entry) => ({
          entryId: String(entry?.entryId ?? '').trim(),
          title: String(entry?.title ?? '').trim(),
        }));
        if (entries.some((entry) => !entry.entryId || !entry.title)) {
          throw new Error('动画条目缺少标题或标识。');
        }

        const result = await yucExporter({
          rootDirectory,
          sourceUrl: body.sourceUrl,
          entries,
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, { error: error.message });
      }
      return;
    }

    const filename =
      resolveExportPath(request.url, rootDirectory) ?? resolveRequestPath(request.url, rootDirectory);
    if (!filename) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    try {
      const fileStat = await stat(filename);
      if (!fileStat.isFile()) {
        throw new Error('Not a file');
      }

      response.writeHead(200, {
        'content-type': contentType(filename),
        'cache-control': 'no-store',
      });
      createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    process.stdout.write(`番组投票台：http://${host}:${actualPort}/\n`);
  });

  return server;
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  const requestedPort = Number.parseInt(process.env.BANGUMI_VOTE_PORT ?? '4173', 10);
  startServer({ port: Number.isFinite(requestedPort) ? requestedPort : 4173 });
}
