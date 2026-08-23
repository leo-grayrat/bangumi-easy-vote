let fallbackId = 0;

const SUPPORTED_PLATFORMS = new Set(['wjx', 'tencent']);
const SUPPORTED_TEMPLATES = new Set(['vote', 'score', 'status']);

function nextId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  fallbackId += 1;
  return `anime-${fallbackId}`;
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

export function createEntry({ title, imageName = '', imageUrl = '' }) {
  return {
    id: nextId(),
    title: String(title ?? '').trim(),
    imageName: String(imageName ?? ''),
    imageUrl: String(imageUrl ?? ''),
  };
}

function issue(code, message, entryId) {
  return entryId ? { code, message, entryId } : { code, message };
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

  if (!SUPPORTED_TEMPLATES.has(project?.template)) {
    errors.push(issue('unsupported-template', '请选择一种题目范式。'));
  }

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

    if (entry?.imageName || entry?.imageUrl) {
      entriesWithImages += 1;
    }
  }

  if (entriesWithImages > 0 && entriesWithImages < entries.length) {
    warnings.push(
      issue('mixed-image-coverage', '部分动画没有图片，请检查图片与题目的对应关系。'),
    );
  }

  if (project?.platform === 'tencent' && project?.template !== 'vote' && entries.length >= 12) {
    warnings.push(
      issue('long-tencent-form', '腾讯问卷会把每部动画展开成一道题，当前问卷会比较长。'),
    );
  }

  return { errors, warnings };
}

export function serializeProject(project) {
  const entries = (Array.isArray(project?.entries) ? project.entries : []).map(
    ({ imageUrl: _temporaryImageUrl, ...entry }) => ({ ...entry }),
  );

  return JSON.stringify(
    {
      version: 1,
      title: String(project?.title ?? ''),
      description: String(project?.description ?? ''),
      platform: project?.platform,
      template: project?.template,
      entries,
    },
    null,
    2,
  );
}
