import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { savePosterAsset, resolvePosterAssetPath } from '../scripts/poster-asset-store.mjs';

test('poster asset store saves binary data under .local and returns a stable relative reference', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'poster-assets-'));
  const stored = await savePosterAsset({
    rootDirectory: root,
    scope: 'project-demo',
    filename: '示例图.png',
    contentType: 'image/png',
    data: Buffer.from([1, 2, 3, 4]),
  });
  assert.equal(stored.scope, 'project-demo');
  assert.equal(stored.fileName, '示例图.png');
  assert.equal(stored.source, 'local');
  assert.match(stored.assetId, /^[a-f0-9-]+\.png$/);
  assert.equal(stored.relativePath, `.local/poster-assets/project-demo/${stored.assetId}`);
  const filePath = resolvePosterAssetPath(root, stored.scope, stored.assetId);
  assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3, 4]));
});

test('poster asset store rejects traversal in scope and asset ids', () => {
  assert.equal(resolvePosterAssetPath('C:/repo', '../oops', 'a.png'), null);
  assert.equal(resolvePosterAssetPath('C:/repo', 'safe', '../a.png'), null);
});
