import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { exportYucAssets } from './yuc-exporter.mjs';
import { handlePosterRequest } from './poster-api.mjs';
import { getTmdbArtwork, searchTmdbTv } from './tmdb-client.mjs';

const { createServer } = http;

const PUBLIC_FILES = new Set([
  'index.html',
  'images.html',
  'poster.html',
  'bangumi-components.css',
  'styles.css',
  'poster.css',
  'form-import-findings.md',
  'tools/ranking-poster/sample.json',
  'tools/ranking-poster/sample-black.json',
  'tools/ranking-poster/sample-controversy.json',
  'tools/ranking-poster/sample-favorite.json',
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
const TMDB_IMAGE_SIZES = new Set(['w185', 'w300', 'w500', 'w780', 'w1280', 'original']);
const TMDB_IMAGE_PATH = /^\/[a-z0-9._/-]+\.(?:jpe?g|png|webp)$/i;

function proxyValue(env, name) {
  return String(env?.[name] ?? env?.[name.toLowerCase()] ?? '').trim();
}

function mergedNoProxy(env) {
  const existing = proxyValue(env, 'NO_PROXY')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const local of ['localhost', '127.0.0.1', '::1']) {
    if (!existing.includes(local)) existing.push(local);
  }
  return existing.join(',');
}

export function configureEnvironmentProxy({ env = process.env, httpModule = http } = {}) {
  const hasProxy = Boolean(
    proxyValue(env, 'HTTP_PROXY') || proxyValue(env, 'HTTPS_PROXY') || proxyValue(env, 'ALL_PROXY'),
  );
  if (!hasProxy) return { enabled: false, unsupported: false, message: '' };

  if (typeof httpModule.setGlobalProxyFromEnv !== 'function') {
    return {
      enabled: false,
      unsupported: true,
      message: '检测到 HTTP(S)_PROXY，但当前 Node 不支持运行时环境代理；请使用 Node 24.14+，或用 NODE_USE_ENV_PROXY=1 启动。',
    };
  }

  const proxyEnv = {
    ...env,
    NO_PROXY: mergedNoProxy(env),
  };
  httpModule.setGlobalProxyFromEnv(proxyEnv);
  return {
    enabled: true,
    unsupported: false,
    message: `已启用环境代理；NO_PROXY=${proxyEnv.NO_PROXY}`,
  };
}

export function describeFetchError(error) {
  const message = String(error?.message ?? error ?? '未知错误');
  const cause = error?.cause;
  if (!cause) return message;
  const code = String(cause.code ?? '').trim();
  const causeMessage = String(cause.message ?? cause).trim();
  const detail = [code, causeMessage].filter(Boolean).join(': ');
  return detail ? `${message}；原因：${detail}` : message;
}

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
  const isPublicFile = PUBLIC_FILES.has(relativePath);
  const isSourceModule = /^src\/[a-z0-9-]+\.js$/i.test(relativePath);

  if (!isPublicFile && !isSourceModule) {
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

function normalizeImportEntries(body) {
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
  return entries;
}

function writeNdjson(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

function tmdbCredential(body) {
  return String(body?.credential ?? '').trim() || undefined;
}

function parseTmdbImageRequest(requestUrl) {
  let url;
  try {
    url = new URL(String(requestUrl ?? ''), 'http://127.0.0.1');
  } catch {
    return null;
  }
  const filePath = url.searchParams.get('path') ?? '';
  const size = url.searchParams.get('size') ?? 'w780';
  if (!TMDB_IMAGE_PATH.test(filePath) || !TMDB_IMAGE_SIZES.has(size)) return null;
  return { filePath, size };
}

export function startServer({
  rootDirectory = process.cwd(),
  host = '127.0.0.1',
  port = 4173,
  yucExporter = exportYucAssets,
  tmdbSearch = searchTmdbTv,
  tmdbArtwork = getTmdbArtwork,
  fetchImpl = globalThis.fetch,
} = {}) {
  const server = createServer(async (request, response) => {
    const requestPath = String(request.url ?? '').split(/[?#]/, 1)[0];

    if (await handlePosterRequest({ request, response, rootDirectory })) {
      return;
    }

    if (request.method === 'POST' && requestPath === '/api/yuc/import-stream') {
      try {
        const body = await readJsonBody(request);
        const entries = normalizeImportEntries(body);
        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        const result = await yucExporter({
          rootDirectory,
          sourceUrl: body.sourceUrl,
          entries,
          onProgress: async (event) => writeNdjson(response, event),
        });
        writeNdjson(response, { type: 'complete', result });
        response.end();
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, 500, { error: error.message });
        } else {
          writeNdjson(response, { type: 'error', message: error.message });
          response.end();
        }
      }
      return;
    }

    if (request.method === 'POST' && requestPath === '/api/yuc/import') {
      try {
        const body = await readJsonBody(request);
        const entries = normalizeImportEntries(body);

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

    if (request.method === 'POST' && requestPath === '/api/tmdb/search') {
      try {
        const body = await readJsonBody(request);
        const results = await tmdbSearch(body.query, { credential: tmdbCredential(body), fetchImpl });
        sendJson(response, 200, { results });
      } catch (error) {
        sendJson(response, 500, { error: describeFetchError(error) });
      }
      return;
    }

    if (request.method === 'POST' && requestPath === '/api/tmdb/assets') {
      try {
        const body = await readJsonBody(request);
        const result = await tmdbArtwork(body.seriesId, { credential: tmdbCredential(body), fetchImpl });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, { error: describeFetchError(error) });
      }
      return;
    }

    if (request.method === 'GET' && requestPath === '/api/tmdb/image') {
      const imageRequest = parseTmdbImageRequest(request.url);
      if (!imageRequest) {
        sendJson(response, 400, { error: 'TMDB 图片路径或尺寸无效。' });
        return;
      }
      try {
        const upstream = await fetchImpl(`https://image.tmdb.org/t/p/${imageRequest.size}${imageRequest.filePath}`);
        if (!upstream.ok) {
          sendJson(response, upstream.status, { error: `TMDB 图片请求失败（HTTP ${upstream.status}）。` });
          return;
        }
        const contentTypeHeader = upstream.headers.get('content-type') || 'application/octet-stream';
        const body = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(200, {
          'content-type': contentTypeHeader,
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
        });
        response.end(body);
      } catch (error) {
        sendJson(response, 502, { error: `TMDB 图片代理失败：${describeFetchError(error)}` });
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
  const proxy = configureEnvironmentProxy();
  if (proxy.message) {
    process.stdout.write(`网络代理：${proxy.message}\n`);
  }
  const requestedPort = Number.parseInt(process.env.BANGUMI_VOTE_PORT ?? '4173', 10);
  startServer({ port: Number.isFinite(requestedPort) ? requestedPort : 4173 });
}
