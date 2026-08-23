import {
  createEntry,
  deriveTitleFromFilename,
  serializeProject,
  titlesFromText,
  validateProject,
} from './model.js';
import { generateImportText } from './generators.js';

const elements = {
  addTitles: document.querySelector('#add-titles'),
  bulkTitles: document.querySelector('#bulk-titles'),
  clearEntries: document.querySelector('#clear-entries'),
  copyText: document.querySelector('#copy-text'),
  description: document.querySelector('#project-description'),
  diagnostics: document.querySelector('#diagnostics'),
  downloadProject: document.querySelector('#download-project'),
  downloadText: document.querySelector('#download-text'),
  emptyState: document.querySelector('#empty-state'),
  entryCount: document.querySelector('#entry-count'),
  entryList: document.querySelector('#entry-list'),
  generatedText: document.querySelector('#generated-text'),
  imageFiles: document.querySelector('#image-files'),
  platformInputs: [...document.querySelectorAll('input[name="platform"]')],
  questionSummary: document.querySelector('#question-summary'),
  templateInputs: [...document.querySelectorAll('input[name="template"]')],
  title: document.querySelector('#project-title'),
  undoAction: document.querySelector('#undo-action'),
  undoBar: document.querySelector('#undo-bar'),
  undoMessage: document.querySelector('#undo-message'),
};

const state = {
  title: elements.title.value,
  description: elements.description.value,
  platform: 'wjx',
  template: 'vote',
  entries: [],
  notice: null,
};

let generatedText = '';
let undoRecord = null;
let undoTimer = null;
let copyResetTimer = null;

function currentProject() {
  return {
    title: state.title,
    description: state.description,
    platform: state.platform,
    template: state.template,
    entries: state.entries,
  };
}

function releaseEntry(entry) {
  if (entry?.imageUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(entry.imageUrl);
  }
}

function releaseEntries(entries) {
  entries.forEach(releaseEntry);
}

function hideUndo({ discard = true } = {}) {
  if (undoTimer) {
    window.clearTimeout(undoTimer);
    undoTimer = null;
  }

  if (discard && undoRecord?.discard) {
    undoRecord.discard();
  }

  undoRecord = null;
  elements.undoBar.hidden = true;
}

function showUndo(message, restore, discard) {
  hideUndo();
  undoRecord = { restore, discard };
  elements.undoMessage.textContent = message;
  elements.undoBar.hidden = false;
  undoTimer = window.setTimeout(() => hideUndo(), 8000);
}

function setNotice(tone, message) {
  state.notice = { tone, message };
}

function makeDiagnostic(tone, message) {
  const item = document.createElement('div');
  item.className = `diagnostic diagnostic--${tone}`;
  item.textContent = message;
  return item;
}

function expectedQuestionCount() {
  if (state.entries.length === 0) {
    return 0;
  }

  if (state.platform === 'wjx' || state.template === 'vote') {
    return 1;
  }

  return state.entries.length;
}

function renderDiagnostics(validation) {
  elements.diagnostics.replaceChildren();

  if (state.notice) {
    elements.diagnostics.append(makeDiagnostic(state.notice.tone, state.notice.message));
  }

  validation.errors.forEach((item) => {
    elements.diagnostics.append(makeDiagnostic('error', item.message));
  });
  validation.warnings.forEach((item) => {
    elements.diagnostics.append(makeDiagnostic('warning', item.message));
  });

  elements.diagnostics.append(
    makeDiagnostic('info', '文本导入不会把本地图片上传到问卷平台。'),
  );

  if (state.entries.some((entry) => entry.imageName)) {
    elements.diagnostics.append(
      makeDiagnostic('info', '下载项目 JSON 可以保留图片文件名与题目的对应顺序。'),
    );
  }
}

function updateGeneratedOutput() {
  const project = currentProject();
  const validation = validateProject(project);
  const hasErrors = validation.errors.length > 0;

  generatedText = '';
  if (!hasErrors) {
    try {
      generatedText = generateImportText(project);
    } catch (error) {
      validation.errors.push({ code: 'generator-error', message: error.message });
    }
  }

  const blocked = validation.errors.length > 0;
  elements.generatedText.value = blocked ? '' : generatedText;
  elements.generatedText.setAttribute('aria-invalid', String(blocked));
  elements.copyText.disabled = blocked;
  elements.downloadText.disabled = blocked;
  elements.downloadProject.disabled = blocked;
  elements.clearEntries.disabled = state.entries.length === 0;

  const count = expectedQuestionCount();
  elements.questionSummary.textContent = count
    ? `预计生成 ${count} 道题；导入前仍应检查平台右侧预览。`
    : '加入动画后显示预计题目数。';

  renderDiagnostics(validation);
}

function makeEntryVisual(entry, index) {
  const visual = document.createElement('div');
  visual.className = 'entry-card__visual';

  if (entry.imageUrl) {
    const image = document.createElement('img');
    image.src = entry.imageUrl;
    image.alt = `${entry.title || '未命名动画'}的本地视觉图`;
    image.width = 300;
    image.height = 400;
    image.loading = index < 2 ? 'eager' : 'lazy';
    visual.append(image);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'entry-card__placeholder';
    placeholder.textContent = '无图';
    visual.append(placeholder);
  }

  return visual;
}

function makeEntryButton(label, disabled, onClick) {
  const button = document.createElement('button');
  button.className = 'entry-action';
  button.type = 'button';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function moveEntry(index, offset) {
  hideUndo();
  const target = index + offset;
  if (target < 0 || target >= state.entries.length) {
    return;
  }

  [state.entries[index], state.entries[target]] = [state.entries[target], state.entries[index]];
  state.notice = null;
  renderEntries();
  updateGeneratedOutput();
}

function removeEntry(index) {
  hideUndo();
  const [removed] = state.entries.splice(index, 1);
  state.notice = null;
  renderEntries();
  updateGeneratedOutput();

  showUndo(
    `已删除“${removed.title || '未命名动画'}”。`,
    () => {
      state.entries.splice(Math.min(index, state.entries.length), 0, removed);
      renderEntries();
      updateGeneratedOutput();
    },
    () => releaseEntry(removed),
  );
}

function makeEntryCard(entry, index) {
  const article = document.createElement('article');
  article.className = 'entry-card';
  article.dataset.entryId = entry.id;
  article.append(makeEntryVisual(entry, index));

  const body = document.createElement('div');
  body.className = 'entry-card__body';

  const field = document.createElement('label');
  field.className = 'field';
  const fieldLabel = document.createElement('span');
  fieldLabel.textContent = `第 ${index + 1} 部动画`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = entry.title;
  input.setAttribute('aria-invalid', String(!entry.title.trim()));
  input.addEventListener('input', () => {
    entry.title = input.value;
    input.setAttribute('aria-invalid', String(!input.value.trim()));
    state.notice = null;
    updateGeneratedOutput();
  });
  field.append(fieldLabel, input);

  const meta = document.createElement('p');
  meta.className = 'entry-card__meta';
  meta.textContent = entry.imageName ? `图片：${entry.imageName}` : '仅标题条目';

  const actions = document.createElement('div');
  actions.className = 'entry-card__actions';
  actions.append(
    makeEntryButton('上移', index === 0, () => moveEntry(index, -1)),
    makeEntryButton('下移', index === state.entries.length - 1, () => moveEntry(index, 1)),
    makeEntryButton('删除', false, () => removeEntry(index)),
  );

  body.append(field, meta, actions);
  article.append(body);
  return article;
}

function renderEntries() {
  const imageCount = state.entries.filter((entry) => entry.imageName).length;
  elements.entryCount.textContent = imageCount
    ? `${state.entries.length} 部 · ${imageCount} 张图`
    : `${state.entries.length} 部动画`;

  elements.entryList.replaceChildren();
  if (state.entries.length === 0) {
    elements.entryList.append(elements.emptyState);
    return;
  }

  state.entries.forEach((entry, index) => {
    elements.entryList.append(makeEntryCard(entry, index));
  });
}

function addTitles() {
  hideUndo();
  const titles = titlesFromText(elements.bulkTitles.value);
  if (titles.length === 0) {
    setNotice('error', '没有读到有效标题。请确保每行至少有一个可见字符。');
    updateGeneratedOutput();
    return;
  }

  state.entries.push(...titles.map((title) => createEntry({ title })));
  elements.bulkTitles.value = '';
  setNotice('info', `已加入 ${titles.length} 个标题。`);
  renderEntries();
  updateGeneratedOutput();
}

function addImages(files) {
  hideUndo();
  const imageFiles = [...files].filter((file) => file.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    setNotice('error', '没有读到图片文件。请选择 JPG、PNG、WebP 等图片。');
    updateGeneratedOutput();
    return;
  }

  const entries = imageFiles.map((file) =>
    createEntry({
      title: deriveTitleFromFilename(file.name),
      imageName: file.name,
      imageUrl: URL.createObjectURL(file),
    }),
  );
  state.entries.push(...entries);
  elements.imageFiles.value = '';
  setNotice('info', `已加入 ${entries.length} 张图片，标题来自文件名。`);
  renderEntries();
  updateGeneratedOutput();
}

function clearEntries() {
  if (state.entries.length === 0) {
    return;
  }

  hideUndo();
  const removed = state.entries;
  state.entries = [];
  state.notice = null;
  renderEntries();
  updateGeneratedOutput();

  showUndo(
    `已清空 ${removed.length} 个条目。`,
    () => {
      state.entries = removed;
      renderEntries();
      updateGeneratedOutput();
    },
    () => releaseEntries(removed),
  );
}

function safeFilename(extension) {
  const base = state.title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || '动画投票'}.${extension}`;
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyImportText() {
  if (!generatedText) {
    return;
  }

  elements.copyText.dataset.state = 'loading';
  elements.copyText.querySelector('span').textContent = '正在复制';
  try {
    await navigator.clipboard.writeText(generatedText);
    elements.copyText.dataset.state = 'success';
    elements.copyText.querySelector('span').textContent = '已复制';
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      delete elements.copyText.dataset.state;
      elements.copyText.querySelector('span').textContent = '复制导入文本';
    }, 2500);
  } catch {
    elements.copyText.dataset.state = 'error';
    elements.copyText.querySelector('span').textContent = '复制失败';
    setNotice('error', '浏览器没有允许读取剪贴板。请选中生成文本后手动复制。');
    renderDiagnostics(validateProject(currentProject()));
  }
}

elements.addTitles.addEventListener('click', addTitles);
elements.imageFiles.addEventListener('change', (event) => addImages(event.target.files));
elements.clearEntries.addEventListener('click', clearEntries);
elements.copyText.addEventListener('click', copyImportText);
elements.downloadText.addEventListener('click', () => {
  downloadBlob(generatedText, 'text/plain;charset=utf-8', safeFilename('txt'));
});
elements.downloadProject.addEventListener('click', () => {
  downloadBlob(
    serializeProject(currentProject()),
    'application/json;charset=utf-8',
    safeFilename('json'),
  );
});

elements.title.addEventListener('input', (event) => {
  state.title = event.target.value;
  state.notice = null;
  updateGeneratedOutput();
});
elements.description.addEventListener('input', (event) => {
  state.description = event.target.value;
  state.notice = null;
  updateGeneratedOutput();
});

elements.platformInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      state.platform = input.value;
      state.notice = null;
      updateGeneratedOutput();
    }
  });
});

elements.templateInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      state.template = input.value;
      state.notice = null;
      updateGeneratedOutput();
    }
  });
});

elements.undoAction.addEventListener('click', () => {
  if (!undoRecord) {
    return;
  }

  const restore = undoRecord.restore;
  hideUndo({ discard: false });
  restore();
});

window.addEventListener('beforeunload', () => {
  releaseEntries(state.entries);
  hideUndo();
});

renderEntries();
updateGeneratedOutput();
