import {
  POSTER_DEFAULTS,
  cropTransform,
  createPosterProject,
  normalizePosterProject,
  serializePosterProject,
  sortPosterItems,
} from './poster-model.js';
import {loadTrendIcons} from './poster-assets.js';
import {POSTER_LAYOUT, renderPoster, rowAtCanvasPoint} from './poster-renderer.js';
import {openProjectStore} from './project-store.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const SAMPLE_PATHS = {
  red: 'tools/ranking-poster/sample.json',
  black: 'tools/ranking-poster/sample-black.json',
};
const STYLE_ROLES = [
  ['headerTitle', 'headerTitle', '主标题'],
  ['headerSubtitle', 'headerSubtitle', '英文副标题'],
  ['anime', 'anime', '动画标题'],
  ['rank', 'rank', '排名数字'],
  ['label', 'label', '栏目标记'],
  ['metric', 'metric', '平均分'],
  ['trendDelta', 'trendDelta', '差值'],
  ['aux', 'aux', '底部小字'],
];

const elements = {
  canvas: document.querySelector('#poster-canvas'),
  cropCanvas: document.querySelector('#poster-crop-canvas'),
  cropDialog: document.querySelector('#poster-crop-dialog'),
  cropItemTitle: document.querySelector('#crop-item-title'),
  cropZoom: document.querySelector('#crop-zoom'),
  dataMessage: document.querySelector('#poster-data-message'),
  downloadPoster: document.querySelector('#download-poster'),
  downloadProject: document.querySelector('#download-poster-project'),
  entryCount: document.querySelector('#poster-entry-count'),
  entryList: document.querySelector('#poster-entry-list'),
  headerLineGap: document.querySelector('#header-line-gap'),
  loadBlack: document.querySelector('#load-black-sample'),
  loadError: document.querySelector('#load-error'),
  loadRed: document.querySelector('#load-red-sample'),
  minusYOffset: document.querySelector('#minus-y-offset'),
  mode: document.querySelector('#poster-mode'),
  modeLabel: document.querySelector('#poster-mode-label'),
  outputMessage: document.querySelector('#poster-output-message'),
  projectFile: document.querySelector('#poster-project-file'),
  resetCrop: document.querySelector('#reset-crop'),
  saveStatus: document.querySelector('#save-status'),
  sourceProjectName: document.querySelector('#source-project-name'),
  styleList: document.querySelector('#poster-style-list'),
  subtitle: document.querySelector('#poster-subtitle'),
  title: document.querySelector('#poster-title'),
  workspace: document.querySelector('#poster-workspace'),
};

const resources = {
  images: new Map(),
  imageUrls: new Map(),
  trendIcons: {},
};

let project = createPosterProject();
let selectedItemId = '';
let cropItemId = '';
let dragPoint = null;
let statusTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message, reset = false) {
  elements.saveStatus.textContent = message;
  if (statusTimer) window.clearTimeout(statusTimer);
  if (reset) {
    statusTimer = window.setTimeout(() => {
      elements.saveStatus.textContent = '本地编辑';
    }, 2200);
  }
}

function setMessage(element, message, warning = false) {
  element.textContent = message;
  element.classList.toggle('field-message--warning', warning);
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
    if (projectId) target.searchParams.set('project', projectId);
    link.href = target.href;
  });
}

async function loadSourceProjectContext() {
  const url = new URL(window.location.href);
  const projectId = url.searchParams.get('project')?.trim() || recentProjectId();
  if (!projectId) {
    elements.sourceProjectName.textContent = '独立海报项目；视觉图和字体只在当前浏览器会话中使用。';
    return;
  }

  if (!url.searchParams.get('project')) {
    url.searchParams.set('project', projectId);
    window.history.replaceState(null, '', url);
  }
  updateProjectLinks(projectId);

  try {
    const store = await openProjectStore();
    const source = await store.loadProject(projectId);
    elements.sourceProjectName.textContent = source?.title
      ? `当前问卷项目：${source.title}。海报数据独立保存，不会改动问卷。`
      : '未找到对应问卷项目；海报仍可独立编辑。';
  } catch {
    elements.sourceProjectName.textContent = '无法读取问卷项目；海报仍可独立编辑。';
  }
}

function clearImageResources() {
  for (const url of resources.imageUrls.values()) URL.revokeObjectURL(url);
  resources.images.clear();
  resources.imageUrls.clear();
}

function sortedItems() {
  return sortPosterItems(project.items, project.mode).slice(0, 10);
}

function syncProjectControls() {
  elements.mode.value = project.mode;
  elements.modeLabel.textContent = project.mode === 'black' ? '黑榜' : '红榜';
  elements.title.value = project.title;
  elements.subtitle.value = project.subtitle;
  elements.headerLineGap.value = String(project.style.headerLineGap);
  elements.minusYOffset.value = String(project.style.deltaMinusYOffset);
  elements.entryCount.textContent = `${project.items.length} 项`;
}

function renderNow() {
  renderPoster(elements.canvas, project, resources);
  elements.entryCount.textContent = `${project.items.length} 项`;
  if (cropItemId) drawCropPreview();
}

function inputField(labelText, value, onInput, options = {}) {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.className = 'field__label';
  caption.textContent = labelText;
  const wrapper = document.createElement('span');
  wrapper.className = 'bgm-input__wrapper bgm-input__wrapper--rounded';
  const input = document.createElement('input');
  input.className = 'bgm-input';
  input.type = options.type || 'text';
  input.value = value ?? '';
  if (options.step !== undefined) input.step = String(options.step);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener('input', () => onInput(input.value, input));
  wrapper.append(input);
  label.append(caption, wrapper);
  return {label, input};
}

function selectItem(itemId, {scroll = false} = {}) {
  selectedItemId = itemId;
  elements.entryList.querySelectorAll('.poster-entry-card').forEach((card) => {
    card.classList.toggle('poster-entry-card--selected', card.dataset.itemId === itemId);
  });
  if (scroll) {
    elements.entryList.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'});
  }
}

function imageInputFor(item, cropButton, nameElement) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'poster-hidden-file';
  input.id = `poster-image-${item.id}`;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await attachImage(item, file);
      nameElement.textContent = file.name;
      cropButton.disabled = false;
      setMessage(elements.dataMessage, '');
      renderNow();
    } catch (error) {
      setMessage(elements.dataMessage, `图片读取失败：${error.message}`);
    } finally {
      input.value = '';
    }
  });
  return input;
}

function renderEntryList() {
  elements.entryList.replaceChildren();
  const items = sortedItems();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'poster-section-note';
    empty.textContent = '当前没有榜单条目。请载入红榜、黑榜或一个整理后的 JSON。';
    elements.entryList.append(empty);
    return;
  }

  items.forEach((item, rankIndex) => {
    const card = document.createElement('article');
    card.className = 'poster-entry-card';
    card.dataset.itemId = item.id;
    if (item.id === selectedItemId) card.classList.add('poster-entry-card--selected');
    card.addEventListener('click', (event) => {
      if (!event.target.closest('input, button, label')) selectItem(item.id);
    });

    const rank = document.createElement('span');
    rank.className = 'poster-entry-rank';
    rank.textContent = String(rankIndex + 1);

    const body = document.createElement('div');
    body.className = 'poster-entry-body';

    const title = inputField('标题', item.title, (value) => {
      item.title = value;
      renderNow();
    });

    const manual = document.createElement('div');
    manual.className = 'poster-manual-lines';
    const lines = item.titleLines?.slice(0, 2) ?? [];
    let line2;
    const line1 = inputField('人工第 1 行', lines[0] ?? '', () => updateManualLines(item, line1.input.value, line2.input.value), {placeholder: '留空则自动换行'});
    line2 = inputField('人工第 2 行', lines[1] ?? '', () => updateManualLines(item, line1.input.value, line2.input.value), {placeholder: '可留空'});
    manual.append(line1.label, line2.label);

    const numeric = document.createElement('div');
    numeric.className = 'poster-entry-inline';
    const score = inputField('社内均分', item.score, (value) => {
      item.score = Number(value) || 0;
      renderNow();
    }, {type: 'number', step: 0.01});
    score.input.addEventListener('change', renderEntryList);
    const voters = inputField('投票数', item.voters, (value) => {
      item.voters = Math.max(0, Math.round(Number(value) || 0));
      renderNow();
    }, {type: 'number', step: 1, min: 0});
    voters.input.addEventListener('change', renderEntryList);
    const bgm = inputField('BGM 分数', item.bgmScore ?? '', (value) => {
      item.bgmScore = value === '' ? null : Number(value);
      renderNow();
    }, {type: 'number', step: 0.0001});
    numeric.append(score.label, voters.label, bgm.label);

    const imageRow = document.createElement('div');
    imageRow.className = 'poster-entry-image-row';
    const fileLabel = document.createElement('label');
    fileLabel.className = 'bgm-button bgm-button--secondary bgm-button--color-blue poster-file-button';
    fileLabel.textContent = resources.images.has(item.id) ? '更换视觉图' : '导入视觉图';
    const cropButton = document.createElement('button');
    cropButton.className = 'bgm-button bgm-button--secondary';
    cropButton.type = 'button';
    cropButton.textContent = '调整裁切';
    cropButton.disabled = !resources.images.has(item.id);
    cropButton.addEventListener('click', () => openCrop(item));
    const imageName = document.createElement('span');
    imageName.className = 'poster-entry-image-name';
    imageName.textContent = resources.images.has(item.id)
      ? item.imageName
      : item.imageName
        ? `项目记录：${item.imageName}（请重新选择文件）`
        : '未导入图片';
    const imageInput = imageInputFor(item, cropButton, imageName);
    fileLabel.htmlFor = imageInput.id;
    imageRow.append(fileLabel, imageInput, cropButton, imageName);

    body.append(title.label, manual, numeric, imageRow);
    card.append(rank, body);
    elements.entryList.append(card);
  });
}

function updateManualLines(item, first, second) {
  item.titleLines = [first.trim(), second.trim()].filter(Boolean).slice(0, 2);
  renderNow();
}

async function attachImage(item, file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const oldUrl = resources.imageUrls.get(item.id);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('浏览器无法解码该图片'));
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  resources.imageUrls.set(item.id, url);
  resources.images.set(item.id, image);
  item.imageUrl = url;
  item.imageName = file.name;
  item.crop = {zoom: 1, offsetX: 0, offsetY: 0};
  selectedItemId = item.id;
}

function renderStyleList() {
  elements.styleList.replaceChildren();
  STYLE_ROLES.forEach(([familyKey, sizeKey, labelText]) => {
    const row = document.createElement('div');
    row.className = 'poster-style-row';
    const role = document.createElement('div');
    role.className = 'poster-style-role';
    role.textContent = labelText;

    const picker = document.createElement('div');
    picker.className = 'poster-font-picker';
    const family = inputField('字体', project.style.fontFamilies[familyKey], (value) => {
      project.style.fontFamilies[familyKey] = value.trim() || POSTER_DEFAULTS.style.fontFamilies[familyKey];
      renderNow();
    });
    const localName = document.createElement('span');
    localName.className = 'poster-local-font-name';
    const stored = project.style.fontSources?.[familyKey];
    localName.textContent = stored?.filename ? `上次使用：${stored.filename}；重新打开后需再次载入字体文件。` : '';
    const fontFile = document.createElement('input');
    fontFile.className = 'poster-font-file';
    fontFile.type = 'file';
    fontFile.accept = '.ttf,.otf,.ttc,.woff,.woff2,font/*';
    fontFile.addEventListener('change', async () => {
      const file = fontFile.files?.[0];
      if (!file) return;
      try {
        await loadLocalFont(familyKey, file);
        family.input.value = project.style.fontFamilies[familyKey];
        localName.textContent = `已载入：${file.name}`;
        setMessage(elements.outputMessage, '');
        renderNow();
      } catch (error) {
        setMessage(elements.outputMessage, `字体载入失败：${error.message}`);
      } finally {
        fontFile.value = '';
      }
    });
    picker.append(family.label, fontFile, localName);

    const size = inputField('字号', project.style.fontSizes[sizeKey], (value) => {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) project.style.fontSizes[sizeKey] = number;
      renderNow();
    }, {type: 'number', min: 8, max: 120, step: 1});

    row.append(role, picker, size.label);
    elements.styleList.append(row);
  });
}

async function loadLocalFont(role, file) {
  if (typeof FontFace !== 'function' || !document.fonts) throw new Error('当前浏览器不支持本地字体载入');
  const safeRole = role.replace(/[^a-z0-9]/gi, '');
  const family = `PosterLocal_${safeRole}_${Date.now().toString(36)}`;
  const data = await file.arrayBuffer();
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  const fallback = role === 'headerSubtitle' || ['rank', 'label', 'metric', 'trendDelta'].includes(role)
    ? 'Arial, sans-serif'
    : '"Noto Sans SC", "Microsoft YaHei UI", sans-serif';
  project.style.fontFamilies[role] = `"${family}", ${fallback}`;
  project.style.fontSources = project.style.fontSources || {};
  project.style.fontSources[role] = {filename: file.name, family};
  await document.fonts.ready;
  return family;
}

function drawCropPreview() {
  const item = project.items.find((candidate) => candidate.id === cropItemId);
  const image = item && resources.images.get(item.id);
  if (!item || !image) return;
  const canvas = elements.cropCanvas;
  const ctx = canvas.getContext('2d');
  const source = cropTransform(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    canvas.width,
    canvas.height,
    item.crop,
  );
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 1;
  for (const fraction of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(canvas.width * fraction, 0);
    ctx.lineTo(canvas.width * fraction, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * fraction);
    ctx.lineTo(canvas.width, canvas.height * fraction);
    ctx.stroke();
  }
}

function openCrop(item) {
  if (!resources.images.has(item.id)) return;
  cropItemId = item.id;
  selectedItemId = item.id;
  elements.cropItemTitle.textContent = item.title;
  elements.cropZoom.value = String(item.crop.zoom);
  drawCropPreview();
  elements.cropDialog.showModal();
  selectItem(item.id);
}

function shiftCropByDrag(item, image, dx, dy, displayRect) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const source = cropTransform(iw, ih, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight, item.crop);
  const maxX = Math.max(0, iw - source.sw);
  const maxY = Math.max(0, ih - source.sh);
  if (maxX > 1e-6 && displayRect.width > 0) {
    const nextSx = clamp(source.sx - dx * source.sw / displayRect.width, 0, maxX);
    item.crop.offsetX = clamp((nextSx - maxX / 2) / (maxX / 2), -1, 1);
  }
  if (maxY > 1e-6 && displayRect.height > 0) {
    const nextSy = clamp(source.sy - dy * source.sh / displayRect.height, 0, maxY);
    item.crop.offsetY = clamp((nextSy - maxY / 2) / (maxY / 2), -1, 1);
  }
}

function currentCropItem() {
  return project.items.find((item) => item.id === cropItemId) || null;
}

async function applyProject(raw, message = '') {
  clearImageResources();
  project = normalizePosterProject(raw);
  selectedItemId = project.items[0]?.id || '';
  cropItemId = '';
  syncProjectControls();
  renderStyleList();
  renderEntryList();
  renderNow();
  setMessage(elements.dataMessage, message, Boolean(message));
}

async function loadBuiltin(mode) {
  try {
    setStatus('正在载入榜单');
    const response = await fetch(SAMPLE_PATHS[mode], {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await applyProject(await response.json());
    setStatus('已载入', true);
  } catch (error) {
    setMessage(elements.dataMessage, `载入内置榜单失败：${error.message}`);
    setStatus('载入失败', true);
  }
}

async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  await applyProject(parsed, '项目 JSON 不包含图片和字体二进制，请按条目重新选择本地文件。');
}

function safeFilename(extension) {
  const base = project.title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${base || '排行榜海报'}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadProjectJson() {
  const blob = new Blob([serializePosterProject(project)], {type: 'application/json;charset=utf-8'});
  downloadBlob(blob, safeFilename('json'));
  setStatus('项目 JSON 已导出', true);
}

function downloadPng() {
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      setMessage(elements.outputMessage, '浏览器未能生成 PNG。');
      return;
    }
    downloadBlob(blob, safeFilename('png'));
    setStatus('PNG 已导出', true);
  }, 'image/png');
}

function bindControls() {
  elements.loadRed.addEventListener('click', () => loadBuiltin('red'));
  elements.loadBlack.addEventListener('click', () => loadBuiltin('black'));
  elements.projectFile.addEventListener('change', async () => {
    const file = elements.projectFile.files?.[0];
    if (!file) return;
    try {
      await importProjectFile(file);
      setStatus('项目已载入', true);
    } catch (error) {
      setMessage(elements.dataMessage, `JSON 读取失败：${error.message}`);
    } finally {
      elements.projectFile.value = '';
    }
  });
  elements.mode.addEventListener('change', () => {
    project.mode = elements.mode.value === 'black' ? 'black' : 'red';
    elements.modeLabel.textContent = project.mode === 'black' ? '黑榜' : '红榜';
    renderEntryList();
    renderNow();
  });
  elements.title.addEventListener('input', () => {
    project.title = elements.title.value;
    renderNow();
  });
  elements.subtitle.addEventListener('input', () => {
    project.subtitle = elements.subtitle.value;
    renderNow();
  });
  elements.headerLineGap.addEventListener('input', () => {
    project.style.headerLineGap = Number(elements.headerLineGap.value) || 0;
    renderNow();
  });
  elements.minusYOffset.addEventListener('input', () => {
    project.style.deltaMinusYOffset = Number(elements.minusYOffset.value) || 0;
    renderNow();
  });
  elements.downloadPoster.addEventListener('click', downloadPng);
  elements.downloadProject.addEventListener('click', downloadProjectJson);

  elements.canvas.addEventListener('click', (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * elements.canvas.width / rect.width;
    const y = (event.clientY - rect.top) * elements.canvas.height / rect.height;
    const row = rowAtCanvasPoint(x, y);
    if (row === null) return;
    const item = sortedItems()[row];
    if (item) selectItem(item.id, {scroll: true});
  });

  elements.cropZoom.addEventListener('input', () => {
    const item = currentCropItem();
    if (!item) return;
    item.crop.zoom = clamp(Number(elements.cropZoom.value) || 1, 1, 4);
    drawCropPreview();
    renderNow();
  });
  elements.resetCrop.addEventListener('click', () => {
    const item = currentCropItem();
    if (!item) return;
    item.crop = {zoom: 1, offsetX: 0, offsetY: 0};
    elements.cropZoom.value = '1';
    drawCropPreview();
    renderNow();
  });
  elements.cropCanvas.addEventListener('pointerdown', (event) => {
    if (!currentCropItem()) return;
    dragPoint = {x: event.clientX, y: event.clientY};
    elements.cropCanvas.setPointerCapture(event.pointerId);
  });
  elements.cropCanvas.addEventListener('pointermove', (event) => {
    if (!dragPoint) return;
    const item = currentCropItem();
    const image = item && resources.images.get(item.id);
    if (!item || !image) return;
    const dx = event.clientX - dragPoint.x;
    const dy = event.clientY - dragPoint.y;
    dragPoint = {x: event.clientX, y: event.clientY};
    shiftCropByDrag(item, image, dx, dy, elements.cropCanvas.getBoundingClientRect());
    drawCropPreview();
    renderNow();
  });
  const stopDrag = () => { dragPoint = null; };
  elements.cropCanvas.addEventListener('pointerup', stopDrag);
  elements.cropCanvas.addEventListener('pointercancel', stopDrag);
  elements.cropCanvas.addEventListener('wheel', (event) => {
    const item = currentCropItem();
    if (!item) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    item.crop.zoom = clamp(item.crop.zoom * factor, 1, 4);
    elements.cropZoom.value = String(item.crop.zoom);
    drawCropPreview();
    renderNow();
  }, {passive: false});
  elements.cropDialog.addEventListener('close', () => {
    cropItemId = '';
    dragPoint = null;
  });

  window.addEventListener('beforeunload', clearImageResources);
}

async function init() {
  try {
    bindControls();
    await loadSourceProjectContext();
    resources.trendIcons = await loadTrendIcons();
    await loadBuiltin('red');
    elements.workspace.hidden = false;
    elements.loadError.hidden = true;
  } catch (error) {
    elements.loadError.hidden = false;
    elements.loadError.textContent = `排行榜海报编辑器启动失败：${error.message}`;
    setStatus('启动失败');
  }
}

init();
