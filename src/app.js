import {
  createEntry,
  createQuestionTemplate,
  titlesFromText,
  validateProject,
} from './model.js';
import { expandQuestions, generateImportText } from './generators.js';
import { openProjectStore } from './project-store.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const SAVE_DELAY_MS = 250;

const elements = {
  addTitles: document.querySelector('#add-titles'),
  bulkTitles: document.querySelector('#bulk-titles'),
  clearEntries: document.querySelector('#clear-entries'),
  copyText: document.querySelector('#copy-text'),
  downloadText: document.querySelector('#download-text'),
  editorWorkspace: document.querySelector('#editor-workspace'),
  entriesMessage: document.querySelector('#entries-message'),
  entryCount: document.querySelector('#entry-count'),
  entryList: document.querySelector('#entry-list'),
  expansion: document.querySelector('#expansion-mode'),
  expansionLabel: document.querySelector('#expansion-label'),
  expansionMessage: document.querySelector('#expansion-message'),
  generatedText: document.querySelector('#generated-text'),
  loadError: document.querySelector('#load-error'),
  options: document.querySelector('#question-options'),
  optionsField: document.querySelector('#question-options-field'),
  optionsMessage: document.querySelector('#question-options-message'),
  outputMessage: document.querySelector('#output-message'),
  platform: document.querySelector('#platform'),
  platformLabel: document.querySelector('#platform-label'),
  platformMessage: document.querySelector('#platform-message'),
  preview: document.querySelector('#question-preview'),
  projectDescription: document.querySelector('#project-description'),
  projectDescriptionMessage: document.querySelector('#project-description-message'),
  projectTitle: document.querySelector('#project-title'),
  projectTitleMessage: document.querySelector('#project-title-message'),
  prompt: document.querySelector('#question-prompt'),
  promptMessage: document.querySelector('#question-prompt-message'),
  questionCount: document.querySelector('#question-count'),
  questionType: document.querySelector('#question-type'),
  questionTypeLabel: document.querySelector('#question-type-label'),
  questionTypeMessage: document.querySelector('#question-type-message'),
  saveStatus: document.querySelector('#save-status'),
  scaleFields: document.querySelector('#scale-fields'),
  scaleMax: document.querySelector('#scale-max'),
  scaleMaxLabel: document.querySelector('#scale-max-label'),
  scaleMessage: document.querySelector('#scale-message'),
  scaleMin: document.querySelector('#scale-min'),
  scaleMinLabel: document.querySelector('#scale-min-label'),
};

const messageElements = {
  entries: elements.entriesMessage,
  expansion: elements.expansionMessage,
  options: elements.optionsMessage,
  output: elements.outputMessage,
  platform: elements.platformMessage,
  prompt: elements.promptMessage,
  scale: elements.scaleMessage,
  title: elements.projectTitleMessage,
  type: elements.questionTypeMessage,
};

let projectStore;
let state;
let generatedText = '';
let saveTimer = null;
let editRevision = 0;
let copyResetTimer = null;
let entryActionError = '';

function createProjectId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `project-${Date.now().toString(36)}`;
}

function createFreshProject(id) {
  return {
    id,
    version: 2,
    title: '动画投票',
    description: '',
    platform: 'wjx',
    questionTemplate: createQuestionTemplate(),
    entries: [],
  };
}

function recentProjectId() {
  try {
    return localStorage.getItem(RECENT_PROJECT_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function rememberProjectId(id) {
  try {
    localStorage.setItem(RECENT_PROJECT_KEY, id);
  } catch {
    // IndexedDB remains the source of truth when localStorage is unavailable.
  }
}

function ensureProjectInUrl(id) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('project') !== id) {
    url.searchParams.set('project', id);
    window.history.replaceState(null, '', url);
  }
}

function selectedLabel(select) {
  return select.selectedOptions[0]?.textContent ?? '';
}

function optionsFromText(text) {
  return titlesFromText(text);
}

function syncEntryOrder() {
  state.entries.forEach((entry, index) => {
    entry.order = index;
  });
}

function setSaveStatus(message) {
  elements.saveStatus.textContent = message;
}

async function persistProject(revision) {
  setSaveStatus('正在保存');
  try {
    await projectStore.saveProject(state);
    rememberProjectId(state.id);
    setSaveStatus(revision === editRevision ? '已保存' : '有未保存更改');
  } catch (error) {
    setSaveStatus(`保存失败：${error.message}`);
  }
}

function scheduleSave() {
  editRevision += 1;
  const revision = editRevision;
  setSaveStatus('有未保存更改');
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistProject(revision);
  }, SAVE_DELAY_MS);
}

function flushPendingSave() {
  if (!saveTimer) {
    return;
  }

  window.clearTimeout(saveTimer);
  saveTimer = null;
  void persistProject(editRevision);
}

function issueTarget(issue) {
  switch (issue.code) {
    case 'blank-project-title':
      return 'title';
    case 'unsupported-platform':
      return 'platform';
    case 'unsupported-expansion-mode':
      return 'expansion';
    case 'unsupported-question-type':
    case 'invalid-aggregate-question-type':
      return 'type';
    case 'too-few-options':
      return 'options';
    case 'invalid-scale-range':
      return 'scale';
    case 'invalid-placeholder-syntax':
    case 'unknown-placeholder':
    case 'placeholder-not-available':
    case 'prompt-without-title':
      return 'prompt';
    case 'no-entries':
    case 'blank-title':
    case 'duplicate-title':
    case 'mixed-image-coverage':
      return 'entries';
    default:
      return 'output';
  }
}

function setFieldMessage(element, errors, warnings) {
  const messages = errors.length > 0 ? errors : warnings;
  element.textContent = messages.join('\n');
  element.classList.toggle('field-message--warning', errors.length === 0 && warnings.length > 0);
}

function resetInvalidState() {
  const controls = [
    elements.projectTitle,
    elements.platform,
    elements.expansion,
    elements.questionType,
    elements.prompt,
    elements.options,
    elements.scaleMin,
    elements.scaleMax,
    elements.scaleMinLabel,
    elements.scaleMaxLabel,
    ...elements.entryList.querySelectorAll('.entry-row .bgm-input'),
  ];
  controls.forEach((control) => control.setAttribute('aria-invalid', 'false'));
}

function markTargetInvalid(target, issue) {
  const controlsByTarget = {
    entries: issue.entryId
      ? [elements.entryList.querySelector(`[data-entry-id="${CSS.escape(issue.entryId)}"] .bgm-input`)]
      : [...elements.entryList.querySelectorAll('.entry-row .bgm-input')],
    expansion: [elements.expansion],
    options: [elements.options],
    platform: [elements.platform],
    prompt: [elements.prompt],
    scale: [elements.scaleMin, elements.scaleMax, elements.scaleMinLabel, elements.scaleMaxLabel],
    title: [elements.projectTitle],
    type: [elements.questionType],
  };

  (controlsByTarget[target] ?? []).filter(Boolean).forEach((control) => {
    control.setAttribute('aria-invalid', 'true');
  });
}

function renderValidation(validation, generatorError) {
  const grouped = new Map(
    Object.keys(messageElements).map((key) => [key, { errors: [], warnings: [] }]),
  );

  resetInvalidState();
  validation.errors.forEach((issue) => {
    const target = issueTarget(issue);
    grouped.get(target).errors.push(issue.message);
    markTargetInvalid(target, issue);
  });
  validation.warnings.forEach((issue) => {
    grouped.get(issueTarget(issue)).warnings.push(issue.message);
  });

  if (entryActionError) {
    grouped.get('entries').errors.unshift(entryActionError);
  }
  if (generatorError) {
    grouped.get('output').errors.push(generatorError);
  }

  for (const [target, messages] of grouped) {
    setFieldMessage(messageElements[target], messages.errors, messages.warnings);
  }
}

function questionTypeName(type) {
  const names = {
    dropdown: '下拉题',
    longText: '多行文本题',
    multiple: '多选题',
    scale: '量表题',
    shortText: '单行文本题',
    single: '单选题',
  };
  return names[type] ?? type;
}

function questionMeta(question) {
  if (question.type === 'scale') {
    return `${questionTypeName(question.type)} · ${question.scale.min}–${question.scale.max}`;
  }
  if (['single', 'multiple', 'dropdown'].includes(question.type)) {
    return `${questionTypeName(question.type)} · ${question.options.length} 个选项`;
  }
  return questionTypeName(question.type);
}

function renderQuestionPreview(questions) {
  elements.preview.replaceChildren();
  for (const question of questions) {
    const item = document.createElement('li');
    item.className = 'question-preview__item';

    const prompt = document.createElement('p');
    prompt.textContent = question.prompt;
    const meta = document.createElement('p');
    meta.className = 'question-preview__meta';
    meta.textContent = questionMeta(question);

    item.append(prompt, meta);
    elements.preview.append(item);
  }
  elements.questionCount.textContent = `${questions.length} 道题`;
}

function renderOutput() {
  const validation = validateProject(state);
  let questions = [];
  let nextText = '';
  let generatorError = '';

  if (validation.errors.length === 0) {
    try {
      questions = expandQuestions(state);
      nextText = generateImportText(state);
    } catch (error) {
      generatorError = error.message;
    }
  }

  generatedText = generatorError ? '' : nextText;
  elements.generatedText.value = generatedText;
  const blocked = validation.errors.length > 0 || Boolean(generatorError) || !generatedText;
  elements.generatedText.setAttribute('aria-invalid', String(blocked));
  elements.copyText.disabled = blocked;
  elements.downloadText.disabled = blocked;
  renderQuestionPreview(questions);
  renderValidation(validation, generatorError);
}

function makeEntryButton(label, disabled, onClick) {
  const button = document.createElement('button');
  button.className = 'bgm-button bgm-button--secondary';
  button.type = 'button';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function moveEntry(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= state.entries.length) {
    return;
  }

  [state.entries[index], state.entries[target]] = [state.entries[target], state.entries[index]];
  syncEntryOrder();
  entryActionError = '';
  renderEntries();
  renderOutput();
  scheduleSave();
}

function removeEntry(index) {
  state.entries.splice(index, 1);
  syncEntryOrder();
  entryActionError = '';
  renderEntries();
  renderOutput();
  scheduleSave();
}

function makeEntryRow(entry, index) {
  const row = document.createElement('article');
  row.className = 'entry-row';
  row.dataset.entryId = entry.id;

  const title = document.createElement('div');
  title.className = 'entry-row__title';
  const number = document.createElement('span');
  number.className = 'entry-row__index';
  number.textContent = `${index + 1}.`;

  const wrapper = document.createElement('span');
  wrapper.className = 'bgm-input__wrapper bgm-input__wrapper--rounded';
  const input = document.createElement('input');
  input.className = 'bgm-input';
  input.type = 'text';
  input.value = entry.title;
  input.setAttribute('aria-label', `第 ${index + 1} 部动画标题`);
  input.addEventListener('input', (event) => {
    entry.title = event.currentTarget.value;
    entryActionError = '';
    renderOutput();
    scheduleSave();
  });
  wrapper.append(input);
  title.append(number, wrapper);

  const actions = document.createElement('div');
  actions.className = 'entry-row__actions';
  actions.append(
    makeEntryButton('上移', index === 0, () => moveEntry(index, -1)),
    makeEntryButton('下移', index === state.entries.length - 1, () => moveEntry(index, 1)),
    makeEntryButton('删除', false, () => removeEntry(index)),
  );

  row.append(title, actions);
  return row;
}

function renderEntries() {
  elements.entryList.replaceChildren();
  elements.entryCount.textContent = `${state.entries.length} 部`;
  elements.clearEntries.disabled = state.entries.length === 0;

  if (state.entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'entry-empty';
    empty.textContent = '尚未加入动画标题。';
    elements.entryList.append(empty);
    return;
  }

  state.entries.forEach((entry, index) => {
    elements.entryList.append(makeEntryRow(entry, index));
  });
}

function renderRelevantTemplateFields() {
  const type = state.questionTemplate.type;
  const isChoice = ['single', 'multiple', 'dropdown'].includes(type);
  elements.optionsField.hidden = !isChoice || state.questionTemplate.expansion === 'allAsOptions';
  elements.scaleFields.hidden = type !== 'scale';
  elements.expansionLabel.textContent = selectedLabel(elements.expansion);
  elements.questionTypeLabel.textContent = selectedLabel(elements.questionType);
  elements.platformLabel.textContent = selectedLabel(elements.platform);
}

function renderProject() {
  elements.projectTitle.value = state.title;
  elements.projectDescription.value = state.description;
  elements.platform.value = state.platform;
  elements.expansion.value = state.questionTemplate.expansion;
  elements.questionType.value = state.questionTemplate.type;
  elements.prompt.value = state.questionTemplate.prompt;
  elements.options.value = state.questionTemplate.options.join('\n');
  elements.scaleMin.value = state.questionTemplate.scale.min;
  elements.scaleMax.value = state.questionTemplate.scale.max;
  elements.scaleMinLabel.value = state.questionTemplate.scale.minLabel;
  elements.scaleMaxLabel.value = state.questionTemplate.scale.maxLabel;

  renderRelevantTemplateFields();
  renderEntries();
  renderOutput();
}

function addTitles() {
  const titles = titlesFromText(elements.bulkTitles.value);
  if (titles.length === 0) {
    entryActionError = '没有读到有效标题，请每行填写一部动画。';
    renderOutput();
    return;
  }

  const startOrder = state.entries.length;
  state.entries.push(
    ...titles.map((title, index) => createEntry({ title, order: startOrder + index })),
  );
  elements.bulkTitles.value = '';
  entryActionError = '';
  renderEntries();
  renderOutput();
  scheduleSave();
}

function clearEntries() {
  if (state.entries.length === 0) {
    return;
  }

  state.entries = [];
  entryActionError = '';
  renderEntries();
  renderOutput();
  scheduleSave();
}

function safeFilename() {
  const base = state.title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || '动画投票'}.txt`;
}

function downloadText() {
  if (!generatedText) {
    return;
  }

  const url = URL.createObjectURL(new Blob([generatedText], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename();
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText() {
  if (!generatedText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(generatedText);
    elements.copyText.textContent = '已复制';
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      elements.copyText.textContent = '复制文本';
    }, 2000);
  } catch {
    elements.outputMessage.textContent = '复制失败，请选中生成文本后手动复制。';
    elements.outputMessage.classList.remove('field-message--warning');
  }
}

function updateProject(mutator, { renderRelevant = false } = {}) {
  mutator();
  entryActionError = '';
  if (renderRelevant) {
    renderRelevantTemplateFields();
  }
  renderOutput();
  scheduleSave();
}

function bindEvents() {
  elements.addTitles.addEventListener('click', addTitles);
  elements.clearEntries.addEventListener('click', clearEntries);
  elements.copyText.addEventListener('click', () => void copyText());
  elements.downloadText.addEventListener('click', downloadText);

  elements.projectTitle.addEventListener('input', (event) => {
    updateProject(() => {
      state.title = event.currentTarget.value;
    });
  });
  elements.projectDescription.addEventListener('input', (event) => {
    updateProject(() => {
      state.description = event.currentTarget.value;
    });
  });
  elements.platform.addEventListener('change', (event) => {
    updateProject(
      () => {
        state.platform = event.currentTarget.value;
      },
      { renderRelevant: true },
    );
  });
  elements.expansion.addEventListener('change', (event) => {
    updateProject(
      () => {
        state.questionTemplate.expansion = event.currentTarget.value;
      },
      { renderRelevant: true },
    );
  });
  elements.questionType.addEventListener('change', (event) => {
    updateProject(
      () => {
        state.questionTemplate.type = event.currentTarget.value;
      },
      { renderRelevant: true },
    );
  });
  elements.prompt.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.prompt = event.currentTarget.value;
    });
  });
  elements.options.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.options = optionsFromText(event.currentTarget.value);
    });
  });
  elements.scaleMin.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.scale.min = Number.parseFloat(event.currentTarget.value);
    });
  });
  elements.scaleMax.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.scale.max = Number.parseFloat(event.currentTarget.value);
    });
  });
  elements.scaleMinLabel.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.scale.minLabel = event.currentTarget.value;
    });
  });
  elements.scaleMaxLabel.addEventListener('input', (event) => {
    updateProject(() => {
      state.questionTemplate.scale.maxLabel = event.currentTarget.value;
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingSave();
    }
  });
  window.addEventListener('beforeunload', flushPendingSave);
}

async function initialize() {
  try {
    projectStore = await openProjectStore();
    const requestedId = new URLSearchParams(window.location.search).get('project')?.trim() || '';
    const candidateId = requestedId || recentProjectId();
    const storedProject = candidateId ? await projectStore.loadProject(candidateId) : null;
    state = storedProject ?? createFreshProject(candidateId || createProjectId());

    ensureProjectInUrl(state.id);
    rememberProjectId(state.id);
    if (!storedProject) {
      await projectStore.saveProject(state);
    }

    renderProject();
    bindEvents();
    elements.editorWorkspace.hidden = false;
    setSaveStatus('已保存');
  } catch (error) {
    elements.loadError.textContent = `无法打开本地项目：${error.message}`;
    elements.loadError.hidden = false;
    setSaveStatus('载入失败');
  }
}

void initialize();
