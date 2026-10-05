let fallbackId = 0;

export const POSTER_MODES = Object.freeze([
  'red',
  'black',
  'controversy',
  'favorite',
  'midseason-change',
  'bgm-deviation',
]);

const DUAL_SECTION_MODES = new Set(['controversy', 'midseason-change', 'bgm-deviation']);

const DEFAULT_THRESHOLDS = Object.freeze({
  scoreBgmDown: 0,
  scoreBgmUp: 0.7,
  controversyDown: -0.5,
  controversyUp: 0.5,
  favoriteDown: 0,
  favoriteUp: 5,
  midseasonDown: 0,
  midseasonUp: 0,
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

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function nullableFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveInteger(value) {
  const number = nullableFinite(value);
  if (number === null) return null;
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : null;
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

function normalizeAnimeTitle(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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
    favoritePoints: Math.max(0, finite(item.favoritePoints ?? item.favorite_points, 0)),
    top5Count: Math.max(0, Math.round(finite(item.top5Count ?? item.top5_count, 0))),
    scoreRank: nullablePositiveInteger(item.scoreRank ?? item.score_rank),
    midseasonScore: nullableFinite(item.midseasonScore ?? item.midseason_score),
    midseasonVoters: nullablePositiveInteger(item.midseasonVoters ?? item.midseason_voters),
    visualId: String(item.visualId ?? item.visual_id ?? '').trim(),
    imageName: String(item.imageName ?? item.image ?? imageAsset?.fileName ?? ''),
    imageUrl: String(item.imageUrl ?? ''),
    imageAsset,
    crop: normalizeCrop(item.crop, item.focus),
    brightness: clamp(finite(item.brightness, 0.78), 0.1, 1.5),
    providerIds: normalizeProviderIds(item.providerIds ?? item.provider_ids),
  };
}

export function normalizePosterVisual(input = {}) {
  const asset = normalizeImageAsset(input.asset ?? input.imageAsset ?? input.image_asset);
  return {
    visualId: String(input.visualId ?? input.visual_id ?? nextId()).trim(),
    animeTitle: String(input.animeTitle ?? input.anime_title ?? '').trim(),
    providerIds: normalizeProviderIds(input.providerIds ?? input.provider_ids),
    label: String(input.label ?? asset?.fileName ?? '视觉方案').trim() || '视觉方案',
    asset,
    crop: normalizeCrop(input.crop, input.focus),
    brightness: clamp(finite(input.brightness, 0.78), 0.1, 1.5),
  };
}

export function posterVisualMatchesItem(visual, item) {
  const visualTmdb = Number(visual?.providerIds?.tmdb);
  const itemTmdb = Number(item?.providerIds?.tmdb);
  const hasVisualTmdb = Number.isInteger(visualTmdb) && visualTmdb > 0;
  const hasItemTmdb = Number.isInteger(itemTmdb) && itemTmdb > 0;
  if (hasVisualTmdb && hasItemTmdb) return visualTmdb === itemTmdb;
  const visualTitle = normalizeAnimeTitle(visual?.animeTitle);
  const itemTitle = normalizeAnimeTitle(item?.title);
  return Boolean(visualTitle && itemTitle && visualTitle === itemTitle);
}

function normalizeThresholds(input = {}, mode = 'red') {
  const legacyScoreDown = mode === 'black'
    ? firstPresent(input.blackDown, input.black_down)
    : mode === 'red'
      ? firstPresent(input.redDown, input.red_down)
      : undefined;
  const legacyScoreUp = mode === 'black'
    ? firstPresent(input.blackUp, input.black_up)
    : mode === 'red'
      ? firstPresent(input.redUp, input.red_up)
      : undefined;

  return {
    scoreBgmDown: finite(
      firstPresent(input.scoreBgmDown, input.score_bgm_down, legacyScoreDown),
      DEFAULT_THRESHOLDS.scoreBgmDown,
    ),
    scoreBgmUp: finite(
      firstPresent(input.scoreBgmUp, input.score_bgm_up, legacyScoreUp),
      DEFAULT_THRESHOLDS.scoreBgmUp,
    ),
    controversyDown: finite(
      firstPresent(input.controversyDown, input.controversy_down),
      DEFAULT_THRESHOLDS.controversyDown,
    ),
    controversyUp: finite(
      firstPresent(input.controversyUp, input.controversy_up),
      DEFAULT_THRESHOLDS.controversyUp,
    ),
    favoriteDown: finite(
      firstPresent(input.favoriteDown, input.favorite_down),
      DEFAULT_THRESHOLDS.favoriteDown,
    ),
    favoriteUp: finite(
      firstPresent(input.favoriteUp, input.favorite_up),
      DEFAULT_THRESHOLDS.favoriteUp,
    ),
    midseasonDown: finite(
      firstPresent(input.midseasonDown, input.midseason_down),
      DEFAULT_THRESHOLDS.midseasonDown,
    ),
    midseasonUp: finite(
      firstPresent(input.midseasonUp, input.midseason_up),
      DEFAULT_THRESHOLDS.midseasonUp,
    ),
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

function defaultCopy(mode) {
  if (mode === 'black') {
    return {
      title: '7月新番中期黑榜 BOTTOM 10',
      subtitle: POSTER_DEFAULTS.subtitle,
      comparisonLabel: 'VS BANGUMI',
    };
  }
  if (mode === 'controversy') {
    return {
      title: '7月新番中期争议度',
      subtitle: 'MOST CONTROVERSIAL / MOST CONSISTENT',
      comparisonLabel: 'VS BANGUMI',
    };
  }
  if (mode === 'favorite') {
    return {
      title: '7月新番中期喜爱度 TOP 10',
      subtitle: 'FAVORITE TOP 10 ANIME',
      comparisonLabel: 'VS SCORE RANK',
    };
  }
  if (mode === 'midseason-change') {
    return {
      title: '7月新番中期→完结评价变化',
      subtitle: 'MOST IMPROVED / MOST DECLINED',
      comparisonLabel: 'VS MID-SEASON',
    };
  }
  if (mode === 'bgm-deviation') {
    return {
      title: '7月新番社内 / Bangumi 评分偏差',
      subtitle: 'MOST ABOVE BANGUMI / MOST BELOW BANGUMI',
      comparisonLabel: 'VS BANGUMI',
    };
  }
  return {
    title: POSTER_DEFAULTS.title,
    subtitle: POSTER_DEFAULTS.subtitle,
    comparisonLabel: POSTER_DEFAULTS.comparisonLabel,
  };
}

export function normalizePosterProject(input = {}) {
  const requestedMode = String(input.mode ?? '').trim();
  const mode = POSTER_MODES.includes(requestedMode) ? requestedMode : 'red';
  const copy = defaultCopy(mode);
  const maxItems = DUAL_SECTION_MODES.has(mode) ? 100 : 10;
  return {
    version: 1,
    mode,
    title: String(input.title ?? copy.title),
    subtitle: String(input.subtitle ?? copy.subtitle),
    comparisonLabel: String(input.comparisonLabel ?? input.comparison_label ?? copy.comparisonLabel),
    thresholds: normalizeThresholds(input.thresholds, mode),
    style: normalizeStyle(input.style ?? input),
    items: (Array.isArray(input.items) ? input.items : []).map(normalizeItem).slice(0, maxItems),
  };
}

export function createPosterProject(input = {}) {
  return normalizePosterProject(input);
}

function nullableDifference(left, right) {
  if (right === null || right === undefined || right === '') return null;
  return finite(left) - finite(right);
}

function midseasonDelta(item) {
  return nullableDifference(item.score, item.midseasonScore);
}

function bgmDelta(item) {
  return nullableDifference(item.score, item.bgmScore);
}

function compareNullableDescending(getValue, tieBreaker) {
  return (a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av === null && bv === null) return tieBreaker(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || tieBreaker(a, b);
  };
}

function compareNullableAscending(getValue, tieBreaker) {
  return (a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av === null && bv === null) return tieBreaker(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv || tieBreaker(a, b);
  };
}

const voterTie = (a, b) => finite(b.voters) - finite(a.voters);
const midseasonVoterTie = (a, b) => finite(b.midseasonVoters) - finite(a.midseasonVoters) || voterTie(a, b);

export function sortPosterItems(items, mode = 'red') {
  const copy = [...items];
  if (mode === 'black') {
    return copy.sort((a, b) => finite(a.score) - finite(b.score) || voterTie(a, b));
  }
  if (mode === 'red') {
    return copy.sort((a, b) => finite(b.score) - finite(a.score) || voterTie(a, b));
  }
  if (mode === 'controversy') {
    return copy.sort((a, b) => finite(b.stdDev) - finite(a.stdDev) || voterTie(a, b));
  }
  if (mode === 'favorite') {
    return copy.sort((a, b) => finite(b.favoritePoints) - finite(a.favoritePoints) || finite(b.top5Count) - finite(a.top5Count));
  }
  if (mode === 'midseason-change') {
    return copy.sort(compareNullableDescending(midseasonDelta, midseasonVoterTie));
  }
  if (mode === 'bgm-deviation') {
    return copy.sort(compareNullableDescending(bgmDelta, voterTie));
  }
  throw new Error(`unknown poster mode: ${mode}`);
}

function dualSectionRows(items, mode) {
  let high;
  let lowSorter;
  let highSection;
  let lowSection;

  if (mode === 'controversy') {
    high = sortPosterItems(items, 'controversy').slice(0, 5);
    lowSorter = (a, b) => finite(a.stdDev) - finite(b.stdDev) || voterTie(a, b);
    highSection = 'controversial';
    lowSection = 'consistent';
  } else if (mode === 'midseason-change') {
    high = sortPosterItems(items, 'midseason-change').slice(0, 5);
    lowSorter = compareNullableAscending(midseasonDelta, midseasonVoterTie);
    highSection = 'improved';
    lowSection = 'declined';
  } else if (mode === 'bgm-deviation') {
    high = sortPosterItems(items, 'bgm-deviation').slice(0, 5);
    lowSorter = compareNullableAscending(bgmDelta, voterTie);
    highSection = 'above';
    lowSection = 'below';
  } else {
    throw new Error(`mode is not dual-section: ${mode}`);
  }

  const highItems = new Set(high);
  const low = [...items].filter((item) => !highItems.has(item)).sort(lowSorter).slice(0, 5);
  return [
    ...high.map((item, index) => ({item, section: highSection, displayRank: index + 1})),
    ...low.map((item, index) => ({item, section: lowSection, displayRank: index + 1})),
  ];
}

export function posterDisplayRows(items, mode = 'red') {
  if (DUAL_SECTION_MODES.has(mode)) return dualSectionRows(items, mode);
  return sortPosterItems(items, mode).slice(0, 10).map((item, index) => ({
    item,
    section: mode,
    displayRank: index + 1,
  }));
}

export function trendState(score, bgmScore, mode = 'red', thresholds = {}) {
  if (bgmScore === null || bgmScore === undefined || bgmScore === '') return 'flat';
  if (!['red', 'black', 'bgm-deviation'].includes(mode)) {
    throw new Error("trendState supports only 'red', 'black' and 'bgm-deviation'");
  }
  const t = normalizeThresholds(thresholds, mode);
  const delta = finite(score) - finite(bgmScore);
  if (delta >= t.scoreBgmUp) return 'up';
  if (delta < t.scoreBgmDown) return 'down';
  return 'flat';
}

export function controversyTrendState(stdDev, bgmStdDev, sectionOrThresholds = {}, maybeThresholds = {}) {
  if (bgmStdDev === null || bgmStdDev === undefined || bgmStdDev === '') return 'flat';
  const thresholds = typeof sectionOrThresholds === 'string' ? maybeThresholds : sectionOrThresholds;
  const t = normalizeThresholds(thresholds, 'controversy');
  const delta = finite(stdDev) - finite(bgmStdDev);
  if (delta >= t.controversyUp) return 'up';
  if (delta <= t.controversyDown) return 'down';
  return 'flat';
}

export function favoriteTrendState(favoriteRank, scoreRank, thresholds = {}) {
  if (scoreRank === null || scoreRank === undefined || scoreRank === '') return 'flat';
  const t = normalizeThresholds(thresholds, 'favorite');
  const delta = finite(scoreRank) - finite(favoriteRank);
  if (delta >= t.favoriteUp) return 'up';
  if (delta < t.favoriteDown) return 'down';
  return 'flat';
}

export function midseasonTrendState(score, midseasonScore, thresholds = {}) {
  if (midseasonScore === null || midseasonScore === undefined || midseasonScore === '') return 'flat';
  const t = normalizeThresholds(thresholds, 'midseason-change');
  const delta = finite(score) - finite(midseasonScore);
  if (delta > t.midseasonUp) return 'up';
  if (delta < t.midseasonDown) return 'down';
  return 'flat';
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
