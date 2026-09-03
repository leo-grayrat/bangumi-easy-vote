const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const API_KEY_PATTERN = /^[a-f0-9]{32}$/i;

export function resolveTmdbCredential(value, env = process.env) {
  const raw = String(value ?? env.TMDB_API_TOKEN ?? env.TMDB_API_KEY ?? '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/^Bearer\s+/i, '').trim();
  return API_KEY_PATTERN.test(normalized)
    ? { type: 'apiKey', value: normalized }
    : { type: 'bearer', value: normalized };
}

async function tmdbJson(pathname, { credential, fetchImpl = globalThis.fetch, params = {} } = {}) {
  const auth = resolveTmdbCredential(credential);
  if (!auth) throw new Error('缺少 TMDB API Read Access Token 或 API Key。');
  if (typeof fetchImpl !== 'function') throw new Error('当前环境无法访问 TMDB。');

  const url = new URL(`${TMDB_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = { Accept: 'application/json' };
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${auth.value}`;
  else url.searchParams.set('api_key', auth.value);

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.status_message ? ` ${body.status_message}` : '';
    } catch {
      // Keep the status-only error when TMDB returns a non-JSON body.
    }
    throw new Error(`TMDB 请求失败（HTTP ${response.status}）。${detail}`.trim());
  }
  return response.json();
}

function normalizeSearchResult(item) {
  return {
    id: Number(item.id),
    name: String(item.name ?? ''),
    originalName: String(item.original_name ?? ''),
    year: String(item.first_air_date ?? '').slice(0, 4),
    firstAirDate: String(item.first_air_date ?? ''),
    countries: Array.isArray(item.origin_country) ? item.origin_country.map(String) : [],
    posterPath: item.poster_path || null,
    backdropPath: item.backdrop_path || null,
    popularity: Number(item.popularity) || 0,
  };
}

function normalizeArtwork(image) {
  return {
    filePath: String(image.file_path ?? ''),
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    aspectRatio: Number(image.aspect_ratio) || (Number(image.width) && Number(image.height) ? Number(image.width) / Number(image.height) : 0),
    voteAverage: Number(image.vote_average) || 0,
    language: image.iso_639_1 ?? null,
  };
}

function sortArtwork(items) {
  return items
    .map(normalizeArtwork)
    .filter((item) => item.filePath)
    .sort((a, b) => b.voteAverage - a.voteAverage || b.width * b.height - a.width * a.height);
}

export async function searchTmdbTv(query, options = {}) {
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery) throw new Error('请输入要搜索的动画标题。');
  const data = await tmdbJson('/search/tv', {
    ...options,
    params: {
      query: normalizedQuery,
      language: options.language ?? 'zh-CN',
      include_adult: 'false',
      page: 1,
    },
  });
  return (Array.isArray(data.results) ? data.results : [])
    .map(normalizeSearchResult)
    .filter((item) => Number.isFinite(item.id))
    .slice(0, 12);
}

function airedOnOrBefore(airDate, today) {
  if (!airDate) return false;
  return String(airDate) <= today;
}

async function recentEpisodeStills(seriesId, series, options) {
  const today = String(options.today ?? new Date().toISOString().slice(0, 10));
  const seasons = (Array.isArray(series.seasons) ? series.seasons : [])
    .filter((season) => Number(season.season_number) > 0 && Number(season.episode_count) > 0)
    .sort((a, b) => Number(b.season_number) - Number(a.season_number));
  const episodes = [];

  for (const season of seasons) {
    if (episodes.length >= 3) break;
    if (season.air_date && !airedOnOrBefore(season.air_date, today)) continue;
    const seasonNumber = Number(season.season_number);
    const detail = await tmdbJson(`/tv/${seriesId}/season/${seasonNumber}`, {
      ...options,
      params: { language: options.language ?? 'zh-CN' },
    });
    const candidates = (Array.isArray(detail.episodes) ? detail.episodes : [])
      .filter((episode) => episode.still_path && airedOnOrBefore(episode.air_date, today))
      .sort((a, b) => String(b.air_date).localeCompare(String(a.air_date)) || Number(b.episode_number) - Number(a.episode_number));
    for (const episode of candidates) {
      episodes.push({
        seasonNumber,
        episodeNumber: Number(episode.episode_number),
        name: String(episode.name ?? ''),
        airDate: String(episode.air_date ?? ''),
        filePath: String(episode.still_path),
      });
      if (episodes.length >= 3) break;
    }
  }
  return episodes;
}

export async function getTmdbArtwork(seriesId, options = {}) {
  const id = Number(seriesId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('TMDB 条目标识无效。');
  const language = options.language ?? 'zh-CN';
  const [series, images] = await Promise.all([
    tmdbJson(`/tv/${id}`, { ...options, params: { language } }),
    tmdbJson(`/tv/${id}/images`, { ...options, params: { include_image_language: 'zh,en,ja,null' } }),
  ]);
  const episodes = await recentEpisodeStills(id, series, { ...options, language });
  return {
    series: {
      id,
      name: String(series.name ?? ''),
      originalName: String(series.original_name ?? ''),
      year: String(series.first_air_date ?? '').slice(0, 4),
    },
    backdrops: sortArtwork(Array.isArray(images.backdrops) ? images.backdrops : []).slice(0, 30),
    posters: sortArtwork(Array.isArray(images.posters) ? images.posters : []).slice(0, 24),
    logos: sortArtwork(Array.isArray(images.logos) ? images.logos : []).slice(0, 18),
    episodes,
  };
}
