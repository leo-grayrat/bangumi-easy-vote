import assert from 'node:assert/strict';
import test from 'node:test';

import { selectedImageDownloadFilename } from '../src/image-downloads.js';

test('names selected image downloads by question order and title', () => {
  assert.equal(
    selectedImageDownloadFilename({
      index: 0,
      total: 12,
      title: '无职转生 第3期',
      sourceFilename: '01-无职转生 第3期-资料卡.png',
    }),
    '01-无职转生 第3期.png',
  );
});

test('keeps the selected asset extension and makes Windows-safe names', () => {
  assert.equal(
    selectedImageDownloadFilename({
      index: 9,
      total: 10,
      title: '作品:A/B?',
      sourceFilename: 'visual.jpg',
    }),
    '10-作品-A-B-.jpg',
  );
});
