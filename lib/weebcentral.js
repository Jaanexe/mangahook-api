const { matchingTitles } = require('./titleMatch');
// Public source adapter. No accounts, cookies, reading history or database.
// Endpoint shapes verified against the Apache-2.0 Keiyoushi WeebCentral source:
// https://github.com/keiyoushi/extensions-source/tree/main/src/en/weebcentral
const { load } = require('cheerio');
const ORIGIN = 'https://weebcentral.com';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const CHAPTER_ID = new RegExp(`^wc-(${ULID})-(${ULID})$`);
const SERIES_PATH = new RegExp(`^/series/(${ULID})/[^/?#]+$`);
const CHAPTER_PATH = new RegExp(`^/chapters/(${ULID})$`);
class SourceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function sourcePath(value, pattern) {
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.search && !url.hash && pattern.test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}
function safeImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ['.planeptune.us', '.leanbox.us', '.lowee.us', '.compsci88.com'].some((suffix) => url.hostname.endsWith(suffix)) &&
      /^\/manga\/[a-z0-9%/_.() -]+$/i.test(url.pathname) && !decodeURIComponent(url.pathname).split('/').includes('..');
  } catch { return false; }
}
function parseSearch(html) {
  const $ = load(html), found = new Map();
  $('article > section > a[href]').each((_, a) => {
    const path = sourcePath($(a).attr('href'), SERIES_PATH);
    const title = $(a).find('div:not([class]):last-child').text().trim();
    if (path && title) found.set(path.split('/')[2], { id: path.split('/')[2], path, title });
  });
  return [...found.values()];
}
function parseChapters(html, series, mangaId) {
  const $ = load(html), found = new Map();
  $('div[x-data] > a[href]').each((_, a) => {
    const path = sourcePath($(a).attr('href'), CHAPTER_PATH);
    const label = $(a).find('span.grow > span').first().text().trim();
    const number = label.match(/^(?:chapter|ch\.)\s*(\d+(?:\.\d+)?)/i)?.[1];
    if (!path || !number) return;
    const id = path.split('/')[2], publishedAt = $(a).find('time').attr('datetime') || '';
    found.set(id, {
      id: `wc-${series}-${id}`, mangaId, chapter: number, volume: '',
      title: label.replace(/^(?:chapter|ch\.)\s*\d+(?:\.\d+)?\s*[:–—-]?\s*/i, ''),
      language: 'en', pages: 0, groups: [],
      publishedAt: Number.isFinite(Date.parse(publishedAt)) ? publishedAt : '',
      translationType: $(a).find('img[src*="chapter-badge-official"]').length ? 'official' : 'unknown',
      source: 'weebcentral', sourceName: 'Weeb Central', sourceUrl: ORIGIN + path,
    });
  });
  return [...found.values()].sort((a, b) => Number(a.chapter) - Number(b.chapter));
}
function parsePages(html) {
  const $ = load(html), images = [];
  $('section[x-data] > img').each((_, img) => {
    if (!$(img).parent().attr('x-data').includes('scroll')) return;
    const src = $(img).attr('src');
    if (!safeImage(src)) throw new SourceError(502, 'The chapter image host could not be verified.');
    images.push(src);
  });
  if (!images.length || images.length > 1000) throw new SourceError(404, 'This source has no readable pages for the selected chapter.');
  return images;
}
function createWeebSource({ fetcher = (...args) => fetch(...args), interval = 2000 } = {}) {
  const cache = new Map(), pending = new Map();
  let gate = Promise.resolve(), nextAt = 0;
  async function cached(key, loader) {
    const old = cache.get(key);
    if (old && old.until > Date.now()) return old.value;
    if (pending.has(key)) return pending.get(key);
    const task = loader().then((value) => {
      cache.set(key, { value, until: Date.now() + 300000 });
      while (cache.size > 64) cache.delete(cache.keys().next().value);
      return value;
    });
    pending.set(key, task);
    task.then(() => pending.delete(key), () => pending.delete(key));
    return task;
  }
  async function html(path) {
    const slot = gate.then(async () => {
      const delay = nextAt - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      nextAt = Date.now() + interval;
    });
    gate = slot.catch(() => {});
    await slot;
    const response = await fetcher(ORIGIN + path, { headers: { Accept: 'text/html', 'User-Agent': 'SharkStream-MangaHook/3.0' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new SourceError(response.status === 429 ? 429 : 502, `Weeb Central returned HTTP ${response.status}. Retry later or choose MangaDex.`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new SourceError(502, 'The chapter source returned an unexpected response.');
    const body = await response.text();
    if (body.length > 12000000 || /cf-chl-|<title>\s*Just a moment/i.test(body)) throw new SourceError(503, 'The chapter source is not currently accessible. Choose another source.');
    return body;
  }
  async function match(manga) {
    return cached('match:' + manga.id, async () => {
      const names = [...new Set([manga.title, ...(manga.alternativeTitles || [])].filter(Boolean))];
      
      for (const name of names.slice(0, 2)) {
        const params = new URLSearchParams({ text: name, limit: '32', offset: '0', display_mode: 'Full Display' });
        const candidates = matchingTitles(parseSearch(await html('/search/data?' + params)), manga);
        if (candidates.length > 1) throw new SourceError(409, 'This manga has more than one matching source edition. Choose MangaDex for this title.');
        if (candidates[0]) return candidates[0];
      }
      return null;
    });
  }
  async function chapters(manga) {
    const series = await match(manga);
    if (!series) return null;
    return cached('chapters:' + manga.id + ':' + series.id, async () => parseChapters(await html('/series/' + series.id + '/full-chapter-list'), series.id, manga.id));
  }
  async function chapter(manga, id) {
    const parts = CHAPTER_ID.exec(id);
    if (!parts) throw new SourceError(400, 'Invalid source chapter ID.');
    const series = await match(manga);
    if (!series || series.id !== parts[1]) throw new SourceError(400, 'This chapter does not belong to this manga.');
    const rows = await chapters(manga), row = rows?.find((c) => c.id === id);
    if (!row) throw new SourceError(404, 'This chapter is not listed by the selected source.');
    const images = await cached('pages:' + id, async () => parsePages(await html('/chapters/' + parts[2] + '/images?is_prev=False&reading_style=long_strip')));
    return { ...row, pages: images.length, images };
  }
  return { chapters, chapter };
}
module.exports = { SourceError, CHAPTER_ID, createWeebSource, parseSearch, parseChapters, parsePages, safeImage };
