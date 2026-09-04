let fallbackId = 0;

const DEFAULT_THRESHOLDS = Object.freeze({
  redUp: 1.0,
  redDown: 0.4,
  blackUp: -0.4,
  blackDown: -1.0,
  controversyHighUp: 0.70,
  controversyHighDown: 0.20,
  controversyLowUp: -0.30,
  controversyLowDown: -0.70,
});

const DEFAULT_FONT_FAMILIES = Object.freeze({
  headerTitle: '"Noto Sans SC", "Microsoft YaHei UI", sans-serif',
  headerSubtitle: '"Century Gothic", "Noto Sans SC", sans-serif',
  anime: '"Noto Sans SC", "Microsoft YaHei UI", sans-serif',
  rank: '"Century Gothic", sans-serif',
  label: '"Century Gothic", sans-serif',
  metric: '"Century Gothic", sans-serif',
  trendDelta: '"Century Gothic", sans-serif',
  aux: '"Noto Sans SC", "Microsoft YaHei UI", sans-serif',
});

const DEFAULT_FONT_SIZES = Object.freeze({
  headerTitle: 60,
  headerSubtitle: 34,
  anime: 36,
  animeSmall: 31,
  rank: 74,
  label: 14,
  metric: 46,
  trendDelta: 34,
  aux: 14,
});

export const POSTER_DEFAULTS = Object.freeze({
  mode: 'red',
  title: '7月新番中期评分 TOP 10',
  subtitle: 'MID-SEASON TOP 10 ANIME',
  comparisonLabel: 'VS BANGUMI',
  thresholds: DEFAULT_THRESHOLDS,
  style: Object.freeze({
    fontFamilies: DEFAULT_FONT_FAMILIES,
    fontSizes: DEFAULT_FONT_SIZES,
    headerLineGap: 18,
    deltaMinusYOffset: 4,
  }),
});

function nextId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackId += 1;
  return `poster-${fallbackId}`;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCrop(input, focus) {
  const inferredX = Array.isArray(focus) ? (finite(focus[0], 0.5) - 0.5) * 2 : 0;
  const inferredY = Array.isArray(focus) ? (finite(focus[1], 0.5) - 0.5) * 2 : 0;
  return {
    zoom: Math.max(1, finite(input?.zoom, 1)),
    offsetX: clamp(finite(input?.offsetX, inferredX), -1, 1),
    offsetY: clamp(finite(input?.offsetY, inferredY), -1, 1),
  };
}

function normalizeProviderIds(input = {}) {
  const tmdb = Number(input?.tmdb);
  return Number.isInteger(tmdb) && tmdb > 0 ? {tmdb} : {};
}

function normalizeImageAsset(input) {
  if (!input || typeof input !== 'object') return null;
  const assetId = String(input.assetId ?? input.asset_id ?? '').trim();
  const scope = String(input.scope ?? '').trim();
  if (!assetId || !scope) return null;
  return {
    assetId,
    scope,
    fileName: String(input.fileName ?? input.filename ?? '').trim(),
    source: input.source === 'tmdb' ? 'tmdb' : 'local',
    contentType: String(input.contentType ?? input.content_type ?? '').trim(),
    relativePath: String(input.relativePath ?? input.relative_path ?? '').trim(),
  };
}

function normalizeItem(item = {}) {
  const imageAsset = normalizeImageAsset(item.imageAsset ?? item.image_asset);
  return {
    id: String(item.id || nextId()),
    title: String(item.title ?? '').trim(),
    titleLines: Array.isArray(item.titleLines ?? item.title_lines)
      ? (item.titleLines ?? item.title_lines).map(String).filter(Boolean).slice(0, 2)
      : [],
    score: finite(item.score ?? item.averageScore ?? item.average_score, 0),
    voters: Math.max(0, Math.round(finite(item.voters, 0))),
    bgmScore: nullableFinite(item.bgmScore ?? item.bgm_score),
    stdDev: Math.max(0, finite(item.stdDev ?? item.std_dev ?? item.standardDeviation ?? item.standard_deviation, 0)),
    bgmStdDev: nullableFinite(item.bgmStdDev ?? item.bgm_std_dev ?? item.bgmStandardDeviation ?? item.bgm_standard_deviation),
    imageName: String(item.imageName ?? item.image ?? imageAsset?.fileName ?? ''),
    imageUrl: String(item.imageUrl ?? ''),
    imageAsset,
    crop: normalizeCrop(item.crop, item.focus),
    brightness: clamp(finite(item.brightness, 0.78), 0.1, 1.5),
    providerIds: normalizeProviderIds(item.providerIds ?? item.provider_ids),
  };
}

function normalizeThresholds(input = {}) {
  return {
    redUp: finite(input.redUp ?? input.red_up, DEFAULT_THRESHOLDS.redUp),
    redDown: finite(input.redDown ?? input.red_down, DEFAULT_THRESHOLDS.redDown),
    blackUp: finite(input.blackUp ?? input.black_up, DEFAULT_THRESHOLDS.blackUp),
    blackDown: finite(input.blackDown ?? input.black_down, DEFAULT_THRESHOLDS.blackDown),
    controversyHighUp: finite(input.controversyHighUp ?? input.controversy_high_up, DEFAULT_THRESHOLDS.controversyHighUp),
    controversyHighDown: finite(input.controversyHighDown ?? input.controversy_high_down, DEFAULT_THRESHOLDS.controversyHighDown),
    controversyLowUp: finite(input.controversyLowUp ?? input.controversy_low_up, DEFAULT_THRESHOLDS.controversyLowUp),
    controversyLowDown: finite(input.controversyLowDown ?? input.controversy_low_down, DEFAULT_THRESHOLDS.controversyLowDown),
  };
}

function normalizeStyle(input = {}) {
  const families = input.fontFamilies ?? input.font_families ?? input.fonts ?? {};
  const sizes = input.fontSizes ?? input.font_sizes ?? {};
  return {
    fontFamilies: {
      ...DEFAULT_FONT_FAMILIES,
      headerTitle: families.headerTitle ?? families.header_title ?? DEFAULT_FONT_FAMILIES.headerTitle,
      headerSubtitle: families.headerSubtitle ?? families.header_subtitle ?? DEFAULT_FONT_FAMILIES.headerSubtitle,
      anime: families.anime ?? DEFAULT_FONT_FAMILIES.anime,
      rank: families.rank ?? DEFAULT_FONT_FAMILIES.rank,
      label: families.label ?? DEFAULT_FONT_FAMILIES.label,
      metric: families.metric ?? DEFAULT_FONT_FAMILIES.metric,
      trendDelta: families.trendDelta ?? families.trend_delta ?? DEFAULT_FONT_FAMILIES.trendDelta,
      aux: families.aux ?? DEFAULT_FONT_FAMILIES.aux,
    },
    fontSizes: {
      ...DEFAULT_FONT_SIZES,
      headerTitle: finite(sizes.headerTitle ?? sizes.header_title, DEFAULT_FONT_SIZES.headerTitle),
      headerSubtitle: finite(sizes.headerSubtitle ?? sizes.header_subtitle, DEFAULT_FONT_SIZES.headerSubtitle),
      anime: finite(sizes.anime, DEFAULT_FONT_SIZES.anime),
      animeSmall: finite(sizes.animeSmall ?? sizes.anime_small, DEFAULT_FONT_SIZES.animeSmall),
      rank: finite(sizes.rank, DEFAULT_FONT_SIZES.rank),
      label: finite(sizes.label, DEFAULT_FONT_SIZES.label),
      metric: finite(sizes.metric, DEFAULT_FONT_SIZES.metric),
      trendDelta: finite(sizes.trendDelta ?? sizes.trend_delta, DEFAULT_FONT_SIZES.trendDelta),
      aux: finite(sizes.aux, DEFAULT_FONT_SIZES.aux),
    },
    headerLineGap: finite(input.headerLineGap ?? input.header_line_gap, POSTER_DEFAULTS.style.headerLineGap),
    deltaMinusYOffset: finite(input.deltaMinusYOffset ?? input.delta_minus_y_offset, POSTER_DEFAULTS.style.deltaMinusYOffset),
    fontSources: {...(input.fontSources ?? {})},
  };
}

export function normalizePosterProject(input = {}) {
  const requestedMode = String(input.mode ?? '').trim();
  const mode = requestedMode === 'black' || requestedMode === 'controversy' ? requestedMode : 'red';
  const defaultTitle = mode === 'black'
    ? '7月新番中期黑榜 BOTTOM 10'
    : mode === 'controversy'
      ? '7月新番中期争议度'
      : POSTER_DEFAULTS.title;
  const defaultSubtitle = mode === 'controversy'
    ? 'MOST CONTROVERSIAL / MOST CONSISTENT'
    : POSTER_DEFAULTS.subtitle;
  const maxItems = mode === 'controversy' ? 100 : 10;
  return {
    version: 1,
    mode,
    title: String(input.title ?? defaultTitle),
    subtitle: String(input.subtitle ?? defaultSubtitle),
    comparisonLabel: String(input.comparisonLabel ?? input.comparison_label ?? POSTER_DEFAULTS.comparisonLabel),
    thresholds: normalizeThresholds(input.thresholds),
    style: normalizeStyle(input.style ?? input),
    items: (Array.isArray(input.items) ? input.items : []).map(normalizeItem).slice(0, maxItems),
  };
}

export function createPosterProject(input = {}) {
  return normalizePosterProject(input);
}

export function sortPosterItems(items, mode = 'red') {
  const copy = [...items];
  if (mode === 'black') {
    return copy.sort((a, b) => finite(a.score) - finite(b.score) || finite(b.voters) - finite(a.voters));
  }
  if (mode === 'red') {
    return copy.sort((a, b) => finite(b.score) - finite(a.score) || finite(b.voters) - finite(a.voters));
  }
  if (mode === 'controversy') {
    return copy.sort((a, b) => finite(b.stdDev) - finite(a.stdDev) || finite(b.voters) - finite(a.voters));
  }
  throw new Error("mode must be 'red', 'black' or 'controversy'");
}

export function posterDisplayRows(items, mode = 'red') {
  if (mode !== 'controversy') {
    return sortPosterItems(items, mode).slice(0, 10).map((item, index) => ({
      item,
      section: mode,
      displayRank: index + 1,
    }));
  }

  const sortedHigh = sortPosterItems(items, 'controversy');
  const high = sortedHigh.slice(0, 5);
  const highIds = new Set(high.map((item) => item.id));
  const low = [...items]
    .filter((item) => !highIds.has(item.id))
    .sort((a, b) => finite(a.stdDev) - finite(b.stdDev) || finite(b.voters) - finite(a.voters))
    .slice(0, 5);

  return [
    ...high.map((item, index) => ({item, section: 'controversial', displayRank: index + 1})),
    ...low.map((item, index) => ({item, section: 'consistent', displayRank: index + 1})),
  ];
}

export function trendState(score, bgmScore, mode = 'red', thresholds = {}) {
  if (bgmScore === null || bgmScore === undefined || bgmScore === '') return 'flat';
  const t = normalizeThresholds(thresholds);
  const delta = finite(score) - finite(bgmScore);
  if (mode === 'red') {
    if (delta >= t.redUp) return 'up';
    if (delta < t.redDown) return 'down';
    return 'flat';
  }
  if (mode === 'black') {
    if (delta > t.blackUp) return 'up';
    if (delta <= t.blackDown) return 'down';
    return 'flat';
  }
  throw new Error("trendState supports only 'red' and 'black'");
}

export function controversyTrendState(stdDev, bgmStdDev, section, thresholds = {}) {
  if (bgmStdDev === null || bgmStdDev === undefined || bgmStdDev === '') return 'flat';
  const t = normalizeThresholds(thresholds);
  const delta = finite(stdDev) - finite(bgmStdDev);
  if (section === 'controversial') {
    if (delta >= t.controversyHighUp) return 'up';
    if (delta < t.controversyHighDown) return 'down';
    return 'flat';
  }
  if (section === 'consistent') {
    if (delta > t.controversyLowUp) return 'up';
    if (delta <= t.controversyLowDown) return 'down';
    return 'flat';
  }
  throw new Error("section must be 'controversial' or 'consistent'");
}

export function cropTransform(imageWidth, imageHeight, viewportWidth, viewportHeight, crop = {}) {
  const iw = Math.max(1, finite(imageWidth, 1));
  const ih = Math.max(1, finite(imageHeight, 1));
  const vw = Math.max(1, finite(viewportWidth, 1));
  const vh = Math.max(1, finite(viewportHeight, 1));
  const viewportAspect = vw / vh;
  const imageAspect = iw / ih;

  let baseSw;
  let baseSh;
  if (imageAspect >= viewportAspect) {
    baseSh = ih;
    baseSw = ih * viewportAspect;
  } else {
    baseSw = iw;
    baseSh = iw / viewportAspect;
  }

  const normalized = normalizeCrop(crop);
  const sw = baseSw / normalized.zoom;
  const sh = baseSh / normalized.zoom;
  const maxX = Math.max(0, iw - sw);
  const maxY = Math.max(0, ih - sh);
  const sx = clamp(maxX / 2 + normalized.offsetX * maxX / 2, 0, maxX);
  const sy = clamp(maxY / 2 + normalized.offsetY * maxY / 2, 0, maxY);
  return {sx, sy, sw, sh};
}

function serializableFontSources(input = {}) {
  const output = {};
  for (const [role, source] of Object.entries(input)) {
    if (!source || typeof source !== 'object') continue;
    const filename = String(source.filename ?? '').trim();
    if (filename) output[role] = {filename};
  }
  return output;
}

export function serializePosterProject(project) {
  const normalized = normalizePosterProject(project);
  const items = normalized.items.map(({imageUrl: _imageUrl, ...item}) => ({...item}));
  const fontSources = serializableFontSources(normalized.style.fontSources);
  const style = {...normalized.style, fontSources};
  return JSON.stringify({...normalized, style, items}, null, 2);
}
