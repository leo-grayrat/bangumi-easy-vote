import assert from 'node:assert/strict';
import test from 'node:test';

import { generateImportText, sanitizeImportText } from '../src/generators.js';

const entries = [
  { id: 'one', title: '世界舞动' },
  { id: 'two', title: '相反的你和我 第2期' },
];

function project(platform, template, overrides = {}) {
  return {
    title: '2026 年 7 月新番投票',
    description: '请选择符合你真实想法的选项。',
    platform,
    template,
    entries,
    ...overrides,
  };
}

test('generates a WJX single-choice vote without option prefixes or internal blanks', () => {
  const output = generateImportText(project('wjx', 'vote'));

  assert.match(output, /本季你最期待哪一部动画？ \[单选题\]/);
  assert.match(output, /\[单选题\]\n世界舞动\n相反的你和我 第2期/);
  assert.doesNotMatch(output, /^A[.、 ]/m);
});

test('generates one WJX score matrix with anime titles as rows', () => {
  const output = generateImportText(project('wjx', 'score'));

  assert.equal((output.match(/\[矩阵题\]/g) ?? []).length, 1);
  assert.match(output, /\[矩阵题\]\n1 2 3 4 5\n世界舞动\n相反的你和我 第2期/);
});

test('generates one WJX status matrix with the four fixed states', () => {
  const output = generateImportText(project('wjx', 'status'));

  assert.match(
    output,
    /\[矩阵题\]\n必追 观望 不追 尚未决定\n世界舞动\n相反的你和我 第2期/,
  );
});

test('generates a Tencent single-choice vote with a welcome paragraph', () => {
  const output = generateImportText(project('tencent', 'vote'));

  assert.match(
    output,
    /^2026 年 7 月新番投票\n\n请选择符合你真实想法的选项。\n\n本季你最期待哪一部动画？ \[单选题\]/,
  );
  assert.match(output, /\[单选题\]\n世界舞动\n相反的你和我 第2期/);
});

test('expands Tencent scoring into one scale question per anime', () => {
  const output = generateImportText(project('tencent', 'score'));

  assert.equal((output.match(/\[量表题\]/g) ?? []).length, 2);
  assert.equal((output.match(/1\(完全不感兴趣\)~5\(非常期待\)/g) ?? []).length, 2);
  assert.doesNotMatch(output, /\[矩阵题\]/);
});

test('expands Tencent status into one dropdown per anime', () => {
  const output = generateImportText(project('tencent', 'status'));

  assert.equal((output.match(/\[下拉题\]/g) ?? []).length, 2);
  assert.match(output, /\[下拉题\]\n必追\n观望\n不追\n尚未决定/);
  assert.doesNotMatch(output, /\[矩阵题\]/);
});

test('sanitizes invisible characters, line endings, trailing spaces and blank runs', () => {
  const dirty = '\uFEFF标题\u200B  \r\n\r\n\t\r\n题目 [单选题]\t\r\n选项\u00A0 \r\n';

  assert.equal(sanitizeImportText(dirty), '标题\n\n题目 [单选题]\n选项');
});

test('cleans line breaks out of user fields before generating platform text', () => {
  const output = generateImportText(
    project('tencent', 'vote', {
      title: '七月\u200B\n新番',
      description: '第一句\r\n第二句',
      entries: [{ id: 'one', title: '世界\n舞动' }],
    }),
  );

  assert.match(output, /^七月 新番\n\n第一句 第二句/);
  assert.match(output, /\[单选题\]\n世界 舞动$/);
  assert.doesNotMatch(output, /[\u200B-\u200D\uFEFF]/);
});

test('never leaves whitespace after a question type tag', () => {
  for (const platform of ['wjx', 'tencent']) {
    for (const template of ['vote', 'score', 'status']) {
      assert.doesNotMatch(generateImportText(project(platform, template)), /\[[^\]]+题\][ \t\u3000]/);
    }
  }
});

test('rejects unsupported platform and template combinations', () => {
  assert.throws(() => generateImportText(project('unknown', 'vote')), /不支持的平台/);
  assert.throws(() => generateImportText(project('wjx', 'unknown')), /不支持的题目范式/);
});
