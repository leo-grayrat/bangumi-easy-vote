import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {resolveRequestPath} from '../scripts/serve.mjs';
import {normalizePosterProject, posterDisplayRows} from '../src/poster-model.js';

const root = path.resolve('D:/File/Git/bangumi-easy-vote');

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('server exposes the built-in controversy sample', () => {
  assert.equal(
    resolveRequestPath('/tools/ranking-poster/sample-controversy.json', root),
    path.join(root, 'tools', 'ranking-poster', 'sample-controversy.json'),
  );
});

test('poster page exposes controversy mode and built-in loader', async () => {
  const html = await source('poster.html');
  const editor = await source('src/poster-editor.js');
  assert.match(html, /id="load-controversy-sample"/);
  assert.match(html, /option value="controversy">争议 \/ 一致榜<\/option>/);
  assert.match(editor, /sample-controversy\.json/);
  assert.match(editor, /社内 SD/);
  assert.match(editor, /BGM SD/);
});

test('built-in controversy sample yields five controversial and five consistent rows', async () => {
  const raw = JSON.parse(await source('tools/ranking-poster/sample-controversy.json'));
  const project = normalizePosterProject(raw);
  const rows = posterDisplayRows(project.items, project.mode);
  assert.equal(project.mode, 'controversy');
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.displayRank), [1,2,3,4,5]);
  assert.deepEqual(rows.slice(5).map((row) => row.displayRank), [1,2,3,4,5]);
  assert.ok(rows.slice(0, 5).every((row) => row.section === 'controversial'));
  assert.ok(rows.slice(5).every((row) => row.section === 'consistent'));
});
