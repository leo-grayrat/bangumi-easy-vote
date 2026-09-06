import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cachePosterImage,
  loadPosterVisuals,
  loadPosterWorkspace,
  posterAssetUrl,
  posterScopeForProjectId,
  savePosterVisuals,
  savePosterWorkspace,
} from '../src/poster-persistence.js';

test('poster scope is stable and filesystem-safe', () => {
  assert.equal(posterScopeForProjectId('abc-123'), 'project-abc-123');
  assert.equal(posterScopeForProjectId(''), 'standalone');
  assert.equal(posterScopeForProjectId('项目 / A'), 'project-_____A');
});

test('cachePosterImage uploads the original binary and returns a persistent asset reference', async () => {
  const calls = [];
  const file = new File([new Uint8Array([1,2,3])], 'foo.png', {type:'image/png'});
  const fetchImpl = async (url, init) => {
    calls.push([String(url), init]);
    return new Response(JSON.stringify({asset:{assetId:'id.png',scope:'project-demo',fileName:'foo.png',source:'local',relativePath:'.local/poster-assets/project-demo/id.png'}}), {status:201, headers:{'content-type':'application/json'}});
  };
  const asset = await cachePosterImage(file, 'project-demo', 'local', fetchImpl);
  assert.equal(asset.assetId, 'id.png');
  assert.match(calls[0][0], /\/api\/poster\/assets\?scope=project-demo&filename=foo.png&source=local$/);
  assert.equal(calls[0][1].body, file);
  assert.equal(calls[0][1].headers['content-type'], 'image/png');
});

test('poster workspace state is isolated by ranking mode', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([String(url), init]);
    if (init.method === 'PUT') {
      return new Response(JSON.stringify({stored:{relativePath:'.local/poster-projects/project-demo--red.json'}}), {status:200});
    }
    return new Response(JSON.stringify({project:{mode:'red',title:'Saved'}}), {status:200});
  };
  await savePosterWorkspace('project-demo', 'red', {mode:'red', title:'Saved'}, fetchImpl);
  assert.deepEqual(await loadPosterWorkspace('project-demo', 'red', fetchImpl), {mode:'red', title:'Saved'});
  assert.match(calls[0][0], /\/api\/poster\/state\?scope=project-demo&mode=red$/);
  assert.equal(calls[0][1].method, 'PUT');
  assert.equal(JSON.parse(calls[0][1].body).project.title, 'Saved');
  assert.match(calls[1][0], /\/api\/poster\/state\?scope=project-demo&mode=red$/);
  assert.equal(posterAssetUrl({scope:'project-demo',assetId:'id.png'}), '/api/poster/assets/project-demo/id.png');
});

test('visual plans round-trip through the local visual index', async () => {
  const calls = [];
  const visuals = [{visualId:'visual-1', animeTitle:'再见 拉拉', label:'第 5 集剧照'}];
  const fetchImpl = async (url, init = {}) => {
    calls.push([String(url), init]);
    if (init.method === 'PUT') return new Response(JSON.stringify({stored:{relativePath:'.local/poster-visuals/project-demo.json'}}), {status:200});
    return new Response(JSON.stringify({visuals}), {status:200});
  };
  await savePosterVisuals('project-demo', visuals, fetchImpl);
  assert.deepEqual(await loadPosterVisuals('project-demo', fetchImpl), visuals);
  assert.equal(calls[0][0], '/api/poster/visuals?scope=project-demo');
  assert.deepEqual(JSON.parse(calls[0][1].body), {visuals});
  assert.equal(calls[1][0], '/api/poster/visuals?scope=project-demo');
});
