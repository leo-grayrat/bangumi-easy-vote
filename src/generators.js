const SUPPORTED_PLATFORMS = new Set(['wjx', 'tencent']);
const SUPPORTED_TYPES = new Set(['single', 'multiple', 'dropdown', 'scale', 'shortText', 'longText']);
const SUPPORTED_EXPANSIONS = new Set(['perAnime', 'allAsOptions']);

const TENCENT_TYPE_LABELS = {
  single: '[单选题]',
  multiple: '[多选题]',
  dropdown: '[下拉题]',
  scale: '[量表题]',
  shortText: '[单行文本题]',
  longText: '[多行文本题]',
};

export function sanitizeImportText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t\u3000 ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanInline(value, fallback = '') {
  const cleaned = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n\u00A0\u3000\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  return cleaned || fallback;
}

function cleanEntries(project) {
  const entries = (Array.isArray(project?.entries) ? project.entries : [])
    .map((entry) => ({
      id: String(entry?.id ?? ''),
      title: cleanInline(entry?.title),
      selectedAssetId: String(entry?.selectedAssetId ?? ''),
    }))
    .filter((entry) => entry.title);

  if (entries.length === 0) {
    throw new Error('至少需要一个有效的动画标题。');
  }

  return entries;
}

function cleanScale(scale) {
  return {
    min: scale?.min,
    max: scale?.max,
    minLabel: cleanInline(scale?.minLabel),
    maxLabel: cleanInline(scale?.maxLabel),
  };
}

function cleanQuestionTemplate(project) {
  const template = project?.questionTemplate;
  const type = template?.type;
  const expansion = template?.expansion;

  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`不支持的题目类型：${type ?? '未选择'}`);
  }
  if (!SUPPORTED_EXPANSIONS.has(expansion)) {
    throw new Error(`不支持的题目展开方式：${expansion ?? '未选择'}`);
  }

  return {
    expansion,
    prompt: cleanInline(template?.prompt),
    type,
    options: (Array.isArray(template?.options) ? template.options : [])
      .map((option) => cleanInline(option))
      .filter(Boolean),
    scale: cleanScale(template?.scale),
  };
}

function interpolate(prompt, entry, index) {
  return cleanInline(
    prompt.replaceAll('{title}', entry.title).replaceAll('{index}', String(index + 1)),
  );
}

export function expandQuestions(project) {
  const template = cleanQuestionTemplate(project);
  const entries = cleanEntries(project);

  if (template.expansion === 'allAsOptions') {
    return [
      {
        ordinal: 1,
        prompt: template.prompt,
        type: template.type,
        options: entries.map((entry) => entry.title),
        scale: { ...template.scale },
        animeEntryId: '',
        selectedAssetId: '',
      },
    ];
  }

  return entries.map((entry, index) => ({
    ordinal: index + 1,
    prompt: interpolate(template.prompt, entry, index),
    type: template.type,
    options: [...template.options],
    scale: { ...template.scale },
    animeEntryId: entry.id,
    selectedAssetId: entry.selectedAssetId,
  }));
}

function projectHeading(project) {
  return cleanInline(project?.title, '动画投票');
}

function projectDescription(project) {
  return cleanInline(project?.description);
}

function wjxPreamble(project) {
  const sections = [projectHeading(project)];
  const description = projectDescription(project);

  if (description) {
    sections.push(`问卷说明 [段落说明]\n${description}`);
  }

  return sections;
}

function tencentPreamble(project) {
  const sections = [projectHeading(project)];
  const description = projectDescription(project);

  if (description) {
    sections.push(description);
  }

  return sections;
}

function optionLetter(index) {
  let number = index;
  let letters = '';

  do {
    letters = String.fromCharCode(65 + (number % 26)) + letters;
    number = Math.floor(number / 26) - 1;
  } while (number >= 0);

  return letters;
}

function formatScale(question) {
  return `${question.scale.min}(${question.scale.minLabel})~${question.scale.max}(${question.scale.maxLabel})`;
}

function formatWjxScale(question) {
  return Array.from(
    { length: question.scale.max - question.scale.min + 1 },
    (_, index) => String(question.scale.min + index),
  ).join('\n');
}

function formatWjxQuestion(question) {
  if (question.type === 'dropdown' || question.type === 'longText') {
    throw new Error(`问卷星的 ${question.type} 题型尚未实测支持，暂不能生成导入文本。`);
  }

  const heading = `${question.ordinal}.${question.prompt}`;
  if (question.type === 'single') {
    return [heading, ...question.options.map((option, index) => `${optionLetter(index)}.${option}`)].join('\n');
  }
  if (question.type === 'multiple') {
    return [
      `${heading} [多选题]`,
      ...question.options.map((option, index) => `${optionLetter(index)}.${option}`),
    ].join('\n');
  }
  if (question.type === 'scale') {
    return `${heading}[量表题]\n${formatWjxScale(question)}`;
  }

  return heading;
}

function formatTencentQuestion(question) {
  const heading = `${question.prompt}${TENCENT_TYPE_LABELS[question.type]}`;

  if (question.type === 'scale') {
    return `${heading}\n${formatScale(question)}`;
  }
  if (['single', 'multiple', 'dropdown'].includes(question.type)) {
    return [heading, ...question.options].join('\n');
  }

  return heading;
}

function assertSupportedPlatform(project) {
  if (!SUPPORTED_PLATFORMS.has(project?.platform)) {
    throw new Error(`不支持的平台：${project?.platform ?? '未选择'}`);
  }
}

export function generateImportText(project) {
  assertSupportedPlatform(project);
  const questions = expandQuestions(project);
  const sections = project.platform === 'wjx' ? wjxPreamble(project) : tencentPreamble(project);
  const formatter = project.platform === 'wjx' ? formatWjxQuestion : formatTencentQuestion;

  sections.push(...questions.map(formatter));
  return sanitizeImportText(sections.join('\n\n'));
}
