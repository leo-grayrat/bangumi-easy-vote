import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEntry,
  createQuestionTemplate,
  deriveTitleFromFilename,
  interpolatePrompt,
  normalizeProjectRecord,
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

test('createEntry returns the stable entry shape without temporary blob URLs', () => {
  const entry = createEntry({
    title: '世界舞动',
  });

  assert.equal(typeof entry.id, 'string');
  assert.ok(entry.id.length > 0);
  assert.deepEqual(
    {
      title: entry.title,
      order: entry.order,
      sourceUrl: entry.sourceUrl,
      visualAssetId: entry.visualAssetId,
      infoCardAssetId: entry.infoCardAssetId,
      selectedAssetId: entry.selectedAssetId,
    },
    {
      title: '世界舞动',
      order: 0,
      sourceUrl: '',
      visualAssetId: '',
      infoCardAssetId: '',
      selectedAssetId: '',
    },
  );
});

test('question templates interpolate per-anime prompts and one-based indices', () => {
  const template = createQuestionTemplate({
    expansion: 'perAnime',
    prompt: '你对《{title}》的期待度是？',
    type: 'scale',
    scale: { min: 1, max: 5, minLabel: '没兴趣', maxLabel: '很期待' },
  });

  assert.equal(template.type, 'scale');
  assert.equal(
    interpolatePrompt(template.prompt, { title: '世界舞动' }, 0),
    '你对《世界舞动》的期待度是？',
  );
  assert.equal(interpolatePrompt('第 {index} 部：{title}', { title: '世界舞动' }, 1), '第 2 部：世界舞动');
});

test('normalizeProjectRecord migrates a legacy vote project to a version 2 question template', () => {
  const project = normalizeProjectRecord({
    version: 1,
    title: '七月新番投票',
    description: '请选择最期待的作品',
    platform: 'wjx',
    template: 'vote',
    entries: [
      { id: 'first', title: '世界舞动', visualAssetId: 'asset-world' },
      { id: 'second', title: '相反的你和我', infoCardAssetId: 'asset-opposite' },
    ],
  });

  assert.equal(project.version, 2);
  assert.equal(project.template, undefined);
  assert.deepEqual(project.questionTemplate, {
    expansion: 'allAsOptions',
    prompt: '本季你最期待哪一部动画？',
    type: 'single',
    options: ['推荐', '不推荐'],
    scale: { min: 1, max: 5, minLabel: '完全不感兴趣', maxLabel: '非常期待' },
  });
  assert.deepEqual(
    project.entries.map(({ id, title, order, visualAssetId, infoCardAssetId }) => ({
      id,
      title,
      order,
      visualAssetId,
      infoCardAssetId,
    })),
    [
      { id: 'first', title: '世界舞动', order: 0, visualAssetId: 'asset-world', infoCardAssetId: '' },
      { id: 'second', title: '相反的你和我', order: 1, visualAssetId: '', infoCardAssetId: 'asset-opposite' },
    ],
  );
});

test('validateProject reports blank and duplicate titles', () => {
  const project = {
    title: '七月新番投票',
    description: '',
    platform: 'wjx',
    questionTemplate: createQuestionTemplate(),
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
    questionTemplate: createQuestionTemplate(),
    entries: [],
  });

  assert.equal(result.errors[0].code, 'no-entries');
});

test('validateProject reports unsupported question settings and placeholder misuse', () => {
  const validProject = {
    title: '七月新番投票',
    description: '',
    platform: 'wjx',
    entries: [{ id: 'one', title: '世界舞动' }],
  };
  const projectWithUnknownType = {
    ...validProject,
    questionTemplate: createQuestionTemplate({ type: 'ranking' }),
  };
  const singleChoiceWithOneOption = {
    ...validProject,
    questionTemplate: createQuestionTemplate({ type: 'single', options: ['推荐'] }),
  };
  const scaleWithMinAboveMax = {
    ...validProject,
    questionTemplate: createQuestionTemplate({ type: 'scale', scale: { min: 5, max: 1 } }),
  };
  const perAnimePromptWithoutTitle = {
    ...validProject,
    questionTemplate: createQuestionTemplate({ expansion: 'perAnime', prompt: '请评分' }),
  };
  const projectWithUnknownPlaceholder = {
    ...validProject,
    questionTemplate: createQuestionTemplate({ prompt: '《{name}》好看吗？' }),
  };
  const allAsOptionsWithTitlePlaceholder = {
    ...validProject,
    questionTemplate: createQuestionTemplate({
      expansion: 'allAsOptions',
      type: 'single',
      prompt: '《{title}》好看吗？',
    }),
  };

  assert.equal(validateProject(projectWithUnknownType).errors[0].code, 'unsupported-question-type');
  assert.ok(validateProject(singleChoiceWithOneOption).errors.some((x) => x.code === 'too-few-options'));
  assert.ok(validateProject(scaleWithMinAboveMax).errors.some((x) => x.code === 'invalid-scale-range'));
  assert.ok(validateProject(perAnimePromptWithoutTitle).warnings.some((x) => x.code === 'prompt-without-title'));
  assert.ok(validateProject(projectWithUnknownPlaceholder).errors.some((x) => x.code === 'unknown-placeholder'));
  assert.ok(validateProject(allAsOptionsWithTitlePlaceholder).errors.some((x) => x.code === 'placeholder-not-available'));
});

test('serializeProject emits the normalized version 2 project without temporary image fields', () => {
  const serialized = serializeProject({
    title: '七月新番投票',
    description: '请选择你最期待的作品',
    platform: 'tencent',
    template: 'score',
    entries: [
      {
        id: 'one',
        title: '世界舞动',
        visualAssetId: 'asset-world',
        imageName: '世界舞动.jpg',
        imageUrl: 'blob:local-preview',
      },
    ],
  });
  const project = JSON.parse(serialized);

  assert.equal(project.entries[0].imageUrl, undefined);
  assert.equal(project.entries[0].imageName, undefined);
  assert.equal(project.entries[0].visualAssetId, 'asset-world');
  assert.equal(project.questionTemplate.type, 'scale');
  assert.equal(project.template, undefined);
  assert.equal(project.version, 2);
});
