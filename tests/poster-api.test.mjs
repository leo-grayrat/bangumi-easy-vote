import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handlePosterRequest } from '../scripts/poster-api.mjs';

test('poster api persists image bytes and project state across requests', async () => {
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

    const saved = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo`, {
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({project:{title:'Saved',items:[{imageAsset:asset}]}}),
    });
    assert.equal(saved.status, 200);
    const loaded = await fetch(`http://127.0.0.1:${port}/api/poster/state?scope=project-demo`);
    assert.equal((await loaded.json()).project.title, 'Saved');
  } finally {
    await new Promise((resolve)=>server.close(resolve));
  }
});
