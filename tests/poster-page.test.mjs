import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('question, image and poster pages expose the same three workspace tabs', async () => {
  const [question, images, poster] = await Promise.all([
    source('index.html'),
    source('images.html'),
    source('poster.html'),
  ]);

  for (const html of [question, images, poster]) {
    assert.match(html, /data-project-link="index\.html">题目<\/a>/);
    assert.match(html, /data-project-link="images\.html">图片<\/a>/);
    assert.match(html, /data-project-link="poster\.html">排行榜海报<\/a>/);
  }

  assert.match(question, /bgm-tab__item bgm-tab__item--active[^>]+index\.html/);
  assert.match(images, /bgm-tab__item bgm-tab__item--active[^>]+images\.html/);
  assert.match(poster, /bgm-tab__item bgm-tab__item--active[^>]+poster\.html/);
});

test('poster page keeps the fixed export and crop dimensions', async () => {
  const poster = await source('poster.html');
  assert.match(poster, /id="poster-canvas" width="1200" height="1800"/);
  assert.match(poster, /id="poster-crop-canvas" width="699" height="136"/);
  assert.match(poster, /id="download-poster"/);
  assert.match(poster, /id="download-poster-project"/);
});

test('poster editor persists image files through the local server while keeping font and PNG browser APIs', async () => {
  const [editor, persistence] = await Promise.all([
    source('src/poster-editor.js'),
    source('src/poster-persistence.js'),
  ]);
  assert.match(editor, /cachePosterImage\(/);
  assert.match(editor, /loadPosterWorkspace\(/);
  assert.match(editor, /imageAsset/);
  assert.match(persistence, /\/api\/poster\/assets/);
  assert.match(persistence, /\/api\/poster\/state/);
  assert.match(editor, /new FontFace\(/);
  assert.match(editor, /\.toBlob\(/);
  assert.doesNotMatch(editor, /\.xlsx|Excel|spreadsheet/i);
});
