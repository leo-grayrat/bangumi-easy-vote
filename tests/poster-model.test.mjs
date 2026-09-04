import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTER_DEFAULTS,
  createPosterProject,
  normalizePosterProject,
  sortPosterItems,
  trendState,
  serializePosterProject,
  cropTransform,
} from '../src/poster-model.js';

test('red and black sorting break score ties by more voters', () => {
  const items = [
    { title: 'A', score: 8, voters: 4 },
    { title: 'B', score: 8, voters: 6 },
    { title: 'C', score: 7, voters: 9 },
  ];
  assert.deepEqual(sortPosterItems(items, 'red').map(x => x.title), ['B', 'A', 'C']);
  assert.deepEqual(sortPosterItems(items, 'black').map(x => x.title), ['C', 'B', 'A']);
});

test('red and black modes use different comparison baselines', () => {
  assert.equal(trendState(8.8, 8.0, 'red'), 'flat');
  assert.equal(trendState(8.8, 7.5, 'red'), 'up');
  assert.equal(trendState(8.0, 8.0, 'red'), 'down');
  assert.equal(trendState(4.8, 5.5, 'black'), 'flat');
  assert.equal(trendState(4.0, 5.5, 'black'), 'down');
  assert.equal(trendState(5.5, 5.5, 'black'), 'up');
});

test('project normalization supplies stable crop, style and provider defaults', () => {
  const project = normalizePosterProject({items:[{title:'A', score:8, voters:3, bgm_score:7.2, providerIds:{tmdb:123}}]});
  assert.equal(project.mode, 'red');
  assert.deepEqual(project.items[0].crop, {zoom:1, offsetX:0, offsetY:0});
  assert.deepEqual(project.items[0].providerIds, {tmdb:123});
  assert.equal(project.style.headerLineGap, POSTER_DEFAULTS.style.headerLineGap);
  assert.equal(project.style.deltaMinusYOffset, POSTER_DEFAULTS.style.deltaMinusYOffset);
});

test('poster latin presets use Century Gothic instead of Arial', () => {
  const families = POSTER_DEFAULTS.style.fontFamilies;
  for (const role of ['headerSubtitle', 'rank', 'label', 'metric', 'trendDelta']) {
    assert.match(families[role], /Century Gothic/);
    assert.doesNotMatch(families[role], /Arial/);
  }
});

test('poster serialization strips binary/session urls but keeps provider ids and local filenames as reload hints', () => {
  const project = createPosterProject({
    style: {
      fontFamilies: {anime: 'LocalAnime'},
      fontSources: {
        anime: {filename: 'anime-local.ttf', family: 'LocalAnime', url: 'blob:font'},
        metric: 'blob:legacy-font',
      },
    },
    items:[{title:'A', score:8, voters:3, bgmScore:7.2, imageName:'a.jpg', imageUrl:'blob:image', providerIds:{tmdb:456}}],
  });
  const parsed = JSON.parse(serializePosterProject(project));
  assert.equal(parsed.items[0].imageUrl, undefined);
  assert.equal(parsed.items[0].imageName, 'a.jpg');
  assert.deepEqual(parsed.items[0].providerIds, {tmdb:456});
  assert.deepEqual(parsed.style.fontSources, {anime: {filename: 'anime-local.ttf'}});
  assert.equal(parsed.style.fontFamilies.anime, 'LocalAnime');
  assert.doesNotMatch(JSON.stringify(parsed), /blob:/);
});

test('cropTransform returns centered cover at zoom 1', () => {
  const crop = cropTransform(1000, 1000, 699, 136, {zoom:1, offsetX:0, offsetY:0});
  assert.ok(Math.abs(crop.sw - 1000) < 1e-9);
  assert.ok(Math.abs(crop.sh - (1000 * 136 / 699)) < 1e-9);
  assert.ok(Math.abs(crop.sx) < 1e-9);
  assert.ok(crop.sy > 0);
});

test('cropTransform clamps zoom and offsets inside source image', () => {
  const crop = cropTransform(1600, 900, 699, 136, {zoom:2, offsetX:999, offsetY:-999});
  assert.ok(crop.sw < 1600);
  assert.ok(crop.sh < 900);
  assert.ok(crop.sx >= 0 && crop.sx + crop.sw <= 1600 + 1e-9);
  assert.ok(crop.sy >= 0 && crop.sy + crop.sh <= 900 + 1e-9);
  const clampedZoom = cropTransform(1600, 900, 699, 136, {zoom:0.1, offsetX:0, offsetY:0});
  const base = cropTransform(1600, 900, 699, 136, {zoom:1, offsetX:0, offsetY:0});
  assert.deepEqual(clampedZoom, base);
});
