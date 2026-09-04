import {
  fetchTmdbImageFile,
  loadTmdbAssets,
  readTmdbCredential,
  saveTmdbCredential,
  searchTmdb,
  tmdbImageUrl,
} from './tmdb-poster.js';

const TMDB_LOGO = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className = 'bgm-button bgm-button--secondary') {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function safeImageFilename(prefix, filePath) {
  const extension = String(filePath).split('.').pop()?.toLowerCase() || 'jpg';
  return `${prefix}.${extension.replace(/[^a-z0-9]/g, '') || 'jpg'}`;
}

function posterCandidateImage(candidate) {
  const path = candidate.posterPath || candidate.backdropPath;
  return path ? tmdbImageUrl(path, 'w185') : '';
}

function metadataLine(candidate) {
  const parts = [];
  if (candidate.year) parts.push(candidate.year);
  if (candidate.countries?.length) parts.push(candidate.countries.join('/'));
  if (candidate.originalName && candidate.originalName !== candidate.name) parts.push(candidate.originalName);
  return parts.join(' · ');
}

export function createTmdbPicker({onUseImage, onMappingChange} = {}) {
  if (typeof onUseImage !== 'function') throw new TypeError('onUseImage is required');

  let currentItem = null;
  let busy = false;

  const dialog = element('dialog', 'poster-tmdb-dialog');
  const card = element('div', 'poster-tmdb-card');
  const heading = element('div', 'section-heading section-heading--actions');
  const headingText = element('div');
  const title = element('h2', '', '从 TMDB 选择视觉图');
  const subtitle = element('p', 'poster-section-note', '先确认作品，再从系列图片或最近剧集剧照中挑一张。');
  headingText.append(title, subtitle);
  const close = button('关闭');
  close.addEventListener('click', () => dialog.close());
  heading.append(headingText, close);

  const credentialBox = element('div', 'poster-tmdb-credential');
  const credentialLabel = element('label', 'field');
  const credentialCaption = element('span', 'field__label', 'TMDB API Read Access Token / API Key');
  const credentialWrap = element('span', 'bgm-input__wrapper bgm-input__wrapper--rounded');
  const credentialInput = element('input', 'bgm-input');
  credentialInput.type = 'password';
  credentialInput.autocomplete = 'off';
  credentialInput.placeholder = '可留空：若启动服务器时已设置 TMDB_API_TOKEN / TMDB_API_KEY';
  credentialWrap.append(credentialInput);
  credentialLabel.append(credentialCaption, credentialWrap);
  const credentialActions = element('div', 'poster-tmdb-credential-actions');
  const saveCredentialButton = button('保存到本机');
  const clearCredentialButton = button('清除');
  const credentialNote = element('span', 'poster-section-note', '仅保存在当前浏览器 localStorage；不会写入仓库、问卷项目或海报 JSON。');
  saveCredentialButton.addEventListener('click', () => {
    saveTmdbCredential(credentialInput.value);
    setStatus(credentialInput.value.trim() ? 'TMDB 凭据已保存在本机浏览器。' : '凭据为空；将尝试使用服务器环境变量。');
  });
  clearCredentialButton.addEventListener('click', () => {
    credentialInput.value = '';
    saveTmdbCredential('');
    setStatus('已清除浏览器中保存的 TMDB 凭据。');
  });
  credentialActions.append(saveCredentialButton, clearCredentialButton, credentialNote);
  credentialBox.append(credentialLabel, credentialActions);

  const searchRow = element('div', 'poster-tmdb-search-row');
  const searchWrap = element('span', 'bgm-input__wrapper bgm-input__wrapper--rounded');
  const searchInput = element('input', 'bgm-input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索 TMDB 电视剧 / 动画标题';
  searchWrap.append(searchInput);
  const searchButton = button('搜索', 'bgm-button bgm-button--primary');
  searchRow.append(searchWrap, searchButton);

  const status = element('output', 'poster-tmdb-status');
  status.setAttribute('aria-live', 'polite');
  const searchResults = element('div', 'poster-tmdb-search-results');
  const assets = element('div', 'poster-tmdb-assets');
  const attribution = element('div', 'poster-tmdb-attribution');
  const logoLink = document.createElement('a');
  logoLink.href = 'https://www.themoviedb.org';
  logoLink.target = '_blank';
  logoLink.rel = 'noreferrer';
  const logo = document.createElement('img');
  logo.src = TMDB_LOGO;
  logo.alt = 'TMDB';
  logoLink.append(logo);
  const attributionText = element('span', '', 'This product uses the TMDB API but is not endorsed or certified by TMDB.');
  attribution.append(logoLink, attributionText);

  card.append(heading, credentialBox, searchRow, status, searchResults, assets, attribution);
  dialog.append(card);
  document.body.append(dialog);

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('poster-tmdb-status--error', error);
  }

  function credential() {
    return credentialInput.value.trim();
  }

  function setBusy(value) {
    busy = value;
    searchButton.disabled = value;
    close.disabled = value;
    dialog.querySelectorAll('[data-tmdb-action]').forEach((node) => { node.disabled = value; });
  }

  async function search(query = searchInput.value) {
    if (busy) return;
    const normalized = String(query ?? '').trim();
    if (!normalized) {
      setStatus('请输入要搜索的标题。', true);
      return;
    }
    setBusy(true);
    setStatus(`正在搜索“${normalized}”…`);
    searchResults.replaceChildren();
    assets.replaceChildren();
    try {
      const results = await searchTmdb(normalized, credential());
      renderSearchResults(results);
      setStatus(results.length ? `找到 ${results.length} 个候选；请选择正确作品。` : '没有找到候选，可以换一个标题或原文名再试。', !results.length);
    } catch (error) {
      setStatus(`TMDB 搜索失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function renderSearchResults(results) {
    searchResults.replaceChildren();
    for (const candidate of results) {
      const item = element('button', 'poster-tmdb-search-card');
      item.type = 'button';
      item.dataset.tmdbAction = 'select';
      const imageUrl = posterCandidateImage(candidate);
      if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = '';
        image.loading = 'lazy';
        item.append(image);
      } else {
        item.append(element('div', 'poster-tmdb-search-placeholder', '无图'));
      }
      const copy = element('div', 'poster-tmdb-search-copy');
      copy.append(element('strong', '', candidate.name || candidate.originalName || `TMDB #${candidate.id}`));
      copy.append(element('span', '', metadataLine(candidate)));
      item.append(copy);
      item.addEventListener('click', () => selectSeries(candidate));
      searchResults.append(item);
    }
  }

  async function selectSeries(candidate) {
    if (!currentItem || busy) return;
    currentItem.providerIds = currentItem.providerIds || {};
    currentItem.providerIds.tmdb = candidate.id;
    onMappingChange?.(currentItem);
    await loadAssets(candidate.id);
  }

  async function loadAssets(seriesId) {
    if (busy) return;
    setBusy(true);
    setStatus('正在读取 TMDB 图片和最近剧集…');
    searchResults.replaceChildren();
    assets.replaceChildren();
    try {
      const data = await loadTmdbAssets(seriesId, credential());
      renderAssets(data);
      const name = data.series?.name || `TMDB #${seriesId}`;
      setStatus(`已匹配：${name}。点击任意图片即可作为视觉图并进入裁切。`);
    } catch (error) {
      setStatus(`TMDB 图片读取失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function renderAssets(data) {
    assets.replaceChildren();
    const summary = element('div', 'poster-tmdb-match-summary');
    const name = data.series?.name || `TMDB #${data.series?.id ?? ''}`;
    summary.append(element('strong', '', `${name}${data.series?.year ? ` (${data.series.year})` : ''}`));
    if (data.series?.originalName && data.series.originalName !== name) summary.append(element('span', '', data.series.originalName));
    const rematch = button('重新匹配');
    rematch.dataset.tmdbAction = 'rematch';
    rematch.addEventListener('click', () => search(currentItem?.title || searchInput.value));
    summary.append(rematch);
    assets.append(summary);

    renderImageGroup('最近 5 集剧照', data.episodes || [], (asset) => ({
      label: `S${asset.seasonNumber}E${asset.episodeNumber}${asset.name ? ` · ${asset.name}` : ''}`,
      meta: asset.airDate || '',
      filename: safeImageFilename(`tmdb-s${asset.seasonNumber}e${asset.episodeNumber}`, asset.filePath),
      fit: 'cover',
    }));
    renderImageGroup('背景图', data.backdrops || [], (asset, index) => ({
      label: `背景图 ${index + 1}`,
      meta: asset.width && asset.height ? `${asset.width} × ${asset.height}` : '',
      filename: safeImageFilename(`tmdb-backdrop-${index + 1}`, asset.filePath),
      fit: 'cover',
    }));
    renderImageGroup('海报', data.posters || [], (asset, index) => ({
      label: `海报 ${index + 1}`,
      meta: asset.width && asset.height ? `${asset.width} × ${asset.height}` : '',
      filename: safeImageFilename(`tmdb-poster-${index + 1}`, asset.filePath),
      fit: 'cover',
    }));
    renderImageGroup('Logo', data.logos || [], (asset, index) => ({
      label: `Logo ${index + 1}`,
      meta: asset.width && asset.height ? `${asset.width} × ${asset.height}` : '',
      filename: safeImageFilename(`tmdb-logo-${index + 1}`, asset.filePath),
      fit: 'contain',
    }));
  }

  function renderImageGroup(titleText, items, describe) {
    if (!items.length) return;
    const section = element('section', 'poster-tmdb-group');
    const groupHeading = element('div', 'poster-tmdb-group-heading');
    groupHeading.append(element('h3', '', titleText), element('span', '', `${items.length} 张`));
    const grid = element('div', 'poster-tmdb-image-grid');
    items.forEach((asset, index) => {
      const description = describe(asset, index);
      const item = button('', 'poster-tmdb-image-card');
      item.dataset.tmdbAction = 'image';
      const image = document.createElement('img');
      image.src = tmdbImageUrl(asset.filePath, description.fit === 'contain' ? 'w500' : 'w300');
      image.alt = description.label;
      image.loading = 'lazy';
      if (description.fit === 'contain') image.classList.add('poster-tmdb-image--contain');
      const copy = element('span', 'poster-tmdb-image-copy');
      copy.append(element('strong', '', description.label));
      if (description.meta) copy.append(element('small', '', description.meta));
      item.append(image, copy);
      item.addEventListener('click', () => useImage(asset, description.filename));
      grid.append(item);
    });
    section.append(groupHeading, grid);
    assets.append(section);
  }

  async function useImage(asset, filename) {
    if (!currentItem || busy) return;
    setBusy(true);
    setStatus('正在下载原图并导入海报…');
    try {
      const file = await fetchTmdbImageFile(asset.filePath, filename);
      await onUseImage(currentItem, file);
      setStatus('图片已导入。');
      dialog.close();
    } catch (error) {
      setStatus(`图片导入失败：${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  searchButton.addEventListener('click', () => search());
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });

  return {
    async open(item) {
      currentItem = item;
      credentialInput.value = readTmdbCredential();
      searchInput.value = item?.title || '';
      searchResults.replaceChildren();
      assets.replaceChildren();
      setStatus('');
      dialog.showModal();
      const tmdbId = Number(item?.providerIds?.tmdb);
      if (Number.isInteger(tmdbId) && tmdbId > 0) await loadAssets(tmdbId);
      else await search(searchInput.value);
    },
    close() {
      dialog.close();
    },
  };
}
