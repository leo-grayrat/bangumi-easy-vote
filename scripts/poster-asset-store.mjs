import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_SCOPE = /^[a-z0-9._-]{1,120}$/i;
const SAFE_ASSET_ID = /^[a-f0-9-]+\.(?:png|jpe?g|webp|gif|avif)$/i;
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

export function normalizePosterScope(value) {
  const scope = String(value ?? '').trim();
  return SAFE_SCOPE.test(scope) ? scope : null;
}

function extensionFor(filename, contentType) {
  const candidate = path.extname(String(filename ?? '')).toLowerCase();
  if (EXTENSIONS.has(candidate)) return candidate === '.jpeg' ? '.jpg' : candidate;
  return MIME_EXTENSIONS.get(String(contentType ?? '').toLowerCase()) ?? null;
}

function posterAssetsRoot(rootDirectory) {
  return path.resolve(rootDirectory, '.local', 'poster-assets');
}

function posterProjectsRoot(rootDirectory) {
  return path.resolve(rootDirectory, '.local', 'poster-projects');
}

export function resolvePosterAssetPath(rootDirectory, scope, assetId) {
  const safeScope = normalizePosterScope(scope);
  const safeAssetId = String(assetId ?? '').trim();
  if (!safeScope || !SAFE_ASSET_ID.test(safeAssetId)) return null;
  const root = posterAssetsRoot(rootDirectory);
  const resolved = path.resolve(root, safeScope, safeAssetId);
  const expectedRoot = path.resolve(root, safeScope);
  return resolved.startsWith(`${expectedRoot}${path.sep}`) ? resolved : null;
}

export function resolvePosterStatePath(rootDirectory, scope) {
  const safeScope = normalizePosterScope(scope);
  if (!safeScope) return null;
  const root = posterProjectsRoot(rootDirectory);
  const resolved = path.resolve(root, `${safeScope}.json`);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

export async function savePosterAsset({
  rootDirectory,
  scope,
  filename,
  contentType,
  source = 'local',
  data,
}) {
  const safeScope = normalizePosterScope(scope);
  if (!safeScope) throw new Error('海报素材作用域无效。');
  const mime = String(contentType ?? '').toLowerCase().split(';', 1)[0].trim();
  const extension = extensionFor(filename, mime);
  if (!mime.startsWith('image/') || !extension) throw new Error('只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片。');
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data ?? []);
  if (!buffer.length) throw new Error('图片文件为空。');
  const assetId = `${randomUUID()}${extension}`;
  const directory = path.resolve(posterAssetsRoot(rootDirectory), safeScope);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, assetId), buffer);
  const fileName = String(filename ?? '').trim() || assetId;
  return {
    assetId,
    scope: safeScope,
    fileName,
    source: source === 'tmdb' ? 'tmdb' : 'local',
    contentType: mime,
    relativePath: `.local/poster-assets/${safeScope}/${assetId}`,
  };
}

export async function deletePosterAsset(rootDirectory, scope, assetId) {
  const filename = resolvePosterAssetPath(rootDirectory, scope, assetId);
  if (!filename) return false;
  try {
    await unlink(filename);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function savePosterState(rootDirectory, scope, project) {
  const filename = resolvePosterStatePath(rootDirectory, scope);
  if (!filename) throw new Error('海报项目作用域无效。');
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true });
  const json = JSON.stringify(project, null, 2);
  await writeFile(filename, `${json}\n`, 'utf8');
  return {
    scope: normalizePosterScope(scope),
    relativePath: `.local/poster-projects/${normalizePosterScope(scope)}.json`,
  };
}

export async function loadPosterState(rootDirectory, scope) {
  const filename = resolvePosterStatePath(rootDirectory, scope);
  if (!filename) throw new Error('海报项目作用域无效。');
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
