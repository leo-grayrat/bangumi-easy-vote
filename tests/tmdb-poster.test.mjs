import test from 'node:test';
import assert from 'node:assert/strict';
import { tmdbImageUrl, searchTmdb, loadTmdbAssets, readTmdbCredential, saveTmdbCredential } from '../src/tmdb-poster.js';

test('TMDB proxy URLs encode file paths and reject unsupported sizes', () => {
  assert.equal(tmdbImageUrl('/abc.jpg', 'w300'), '/api/tmdb/image?path=%2Fabc.jpg&size=w300');
  assert.throws(() => tmdbImageUrl('https://evil/x.jpg', 'w300'));
  assert.throws(() => tmdbImageUrl('/abc.jpg', 'huge'));
});

test('credential storage is local-only and can be cleared', () => {
  const data = new Map();
  const storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  saveTmdbCredential('  token  ', storage);
  assert.equal(readTmdbCredential(storage), 'token');
  saveTmdbCredential('', storage);
  assert.equal(readTmdbCredential(storage), '');
});

test('search and assets calls send credential only in local POST bodies', async () => {
  const calls=[];
  const fetchImpl=async (url, init)=>{calls.push([url, JSON.parse(init.body)]); return new Response(JSON.stringify(url.endsWith('/search')?{results:[{id:1}]}:{series:{id:1}}),{status:200,headers:{'content-type':'application/json'}})};
  assert.deepEqual(await searchTmdb('作品','secret',fetchImpl),[{id:1}]);
  assert.deepEqual(await loadTmdbAssets(1,'secret',fetchImpl),{series:{id:1}});
  assert.deepEqual(calls,[['/api/tmdb/search',{query:'作品',credential:'secret'}],['/api/tmdb/assets',{seriesId:1,credential:'secret'}]]);
});
