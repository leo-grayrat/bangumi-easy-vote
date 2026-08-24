import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PUBLIC_ROOT_FILES = new Set([
  'index.html',
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

export function startServer({ rootDirectory = process.cwd(), host = '127.0.0.1', port = 4173 } = {}) {
  const server = createServer(async (request, response) => {
    const filename = resolveRequestPath(request.url, rootDirectory);
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
