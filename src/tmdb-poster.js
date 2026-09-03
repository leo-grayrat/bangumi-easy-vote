const TMDB_CREDENTIAL_KEY = 'bangumi-easy-vote:tmdb-credential';
const IMAGE_SIZES = new Set(['w185', 'w300', 'w500', 'w780', 'w1280', 'original']);
const IMAGE_PATH = /^\/[a-z0-9._/-]+\.(?:jpe?g|png|webp)$/i;

function storageOrNull(storage) {
  return storage ?? globalThis.localStorage ?? null;
}

export function readTmdbCredential(storage) {
  try {
    return storageOrNull(storage)?.getItem(TMDB_CREDENTIAL_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

export function saveTmdbCredential(value, storage) {
  const target = storageOrNull(storage);
  if (!target) return;
  const normalized = String(value ?? '').trim();
  try {
    if (normalized) target.setItem(TMDB_CREDENTIAL_KEY, normalized);
    else target.removeItem(TMDB_CREDENTIAL_KEY);
  } catch {
    // Credential remains usable for the current dialog even when localStorage is blocked.
  }
}

export function tmdbImageUrl(filePath, size = 'w300') {
  const path = String(filePath ?? '');
  if (!IMAGE_PATH.test(path)) throw new Error('TMDB 图片路径无效。');
  if (!IMAGE_SIZES.has(size)) throw new Error('TMDB 图片尺寸无效。');
  return `/api/tmdb/image?path=${encodeURIComponent(path)}&size=${encodeURIComponent(size)}`;
}

async function postJson(url, body, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function searchTmdb(query, credential, fetchImpl) {
  const data = await postJson('/api/tmdb/search', {query: String(query ?? '').trim(), credential: String(credential ?? '').trim()}, fetchImpl);
  return Array.isArray(data.results) ? data.results : [];
}

export async function loadTmdbAssets(seriesId, credential, fetchImpl) {
  return postJson('/api/tmdb/assets', {seriesId: Number(seriesId), credential: String(credential ?? '').trim()}, fetchImpl);
}

export async function fetchTmdbImageFile(filePath, filename, {size = 'original', fetchImpl = globalThis.fetch} = {}) {
  const response = await fetchImpl(tmdbImageUrl(filePath, size));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `图片下载失败（HTTP ${response.status}）。`);
  }
  const blob = await response.blob();
  const type = blob.type || 'image/jpeg';
  const safeName = String(filename || filePath.split('/').pop() || 'tmdb-image.jpg');
  if (typeof File === 'function') return new File([blob], safeName, {type});
  blob.name = safeName;
  return blob;
}
