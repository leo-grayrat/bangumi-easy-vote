import assert from 'node:assert/strict';
import test from 'node:test';

import { expandQuestions, generateImportText, sanitizeImportText } from '../src/generators.js';

const entries = [
  { id: 'one', title: '世界舞动', selectedAssetId: 'asset-one' },
  { id: 'two', title: '相反的你和我', selectedAssetId: 'asset-two' },
];

function project(platform, questionTemplate, overrides = {}) {
  return {
    title: '2026 年 7 月新番投票',
    description: '请选择符合你真实想法的选项。',
    platform,
    questionTemplate,
    entries,
    ...overrides,
  };
}

function template(overrides = {}) {
  return {
    expansion: 'perAnime',
    prompt: '请为《{title}》评分',
    type: 'scale',
    options: [],
    scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
    ...overrides,
  };
}

test('expands every anime into an editable scale question with its preview asset metadata', () => {
  const questions = expandQuestions(project('wjx', template()));

  assert.deepEqual(questions, [
    {
      ordinal: 1,
      prompt: '请为《世界舞动》评分',
      type: 'scale',
      options: [],
      scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
      animeEntryId: 'one',
      selectedAssetId: 'asset-one',
    },
    {
      ordinal: 2,
      prompt: '请为《相反的你和我》评分',
      type: 'scale',
      options: [],
      scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
      animeEntryId: 'two',
      selectedAssetId: 'asset-two',
    },
  ]);
});

test('formats WJX per-anime scales as one numeric line per score', () => {
  const output = generateImportText(project('wjx', template()));

  assert.match(output, /1\.请为《世界舞动》评分\[量表题\]\n1\n2\n3\n4\n5/);
  assert.match(output, /2\.请为《相反的你和我》评分\[量表题\]\n1\n2\n3\n4\n5/);
  assert.doesNotMatch(output, /1\(低\)~5\(高\)/);
  assert.doesNotMatch(output, /\[矩阵题\]/);
});

test('formats WJX multiple-choice and description with the documented compact labels', () => {
  const multiple = generateImportText(
    project('wjx', template({ type: 'multiple', prompt: '《{title}》吸引你的地方？', options: ['作画', '音乐'] })),
  );

  assert.match(multiple, /1\.《世界舞动》吸引你的地方？\[多选题\]\n作画\n音乐/);
  assert.doesNotMatch(multiple, /A\.作画/);
  assert.match(multiple, /问卷说明\[段落说明\]\n请选择符合你真实想法的选项。/);
});

test('formats Tencent per-anime scales with its range syntax', () => {
  const output = generateImportText(project('tencent', template()));

  assert.equal((output.match(/\[量表题\]/g) ?? []).length, 2);
  assert.equal((output.match(/1\(低\)~5\(高\)/g) ?? []).length, 2);
  assert.doesNotMatch(output, /\[矩阵题\]/);
});

test('turns all anime titles into one option question without per-option asset bindings', () => {
  const questions = expandQuestions(
    project('wjx', template({ expansion: 'allAsOptions', prompt: '最期待哪部？', type: 'single' })),
  );

  assert.deepEqual(questions, [
    {
      ordinal: 1,
      prompt: '最期待哪部？',
      type: 'single',
      options: ['世界舞动', '相反的你和我'],
      scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
      animeEntryId: '',
      selectedAssetId: '',
    },
  ]);
});

test('uses platform-specific option prefixes for one aggregate single-choice question', () => {
  const aggregate = template({ expansion: 'allAsOptions', prompt: '最期待哪部？', type: 'single' });
  const wjxText = generateImportText(project('wjx', aggregate));
  const tencentText = generateImportText(project('tencent', aggregate));

  assert.match(wjxText, /A\.世界舞动\nB\.相反的你和我/);
  assert.match(tencentText, /\[单选题\]\n世界舞动\n相反的你和我/);
  assert.doesNotMatch(tencentText, /A\.世界舞动/);
});

test('formats each verified Tencent question type with its real import label and no manual number', () => {
  const cases = [
    ['single', '[单选题]', ['推荐', '不推荐']],
    ['multiple', '[多选题]', ['作画', '音乐']],
    ['dropdown', '[下拉题]', ['追', '不追']],
    ['scale', '[量表题]', ['1(低)~5(高)']],
    ['shortText', '[单行文本题]', []],
    ['longText', '[多行文本题]', []],
  ];

  for (const [type, label, expectedLines] of cases) {
    const output = generateImportText(
      project('tencent', template({ type, options: expectedLines, prompt: '《{title}》感想' })),
    );
    const firstQuestion = output.split('\n\n').at(-2);

    assert.match(
      firstQuestion.split('\n')[0],
      new RegExp(`^《世界舞动》感想${label.replace(/[\[\]]/g, '\\$&')}$`),
    );
    for (const line of expectedLines) {
      assert.match(output, new RegExp(`\\n${line.replace(/[()~]/g, '\\$&')}(?:\\n|$)`));
    }
    assert.doesNotMatch(firstQuestion, /^1\./);
  }
});

test('rejects unverified WJX dropdown and long-text templates before creating import text', () => {
  for (const type of ['dropdown', 'longText']) {
    assert.throws(
      () => generateImportText(project('wjx', template({ type }))),
      /尚未实测支持/,
    );
  }
});

test('cleans generated platform text without leaking preview asset IDs or tag trailing whitespace', () => {
  const output = generateImportText(
    project('tencent', template({ type: 'multiple', options: ['好\u200B\n', '一般\t'] }), {
      title: '七月\u200B\n新番',
      description: '第一句\r\n第二句',
      entries: [{ id: 'one', title: '世界\n舞动', selectedAssetId: 'asset-only-preview' }],
    }),
  );

  assert.match(output, /^七月 新番\n\n第一句 第二句/);
  assert.match(output, /《世界 舞动》评分\[多选题\]\n好\n一般/);
  assert.doesNotMatch(output, /[\u200B-\u200D\uFEFF]/);
  assert.doesNotMatch(output, /asset-only-preview/);
  assert.doesNotMatch(output, /\[[^\]]+题\][ \t\u3000]/);
});

test('sanitizes invisible characters, line endings, trailing spaces and blank runs', () => {
  const dirty = '\uFEFF标题\u200B  \r\n\r\n\t\r\n题目 [单选题]\t\r\n选项\u00A0 \r\n';

  assert.equal(sanitizeImportText(dirty), '标题\n\n题目 [单选题]\n选项');
});

test('rejects unsupported platforms and question types', () => {
  assert.throws(() => generateImportText(project('unknown', template())), /不支持的平台/);
  assert.throws(() => generateImportText(project('wjx', template({ type: 'unknown' }))), /不支持的题目类型/);
});
