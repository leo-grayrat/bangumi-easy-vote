import {
  POSTER_DEFAULTS,
  cropTransform,
  createPosterProject,
  normalizePosterProject,
  normalizePosterVisual,
  posterDisplayRows,
  posterVisualMatchesItem,
  serializePosterProject,
} from './poster-model.js';
import {loadTrendIcons} from './poster-assets.js';
import {POSTER_LAYOUT, renderPoster, rowAtCanvasPoint} from './poster-renderer.js';
import {openProjectStore} from './project-store.js';
import {createTmdbPicker} from './tmdb-picker.js';
import {
  cachePosterImage,
  deletePosterImage,
  loadPosterVisuals,
  loadPosterWorkspace,
  posterAssetUrl,
  posterScopeForProjectId,
  savePosterVisuals,
  savePosterWorkspace,
} from './poster-persistence.js';

const RECENT_PROJECT_KEY = 'bangumi-easy-vote:recent-project';
const LAST_MODE_KEY_PREFIX = 'bangumi-easy-vote:poster-mode:';
const POSTER_MODES = ['red', 'black', 'controversy', 'favorite'];
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
  visualClose: document.querySelector('#poster-visual-close'),
  visualDialog: document.querySelector('#poster-visual-dialog'),
  visualEmpty: document.querySelector('#poster-visual-empty'),
  visualGrid: document.querySelector('#poster-visual-grid'),
  visualTitle: document.querySelector('#poster-visual-title'),
  workspace: document.querySelector('#poster-workspace'),
};

const resources = {
  images: new Map(),
  imageUrls: new Map(),
  trendIcons: {},
};

let project = createPosterProject();
let visualPlans = [];
let selectedItemId = '';
let cropItemId = '';
let visualItemId = '';
let dragPoint = null;
let statusTimer = null;
let tmdbPicker = null;
let posterScope = 'standalone';
let stateSaveTimer = null;
let visualSaveTimer = null;
let persistenceReady = false;
let switchingMode = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function modeLabel(mode) {
  if (mode === 'black') return '黑榜';
  if (mode === 'controversy') return '争议 / 一致榜';
  if (mode === 'favorite') return '喜爱榜';
  return '红榜';
}

function validMode(value) {
  return POSTER_MODES.includes(value) ? value : 'red';
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

function lastModeKey() {
  return `${LAST_MODE_KEY_PREFIX}${posterScope}`;
}

function readLastMode() {
  try {
    return validMode(localStorage.getItem(lastModeKey()) || 'red');
  } catch {
    return 'red';
  }
}

function rememberMode(mode) {
  try {
    localStorage.setItem(lastModeKey(), validMode(mode));
  } catch {
    // Local mode preference is optional; mode state itself still lives on disk.
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
  const storageNote = `四种榜单分别保存在 .local/poster-projects/${posterScope}--<榜单>.json；视觉方案库保存在 .local/poster-visuals/${posterScope}.json，原图仍缓存在 .local/poster-assets/${posterScope}/。`;
  if (!projectId) {
    elements.sourceProjectName.textContent = `独立海报项目。${storageNote}`;
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
      ? `当前问卷项目：${source.title}。${storageNote}`
      : `未找到对应问卷项目。${storageNote}`;
  } catch {
    elements.sourceProjectName.textContent = `无法读取问卷项目。${storageNote}`;
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
    await savePosterWorkspace(posterScope, project.mode, serializableProjectObject());
    if (!silent) setStatus('已保存到本地', true);
  } catch (error) {
    if (!silent) setMessage(elements.outputMessage, `本地海报保存失败：${error.message}`, true);
    throw error;
  }
}

async function persistVisualPlans({silent = true} = {}) {
  if (!persistenceReady) return;
  try {
    await savePosterVisuals(posterScope, visualPlans);
    if (!silent) setStatus('视觉方案已保存', true);
  } catch (error) {
    if (!silent) setMessage(elements.outputMessage, `视觉方案保存失败：${error.message}`, true);
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

function scheduleVisualSave(delay = 180) {
  if (!persistenceReady) return;
  if (visualSaveTimer) window.clearTimeout(visualSaveTimer);
  visualSaveTimer = window.setTimeout(() => {
    visualSaveTimer = null;
    persistVisualPlans().catch((error) => {
      setMessage(elements.outputMessage, `视觉方案保存失败：${error.message}`, true);
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

function cloneCrop(crop = {}) {
  return {
    zoom: Number(crop.zoom) || 1,
    offsetX: Number(crop.offsetX) || 0,
    offsetY: Number(crop.offsetY) || 0,
  };
}

function visualById(visualId) {
  return visualPlans.find((visual) => visual.visualId === visualId) || null;
}

function matchingVisuals(item) {
  return visualPlans.filter((visual) => posterVisualMatchesItem(visual, item));
}

function activeVisual(item) {
  return item?.visualId ? visualById(item.visualId) : null;
}

function sameAsset(first, second) {
  return Boolean(
    first?.assetId && second?.assetId
    && first.assetId === second.assetId
    && first.scope === second.scope,
  );
}

function sameCrop(first = {}, second = {}) {
  return Number(first.zoom ?? 1) === Number(second.zoom ?? 1)
    && Number(first.offsetX ?? 0) === Number(second.offsetX ?? 0)
    && Number(first.offsetY ?? 0) === Number(second.offsetY ?? 0);
}

function uniqueVisualLabel(item, requested) {
  const base = String(requested || '视觉方案').trim() || '视觉方案';
  const used = new Set(matchingVisuals(item).map((visual) => visual.label));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

function createVisualFromItem(item, {label = '', visualId = ''} = {}) {
  const visual = normalizePosterVisual({
    visualId: visualId || undefined,
    animeTitle: item.title,
    providerIds: item.providerIds,
    label: uniqueVisualLabel(item, label || item.imageAsset?.fileName || item.imageName || '视觉方案'),
    asset: item.imageAsset,
    crop: item.crop,
    brightness: item.brightness,
  });
  visualPlans.push(visual);
  item.visualId = visual.visualId;
  scheduleVisualSave(0);
  return visual;
}

function syncActiveVisualFromItem(item) {
  const visual = activeVisual(item);
  if (!visual) return;
  visual.crop = cloneCrop(item.crop);
  visual.brightness = Number(item.brightness) || 0.78;
  if (item.imageAsset) visual.asset = {...item.imageAsset};
  scheduleVisualSave();
}

function syncActiveVisualIdentity(item) {
  const visual = activeVisual(item);
  if (!visual) return;
  visual.animeTitle = item.title;
  visual.providerIds = {...(item.providerIds || {})};
  scheduleVisualSave(0);
}

function reconcileProjectVisuals() {
  let changed = false;
  for (const item of project.items) {
    let visual = activeVisual(item);
    if (visual?.asset) {
      item.imageAsset = {...visual.asset};
      item.imageName = visual.asset.fileName || item.imageName;
      item.crop = cloneCrop(visual.crop);
      item.brightness = visual.brightness;
      if (!item.providerIds?.tmdb && visual.providerIds?.tmdb) item.providerIds = {...visual.providerIds};
      continue;
    }
    if (!item.imageAsset) continue;

    visual = visualPlans.find((candidate) => (
      sameAsset(candidate.asset, item.imageAsset)
      && sameCrop(candidate.crop, item.crop)
      && posterVisualMatchesItem(candidate, item)
    ));
    if (visual) {
      item.visualId = visual.visualId;
      continue;
    }

    const created = normalizePosterVisual({
      visualId: item.visualId || undefined,
      animeTitle: item.title,
      providerIds: item.providerIds,
      label: uniqueVisualLabel(item, item.imageAsset.fileName || item.imageName || '旧视觉图'),
      asset: item.imageAsset,
      crop: item.crop,
      brightness: item.brightness,
    });
    visualPlans.push(created);
    item.visualId = created.visualId;
    changed = true;
  }
  if (changed) scheduleVisualSave(0);
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
  item.imageAsset = {...asset};
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

async function attachImage(item, file, {source = 'local', label = ''} = {}) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const asset = await cachePosterImage(file, posterScope, source);
  try {
    await attachCachedAsset(item, asset, {resetCrop: true});
  } catch (error) {
    deletePosterImage(asset).catch(() => {});
    throw error;
  }
  const visual = createVisualFromItem(item, {label: label || file.name || asset.fileName});
  await persistVisualPlans({silent:true});
  await persistProjectState({silent: true});
  return visual;
}

async function useVisualPlan(item, visual) {
  if (!visual?.asset) throw new Error('这个视觉方案没有可用的本地图片。');
  await attachCachedAsset(item, visual.asset);
  item.visualId = visual.visualId;
  item.crop = cloneCrop(visual.crop);
  item.brightness = visual.brightness;
  if (visual.providerIds?.tmdb) item.providerIds = {...visual.providerIds};
  selectedItemId = item.id;
  await persistProjectState({silent:true});
  renderEntryList();
  renderNow();
}

async function drawVisualPlanPreview(canvas, visual) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!visual?.asset) return;
  try {
    const image = await decodeImageUrl(posterAssetUrl(visual.asset));
    const source = cropTransform(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      canvas.width,
      canvas.height,
      visual.crop,
    );
    ctx.filter = `brightness(${Math.round((visual.brightness || 0.78) * 100)}%)`;
    ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  } catch {
    ctx.filter = 'none';
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('本地图片缺失', canvas.width / 2, canvas.height / 2 + 8);
  }
}

function currentVisualItem() {
  return project.items.find((item) => item.id === visualItemId) || null;
}

function renderVisualLibrary() {
  elements.visualGrid.replaceChildren();
  const item = currentVisualItem();
  if (!item) return;
  const matches = matchingVisuals(item);
  elements.visualTitle.textContent = `${item.title} · ${matches.length} 个可复用方案`;
  elements.visualEmpty.hidden = matches.length > 0;

  for (const visual of matches) {
    const card = document.createElement('article');
    card.className = 'poster-visual-item';
    if (visual.visualId === item.visualId) card.classList.add('poster-visual-item--active');

    const frame = document.createElement('div');
    frame.className = 'poster-visual-preview-frame';
    const canvas = document.createElement('canvas');
    canvas.className = 'poster-visual-preview';
    canvas.width = 699;
    canvas.height = 136;
    frame.append(canvas);
    drawVisualPlanPreview(canvas, visual);

    const meta = document.createElement('div');
    meta.className = 'poster-visual-meta';
    const name = document.createElement('strong');
    name.textContent = visual.label;
    const source = document.createElement('small');
    const sourceLabel = visual.asset?.source === 'tmdb' ? 'TMDB' : '本地';
    source.textContent = `${sourceLabel} · ${visual.asset?.fileName || visual.asset?.assetId || '未知文件'}`;
    meta.append(name, source);

    const actions = document.createElement('div');
    actions.className = 'poster-visual-actions';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'bgm-button bgm-button--primary';
    use.textContent = visual.visualId === item.visualId ? '当前使用' : '使用此方案';
    use.disabled = visual.visualId === item.visualId;
    use.addEventListener('click', async () => {
      try {
        setStatus('正在切换视觉方案');
        await useVisualPlan(item, visual);
        elements.visualDialog.close();
        setStatus('视觉方案已切换', true);
      } catch (error) {
        setMessage(elements.dataMessage, `视觉方案读取失败：${error.message}`, true);
        setStatus('视觉方案读取失败', true);
      }
    });

    const renameWrap = document.createElement('span');
    renameWrap.className = 'bgm-input__wrapper bgm-input__wrapper--rounded poster-visual-rename';
    const rename = document.createElement('input');
    rename.className = 'bgm-input';
    rename.value = visual.label;
    rename.placeholder = '视觉方案名称';
    renameWrap.append(rename);
    const saveName = document.createElement('button');
    saveName.type = 'button';
    saveName.className = 'bgm-button bgm-button--secondary';
    saveName.textContent = '改名';
    saveName.addEventListener('click', async () => {
      const next = rename.value.trim();
      if (!next || next === visual.label) return;
      visual.label = next;
      try {
        await persistVisualPlans({silent:true});
        renderVisualLibrary();
        renderEntryList();
        setStatus('方案名称已保存', true);
      } catch (error) {
        setMessage(elements.dataMessage, `方案名称保存失败：${error.message}`, true);
      }
    });
    actions.append(use, renameWrap, saveName);
    card.append(frame, meta, actions);
    elements.visualGrid.append(card);
  }
}

function openVisualLibrary(item) {
  visualItemId = item.id;
  selectedItemId = item.id;
  renderVisualLibrary();
  elements.visualDialog.showModal();
  selectItem(item.id);
}

function imageStatusText(item) {
  const visual = activeVisual(item);
  if (visual?.asset) {
    const source = visual.asset.source === 'tmdb' ? 'TMDB' : '本地';
    return `方案：${visual.label} · ${source} · ${visual.asset.fileName || visual.asset.assetId}`;
  }
  if (item.imageAsset) {
    const filename = item.imageAsset.fileName || item.imageName || item.imageAsset.assetId;
    return resources.images.has(item.id)
      ? `旧视觉图已缓存：${filename}`
      : `旧视觉图缓存缺失：${filename}`;
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
      await attachImage(item, file, {source: 'local', label:file.name});
      setMessage(elements.dataMessage, '');
      renderEntryList();
      renderNow();
      setStatus('图片与视觉方案已缓存', true);
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
    const existingVisuals = matchingVisuals(item);
    const visualButton = document.createElement('button');
    visualButton.className = 'bgm-button bgm-button--secondary';
    visualButton.type = 'button';
    visualButton.textContent = `已有视觉方案 (${existingVisuals.length})`;
    visualButton.addEventListener('click', () => openVisualLibrary(item));
    const tmdbButton = document.createElement('button');
    tmdbButton.className = 'bgm-button bgm-button--secondary';
    tmdbButton.type = 'button';
    tmdbButton.textContent = item.providerIds?.tmdb ? 'TMDB 选图' : '从 TMDB 获取';
    tmdbButton.addEventListener('click', () => tmdbPicker?.open(item));
    const fileLabel = document.createElement('label');
    fileLabel.className = 'bgm-button bgm-button--secondary bgm-button--color-blue poster-file-button';
    fileLabel.textContent = resources.images.has(item.id) ? '新增视觉图' : '导入视觉图';
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
    imageRow.append(visualButton, tmdbButton, fileLabel, imageInput, cropButton, imageName);

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
  reconcileProjectVisuals();
  selectedItemId = displayRows()[0]?.item.id || project.items[0]?.id || '';
  cropItemId = '';
  visualItemId = '';
  const missing = await restoreProjectImages();
  syncProjectControls();
  renderStyleList();
  renderEntryList();
  renderNow();
  const missingMessage = missing.length
    ? `${missing.length} 张本地缓存图片不存在；视觉方案和原文件名仍保留，可以重新导入替换。`
    : '';
  setMessage(elements.dataMessage, [message, missingMessage].filter(Boolean).join(' '), missing.length > 0);
}

async function loadBuiltin(mode, {saveCurrent = true} = {}) {
  const targetMode = validMode(mode);
  try {
    setStatus(`正在载入${modeLabel(targetMode)}`);
    if (saveCurrent && persistenceReady) {
      if (stateSaveTimer) {
        window.clearTimeout(stateSaveTimer);
        stateSaveTimer = null;
      }
      await persistProjectState({silent:true});
    }
    const response = await fetch(SAMPLE_PATHS[targetMode], {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await applyProject(await response.json());
    rememberMode(targetMode);
    await persistProjectState({silent: true});
    setStatus('已载入', true);
  } catch (error) {
    setMessage(elements.dataMessage, `载入内置榜单失败：${error.message}`, true);
    setStatus('载入失败', true);
    throw error;
  }
}

async function switchMode(mode) {
  const targetMode = validMode(mode);
  if (switchingMode || targetMode === project.mode) {
    syncProjectControls();
    return;
  }
  switchingMode = true;
  elements.mode.disabled = true;
  setStatus(`正在切换到${modeLabel(targetMode)}`);
  try {
    if (stateSaveTimer) {
      window.clearTimeout(stateSaveTimer);
      stateSaveTimer = null;
    }
    await persistProjectState({silent:true});
    const saved = await loadPosterWorkspace(posterScope, targetMode);
    if (saved) {
      await applyProject(saved, `已恢复${modeLabel(targetMode)}上次的完整编辑状态。`);
      rememberMode(targetMode);
      setStatus('榜单状态已恢复', true);
    } else {
      await loadBuiltin(targetMode, {saveCurrent:false});
    }
  } finally {
    switchingMode = false;
    elements.mode.disabled = false;
    syncProjectControls();
  }
}

async function importProjectFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const target = normalizePosterProject(parsed);
  if (persistenceReady && target.mode !== project.mode) await persistProjectState({silent:true});
  await applyProject(target, '已载入项目 JSON；同一台电脑上的视觉方案引用、图片、裁切和缩放会从本地库恢复。');
  rememberMode(project.mode);
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
  elements.loadRed.addEventListener('click', () => switchMode('red').catch(() => {}));
  elements.loadBlack.addEventListener('click', () => switchMode('black').catch(() => {}));
  elements.loadControversy.addEventListener('click', () => switchMode('controversy').catch(() => {}));
  elements.loadFavorite.addEventListener('click', () => switchMode('favorite').catch(() => {}));
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
  elements.mode.addEventListener('change', async () => {
    try {
      await switchMode(elements.mode.value);
    } catch (error) {
      setMessage(elements.dataMessage, `榜单切换失败：${error.message}`, true);
      syncProjectControls();
      setStatus('榜单切换失败', true);
    }
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
  elements.visualClose.addEventListener('click', () => elements.visualDialog.close());
  elements.visualDialog.addEventListener('close', () => { visualItemId = ''; });

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
    syncActiveVisualFromItem(item);
    drawCropPreview();
    renderNow();
  });
  elements.resetCrop.addEventListener('click', () => {
    const item = currentCropItem();
    if (!item) return;
    item.crop = {zoom: 1, offsetX: 0, offsetY: 0};
    syncActiveVisualFromItem(item);
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
    syncActiveVisualFromItem(item);
    drawCropPreview();
    renderNow();
  });
  const stopDrag = () => {
    dragPoint = null;
    const item = currentCropItem();
    if (item) syncActiveVisualFromItem(item);
    scheduleProjectSave(0);
    scheduleVisualSave(0);
  };
  elements.cropCanvas.addEventListener('pointerup', stopDrag);
  elements.cropCanvas.addEventListener('pointercancel', stopDrag);
  elements.cropCanvas.addEventListener('wheel', (event) => {
    const item = currentCropItem();
    if (!item) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    item.crop.zoom = clamp(item.crop.zoom * factor, 1, 4);
    syncActiveVisualFromItem(item);
    elements.cropZoom.value = String(item.crop.zoom);
    drawCropPreview();
    renderNow();
  }, {passive: false});
  elements.cropDialog.addEventListener('close', () => {
    const item = currentCropItem();
    if (item) syncActiveVisualFromItem(item);
    cropItemId = '';
    dragPoint = null;
    scheduleProjectSave(0);
    scheduleVisualSave(0);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistProjectState({silent: true}).catch(() => {});
      persistVisualPlans({silent:true}).catch(() => {});
    }
  });
  window.addEventListener('beforeunload', () => {
    if (stateSaveTimer) window.clearTimeout(stateSaveTimer);
    if (visualSaveTimer) window.clearTimeout(visualSaveTimer);
    persistProjectState({silent:true}).catch(() => {});
    persistVisualPlans({silent:true}).catch(() => {});
    clearImageResources();
  });
}

async function init() {
  try {
    tmdbPicker = createTmdbPicker({
      onUseImage: async (item, file, metadata = {}) => {
        await attachImage(item, file, {source: 'tmdb', label:metadata.label || file.name});
        renderEntryList();
        renderNow();
        openCrop(item);
      },
      onMappingChange: (item) => {
        syncActiveVisualIdentity(item);
        renderEntryList();
        scheduleProjectSave(0);
      },
    });
    bindControls();
    await loadSourceProjectContext();
    resources.trendIcons = await loadTrendIcons();

    let visualError = '';
    try {
      visualPlans = (await loadPosterVisuals(posterScope))
        .map((visual) => normalizePosterVisual(visual))
        .filter((visual) => visual.asset);
    } catch (error) {
      visualPlans = [];
      visualError = error.message;
    }

    persistenceReady = true;
    const initialMode = readLastMode();
    let saved = null;
    let stateError = '';
    try {
      saved = await loadPosterWorkspace(posterScope, initialMode);
    } catch (error) {
      stateError = error.message;
    }

    if (saved) {
      await applyProject(saved, `已恢复${modeLabel(initialMode)}上次的海报状态和视觉方案。`);
      rememberMode(project.mode);
      setStatus('已恢复本地海报', true);
    } else {
      await loadBuiltin(initialMode, {saveCurrent:false});
    }
    const startupWarning = [
      visualError ? `视觉方案库读取失败：${visualError}` : '',
      stateError ? `本地榜单状态读取失败：${stateError}` : '',
    ].filter(Boolean).join(' ');
    if (startupWarning) setMessage(elements.dataMessage, startupWarning, true);
    elements.workspace.hidden = false;
    elements.loadError.hidden = true;
  } catch (error) {
    elements.loadError.hidden = false;
    elements.loadError.textContent = `排行榜海报编辑器启动失败：${error.message}`;
    setStatus('启动失败');
  }
}

init();
