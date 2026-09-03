import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTmdbCredential, searchTmdbTv, getTmdbArtwork } from '../scripts/tmdb-client.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('detects bearer token and v3 api key credentials', () => {
  assert.deepEqual(resolveTmdbCredential('eyJhbGciOiJIUzI1NiJ9.payload.sig'), { type: 'bearer', value: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' });
  assert.deepEqual(resolveTmdbCredential('0123456789abcdef0123456789abcdef'), { type: 'apiKey', value: '0123456789abcdef0123456789abcdef' });
  assert.equal(resolveTmdbCredential(''), null);
});

test('search normalizes TMDB TV candidates and authenticates with bearer token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([String(url), init]);
    return jsonResponse({ results: [{ id: 123, name: '黄泉的使者', original_name: 'Yomi no Tsugai', first_air_date: '2026-07-04', origin_country: ['JP'], poster_path: '/p.jpg', backdrop_path: '/b.jpg', popularity: 9.5 }] });
  };
  const result = await searchTmdbTv('黄泉的使者', { credential: 'eyJ.foo.bar', fetchImpl });
  assert.equal(result[0].id, 123);
  assert.equal(result[0].year, '2026');
  assert.equal(result[0].originalName, 'Yomi no Tsugai');
  assert.match(calls[0][0], /search\/tv/);
  assert.match(calls[0][0], /language=zh-CN/);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer eyJ.foo.bar');
});

test('artwork returns series images plus three most recent aired episode stills across seasons', async () => {
  const routes = new Map([
    ['/3/tv/77?language=zh-CN', { id: 77, name: '作品', original_name: 'Work', first_air_date: '2026-01-01', seasons: [
      { season_number: 1, air_date: '2026-01-01', episode_count: 2 },
      { season_number: 2, air_date: '2026-07-01', episode_count: 2 },
    ] }],
    ['/3/tv/77/images?include_image_language=zh%2Cen%2Cnull', { backdrops: [{ file_path: '/bg.jpg', width: 1920, height: 1080, vote_average: 5.1 }], posters: [{ file_path: '/poster.jpg', width: 1000, height: 1500 }], logos: [{ file_path: '/logo.png', width: 800, height: 300 }] }],
    ['/3/tv/77/season/2?language=zh-CN', { episodes: [
      { episode_number: 1, name: 'S2E1', air_date: '2026-07-01', still_path: '/s2e1.jpg' },
      { episode_number: 2, name: 'S2E2', air_date: '2026-07-08', still_path: '/s2e2.jpg' },
    ] }],
    ['/3/tv/77/season/1?language=zh-CN', { episodes: [
      { episode_number: 1, name: 'S1E1', air_date: '2026-01-01', still_path: '/s1e1.jpg' },
      { episode_number: 2, name: 'S1E2', air_date: '2026-01-08', still_path: null },
    ] }],
  ]);
  const fetchImpl = async (url) => {
    const u = new URL(url);
    u.searchParams.delete('api_key');
    const key = `${u.pathname}${u.search}`;
    if (!routes.has(key)) throw new Error(`unexpected ${key}`);
    return jsonResponse(routes.get(key));
  };
  const result = await getTmdbArtwork(77, { credential: '0123456789abcdef0123456789abcdef', fetchImpl, today: '2026-09-04' });
  assert.equal(result.series.id, 77);
  assert.equal(result.backdrops[0].filePath, '/bg.jpg');
  assert.equal(result.posters[0].filePath, '/poster.jpg');
  assert.equal(result.logos[0].filePath, '/logo.png');
  assert.deepEqual(result.episodes.map((e) => [e.seasonNumber, e.episodeNumber, e.filePath]), [
    [2, 2, '/s2e2.jpg'],
    [2, 1, '/s2e1.jpg'],
    [1, 1, '/s1e1.jpg'],
  ]);
});
