import test from 'node:test';
import assert from 'node:assert/strict';
import {POSTER_LAYOUT, measurePosterRows, rowAtCanvasPoint} from '../src/poster-renderer.js';

test('renderer geometry matches calibrated Pillow prototype', () => {
  assert.equal(POSTER_LAYOUT.width, 1200);
  assert.equal(POSTER_LAYOUT.height, 1800);
  assert.equal(POSTER_LAYOUT.visualWidth, 699);
  assert.equal(POSTER_LAYOUT.rowHeight, 136);
  assert.deepEqual(POSTER_LAYOUT.rowY, [168,317,467,616,766,915,1065,1214,1364,1514]);
  assert.equal(POSTER_LAYOUT.statsX, 831);
  assert.equal(POSTER_LAYOUT.right, 1176);
});

test('measurePosterRows returns ten fixed row boxes', () => {
  const rows = measurePosterRows();
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], {index:0, x:22, y:168, width:1154, height:136});
  assert.deepEqual(rows[9], {index:9, x:22, y:1514, width:1154, height:136});
});

test('rowAtCanvasPoint maps rank, visual and stats area to same row', () => {
  assert.equal(rowAtCanvasPoint(30, 170), 0);
  assert.equal(rowAtCanvasPoint(500, 170), 0);
  assert.equal(rowAtCanvasPoint(1000, 170), 0);
  assert.equal(rowAtCanvasPoint(1000, 1520), 9);
  assert.equal(rowAtCanvasPoint(10, 170), null);
  assert.equal(rowAtCanvasPoint(1000, 310), null);
});
