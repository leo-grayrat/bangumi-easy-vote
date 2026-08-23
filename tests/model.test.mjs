import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEntry,
  deriveTitleFromFilename,
  serializeProject,
  titlesFromText,
  validateProject,
} from '../src/model.js';

test('deriveTitleFromFilename removes only the final extension', () => {
  assert.equal(deriveTitleFromFilename('世界舞动.visual.jpg'), '世界舞动.visual');
  assert.equal(deriveTitleFromFilename('  相反的你和我.png  '), '相反的你和我');
  assert.equal(deriveTitleFromFilename('.hidden'), '.hidden');
});

test('titlesFromText keeps non-empty trimmed lines in source order', () => {
  assert.deepEqual(
    titlesFromText('世界舞动\r\n\r\n  相反的你和我  \n\t\n胆大党 第2期'),
    ['世界舞动', '相反的你和我', '胆大党 第2期'],
  );
});

test('createEntry returns the stable entry shape', () => {
  const entry = createEntry({
    title: '世界舞动',
    imageName: '世界舞动.jpg',
    imageUrl: 'blob:local-preview',
  });

  assert.equal(typeof entry.id, 'string');
  assert.ok(entry.id.length > 0);
  assert.deepEqual(
    { title: entry.title, imageName: entry.imageName, imageUrl: entry.imageUrl },
    {
      title: '世界舞动',
      imageName: '世界舞动.jpg',
      imageUrl: 'blob:local-preview',
    },
  );
});

test('validateProject reports blank and duplicate titles', () => {
  const project = {
    title: '七月新番投票',
    description: '',
    platform: 'wjx',
    template: 'vote',
    entries: [
      { id: 'one', title: '世界舞动' },
      { id: 'two', title: '  ' },
      { id: 'three', title: '世界舞动' },
    ],
  };

  const result = validateProject(project);

  assert.ok(result.errors.some((issue) => issue.code === 'blank-title'));
  assert.ok(result.warnings.some((issue) => issue.code === 'duplicate-title'));
});

test('validateProject blocks a project without entries', () => {
  const result = validateProject({
    title: '七月新番投票',
    description: '',
    platform: 'wjx',
    template: 'vote',
    entries: [],
  });

  assert.equal(result.errors[0].code, 'no-entries');
});

test('serializeProject removes temporary image URLs and preserves image names', () => {
  const serialized = serializeProject({
    title: '七月新番投票',
    description: '请选择你最期待的作品',
    platform: 'tencent',
    template: 'score',
    entries: [
      {
        id: 'one',
        title: '世界舞动',
        imageName: '世界舞动.jpg',
        imageUrl: 'blob:local-preview',
      },
    ],
  });
  const project = JSON.parse(serialized);

  assert.equal(project.entries[0].imageUrl, undefined);
  assert.equal(project.entries[0].imageName, '世界舞动.jpg');
  assert.equal(project.version, 1);
});
