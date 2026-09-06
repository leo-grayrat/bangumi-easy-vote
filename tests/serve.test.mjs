import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import test from 'node:test';

import { contentType, resolveExportPath, resolveRequestPath, startServer } from '../scripts/serve.mjs';

const root = path.resolve('D:/File/Git/bangumi-easy-vote');

test('resolveRequestPath maps the root and public assets inside the repository', () => {
  assert.equal(resolveRequestPath('/', root), path.join(root, 'index.html'));
  assert.equal(resolveRequestPath('/images.html', root), path.join(root, 'images.html'));
  assert.equal(resolveRequestPath('/poster.html?project=demo', root), path.join(root, 'poster.html'));
  assert.equal(resolveRequestPath('/poster.css', root), path.join(root, 'poster.css'));
  assert.equal(resolveRequestPath('/src/app.js', root), path.join(root, 'src', 'app.js'));
  assert.equal(
    resolveRequestPath('/tools/ranking-poster/sample.json', root),
    path.join(root, 'tools', 'ranking-poster', 'sample.json'),
  );
  assert.equal(
    resolveRequestPath('/tools/ranking-poster/sample-black.json', root),
    path.join(root, 'tools', 'ranking-poster', 'sample-black.json'),
  );
  assert.equal(
    resolveRequestPath('/form-import-findings.md', root),
    path.join(root, 'form-import-findings.md'),
  );
});

test('resolveRequestPath rejects traversal and files outside the public surface', () => {
  assert.equal(resolveRequestPath('/../package.json', root), null);
  assert.equal(resolveRequestPath('/%2e%2e/package.json', root), null);
  assert.equal(resolveRequestPath('/package.json', root), null);
  assert.equal(resolveRequestPath('/tools/ranking-poster/render.py', root), null);
  assert.equal(resolveRequestPath('/.git/config', root), null);
});

test('resolveExportPath serves generated images but rejects paths outside exports', () => {
  assert.equal(
    resolveExportPath('/exports/202607/01-%E5%B0%BC%E5%8F%A4%E5%96%B5%E5%96%B5.png', root),
    path.join(root, 'exports', '202607', '01-尼古喵喵.png'),
  );
  assert.equal(resolveExportPath('/exports/../README.md', root), null);
  assert.equal(resolveExportPath('/src/app.js', root), null);
});

test('contentType returns browser-safe MIME types', () => {
  assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('styles.css'), 'text/css; charset=utf-8');
  assert.equal(contentType('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('notes.md'), 'text/markdown; charset=utf-8');
});

test('YUC stream reports each real exporter step before the final result', async () => {
  const server = startServer({
    rootDirectory: root,
    port: 0,
    yucExporter: async ({ entries, onProgress }) => {
      await onProgress({ type: 'catalog', total: entries.length, catalogSize: 32 });
      await onProgress({
        type: 'entry-start',
        entryId: entries[0].entryId,
        title: entries[0].title,
        index: 1,
        total: entries.length,
        matchedTitle: '尼古喵喵',
      });
      const entryResult = {
        type: 'entry-result',
        index: 1,
        total: entries.length,
        result: {
          entryId: entries[0].entryId,
          requestedTitle: entries[0].title,
          matchedTitle: '尼古喵喵',
          status: 'ok',
        },
      };
      await onProgress(entryResult);
      return { season: '202607', catalogSize: 32, outputDirectory: 'exports/202607', results: [entryResult.result] };
    },
  });

  try {
    if (!server.listening) await once(server, 'listening');
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/yuc/import-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUrl: 'http://yuc.wiki/202607/',
        entries: [{ entryId: 'entry-1', title: '尼古喵喵' }],
      }),
    });
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    assert.deepEqual(events.map((event) => event.type), [
      'catalog',
      'entry-start',
      'entry-result',
      'complete',
    ]);
    assert.equal(events[1].title, '尼古喵喵');
    assert.equal(events[3].result.season, '202607');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('TMDB search and artwork routes keep credentials local to the request', async () => {
  const calls = [];
  const server = startServer({
    rootDirectory: root,
    port: 0,
    tmdbSearch: async (query, options) => {
      calls.push(['search', query, options.credential]);
      return [{ id: 42, name: '作品', year: '2026' }];
    },
    tmdbArtwork: async (seriesId, options) => {
      calls.push(['assets', seriesId, options.credential]);
      return { series: { id: seriesId, name: '作品' }, backdrops: [], posters: [], logos: [], episodes: [] };
    },
  });

  try {
    if (!server.listening) await once(server, 'listening');
    const { port } = server.address();
    const search = await fetch(`http://127.0.0.1:${port}/api/tmdb/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '作品', credential: 'secret-token' }),
    });
    const assets = await fetch(`http://127.0.0.1:${port}/api/tmdb/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seriesId: 42, credential: 'secret-token' }),
    });
    assert.equal(search.status, 200);
    assert.deepEqual(await search.json(), { results: [{ id: 42, name: '作品', year: '2026' }] });
    assert.equal(assets.status, 200);
    assert.equal((await assets.json()).series.id, 42);
    assert.deepEqual(calls, [
      ['search', '作品', 'secret-token'],
      ['assets', 42, 'secret-token'],
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('TMDB image route proxies only validated CDN paths and sizes', async () => {
  const upstreamCalls = [];
  const server = startServer({
    rootDirectory: root,
    port: 0,
    fetchImpl: async (url) => {
      upstreamCalls.push(String(url));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    },
  });

  try {
    if (!server.listening) await once(server, 'listening');
    const { port } = server.address();
    const ok = await fetch(`http://127.0.0.1:${port}/api/tmdb/image?path=%2Fabc.jpg&size=w780`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
    assert.equal(upstreamCalls[0], 'https://image.tmdb.org/t/p/w780/abc.jpg');

    const bad = await fetch(`http://127.0.0.1:${port}/api/tmdb/image?path=https%3A%2F%2Fevil.example%2Fx.jpg&size=w780`);
    assert.equal(bad.status, 400);
    assert.equal(upstreamCalls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
