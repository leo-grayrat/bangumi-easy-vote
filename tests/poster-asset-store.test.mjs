import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadPosterState,
  loadPosterVisuals,
  resolvePosterAssetPath,
  resolvePosterStatePath,
  resolvePosterVisualsPath,
  savePosterAsset,
  savePosterState,
  savePosterVisuals,
} from '../scripts/poster-asset-store.mjs';

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

test('poster state paths are isolated by ranking mode', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'poster-state-'));
  const redPath = resolvePosterStatePath(root, 'project-demo', 'red');
  const favoritePath = resolvePosterStatePath(root, 'project-demo', 'favorite');
  assert.notEqual(redPath, favoritePath);
  assert.match(redPath, /project-demo--red\.json$/);
  assert.match(favoritePath, /project-demo--favorite\.json$/);

  await savePosterState(root, 'project-demo', 'red', {mode:'red', title:'Red'});
  await savePosterState(root, 'project-demo', 'favorite', {mode:'favorite', title:'Favorite'});
  assert.equal((await loadPosterState(root, 'project-demo', 'red')).title, 'Red');
  assert.equal((await loadPosterState(root, 'project-demo', 'favorite')).title, 'Favorite');
});

test('mode state loader falls back to a matching legacy single-state file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'poster-legacy-'));
  const legacyDirectory = path.join(root, '.local', 'poster-projects');
  await mkdir(legacyDirectory, {recursive:true});
  await writeFile(path.join(legacyDirectory, 'project-demo.json'), JSON.stringify({mode:'black', title:'Legacy black'}), 'utf8');
  assert.equal((await loadPosterState(root, 'project-demo', 'black')).title, 'Legacy black');
  assert.equal(await loadPosterState(root, 'project-demo', 'red'), null);
});

test('poster visual index persists readable visual plans separately from binaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'poster-visuals-'));
  const visuals = [{visualId:'visual-1', animeTitle:'再见 拉拉', label:'第 5 集剧照'}];
  assert.match(resolvePosterVisualsPath(root, 'project-demo'), /poster-visuals[\\/]project-demo\.json$/);
  await savePosterVisuals(root, 'project-demo', visuals);
  assert.deepEqual(await loadPosterVisuals(root, 'project-demo'), visuals);
});
