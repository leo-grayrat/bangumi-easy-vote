import {
  POSTER_DEFAULTS,
  cropTransform,
  createPosterProject,
  normalizePosterProject,
  posterDisplayRows,
  serializePosterProject,
} from './poster-model.js';
import {loadTrendIcons} from './poster-assets.js';
import {POSTER_LAYOUT, renderPoster, rowAtCanvasPoint} from './poster-renderer.js';
import {openProjectStore} from './project-store.js';
import {createTmdbPicker} from './tmdb-picker.js';
import {
  cachePosterImage,
  deletePosterImage,
  loadPosterWorkspace,
  posterAssetUrl,
  posterScopeForProjectId,
  savePosterWorkspace,
} from './poster-persistence.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const SAMPLE_PATHS = {
  red: 'tools/ranking-poster/sample.json',
  black: 'tools/ranking-poster/sample-black.json',
  controversy: 'tools/ranking-poster/sample-controversy.json',
  favorite: 'tools/ranking-poster/sample-favorite.json',
};
const STYLE_ROLES = [
  ['headerTitle', 'headerTitle', '主标题'],
  ['headerSubtitle', 'headerSubtitle', '英文副标题'],
  ['anime', 'anime', '动画标题'],
  ['rank', 'rank', '排名数字'],
  ['label', 'label', '栏目标记'],
  ['metric', 'metric', '主数值（均分 / SD / 喜爱分）'],
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
  loadControversy: document.querySelector('#load-controversy-sample'),
  loadFavorite: document.querySelector('#load-favorite-sample'),
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
let tmdbPicker = null;
let posterScope = 'standalone';
let stateSaveTimer = null;
let persistenceReady = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function modeLabel(mode) {
  if (mode === 'black') return '黑榜';
  if (mode === 'controversy') return '争议 / 一致榜';
  if (mode === 'favorite') return '喜爱榜';
  return '红榜';
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
  posterScope = posterScopeForProjectId(projectId);
  if (!projectId) {
    elements.sourceProjectName.textContent = `独立海报项目；状态保存在 .local/poster-projects/${posterScope}.json，视觉图缓存在 .local/poster-assets/${posterScope}/。`;
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
      ? `当前问卷项目：${source.title}。海报状态保存在 .local/poster-projects/${posterScope}.json，视觉图缓存在 .local/poster-assets/${posterScope}/。`
      : `未找到对应问卷项目；海报仍会保存在本地 .local/poster-projects/${posterScope}.json。`;
  } catch {
    elements.sourceProjectName.textContent = `无法读取问卷项目；海报仍会保存在本地 .local/poster-projects/${posterScope}.json。`;
  }
}

function clearImageResources() {
  for (const url of resources.imageUrls.values()) {
    if (String(url).startsWith('blob:')) URL.revokeObjectURL(url);
  }
  resources.images.clear();
  resources.imageUrls.clear();
}

function displayRows() {
  return posterDisplayRows(project.items, project.mode).slice(0, 10);
}

function syncProjectControls() {
  elements.mode.value = project.mode;
  elements.modeLabel.textContent = modeLabel(project.mode);
  elements.title.value = project.title;
  elements.subtitle.value = project.subtitle;
  elements.headerLineGap.value = String(project.style.headerLineGap);
  elements.minusYOffset.value = String(project.style.deltaMinusYOffset);
  elements.entryCount.textContent = `${project.items.length} 项`;
}

function serializableProjectObject() {
  return JSON.parse(serializePosterProject(project));
}

async function persistProjectState({silent = true} = {}) {
  if (!persistenceReady) return;
  try {
    await savePosterWorkspace(posterScope, serializableProjectObject());
    if (!silent) setStatus('已保存到本地', true);
  } catch (error) {
    if (!silent) setMessage(elements.outputMessage, `本地海报保存失败：${error.message}`, true);
    throw error;
  }
}

function scheduleProjectSave(delay = 180) {
  if (!persistenceReady) return;
  if (stateSaveTimer) window.clearTimeout(stateSaveTimer);
  stateSaveTimer = window.setTimeout(() => {
    stateSaveTimer = null;
    persistProjectState().catch((error) => {
      setMessage(elements.outputMessage, `本地海报保存失败：${error.message}`, true);
    });
  }, delay);
}

function renderNow() {
  renderPoster(elements.canvas, project, resources);
  elements.entryCount.textContent = `${project.items.length} 项`;
  if (cropItemId) drawCropPreview();
  scheduleProjectSave();
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

async function decodeImageUrl(url) {
  const image = new Image();
  image.src = url;
  if (image.decode) await image.decode();
  else await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('浏览器无法解码该图片'));
  });
  return image;
}

async function attachCachedAsset(item, asset, {resetCrop = false} = {}) {
  const url = posterAssetUrl(asset);
  if (!url) throw new Error('本地图片缓存引用无效。');
  const image = await decodeImageUrl(url);
  const oldUrl = resources.imageUrls.get(item.id);
  if (oldUrl && String(oldUrl).startsWith('blob:')) URL.revokeObjectURL(oldUrl);
  resources.imageUrls.set(item.id, url);
  resources.images.set(item.id, image);
  item.imageUrl = url;
  item.imageAsset = asset;
  item.imageName = asset.fileName || item.imageName;
  if (resetCrop) item.crop = {zoom: 1, offsetX: 0, offsetY: 0};
  selectedItemId = item.id;
}

async function restoreProjectImages() {
  const missing = [];
  for (const item of project.items) {
    if (!item.imageAsset) continue;
    try {
      await attachCachedAsset(item, item.imageAsset);
    } catch {
      missing.push(item);
    }
  }
  return missing;
}

async function attachImage(item, file, {source = 'local'} = {}) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const previous = item.imageAsset;
  const asset = await cachePosterImage(file, posterScope, source);
  try {
    await attachCachedAsset(item, asset, {resetCrop: true});
  } catch (error) {
    deletePosterImage(asset).catch(() => {});
    throw error;
  }
  if (previous && (previous.scope !== asset.scope || previous.assetId !== asset.assetId)) {
    deletePosterImage(previous).catch(() => {});
  }
  await persistProjectState({silent: true});
}

function imageStatusText(item) {
  if (item.imageAsset) {
    const filename = item.imageAsset.fileName || item.imageName || item.imageAsset.assetId;
    const path = item.imageAsset.relativePath || `.local/poster-assets/${item.imageAsset.scope}/${item.imageAsset.assetId}`;
    return resources.images.has(item.id)
      ? `已缓存：${filename} · ${path}`
      : `缓存素材缺失：${filename} · ${path}`;
  }
  if (item.imageName) return `旧项目仅记录文件名：${item.imageName}（重新导入一次即可缓存并自动恢复）`;
  return '未导入图片';
}

function imageInputFor(item) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'poster-hidden-file';
  input.id = `poster-image-${item.id}`;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      setStatus('正在缓存图片');
      await attachImage(item, file, {source: 'local'});
      setMessage(elements.dataMessage, '');
      renderEntryList();
      renderNow();
      setStatus('图片已缓存', true);
    } catch (error) {
      setMessage(elements.dataMessage, `图片读取或缓存失败：${error.message}`, true);
      setStatus('图片缓存失败', true);
    } finally {
      input.value = '';
    }
  });
  return input;
}

function appendControversySectionHeading(section) {
  const heading = document.createElement('p');
  heading.className = 'poster-section-note';
  heading.textContent = section === 'controversial'
    ? 'MOST CONTROVERSIAL · 社内标准差最高 5 部'
    : 'MOST CONSISTENT · 社内标准差最低 5 部';
  elements.entryList.append(heading);
}

function renderEntryList() {
  elements.entryList.replaceChildren();
  const rows = displayRows();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'poster-section-note';
    empty.textContent = '当前没有榜单条目。请载入内置榜单或一个整理后的 JSON。';
    elements.entryList.append(empty);
    return;
  }

  let previousSection = '';
  rows.forEach((rowInfo) => {
    const {item, displayRank, section} = rowInfo;
    if (project.mode === 'controversy' && section !== previousSection) {
      appendControversySectionHeading(section);
      previousSection = section;
    }

    const card = document.createElement('article');
    card.className = 'poster-entry-card';
    card.dataset.itemId = item.id;
    if (item.id === selectedItemId) card.classList.add('poster-entry-card--selected');
    card.addEventListener('click', (event) => {
      if (!event.target.closest('input, button, label')) selectItem(item.id);
    });

    const rank = document.createElement('span');
    rank.className = 'poster-entry-rank';
    rank.textContent = String(displayRank);

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

    if (project.mode === 'favorite') {
      const favoritePoints = inputField('喜爱分', item.favoritePoints, (value) => {
        item.favoritePoints = Math.max(0, Number(value) || 0);
        renderNow();
      }, {type: 'number', step: 1, min: 0});
      favoritePoints.input.addEventListener('change', renderEntryList);
      const top5Count = inputField('TOP5 人数', item.top5Count, (value) => {
        item.top5Count = Math.max(0, Math.round(Number(value) || 0));
        renderNow();
      }, {type: 'number', step: 1, min: 0});
      top5Count.input.addEventListener('change', renderEntryList);
      const scoreRank = inputField('社内评分排名', item.scoreRank ?? '', (value) => {
        const number = Math.round(Number(value) || 0);
        item.scoreRank = value === '' || number <= 0 ? null : number;
        renderNow();
      }, {type: 'number', step: 1, min: 1});
      numeric.append(favoritePoints.label, top5Count.label, scoreRank.label);
    } else {
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

      if (project.mode === 'controversy') {
        const stdDev = inputField('社内 SD', item.stdDev, (value) => {
          item.stdDev = Math.max(0, Number(value) || 0);
          renderNow();
        }, {type: 'number', step: 0.001, min: 0});
        stdDev.input.addEventListener('change', renderEntryList);
        const bgmStdDev = inputField('BGM SD', item.bgmStdDev ?? '', (value) => {
          item.bgmStdDev = value === '' ? null : Math.max(0, Number(value) || 0);
          renderNow();
        }, {type: 'number', step: 0.001, min: 0});
        numeric.append(score.label, voters.label, stdDev.label, bgmStdDev.label);
      } else {
        const bgm = inputField('BGM 分数', item.bgmScore ?? '', (value) => {
          item.bgmScore = value === '' ? null : Number(value);
          renderNow();
        }, {type: 'number', step: 0.0001});
        numeric.append(score.label, voters.label, bgm.label);
      }
    }

    const imageRow = document.createElement('div');
    imageRow.className = 'poster-entry-image-row';
    const tmdbButton = document.createElement('button');
    tmdbButton.className = 'bgm-button bgm-button--secondary';
    tmdbButton.type = 'button';
    tmdbButton.textContent = item.providerIds?.tmdb ? 'TMDB 选图' : '从 TMDB 获取';
    tmdbButton.addEventListener('click', () => tmdbPicker?.open(item));
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
    imageName.textContent = imageStatusText(item);
    const imageInput = imageInputFor(item);
    fileLabel.htmlFor = imageInput.id;
    imageRow.append(tmdbButton, fileLabel, imageInput, cropButton, imageName);

    body.append(title.label, manual, numeric, imageRow);
    card.append(rank, body);
    elements.entryList.append(card);
  });
}

function updateManualLines(item, first, second) {
  item.titleLines = [first.trim(), second.trim()].filter(Boolean).slice(0, 2);
  renderNow();
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
        setMessage(elements.outputMessage, `字体载入失败：${error.message}`, true);
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
    ? '"Century Gothic", sans-serif'
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
  selectedItemId = displayRows()[0]?.item.id || project.items[0]?.id || '';
  cropItemId = '';
  const missing = await restoreProjectImages();
  syncProjectControls();
  renderStyleList();
  renderEntryList();
  renderNow();
  const missingMessage = missing.length
    ? `${missing.length} 张本地缓存图片不存在；条目中保留了原文件名和缓存路径，可以重新导入替换。`
    : '';
  setMessage(elements.dataMessage, [message, missingMessage].filter(Boolean).join(' '), missing.length > 0);
}

async function loadBuiltin(mode) {
  try {
    setStatus('正在载入榜单');
    const response = await fetch(SAMPLE_PATHS[mode], {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await applyProject(await response.json());
    await persistProjectState({silent: true});
    setStatus('已载入', true);
  } catch (error) {
    setMessage(elements.dataMessage, `载入内置榜单失败：${error.message}`, true);
    setStatus('载入失败', true);
  }
}

async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  await applyProject(parsed, '已载入项目 JSON；带本地缓存引用的图片会自动恢复，旧版只有文件名的图片需要重新导入一次。');
  await persistProjectState({silent: true});
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
      setMessage(elements.outputMessage, '浏览器未能生成 PNG。', true);
      return;
    }
    downloadBlob(blob, safeFilename('png'));
    setStatus('PNG 已导出', true);
  }, 'image/png');
}

function bindControls() {
  elements.loadRed.addEventListener('click', () => loadBuiltin('red'));
  elements.loadBlack.addEventListener('click', () => loadBuiltin('black'));
  elements.loadControversy.addEventListener('click', () => loadBuiltin('controversy'));
  elements.loadFavorite.addEventListener('click', () => loadBuiltin('favorite'));
  elements.projectFile.addEventListener('change', async () => {
    const file = elements.projectFile.files?.[0];
    if (!file) return;
    try {
      await importProjectFile(file);
      setStatus('项目已载入', true);
    } catch (error) {
      setMessage(elements.dataMessage, `JSON 读取失败：${error.message}`, true);
    } finally {
      elements.projectFile.value = '';
    }
  });
  elements.mode.addEventListener('change', () => {
    project.mode = ['red', 'black', 'controversy', 'favorite'].includes(elements.mode.value) ? elements.mode.value : 'red';
    project.comparisonLabel = project.mode === 'favorite' ? 'VS SCORE RANK' : 'VS BANGUMI';
    elements.modeLabel.textContent = modeLabel(project.mode);
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
    const item = displayRows()[row]?.item;
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
  const stopDrag = () => {
    dragPoint = null;
    scheduleProjectSave(0);
  };
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
    scheduleProjectSave(0);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistProjectState({silent: true}).catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    if (stateSaveTimer) window.clearTimeout(stateSaveTimer);
    clearImageResources();
  });
}

async function init() {
  try {
    tmdbPicker = createTmdbPicker({
      onUseImage: async (item, file) => {
        await attachImage(item, file, {source: 'tmdb'});
        renderEntryList();
        renderNow();
        openCrop(item);
      },
      onMappingChange: () => {
        renderEntryList();
        scheduleProjectSave(0);
      },
    });
    bindControls();
    await loadSourceProjectContext();
    resources.trendIcons = await loadTrendIcons();

    let saved = null;
    let stateError = '';
    try {
      saved = await loadPosterWorkspace(posterScope);
    } catch (error) {
      stateError = error.message;
    }
    persistenceReady = true;

    if (saved) {
      await applyProject(saved, '已从本地工作区恢复上次的海报状态和缓存图片。');
      setStatus('已恢复本地海报', true);
    } else {
      await loadBuiltin('red');
      if (stateError) setMessage(elements.dataMessage, `本地海报缓存读取失败：${stateError}`, true);
    }
    elements.workspace.hidden = false;
    elements.loadError.hidden = true;
  } catch (error) {
    elements.loadError.hidden = false;
    elements.loadError.textContent = `排行榜海报编辑器启动失败：${error.message}`;
    setStatus('启动失败');
  }
}

init();
