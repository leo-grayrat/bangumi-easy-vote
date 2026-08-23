const SUPPORTED_PLATFORMS = new Set(['wjx', 'tencent']);
const SUPPORTED_TEMPLATES = new Set(['vote', 'score', 'status']);
const STATUS_OPTIONS = ['必追', '观望', '不追', '尚未决定'];

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

function entryTitles(project) {
  const titles = (Array.isArray(project.entries) ? project.entries : [])
    .map((entry) => cleanInline(entry?.title))
    .filter(Boolean);

  if (titles.length === 0) {
    throw new Error('至少需要一个有效的动画标题。');
  }

  return titles;
}

function projectHeading(project) {
  return cleanInline(project.title, '动画投票');
}

function wjxPreamble(project) {
  const sections = [projectHeading(project)];
  const description = cleanInline(project.description);

  if (description) {
    sections.push(`问卷说明 [段落说明]\n${description}`);
  }

  return sections;
}

function tencentPreamble(project) {
  const sections = [projectHeading(project)];
  const description = cleanInline(project.description);

  if (description) {
    sections.push(description);
  }

  return sections;
}

function generateWjx(project, titles) {
  const sections = wjxPreamble(project);

  if (project.template === 'vote') {
    sections.push(`1.本季你最期待哪一部动画？ [单选题]\n${titles.join('\n')}`);
  } else if (project.template === 'score') {
    sections.push(`1.请为以下动画评分 [矩阵题]\n1 2 3 4 5\n${titles.join('\n')}`);
  } else if (project.template === 'status') {
    sections.push(
      `1.请选择每部动画的追番状态 [矩阵题]\n${STATUS_OPTIONS.join(' ')}\n${titles.join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

function generateTencent(project, titles) {
  const sections = tencentPreamble(project);

  if (project.template === 'vote') {
    sections.push(`本季你最期待哪一部动画？ [单选题]\n${titles.join('\n')}`);
  } else if (project.template === 'score') {
    sections.push(
      ...titles.map(
        (title) => `请为《${title}》评分 [量表题]\n1(完全不感兴趣)~5(非常期待)`,
      ),
    );
  } else if (project.template === 'status') {
    sections.push(
      ...titles.map(
        (title) => `《${title}》的追番状态 [下拉题]\n${STATUS_OPTIONS.join('\n')}`,
      ),
    );
  }

  return sections.join('\n\n');
}

export function generateImportText(project) {
  if (!SUPPORTED_PLATFORMS.has(project?.platform)) {
    throw new Error(`不支持的平台：${project?.platform ?? '未选择'}`);
  }

  if (!SUPPORTED_TEMPLATES.has(project?.template)) {
    throw new Error(`不支持的题目范式：${project?.template ?? '未选择'}`);
  }

  const titles = entryTitles(project);
  const output =
    project.platform === 'wjx'
      ? generateWjx(project, titles)
      : generateTencent(project, titles);

  return sanitizeImportText(output);
}
