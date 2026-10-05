import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
  POSTER_DEFAULTS,
  controversyTrendState,
  midseasonTrendState,
  normalizePosterProject,
  posterDisplayRows,
  serializePosterProject,
  trendState,
} from '../src/poster-model.js';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function itemsFromDeltas(field, values) {
  return values.map((value, index) => {
    const item = {id: `item-${index}`, title: `Item ${index}`, score: 7, voters: 10};
    if (field === 'midseason') item.midseasonScore = 7 - value;
    if (field === 'bgm') item.bgmScore = 7 - value;
    return item;
  });
}

test('all six poster modes normalize without falling back to red', () => {
  for (const mode of ['red', 'black', 'favorite', 'controversy', 'midseason-change', 'bgm-deviation']) {
    const project = normalizePosterProject({mode, items: []});
    assert.equal(project.mode, mode);
  }
});

test('new projects expose editable threshold defaults', () => {
  assert.deepEqual(POSTER_DEFAULTS.thresholds, {
    scoreBgmDown: 0,
    scoreBgmUp: 0.7,
    controversyDown: -0.5,
    controversyUp: 0.5,
    favoriteDown: 0,
    favoriteUp: 5,
    midseasonDown: 0,
    midseasonUp: 0,
  });
  const project = normalizePosterProject({mode: 'red'});
  assert.deepEqual(project.thresholds, POSTER_DEFAULTS.thresholds);
});

test('legacy red and black thresholds migrate by the project mode while new fields win', () => {
  const red = normalizePosterProject({
    mode: 'red',
    thresholds: {redDown: 0.4, redUp: 1.0, blackDown: -1, blackUp: -0.4},
  });
  assert.equal(red.thresholds.scoreBgmDown, 0.4);
  assert.equal(red.thresholds.scoreBgmUp, 1.0);

  const black = normalizePosterProject({
    mode: 'black',
    thresholds: {redDown: 0.4, redUp: 1.0, blackDown: -1, blackUp: -0.4},
  });
  assert.equal(black.thresholds.scoreBgmDown, -1);
  assert.equal(black.thresholds.scoreBgmUp, -0.4);

  const current = normalizePosterProject({
    mode: 'black',
    thresholds: {scoreBgmDown: 0.1, scoreBgmUp: 0.8, blackDown: -1, blackUp: -0.4},
  });
  assert.equal(current.thresholds.scoreBgmDown, 0.1);
  assert.equal(current.thresholds.scoreBgmUp, 0.8);
});

test('legacy controversy split thresholds are intentionally replaced by new unified defaults', () => {
  const project = normalizePosterProject({
    mode: 'controversy',
    thresholds: {
      controversyHighDown: 0.2,
      controversyHighUp: 0.7,
      controversyLowDown: -0.7,
      controversyLowUp: -0.3,
    },
  });
  assert.equal(project.thresholds.controversyDown, -0.5);
  assert.equal(project.thresholds.controversyUp, 0.5);
});

test('serialization keeps only the new threshold structure', () => {
  const project = normalizePosterProject({
    mode: 'red',
    thresholds: {redDown: 0.4, redUp: 1.0},
  });
  const serialized = JSON.parse(serializePosterProject(project));
  assert.deepEqual(Object.keys(serialized.thresholds).sort(), [
    'controversyDown',
    'controversyUp',
    'favoriteDown',
    'favoriteUp',
    'midseasonDown',
    'midseasonUp',
    'scoreBgmDown',
    'scoreBgmUp',
  ]);
  assert.equal(serialized.thresholds.redDown, undefined);
  assert.equal(serialized.thresholds.redUp, undefined);
});

test('midseason fields normalize from camelCase and snake_case', () => {
  const project = normalizePosterProject({
    mode: 'midseason-change',
    items: [
      {title: 'A', score: 8, midseasonScore: 6.5, midseasonVoters: 7},
      {title: 'B', score: 7, midseason_score: 7.5, midseason_voters: 4},
    ],
  });
  assert.equal(project.items[0].midseasonScore, 6.5);
  assert.equal(project.items[0].midseasonVoters, 7);
  assert.equal(project.items[1].midseasonScore, 7.5);
  assert.equal(project.items[1].midseasonVoters, 4);
});

test('score-vs-Bangumi arrows share one adjustable threshold pair in red black and deviation modes', () => {
  for (const mode of ['red', 'black', 'bgm-deviation']) {
    assert.equal(trendState(7.69, 7, mode), 'flat');
    assert.equal(trendState(7.70, 7, mode), 'up');
    assert.equal(trendState(6.99, 7, mode), 'down');
    assert.equal(trendState(7.20, 7, mode, {scoreBgmDown: 0.1, scoreBgmUp: 0.3}), 'flat');
  }
});

test('controversy arrows use one adjustable delta-SD threshold pair regardless of section', () => {
  for (const section of ['controversial', 'consistent']) {
    assert.equal(controversyTrendState(1.50, 1.00, section), 'up');
    assert.equal(controversyTrendState(0.50, 1.00, section), 'down');
    assert.equal(controversyTrendState(1.10, 1.00, section), 'flat');
  }
  assert.equal(
    controversyTrendState(1.25, 1.00, 'controversial', {controversyDown: -0.2, controversyUp: 0.2}),
    'up',
  );
});

test('midseason arrows use adjustable positive negative boundaries with zero flat by default', () => {
  assert.equal(midseasonTrendState(7.01, 7.00), 'up');
  assert.equal(midseasonTrendState(6.99, 7.00), 'down');
  assert.equal(midseasonTrendState(7.00, 7.00), 'flat');
  const thresholds = {midseasonDown: -0.3, midseasonUp: 0.3};
  assert.equal(midseasonTrendState(7.2, 7, thresholds), 'flat');
  assert.equal(midseasonTrendState(7.4, 7, thresholds), 'up');
  assert.equal(midseasonTrendState(6.6, 7, thresholds), 'down');
});

test('midseason-change selects five most improved and five most declined without overlap', () => {
  const items = itemsFromDeltas('midseason', [-2, -1.5, -1, -0.5, -0.2, 0.1, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5]);
  const rows = posterDisplayRows(items, 'midseason-change');
  assert.deepEqual(rows.slice(0, 5).map((row) => row.section), Array(5).fill('improved'));
  assert.deepEqual(rows.slice(5).map((row) => row.section), Array(5).fill('declined'));
  assert.deepEqual(rows.map((row) => row.displayRank), [1,2,3,4,5,1,2,3,4,5]);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.item.id), ['item-11','item-10','item-9','item-8','item-7']);
  assert.deepEqual(rows.slice(5).map((row) => row.item.id), ['item-0','item-1','item-2','item-3','item-4']);
  assert.equal(new Set(rows.map((row) => row.item.id)).size, 10);
});

test('bgm-deviation selects five most above and five most below Bangumi without overlap', () => {
  const items = itemsFromDeltas('bgm', [-1.2, -0.9, -0.4, -0.2, -0.1, 0.1, 0.3, 0.5, 0.8, 1.0, 1.4, 1.8]);
  const rows = posterDisplayRows(items, 'bgm-deviation');
  assert.deepEqual(rows.slice(0, 5).map((row) => row.section), Array(5).fill('above'));
  assert.deepEqual(rows.slice(5).map((row) => row.section), Array(5).fill('below'));
  assert.deepEqual(rows.slice(0, 5).map((row) => row.item.id), ['item-11','item-10','item-9','item-8','item-7']);
  assert.deepEqual(rows.slice(5).map((row) => row.item.id), ['item-0','item-1','item-2','item-3','item-4']);
  assert.equal(new Set(rows.map((row) => row.item.id)).size, 10);
});

test('new mode defaults use the agreed headers', () => {
  const mid = normalizePosterProject({mode: 'midseason-change'});
  assert.equal(mid.comparisonLabel, 'VS MID-SEASON');
  assert.match(mid.subtitle, /MOST IMPROVED \/ MOST DECLINED/);
  const bgm = normalizePosterProject({mode: 'bgm-deviation'});
  assert.equal(bgm.comparisonLabel, 'VS BANGUMI');
  assert.match(bgm.subtitle, /MOST ABOVE BANGUMI \/ MOST BELOW BANGUMI/);
});

test('browser source exposes six modes, two new samples, editable thresholds and midseason fields', async () => {
  const [page, editor, renderer, server] = await Promise.all([
    source('poster.html'),
    source('src/poster-editor.js'),
    source('src/poster-renderer.js'),
    source('scripts/serve.mjs'),
  ]);
  assert.match(page, /option value="midseason-change">中期 → 完结<\/option>/);
  assert.match(page, /option value="bgm-deviation">BGM 偏差<\/option>/);
  assert.match(page, /id="threshold-down"/);
  assert.match(page, /id="threshold-up"/);
  assert.match(editor, /sample-midseason-change\.json/);
  assert.match(editor, /sample-bgm-deviation\.json/);
  assert.match(editor, /midseasonScore/);
  assert.match(editor, /midseasonVoters/);
  assert.match(editor, /scoreBgmDown/);
  assert.match(editor, /controversyDown/);
  assert.match(renderer, /MOST IMPROVED/);
  assert.match(renderer, /MOST DECLINED/);
  assert.match(renderer, /MOST ABOVE BANGUMI/);
  assert.match(renderer, /MOST BELOW BANGUMI/);
  assert.match(renderer, /MID N/);
  assert.match(server, /sample-midseason-change\.json/);
  assert.match(server, /sample-bgm-deviation\.json/);
});
