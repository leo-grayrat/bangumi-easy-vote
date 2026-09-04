import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import {
  deletePosterAsset,
  loadPosterState,
  resolvePosterAssetPath,
  savePosterAsset,
  savePosterState,
} from './poster-asset-store.mjs';

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]);

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function requestUrl(request) {
  try {
    return new URL(String(request.url ?? '/'), 'http://127.0.0.1');
  } catch {
    return null;
  }
}

function readBody(request, limit) {
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
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJson(request) {
  const buffer = await readBody(request, MAX_STATE_BYTES);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('请求不是有效的 JSON。');
  }
}

function assetRoute(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 5 || parts[0] !== 'api' || parts[1] !== 'poster' || parts[2] !== 'assets') {
    return null;
  }
  try {
    return {
      scope: decodeURIComponent(parts[3]),
      assetId: decodeURIComponent(parts[4]),
    };
  } catch {
    return null;
  }
}

function imageType(filename) {
  const extension = String(filename).match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
  return IMAGE_TYPES.get(extension) ?? 'application/octet-stream';
}

export async function handlePosterRequest({ request, response, rootDirectory }) {
  const url = requestUrl(request);
  if (!url || !url.pathname.startsWith('/api/poster/')) return false;

  if (request.method === 'POST' && url.pathname === '/api/poster/assets') {
    try {
      const scope = url.searchParams.get('scope') ?? '';
      const filename = url.searchParams.get('filename') ?? '';
      const source = url.searchParams.get('source') ?? 'local';
      const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim();
      const data = await readBody(request, MAX_ASSET_BYTES);
      const asset = await savePosterAsset({
        rootDirectory,
        scope,
        filename,
        source,
        contentType,
        data,
      });
      sendJson(response, 201, { asset });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  const asset = assetRoute(url);
  if (asset && request.method === 'GET') {
    const filename = resolvePosterAssetPath(rootDirectory, asset.scope, asset.assetId);
    if (!filename) {
      sendJson(response, 400, { error: '海报素材路径无效。' });
      return true;
    }
    try {
      const fileStat = await stat(filename);
      if (!fileStat.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'content-type': imageType(filename),
        'content-length': fileStat.size,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      createReadStream(filename).pipe(response);
    } catch {
      sendJson(response, 404, { error: '本地海报素材不存在。' });
    }
    return true;
  }

  if (asset && request.method === 'DELETE') {
    try {
      const deleted = await deletePosterAsset(rootDirectory, asset.scope, asset.assetId);
      sendJson(response, 200, { deleted });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/poster/state' && request.method === 'GET') {
    try {
      const scope = url.searchParams.get('scope') ?? '';
      const project = await loadPosterState(rootDirectory, scope);
      sendJson(response, 200, { project });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/poster/state' && request.method === 'PUT') {
    try {
      const scope = url.searchParams.get('scope') ?? '';
      const body = await readJson(request);
      if (!body?.project || typeof body.project !== 'object') throw new Error('缺少海报项目数据。');
      const stored = await savePosterState(rootDirectory, scope, body.project);
      sendJson(response, 200, { stored });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  sendJson(response, 404, { error: 'Poster API route not found.' });
  return true;
}
