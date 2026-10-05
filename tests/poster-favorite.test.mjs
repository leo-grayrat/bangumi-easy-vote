import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
  favoriteTrendState,
  normalizePosterProject,
  posterDisplayRows,
  sortPosterItems,
} from '../src/poster-model.js';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('favorite mode sorts by points and breaks ties by more Top5 appearances', () => {
  const items = [
    {title: 'A', favoritePoints: 10, top5Count: 2},
    {title: 'B', favoritePoints: 10, top5Count: 3},
    {title: 'C', favoritePoints: 12, top5Count: 2},
  ];
  assert.deepEqual(sortPosterItems(items, 'favorite').map((item) => item.title), ['C', 'B', 'A']);
  assert.deepEqual(posterDisplayRows(items, 'favorite').map((row) => row.displayRank), [1, 2, 3]);
});

test('favorite normalization keeps favorite points, Top5 count and score rank', () => {
  const project = normalizePosterProject({
    mode: 'favorite',
    items: [{title: 'A', favorite_points: 28, top5_count: 7, score_rank: 15}],
  });
  assert.equal(project.mode, 'favorite');
  assert.equal(project.comparisonLabel, 'VS SCORE RANK');
  assert.equal(project.items[0].favoritePoints, 28);
  assert.equal(project.items[0].top5Count, 7);
  assert.equal(project.items[0].scoreRank, 15);
});

test('favorite arrows reserve up for large rises, flat for ordinary rises and down for any fall', () => {
  assert.equal(favoriteTrendState(1, 15), 'up');
  assert.equal(favoriteTrendState(5, 8), 'flat');
  assert.equal(favoriteTrendState(3, 2), 'down');
  assert.equal(favoriteTrendState(6, 6), 'flat');
});

test('favorite rank difference keeps an explicit plus or minus sign beside the arrow', async () => {
  const renderer = await source('src/poster-renderer.js');
  assert.match(renderer, /function drawRankDifference[\s\S]*?const negative = delta < 0;[\s\S]*?const sign = negative \? '−' : '\+';[\s\S]*?Math\.abs\(Math\.round\(delta\)\)/);
});

test('current favorite sample is the agreed finale Top10', async () => {
  const sample = JSON.parse(await source('tools/ranking-poster/sample-favorite.json'));
  const project = normalizePosterProject(sample);
  const rows = posterDisplayRows(project.items, project.mode);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.item.title), [
    '无职转生 第3期',
    '尼古喵喵',
    'Re:从零开始的异世界生活 第4期 Part.2 夺还篇',
    '穹庐下的魔女',
    '与你相恋到生命尽头',
    '躲在超市后门抽烟的两人',
    '再见 拉拉',
    '碧蓝之海 第3期',
    '感谢对战 大小姐才不玩格斗游戏',
    '相反的你和我 第2期',
  ]);
  assert.deepEqual(
    rows.slice(0, 5).map((row) => [row.item.favoritePoints, row.item.top5Count, row.item.scoreRank]),
    [[82, 20, 5], [64, 19, 4], [55, 19, 13], [51, 14, 1], [43, 12, 3]],
  );
});

test('favorite mode is wired through page, editor, renderer and local server', async () => {
  const [page, editor, renderer, server] = await Promise.all([
    source('poster.html'),
    source('src/poster-editor.js'),
    source('src/poster-renderer.js'),
    source('scripts/serve.mjs'),
  ]);
  assert.match(page, /id="load-favorite-sample"/);
  assert.match(page, /option value="favorite">喜爱榜<\/option>/);
  assert.match(editor, /sample-favorite\.json/);
  assert.match(editor, /TOP5 人数/);
  assert.match(editor, /社内评分排名/);
  assert.match(renderer, /FAVORITE PTS/);
  assert.match(renderer, /TOP5 \$\{item\.top5Count\}/);
  assert.match(renderer, /SCORE #\$\{item\.scoreRank\}/);
  assert.match(server, /sample-favorite\.json/);
});
