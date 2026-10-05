import test from 'node:test';
import assert from 'node:assert/strict';

import {normalizePosterProject} from '../src/poster-model.js';

test('finale poster modes use finale copy when a project omits title metadata', () => {
  const red = normalizePosterProject({mode: 'red'});
  assert.equal(red.title, '7月新番完结评分 TOP 10');
  assert.equal(red.subtitle, 'SEASON FINALE TOP 10 ANIME');

  const black = normalizePosterProject({mode: 'black'});
  assert.equal(black.title, '7月新番完结黑榜 BOTTOM 10');
  assert.equal(black.subtitle, 'SEASON FINALE BOTTOM 10 ANIME');

  const controversy = normalizePosterProject({mode: 'controversy'});
  assert.equal(controversy.title, '7月新番完结争议度');

  const favorite = normalizePosterProject({mode: 'favorite'});
  assert.equal(favorite.title, '7月新番完结喜爱度 TOP 10');
});
