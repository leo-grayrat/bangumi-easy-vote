import { assignImageAsset } from './model.js';
import { createProjectChannel, openProjectStore } from './project-store.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const SLOT_LABELS = {
  visual: '视觉图',
  infoCard: '资料卡',
};

const elements = {
  entryCount: document.querySelector('#image-entry-count'),
  entryList: document.querySelector('#image-entry-list'),
  loadError: document.querySelector('#load-error'),
  projectName: document.querySelector('#project-name'),
  saveStatus: document.querySelector('#save-status'),
  workspace: document.querySelector('#image-workspace'),
};

let projectStore;
let project;
let projectChannel;
const previewUrls = new Set();

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

  const oldAssetId = kind === 'visual' ? entry.visualAssetId : entry.infoCardAssetId;
  setStatus('正在保存图片');
  const assetId = await projectStore.saveAsset({
    animeEntryId: entry.id,
    kind,
    filename: file.name,
    mimeType: file.type,
    blob: file,
  });
  assignImageAsset(entry, kind, assetId);
  await projectStore.saveProject(project);

  if (oldAssetId && oldAssetId !== assetId) {
    await projectStore.deleteAsset(oldAssetId);
  }

  projectChannel?.post({ type: 'asset-saved', assetId });
  setStatus('已保存');
  await renderEntries();
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

  const title = document.createElement('h2');
  title.className = 'image-entry-card__title';
  title.textContent = `${index + 1}. ${entry.title || '未命名动画'}`;

  const slots = document.createElement('div');
  slots.className = 'image-slot-grid';
  slots.append(
    await makeImageSlot(entry, 'visual'),
    await makeImageSlot(entry, 'infoCard'),
  );
  card.append(title, slots);
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
