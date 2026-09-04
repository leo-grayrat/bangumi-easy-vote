function normalizeScopePart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-z0-9._-]/gi, '_')
    .slice(0, 100);
}

async function responseJson(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Keep a status-only message for malformed responses.
  }
  if (!response.ok) {
    throw new Error(body?.error || `本地海报服务请求失败（HTTP ${response.status}）。`);
  }
  return body ?? {};
}

export function posterScopeForProjectId(projectId) {
  const part = normalizeScopePart(projectId);
  return part ? `project-${part}` : 'standalone';
}

export function posterAssetUrl(asset) {
  const scope = String(asset?.scope ?? '').trim();
  const assetId = String(asset?.assetId ?? '').trim();
  if (!scope || !assetId) return '';
  return `/api/poster/assets/${encodeURIComponent(scope)}/${encodeURIComponent(assetId)}`;
}

export async function cachePosterImage(file, scope, source = 'local', fetchImpl = globalThis.fetch) {
  if (!(file instanceof Blob)) throw new TypeError('file must be a Blob or File');
  const filename = String(file.name ?? 'poster-image').trim() || 'poster-image';
  const url = new URL('/api/poster/assets', globalThis.location?.origin ?? 'http://127.0.0.1');
  url.searchParams.set('scope', scope);
  url.searchParams.set('filename', filename);
  url.searchParams.set('source', source === 'tmdb' ? 'tmdb' : 'local');
  const response = await fetchImpl(`${url.pathname}${url.search}`, {
    method: 'POST',
    headers: {'content-type': file.type || 'application/octet-stream'},
    body: file,
  });
  const body = await responseJson(response);
  return body.asset;
}

export async function loadPosterWorkspace(scope, fetchImpl = globalThis.fetch) {
  const url = `/api/poster/state?scope=${encodeURIComponent(scope)}`;
  const body = await responseJson(await fetchImpl(url, {cache: 'no-store'}));
  return body.project ?? null;
}

export async function savePosterWorkspace(scope, project, fetchImpl = globalThis.fetch) {
  const url = `/api/poster/state?scope=${encodeURIComponent(scope)}`;
  return responseJson(await fetchImpl(url, {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({project}),
    keepalive: true,
  }));
}

export async function deletePosterImage(asset, fetchImpl = globalThis.fetch) {
  const url = posterAssetUrl(asset);
  if (!url) return false;
  const body = await responseJson(await fetchImpl(url, {method: 'DELETE'}));
  return Boolean(body.deleted);
}
