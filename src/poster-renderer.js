import {
  controversyTrendState,
  cropTransform,
  favoriteTrendState,
  posterDisplayRows,
  trendState,
} from './poster-model.js';

export const POSTER_LAYOUT = Object.freeze({
  width: 1200,
  height: 1800,
  headerHeight: 146,
  brandWidth: 344,
  left: 22,
  rankWidth: 110,
  visualX: 132,
  visualWidth: 699,
  statsX: 831,
  statsWidth: 345,
  statsSplit: 158,
  right: 1176,
  rowHeight: 136,
  rowY: Object.freeze([168,317,467,616,766,915,1065,1214,1364,1514]),
  statsFootHeight: 22,
  statsHeadY: 146,
  statsHeadHeight: 22,
  deltaSignWidth: 24,
});

const COLORS = Object.freeze({
  header: '#000000',
  brand: '#ff6671',
  stats: '#1e1e1e',
  rankTop: '#ff686f',
  rankNormal: '#ef9448',
  labelRed: '#dd0000',
  trendUp: '#36c120',
  trendFlat: '#ffb018',
  trendDown: '#dd0000',
  white: '#ffffff',
  black: '#000000',
});

export function measurePosterRows() {
  return POSTER_LAYOUT.rowY.map((y, index) => ({
    index,
    x: POSTER_LAYOUT.left,
    y,
    width: POSTER_LAYOUT.right - POSTER_LAYOUT.left,
    height: POSTER_LAYOUT.rowHeight,
  }));
}

export function rowAtCanvasPoint(x, y) {
  if (x < POSTER_LAYOUT.left || x >= POSTER_LAYOUT.right) return null;
  for (let index = 0; index < POSTER_LAYOUT.rowY.length; index += 1) {
    const top = POSTER_LAYOUT.rowY[index];
    if (y >= top && y < top + POSTER_LAYOUT.rowHeight) return index;
  }
  return null;
}

function fontString(weight, size, family) {
  return `${weight} ${Math.round(size)}px ${family}`;
}

function textHeight(metrics, fallback) {
  const measured = (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0);
  return measured || fallback;
}

function centerText(ctx, text, x1, y1, x2, y2, {font, fill = COLORS.white, yOffset = 0} = {}) {
  if (font) ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || 0;
  const descent = metrics.actualBoundingBoxDescent || 0;
  const baseline = (y1 + y2 + ascent - descent) / 2 + yOffset;
  ctx.fillText(text, (x1 + x2) / 2, baseline);
}

function drawHeader(ctx, project) {
  const {style} = project;
  ctx.fillStyle = COLORS.header;
  ctx.fillRect(0, 0, POSTER_LAYOUT.width, POSTER_LAYOUT.headerHeight);
  ctx.fillStyle = COLORS.brand;
  ctx.fillRect(0, 0, POSTER_LAYOUT.brandWidth, POSTER_LAYOUT.headerHeight);

  const titleFont = fontString(900, style.fontSizes.headerTitle, style.fontFamilies.headerTitle);
  const subtitleFont = fontString(900, style.fontSizes.headerSubtitle, style.fontFamilies.headerSubtitle);
  ctx.font = titleFont;
  const tm = ctx.measureText(project.title);
  const titleHeight = textHeight(tm, style.fontSizes.headerTitle * 0.9);
  ctx.font = subtitleFont;
  const sm = ctx.measureText(project.subtitle);
  const subtitleHeight = textHeight(sm, style.fontSizes.headerSubtitle * 0.9);
  const total = titleHeight + style.headerLineGap + subtitleHeight;
  const top = (POSTER_LAYOUT.headerHeight - total) / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = 'top';
  ctx.font = titleFont;
  ctx.fillText(project.title, 365, top);
  ctx.font = subtitleFont;
  ctx.fillText(project.subtitle, 365, top + titleHeight + style.headerLineGap);
}

function placeholder(ctx, x, y, width, height, seed) {
  ctx.save();
  const lightness = 35 + (seed * 4) % 12;
  ctx.fillStyle = `hsl(${210 + seed * 9} 18% ${lightness}%)`;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#ffffff';
  for (let p = -height; p < width; p += 120) {
    ctx.beginPath();
    ctx.moveTo(x + p, y);
    ctx.lineTo(x + p + 58, y);
    ctx.lineTo(x + p + height + 58, y + height);
    ctx.lineTo(x + p + height, y + height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawVisual(ctx, item, image, x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight);
  ctx.clip();
  if (image?.naturalWidth || image?.width) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const source = cropTransform(iw, ih, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight, item.crop);
    ctx.filter = `brightness(${Math.round(item.brightness * 100)}%)`;
    ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, x, y, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight);
    ctx.filter = 'none';
  } else {
    placeholder(ctx, x, y, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight, Math.abs((item.title || '').length));
  }

  const horizontal = ctx.createLinearGradient(x, 0, x + POSTER_LAYOUT.visualWidth, 0);
  horizontal.addColorStop(0, 'rgba(0,0,0,.38)');
  horizontal.addColorStop(1, 'rgba(0,0,0,.06)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(x, y, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight);
  const vertical = ctx.createLinearGradient(0, y, 0, y + POSTER_LAYOUT.rowHeight);
  vertical.addColorStop(0, 'rgba(0,0,0,.05)');
  vertical.addColorStop(1, 'rgba(0,0,0,.48)');
  ctx.fillStyle = vertical;
  ctx.fillRect(x, y, POSTER_LAYOUT.visualWidth, POSTER_LAYOUT.rowHeight);
  ctx.restore();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let current = '';
  for (const char of text) {
    const trial = current + char;
    if (!current || ctx.measureText(trial).width <= maxWidth) {
      current = trial;
    } else {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join('') !== text && lines.length) {
    const last = lines.length - 1;
    while (lines[last] && ctx.measureText(lines[last] + '…').width > maxWidth) {
      lines[last] = lines[last].slice(0, -1);
    }
    lines[last] += '…';
  }
  return lines;
}

function titleLines(ctx, item, style) {
  const maxWidth = POSTER_LAYOUT.visualWidth - 44;
  if (item.titleLines?.length) return {lines: item.titleLines.slice(0, 2), size: style.fontSizes.anime};
  for (const size of [style.fontSizes.anime, style.fontSizes.animeSmall]) {
    ctx.font = fontString(800, size, style.fontFamilies.anime);
    if (ctx.measureText(item.title).width <= maxWidth) return {lines: [item.title], size};
    const lines = wrapText(ctx, item.title, maxWidth, 2);
    if (lines.length <= 2) return {lines, size};
  }
  return {lines: wrapText(ctx, item.title, maxWidth, 2), size: style.fontSizes.animeSmall};
}

function drawAnimeTitle(ctx, item, x, y, style) {
  const {lines, size} = titleLines(ctx, item, style);
  const lineHeight = size >= style.fontSizes.anime ? 39 : 34;
  const top = y + POSTER_LAYOUT.rowHeight - 16 - lineHeight * lines.length;
  ctx.font = fontString(800, size, style.fontFamilies.anime);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.fillStyle = COLORS.white;
  lines.forEach((line, lineNo) => {
    const yy = top + lineNo * lineHeight;
    ctx.strokeText(line, x + 20, yy);
    ctx.fillText(line, x + 20, yy);
  });
}

function drawSectionBadge(ctx, section, x, y, project) {
  if (section !== 'controversial' && section !== 'consistent') return;
  const text = section === 'controversial' ? 'MOST CONTROVERSIAL' : 'MOST CONSISTENT';
  ctx.save();
  ctx.font = fontString(900, 13, project.style.fontFamilies.label);
  const width = Math.ceil(ctx.measureText(text).width) + 22;
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fillRect(x + 12, y + 10, width, 24);
  centerText(ctx, text, x + 12, y + 10, x + 12 + width, y + 34, {
    font: fontString(900, 13, project.style.fontFamilies.label),
  });
  ctx.restore();
}

function drawContainedImage(ctx, image, x1, y1, x2, y2) {
  if (!image) return;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  const scale = Math.min((x2 - x1) / iw, (y2 - y1) / ih, 1);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(image, x1 + (x2 - x1 - w) / 2, y1 + (y2 - y1 - h) / 2, w, h);
}

function drawDelta(ctx, delta, x1, y1, x2, y2, project) {
  const family = project.style.fontFamilies.trendDelta;
  const size = project.style.fontSizes.trendDelta;
  ctx.font = fontString(900, size, family);
  const negative = delta < 0;
  const sign = negative ? '−' : '+';
  const magnitude = Math.abs(delta).toFixed(2);
  const magWidth = ctx.measureText(magnitude).width;
  const totalWidth = POSTER_LAYOUT.deltaSignWidth + magWidth;
  const left = (x1 + x2 - totalWidth) / 2;
  centerText(ctx, sign, left, y1, left + POSTER_LAYOUT.deltaSignWidth, y2, {
    font: fontString(900, size, family),
    yOffset: negative ? project.style.deltaMinusYOffset : 0,
  });
  centerText(ctx, magnitude, left + POSTER_LAYOUT.deltaSignWidth, y1, left + totalWidth, y2, {
    font: fontString(900, size, family),
  });
}

function drawRankDifference(ctx, delta, x1, y1, x2, y2, project) {
  const family = project.style.fontFamilies.trendDelta;
  const size = project.style.fontSizes.trendDelta;
  ctx.font = fontString(900, size, family);
  const negative = delta < 0;
  const sign = negative ? '−' : '+';
  const magnitude = String(Math.abs(Math.round(delta)));
  const magWidth = ctx.measureText(magnitude).width;
  const totalWidth = POSTER_LAYOUT.deltaSignWidth + magWidth;
  const left = (x1 + x2 - totalWidth) / 2;
  centerText(ctx, sign, left, y1, left + POSTER_LAYOUT.deltaSignWidth, y2, {
    font: fontString(900, size, family),
    yOffset: negative ? project.style.deltaMinusYOffset : 0,
  });
  centerText(ctx, magnitude, left + POSTER_LAYOUT.deltaSignWidth, y1, left + totalWidth, y2, {
    font: fontString(900, size, family),
  });
}

function drawRow(ctx, project, rowInfo, rankIndex, resources) {
  const {item, section, displayRank} = rowInfo;
  const y = POSTER_LAYOUT.rowY[rankIndex];
  const bottom = y + POSTER_LAYOUT.rowHeight;
  const footY = bottom - POSTER_LAYOUT.statsFootHeight;
  const rankX2 = POSTER_LAYOUT.left + POSTER_LAYOUT.rankWidth;
  const visualX = rankX2;
  const statsX = POSTER_LAYOUT.statsX;
  const split = statsX + POSTER_LAYOUT.statsSplit;
  const topRank = displayRank <= 3;

  ctx.fillStyle = topRank ? COLORS.rankTop : COLORS.rankNormal;
  ctx.fillRect(POSTER_LAYOUT.left, y, POSTER_LAYOUT.rankWidth, POSTER_LAYOUT.rowHeight);
  ctx.fillStyle = COLORS.stats;
  ctx.fillRect(statsX, y, POSTER_LAYOUT.statsWidth, POSTER_LAYOUT.rowHeight);

  const image = resources.images?.get?.(item.id) || resources.images?.[item.id] || null;
  drawVisual(ctx, item, image, visualX, y);
  if (project.mode === 'controversy' && (rankIndex === 0 || rankIndex === 5)) {
    drawSectionBadge(ctx, section, visualX, y, project);
  }

  centerText(ctx, String(displayRank), POSTER_LAYOUT.left, y - 8, rankX2, bottom - 8, {
    font: fontString(900, project.style.fontSizes.rank, project.style.fontFamilies.rank),
    fill: topRank ? COLORS.white : COLORS.black,
  });
  drawAnimeTitle(ctx, item, visualX, y, project.style);

  const controversy = project.mode === 'controversy';
  const favorite = project.mode === 'favorite';
  const metric = controversy ? Number(item.stdDev) : favorite ? Number(item.favoritePoints) : Number(item.score);
  const metricText = favorite
    ? Number.isFinite(metric) ? String(Math.round(metric)) : '--'
    : Number.isFinite(metric) ? metric.toFixed(2) : '--';
  centerText(ctx, metricText, statsX, y, split, footY, {
    font: fontString(900, project.style.fontSizes.metric, project.style.fontFamilies.metric),
  });

  const comparisonValue = controversy ? item.bgmStdDev : favorite ? item.scoreRank : item.bgmScore;
  const hasComparison = comparisonValue !== null && comparisonValue !== undefined && comparisonValue !== '';
  const state = controversy
    ? controversyTrendState(item.stdDev, item.bgmStdDev, section, project.thresholds)
    : favorite
      ? favoriteTrendState(displayRank, item.scoreRank, project.thresholds)
      : trendState(item.score, item.bgmScore, project.mode, project.thresholds);
  const delta = controversy
    ? Number(item.stdDev) - Number(item.bgmStdDev ?? item.stdDev)
    : favorite
      ? Number(item.scoreRank ?? displayRank) - displayRank
      : Number(item.score) - Number(item.bgmScore ?? item.score);
  drawContainedImage(ctx, resources.trendIcons?.[state], split + 6, y + 27, split + 78, y + 91);
  if (hasComparison) {
    if (favorite) drawRankDifference(ctx, delta, split + 79, y, POSTER_LAYOUT.right - 4, footY, project);
    else drawDelta(ctx, delta, split + 79, y, POSTER_LAYOUT.right - 4, footY, project);
  } else {
    centerText(ctx, '--', split + 79, y, POSTER_LAYOUT.right - 4, footY, {
      font: fontString(900, project.style.fontSizes.trendDelta, project.style.fontFamilies.trendDelta),
    });
  }

  const strip = state === 'up' ? COLORS.trendUp : state === 'down' ? COLORS.trendDown : COLORS.trendFlat;
  ctx.fillStyle = strip;
  ctx.fillRect(statsX, footY, POSTER_LAYOUT.statsWidth, POSTER_LAYOUT.statsFootHeight);
  const stripText = state === 'down' ? COLORS.white : COLORS.black;
  const leftFoot = controversy
    ? `AVG ${Number(item.score).toFixed(2)} · N${item.voters}`
    : favorite
      ? `TOP5 ${item.top5Count}`
      : `投票数 ${item.voters}`;
  const rightFoot = controversy
    ? item.bgmStdDev === null || item.bgmStdDev === undefined
      ? 'BGM SD --'
      : `BGM SD ${Number(item.bgmStdDev).toFixed(2)}`
    : favorite
      ? item.scoreRank === null || item.scoreRank === undefined
        ? 'SCORE --'
        : `SCORE #${item.scoreRank}`
      : item.bgmScore === null || item.bgmScore === undefined
        ? 'BGM --'
        : `BGM ${Number(item.bgmScore).toFixed(2)}`;
  centerText(ctx, leftFoot, statsX, footY, split, bottom, {
    font: fontString(800, project.style.fontSizes.aux, project.style.fontFamilies.aux),
    fill: stripText,
  });
  centerText(ctx, rightFoot, split, footY, POSTER_LAYOUT.right, bottom, {
    font: fontString(800, project.style.fontSizes.aux, project.style.fontFamilies.aux),
    fill: stripText,
  });
}

function drawStatsHeaders(ctx, project) {
  const x = POSTER_LAYOUT.statsX;
  const split = x + POSTER_LAYOUT.statsSplit;
  const y = POSTER_LAYOUT.statsHeadY;
  const h = POSTER_LAYOUT.statsHeadHeight;
  ctx.fillStyle = COLORS.labelRed;
  ctx.fillRect(x, y, POSTER_LAYOUT.statsSplit, h);
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(split, y, POSTER_LAYOUT.statsWidth - POSTER_LAYOUT.statsSplit, h);
  const metricLabel = project.mode === 'controversy'
    ? 'STD. DEV.'
    : project.mode === 'favorite'
      ? 'FAVORITE PTS'
      : 'AVERAGE SCORE';
  centerText(ctx, metricLabel, x, y, split, y + h, {
    font: fontString(800, project.style.fontSizes.label, project.style.fontFamilies.label),
  });
  centerText(ctx, project.comparisonLabel, split, y, POSTER_LAYOUT.right, y + h, {
    font: fontString(800, project.style.fontSizes.label, project.style.fontFamilies.label),
    fill: COLORS.black,
  });
}

export function renderPoster(canvas, rawProject, resources = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  if (canvas.width !== POSTER_LAYOUT.width) canvas.width = POSTER_LAYOUT.width;
  if (canvas.height !== POSTER_LAYOUT.height) canvas.height = POSTER_LAYOUT.height;
  ctx.clearRect(0, 0, POSTER_LAYOUT.width, POSTER_LAYOUT.height);
  drawHeader(ctx, rawProject);
  const rows = posterDisplayRows(rawProject.items || [], rawProject.mode).slice(0, 10);
  rows.forEach((row, index) => drawRow(ctx, rawProject, row, index, resources));
  drawStatsHeaders(ctx, rawProject);
}
