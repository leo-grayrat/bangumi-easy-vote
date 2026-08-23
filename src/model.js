let fallbackId = 0;

const SUPPORTED_PLATFORMS = new Set(['wjx', 'tencent']);

export const QUESTION_TYPES = new Set([
  'single',
  'multiple',
  'dropdown',
  'scale',
  'shortText',
  'longText',
]);

export const EXPANSION_MODES = new Set(['perAnime', 'allAsOptions']);

export const DEFAULT_QUESTION_TEMPLATE = Object.freeze({
  expansion: 'perAnime',
  prompt: '你对《{title}》的期待度是？',
  type: 'scale',
  options: ['推荐', '不推荐'],
  scale: { min: 1, max: 5, minLabel: '完全不感兴趣', maxLabel: '非常期待' },
});

const LEGACY_TEMPLATES = {
  vote: { expansion: 'allAsOptions', prompt: '本季你最期待哪一部动画？', type: 'single' },
  score: { expansion: 'perAnime', prompt: '请为《{title}》评分', type: 'scale' },
  status: {
    expansion: 'perAnime',
    prompt: '《{title}》的追番状态',
    type: 'dropdown',
    options: ['必追', '观望', '不追', '尚未决定'],
  },
};

function nextId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  fallbackId += 1;
  return `anime-${fallbackId}`;
}

function copyTemplate(template = {}) {
  return {
    expansion: template.expansion,
    prompt: template.prompt,
    type: template.type,
    options: [...template.options],
    scale: { ...template.scale },
  };
}

export function createQuestionTemplate(overrides = {}) {
  return {
    ...copyTemplate(DEFAULT_QUESTION_TEMPLATE),
    ...overrides,
    options: Array.isArray(overrides.options)
      ? [...overrides.options]
      : [...DEFAULT_QUESTION_TEMPLATE.options],
    scale: {
      ...DEFAULT_QUESTION_TEMPLATE.scale,
      ...(overrides.scale ?? {}),
    },
  };
}

export function deriveTitleFromFilename(filename) {
  const trimmed = String(filename ?? '').trim();
  const finalDot = trimmed.lastIndexOf('.');

  if (finalDot <= 0) {
    return trimmed;
  }

  return trimmed.slice(0, finalDot).trim();
}

export function titlesFromText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function createEntry({
  title,
  order = 0,
  sourceUrl = '',
  visualAssetId = '',
  infoCardAssetId = '',
  selectedAssetId = '',
}) {
  return {
    id: nextId(),
    title: String(title ?? '').trim(),
    order,
    sourceUrl: String(sourceUrl ?? ''),
    visualAssetId: String(visualAssetId ?? ''),
    infoCardAssetId: String(infoCardAssetId ?? ''),
    selectedAssetId: String(selectedAssetId ?? ''),
  };
}

export function interpolatePrompt(prompt, entry, index) {
  return String(prompt ?? '')
    .replaceAll('{title}', String(entry?.title ?? ''))
    .replaceAll('{index}', String(Number(index) + 1));
}

function normalizeEntry(entry, index) {
  return {
    id: String(entry?.id ?? nextId()),
    title: String(entry?.title ?? '').trim(),
    order: Number.isInteger(entry?.order) ? entry.order : index,
    sourceUrl: String(entry?.sourceUrl ?? ''),
    visualAssetId: String(entry?.visualAssetId ?? ''),
    infoCardAssetId: String(entry?.infoCardAssetId ?? ''),
    selectedAssetId: String(entry?.selectedAssetId ?? ''),
  };
}

export function normalizeProjectRecord(record = {}) {
  const template = record?.questionTemplate ?? LEGACY_TEMPLATES[record?.template];

  return {
    version: 2,
    title: String(record?.title ?? ''),
    description: String(record?.description ?? ''),
    platform: record?.platform,
    questionTemplate: createQuestionTemplate(template),
    entries: (Array.isArray(record?.entries) ? record.entries : []).map(normalizeEntry),
  };
}

function issue(code, message, entryId) {
  return entryId ? { code, message, entryId } : { code, message };
}

function placeholderNames(prompt) {
  return [...String(prompt ?? '').matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function validateQuestionTemplate(template, errors, warnings) {
  if (!QUESTION_TYPES.has(template?.type)) {
    errors.push(issue('unsupported-question-type', '请选择支持的题型。'));
  }

  if (!EXPANSION_MODES.has(template?.expansion)) {
    errors.push(issue('unsupported-expansion-mode', '请选择题目展开方式。'));
  }

  const choiceTypes = new Set(['single', 'multiple', 'dropdown']);
  if (choiceTypes.has(template?.type) && (!Array.isArray(template?.options) || template.options.length < 2)) {
    errors.push(issue('too-few-options', '选择题至少需要两个选项。'));
  }

  if (
    template?.type === 'scale' &&
    (!Number.isFinite(template?.scale?.min) ||
      !Number.isFinite(template?.scale?.max) ||
      template.scale.min > template.scale.max)
  ) {
    errors.push(issue('invalid-scale-range', '量表最小值不能大于最大值。'));
  }

  const placeholders = placeholderNames(template?.prompt);
  for (const placeholder of placeholders) {
    if (placeholder !== 'title' && placeholder !== 'index') {
      errors.push(issue('unknown-placeholder', `不支持占位符 {${placeholder}}。`));
    }
  }

  if (template?.expansion === 'perAnime' && !placeholders.includes('title')) {
    warnings.push(issue('prompt-without-title', '逐部题目题干没有使用 {title}。'));
  }

  if (template?.expansion === 'allAsOptions') {
    if (!['single', 'multiple', 'dropdown'].includes(template?.type)) {
      errors.push(issue('invalid-aggregate-question-type', '聚合题目只支持选择题。'));
    }
    if (placeholders.includes('title') || placeholders.includes('index')) {
      errors.push(issue('placeholder-not-available', '聚合题目不能使用逐部动画占位符。'));
    }
  }
}

export function validateProject(project) {
  const errors = [];
  const warnings = [];
  const entries = Array.isArray(project?.entries) ? project.entries : [];

  if (entries.length === 0) {
    errors.push(issue('no-entries', '至少加入一部动画后才能生成问卷。'));
  }

  if (!String(project?.title ?? '').trim()) {
    warnings.push(issue('blank-project-title', '问卷标题为空，将使用默认标题。'));
  }

  if (!SUPPORTED_PLATFORMS.has(project?.platform)) {
    errors.push(issue('unsupported-platform', '请选择问卷星或腾讯问卷。'));
  }

  validateQuestionTemplate(project?.questionTemplate, errors, warnings);

  const seenTitles = new Map();
  let entriesWithImages = 0;

  for (const entry of entries) {
    const title = String(entry?.title ?? '').trim();

    if (!title) {
      errors.push(issue('blank-title', '有动画条目尚未填写标题。', entry?.id));
      continue;
    }

    const duplicateKey = title.toLocaleLowerCase('zh-CN');
    if (seenTitles.has(duplicateKey)) {
      warnings.push(
        issue('duplicate-title', `“${title}”出现了不止一次，请确认是否重复。`, entry?.id),
      );
    } else {
      seenTitles.set(duplicateKey, entry?.id);
    }

    if (entry?.visualAssetId || entry?.infoCardAssetId || entry?.selectedAssetId) {
      entriesWithImages += 1;
    }
  }

  if (entriesWithImages > 0 && entriesWithImages < entries.length) {
    warnings.push(
      issue('mixed-image-coverage', '部分动画没有图片，请检查图片与题目的对应关系。'),
    );
  }

  if (project?.platform === 'tencent' && project?.questionTemplate?.expansion === 'perAnime' && entries.length >= 12) {
    warnings.push(
      issue('long-tencent-form', '腾讯问卷会把每部动画展开成一道题，当前问卷会比较长。'),
    );
  }

  return { errors, warnings };
}

export function serializeProject(project) {
  return JSON.stringify(normalizeProjectRecord(project), null, 2);
}
