import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handlePosterRequest } from '../scripts/poster-api.mjs';

test('poster api persists image bytes, per-mode project state and visual plans across requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'poster-api-'));
  const server = createServer(async (request, response) => {
    if (await handlePosterRequest({request, response, rootDirectory: root})) return;
    response.writeHead(404);
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const {port} = server.address();
  try {
    const upload = await fetch(`http://127.0.0.1:${port}/api/poster/assets?scope=project-demo&filename=foo.png&source=local`, {
      method:'POST',
      headers:{'content-type':'image/png'},
      body:new Uint8Array([1,2,3,4]),
    });
    assert.equal(upload.status, 201);
    const asset = (await upload.json()).asset;
    const restored = await fetch(`http://127.0.0.1:${port}/api/poster/assets/${asset.scope}/${asset.assetId}`);
    assert.equal(restored.status, 200);
    assert.deepEqual([...new Uint8Array(await restored.arrayBuffer())], [1,2,3,4]);

    const savedRed = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo&mode=red`, {
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({project:{mode:'red',title:'Saved red',items:[{imageAsset:asset}]}}),
    });
    assert.equal(savedRed.status, 200);
    const savedFavorite = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo&mode=favorite`, {
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({project:{mode:'favorite',title:'Saved favorite',items:[]}}),
    });
    assert.equal(savedFavorite.status, 200);
    const loadedRed = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo&mode=red`);
    const loadedFavorite = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo&mode=favorite`);
    assert.equal((await loadedRed.json()).project.title, 'Saved red');
    assert.equal((await loadedFavorite.json()).project.title, 'Saved favorite');

    const visuals = [{
      visualId:'visual-1',
      animeTitle:'再见 拉拉',
      label:'第 5 集剧照',
      asset,
      crop:{zoom:1.2,offsetX:0.1,offsetY:-0.2},
      brightness:0.78,
    }];
    const savedVisuals = await fetch(`http://127.0.0.1:${port}/api/poster/visuals?scope=project-demo`, {
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({visuals}),
    });
    assert.equal(savedVisuals.status, 200);
    const loadedVisuals = await fetch(`http://127.0.0.1:${port}/api/poster/visuals?scope=project-demo`);
    assert.deepEqual((await loadedVisuals.json()).visuals, visuals);
  } finally {
    await new Promise((resolve)=>server.close(resolve));
  }
});
