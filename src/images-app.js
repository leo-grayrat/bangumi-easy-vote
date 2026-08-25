import { applyMatchedTitle, assignImageAsset } from './model.js';
import { createProjectChannel, openProjectStore } from './project-store.js';
import { readYucImportEvents } from './yuc-import.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const YUC_SOURCE_KEY = 'bangumi-easy-vote:yuc-source-url';
const SLOT_LABELS = {
  visual: '视觉图',
  infoCard: '资料卡',
};

const elements = {
  entryCount: document.querySelector('#image-entry-count'),
  entryList: document.querySelector('#image-entry-list'),
  fetchYucImages: document.querySelector('#fetch-yuc-images'),
  loadError: document.querySelector('#load-error'),
  projectName: document.querySelector('#project-name'),
  saveStatus: document.querySelector('#save-status'),
  workspace: document.querySelector('#image-workspace'),
  yucFetchProgress: document.querySelector('#yuc-fetch-progress'),
  yucFetchSummary: document.querySelector('#yuc-fetch-summary'),
  yucSourceUrl: document.querySelector('#yuc-source-url'),
};

let projectStore;
let project;
let projectChannel;
const previewUrls = new Set();
const importStatuses = new Map();

function showImportStatus(entryId, status) {
  importStatuses.set(entryId, status);
  const card = elements.entryList.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
  const statusLine = card?.querySelector('.image-entry-card__status');
  if (!statusLine) return;
  statusLine.className = `image-entry-card__status image-entry-card__status--${status.type}`;
  statusLine.textContent = status.message;
  statusLine.hidden = false;
}

function recentProjectId() {
  try {
    return localStorage.getItem(RECENT_PROJECT_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function updateProjectLinks(projectId) {
  document.querySelectorAll('[data-project-link]').forEach((link) => {
    const target = new URL(link.dataset.projectLink, window.location.href);
    target.searchParams.set('project', projectId);
    link.href = target.href;
  });
}

function setStatus(message) {
  elements.saveStatus.textContent = message;
}

function clearPreviewUrls() {
  for (const url of previewUrls) {
    URL.revokeObjectURL(url);
  }
  previewUrls.clear();
}

async function persistProject() {
  setStatus('正在保存');
  await projectStore.saveProject(project);
  setStatus('已保存');
}

async function saveEntryTitle(entry, input) {
  const title = input.value.trim();
  entry.title = title;
  input.value = title;
  importStatuses.delete(entry.id);
  await persistProject();
  projectChannel?.post('project-saved');
  showImportStatus(entry.id, {
    type: title ? 'success' : 'error',
    message: title ? '名称已保存；获取成功后会自动补全为 YUC 完整标题' : '名称不能为空',
  });
}

function syncEntryTitlesFromInputs() {
  elements.entryList.querySelectorAll('.image-entry-card').forEach((card) => {
    const entry = project.entries.find((candidate) => candidate.id === card.dataset.entryId);
    const input = card.querySelector('.image-entry-title-input');
    if (!entry || !input) return;
    entry.title = input.value.trim();
    input.value = entry.title;
  });
}

function setEntryTitleInputsDisabled(disabled) {
  elements.entryList.querySelectorAll('.image-entry-title-input').forEach((input) => {
    input.disabled = disabled;
  });
}

async function storeImageAsset(entry, kind, { blob, filename, mimeType }) {
  const oldAssetId = kind === 'visual' ? entry.visualAssetId : entry.infoCardAssetId;
  const assetId = await projectStore.saveAsset({
    animeEntryId: entry.id,
    kind,
    filename,
    mimeType,
    blob,
  });
  assignImageAsset(entry, kind, assetId);
  return { assetId, oldAssetId };
}

async function selectAsset(entry, kind) {
  const assetId = kind === 'visual' ? entry.visualAssetId : entry.infoCardAssetId;
  if (!assetId || entry.selectedAssetId === assetId) {
    return;
  }

  assignImageAsset(entry, kind, assetId, { select: true });
  await persistProject();
  projectChannel?.post('project-saved');
  await renderEntries();
}

async function saveImage(entry, kind, file) {
  if (!file?.type?.startsWith('image/')) {
    setStatus('请选择图片文件');
    return;
  }

  setStatus('正在保存图片');
  const { assetId, oldAssetId } = await storeImageAsset(entry, kind, {
    blob: file,
    filename: file.name,
    mimeType: file.type,
  });
  await projectStore.saveProject(project);

  if (oldAssetId && oldAssetId !== assetId) {
    await projectStore.deleteAsset(oldAssetId);
  }

  projectChannel?.post({ type: 'asset-saved', assetId });
  setStatus('已保存');
  await renderEntries();
}

async function fetchImageFile(asset) {
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`图片读取失败：HTTP ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('服务器返回的不是图片。');
  }
  return { blob, filename: asset.filename, mimeType: blob.type };
}

async function importYucImages() {
  const sourceUrl = elements.yucSourceUrl.value.trim();
  if (!sourceUrl || project.entries.length === 0) {
    elements.yucFetchSummary.textContent = project.entries.length === 0
      ? '请先在题目页加入动画。'
      : '请填写 YUC 季度页面地址。';
    return;
  }

  syncEntryTitlesFromInputs();
  await projectStore.saveProject(project);
  projectChannel?.post('project-saved');
  elements.fetchYucImages.disabled = true;
  elements.yucSourceUrl.disabled = true;
  setEntryTitleInputsDisabled(true);
  elements.yucFetchProgress.hidden = false;
  elements.yucFetchProgress.max = project.entries.length;
  elements.yucFetchProgress.value = 0;
  elements.yucFetchSummary.textContent = '正在匹配并生成图片，请稍候……';
  setStatus('正在获取 YUC 图片');
  importStatuses.clear();

  try {
    localStorage.setItem(YUC_SOURCE_KEY, sourceUrl);
    const response = await fetch('/api/yuc/import-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUrl,
        entries: project.entries.map((entry) => ({ entryId: entry.id, title: entry.title })),
      }),
    });
    const entriesById = new Map(project.entries.map((entry) => [entry.id, entry]));
    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    let completeResult;

    await readYucImportEvents(response, async (event) => {
      if (event.type === 'catalog') {
        elements.yucFetchSummary.textContent = `已读取 YUC 的 ${event.catalogSize} 部动画，其中 ${event.matchedCount} 部标题匹配；正在准备导出。`;
        return;
      }
      if (event.type === 'entry-start') {
        elements.yucFetchProgress.value = Math.max(0, event.index - 1);
        elements.yucFetchSummary.textContent = `正在处理 ${event.index}/${event.total}：《${event.title}》`;
        showImportStatus(event.entryId, {
          type: event.matchedTitle ? 'warning' : 'error',
          message: event.matchedTitle
            ? `已匹配“${event.matchedTitle}”，正在生成视觉图和资料卡……`
            : `第 ${event.index}/${event.total} 部：没有找到唯一匹配，请换用更有区分度的名称`,
        });
        return;
      }
      if (event.type === 'entry-result') {
        elements.yucFetchProgress.value = event.index;
        const result = event.result;
        const entry = entriesById.get(result.entryId);
        if (!entry) return;

        if (result.status === 'not-found') {
          notFoundCount += 1;
          showImportStatus(entry.id, { type: 'warning', message: '没有找到唯一匹配，已跳过' });
        } else if (result.status !== 'ok') {
          errorCount += 1;
          showImportStatus(entry.id, { type: 'error', message: result.message || '图片生成失败' });
        } else {
          const titleChanged = applyMatchedTitle(entry, result.matchedTitle);
          const titleInput = elements.entryList.querySelector(
            `[data-entry-id="${CSS.escape(entry.id)}"] .image-entry-title-input`,
          );
          if (titleInput) titleInput.value = entry.title;
          try {
            const [visual, infoCard] = await Promise.all([
              fetchImageFile(result.visual),
              fetchImageFile(result.infoCard),
            ]);
            const visualSaved = await storeImageAsset(entry, 'visual', visual);
            const cardSaved = await storeImageAsset(entry, 'infoCard', infoCard);
            await projectStore.saveProject(project);
            for (const assetId of [visualSaved.oldAssetId, cardSaved.oldAssetId].filter(Boolean)) {
              await projectStore.deleteAsset(assetId);
            }
            successCount += 1;
            showImportStatus(entry.id, {
              type: 'success',
              message: titleChanged
                ? `已补全为“${entry.title}”并保存两张图片（${successCount} 部成功）`
                : `已保存两张图片（${successCount} 部成功）`,
            });
          } catch (error) {
            if (titleChanged) {
              await projectStore.saveProject(project);
              projectChannel?.post('project-saved');
            }
            errorCount += 1;
            showImportStatus(entry.id, { type: 'error', message: `保存失败：${error.message}` });
          }
        }
        elements.yucFetchSummary.textContent = `已处理 ${event.index}/${event.total}：成功 ${successCount}，未匹配 ${notFoundCount}，失败 ${errorCount}`;
        return;
      }
      if (event.type === 'complete') {
        elements.yucFetchProgress.value = project.entries.length;
        completeResult = event.result;
        return;
      }
      if (event.type === 'error') {
        throw new Error(event.message || '导出过程中断。');
      }
    });

    if (!completeResult) throw new Error('导出连接提前结束。');
    projectChannel?.post('project-saved');
    elements.yucFetchSummary.textContent = `完成：成功 ${successCount} 部，未匹配 ${notFoundCount} 部，失败 ${errorCount} 部。原图已保存到 exports/${completeResult.season}/。`;
    setStatus('已保存');
    await renderEntries();
  } catch (error) {
    elements.yucFetchSummary.textContent = `无法获取：${error.message}`;
    setStatus('获取失败');
  } finally {
    elements.fetchYucImages.disabled = false;
    elements.yucSourceUrl.disabled = false;
    setEntryTitleInputsDisabled(false);
  }
}

function makeUploadControl(entry, kind) {
  const label = document.createElement('label');
  label.className = 'bgm-button bgm-button--secondary image-upload-button';
  label.textContent = '选择图片';

  const input = document.createElement('input');
  input.className = 'image-file-input';
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => void saveImage(entry, kind, input.files?.[0]));
  label.append(input);
  return label;
}

async function makeImageSlot(entry, kind) {
  const assetId = kind === 'visual' ? entry.visualAssetId : entry.infoCardAssetId;
  const slot = document.createElement('section');
  slot.className = 'image-slot';
  slot.dataset.kind = kind;

  const heading = document.createElement('div');
  heading.className = 'image-slot__heading';
  const title = document.createElement('h3');
  title.textContent = SLOT_LABELS[kind];
  heading.append(title);

  const preview = document.createElement('div');
  preview.className = `image-slot__preview image-slot__preview--${kind}`;

  if (assetId) {
    const asset = await projectStore.loadAsset(assetId);
    if (asset?.blob) {
      const url = URL.createObjectURL(asset.blob);
      previewUrls.add(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${entry.title}的${SLOT_LABELS[kind]}`;
      preview.append(image);
    } else {
      preview.textContent = '图片记录已丢失，请重新选择';
    }
  } else {
    preview.textContent = kind === 'visual' ? '放入竖版视觉图' : '放入横版资料卡';
  }

  const actions = document.createElement('div');
  actions.className = 'image-slot__actions';
  actions.append(makeUploadControl(entry, kind));

  if (assetId) {
    const selected = entry.selectedAssetId === assetId;
    const useButton = document.createElement('button');
    useButton.className = selected
      ? 'bgm-button bgm-button--primary'
      : 'bgm-button bgm-button--secondary bgm-button--color-blue';
    useButton.type = 'button';
    useButton.disabled = selected;
    useButton.textContent = selected ? '问卷使用中' : '设为问卷图片';
    useButton.addEventListener('click', () => void selectAsset(entry, kind));
    actions.append(useButton);
  }

  slot.addEventListener('dragover', (event) => {
    event.preventDefault();
    slot.classList.add('image-slot--dragging');
  });
  slot.addEventListener('dragleave', () => slot.classList.remove('image-slot--dragging'));
  slot.addEventListener('drop', (event) => {
    event.preventDefault();
    slot.classList.remove('image-slot--dragging');
    void saveImage(entry, kind, event.dataTransfer?.files?.[0]);
  });

  slot.append(heading, preview, actions);
  return slot;
}

async function makeEntryCard(entry, index) {
  const card = document.createElement('article');
  card.className = 'image-entry-card';
  card.dataset.entryId = entry.id;

  const title = document.createElement('div');
  title.className = 'image-entry-card__title';
  const number = document.createElement('span');
  number.className = 'image-entry-card__index';
  number.textContent = `${index + 1}.`;
  const titleWrapper = document.createElement('label');
  titleWrapper.className = 'bgm-input__wrapper bgm-input__wrapper--rounded';
  const titleInput = document.createElement('input');
  titleInput.className = 'bgm-input image-entry-title-input';
  titleInput.type = 'text';
  titleInput.value = entry.title;
  titleInput.setAttribute('aria-label', `第 ${index + 1} 部动画的匹配和问卷名称`);
  titleInput.addEventListener('input', () => {
    entry.title = titleInput.value;
    importStatuses.delete(entry.id);
    setStatus('尚未保存');
  });
  titleInput.addEventListener('change', () => void saveEntryTitle(entry, titleInput));
  titleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') titleInput.blur();
    if (event.key === 'Escape') {
      titleInput.value = entry.title;
      titleInput.blur();
    }
  });
  titleWrapper.append(titleInput);
  title.append(number, titleWrapper);

  const status = importStatuses.get(entry.id);
  const statusLine = document.createElement('p');
  statusLine.className = `image-entry-card__status${status ? ` image-entry-card__status--${status.type}` : ''}`;
  statusLine.textContent = status?.message || '';
  statusLine.hidden = !status;

  const slots = document.createElement('div');
  slots.className = 'image-slot-grid';
  slots.append(
    await makeImageSlot(entry, 'visual'),
    await makeImageSlot(entry, 'infoCard'),
  );
  card.append(title, statusLine, slots);
  return card;
}

async function renderEntries() {
  clearPreviewUrls();
  elements.entryList.replaceChildren();
  elements.projectName.textContent = project.title || '未命名问卷';
  elements.entryCount.textContent = `${project.entries.length} 部`;

  if (project.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'entry-empty';
    empty.textContent = '还没有动画。请先回到“题目”页加入标题。';
    elements.entryList.append(empty);
    return;
  }

  for (const [index, entry] of project.entries.entries()) {
    elements.entryList.append(await makeEntryCard(entry, index));
  }
}

async function initialize() {
  try {
    projectStore = await openProjectStore();
    const requestedId = new URLSearchParams(window.location.search).get('project')?.trim() || '';
    const projectId = requestedId || recentProjectId();
    project = projectId ? await projectStore.loadProject(projectId) : null;

    if (!project) {
      throw new Error('没有找到当前项目，请先从题目页进入。');
    }

    updateProjectLinks(project.id);
    elements.yucSourceUrl.value = localStorage.getItem(YUC_SOURCE_KEY) || elements.yucSourceUrl.value;
    elements.fetchYucImages.addEventListener('click', () => void importYucImages());
    projectChannel = createProjectChannel(project.id);
    await renderEntries();
    elements.workspace.hidden = false;
    setStatus('已保存');
  } catch (error) {
    elements.loadError.textContent = `无法打开图片页：${error.message}`;
    elements.loadError.hidden = false;
    setStatus('载入失败');
  }
}

window.addEventListener('beforeunload', () => {
  clearPreviewUrls();
  projectChannel?.close();
});

void initialize();
