// MangaHook serves public catalogue/chapter metadata only. Browser libraries stay on SharkStream.
const ORIGIN = 'https://api.mangadex.org';
const { SourceError, CHAPTER_ID, createWeebSource } = require('../lib/weebcentral');
const weeb = createWeebSource();
const { CHAPTER_ID: KATANA_CHAPTER_ID, createKatanaSource } = require('../lib/mangakatana');
const katana = createKatanaSource();
const { CHAPTER_ID: ATSU_CHAPTER_ID, createAtsuSource } = require('../lib/atsumaru');
const atsu = createAtsuSource();
const { createImageProbe, selectWorkingSource } = require('../lib/sourceSelection');
const probeImage = createImageProbe();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
class ApiError extends SourceError {}
const text = (value) => typeof value === 'string' ? value : '';
const localized = (value = {}) => text(value.en) || text(value['ja-ro']) || text(Object.values(value)[0]);
const pending = new Map();
async function upstream(path, params = new URLSearchParams()) {
  const url = ORIGIN + path + (params.size ? '?' + params : '');
  if (pending.has(url)) return pending.get(url);
  const task = (async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'SharkStream-MangaHook/2.0' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new ApiError(response.status === 429 ? 429 : response.status === 404 ? 404 : 502,
      response.status === 429 ? 'The manga source is busy. Please wait a moment and retry.' : response.status === 404 ? 'This manga or chapter is no longer available.' : 'The manga source is temporarily unavailable.');
    const value = await response.json();
    if (value.result !== 'ok') throw new ApiError(502, 'The manga source returned an invalid response.');
    return value;
  })();
  pending.set(url, task);
  task.then(() => pending.delete(url), () => pending.delete(url));
  return task;
}
function safeManga(m) {
  if (!m || !UUID.test(m.id) || !['safe', 'suggestive'].includes(m.attributes?.contentRating))
    throw new ApiError(404, 'This manga is unavailable in this catalogue.');
  const a = m.attributes;
  const cover = (m.relationships || []).find((r) => r.type === 'cover_art')?.attributes?.fileName;
  return {
    id: m.id, title: localized(a.title), description: localized(a.description),
    alternativeTitles: [...new Set((a.altTitles || []).flatMap((t) => Object.values(t)).filter((t) => typeof t === 'string'))].slice(0, 30),
    contentRating: text(a.contentRating), demographic: text(a.publicationDemographic),
    image: typeof cover === 'string' && /^[a-z0-9._-]+$/i.test(cover) ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.256.jpg` : '',
    authors: [...new Set((m.relationships || []).filter((r) => ['author', 'artist'].includes(r.type)).map((r) => text(r.attributes?.name)).filter(Boolean))],
    artists: [...new Set((m.relationships || []).filter((r) => r.type === 'artist').map((r) => text(r.attributes?.name)).filter(Boolean))],
    status: text(a.status), year: Number.isInteger(a.year) ? a.year : null,
    genres: (a.tags || []).filter((t) => ['genre', 'theme', 'format'].includes(t.attributes?.group)).map((t) => localized(t.attributes.name)).filter(Boolean),
    languages: (a.availableTranslatedLanguages || []).filter((l) => typeof l === 'string'),
    originalLanguage: text(a.originalLanguage), source: 'mangadex', sourceUrl: `https://mangadex.org/title/${m.id}`,
  };
}
function chapterRow(c) {
  const a = c.attributes || {};
  return { id: c.id, chapter: text(a.chapter), volume: text(a.volume), title: text(a.title),
    language: text(a.translatedLanguage), pages: Number(a.pages) || 0, publishedAt: text(a.readableAt),
    mangaId: c.relationships?.find((r) => r.type === 'manga')?.id,
    groups: (c.relationships || []).filter((r) => r.type === 'scanlation_group').map((r) => text(r.attributes?.name)).filter(Boolean),
    translationType: (c.relationships || []).some((r) => r.type === 'scanlation_group' && r.attributes?.official) ? 'official' : (c.relationships || []).some((r) => r.type === 'scanlation_group') ? 'fan' : 'unknown',
    source: 'mangadex', sourceName: 'MangaDex', sourceUrl: `https://mangadex.org/chapter/${c.id}`,
  };
}
function validId(id) { if (!UUID.test(id || '')) throw new ApiError(400, 'Invalid manga or chapter ID.'); return id; }
function validateQuery(query, allowed) {
  if ([...query.keys()].some((k) => !allowed.includes(k))) throw new ApiError(400, 'Unknown manga filter.');
}
function page(query, limit) {
  const value = query.get('page') || '1';
  if (!/^[1-9]\d{0,3}$/.test(value) || (+value - 1) * limit >= 10000) throw new ApiError(400, 'Invalid catalogue page.');
  return { number: +value, offset: (+value - 1) * limit };
}
function language(query) {
  const value = query.get('language') || 'en';
  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(value)) throw new ApiError(400, 'Invalid chapter language.');
  return value;
}
const browseIncludes = (p) => { p.append('includes[]', 'cover_art'); p.append('includes[]', 'author'); p.append('includes[]', 'artist'); };
const ratings = (p) => { p.append('contentRating[]', 'safe'); p.append('contentRating[]', 'suggestive'); };
const resultPage = (data, number, limit, total) => ({ data, pagination: { currentPage: number, totalItems: total, hasNext: number * limit < Math.min(total, 10000) } });
async function handleRequest(url, method = 'GET') {
  try {
    if (method !== 'GET') throw new ApiError(405, 'Only GET requests are supported.');
    const parsed = new URL(url, 'https://mangahook.local');
    const path = parsed.pathname.replace(/\/$/, '') || '/', q = parsed.searchParams;
    if (path === '/') return { status: 200, maxAge: 300, body: { name: 'MangaHook API', version: 4, source: 'Atsumaru + MangaKatana + MangaDex + Weeb Central', endpoints: ['/api/manga', '/api/manga/:id', '/api/manga/:id/chapters', '/api/chapter/:id?manga=:mangaId', '/api/tags'] } };
    if (['/api/manga', '/api/mangaList', '/api/search'].includes(path)) {
      validateQuery(q, ['q', 'page', 'status', 'genre', 'language', 'sort']);
      const paging = page(q, 24), term = (q.get('q') || '').trim();
      if (term.length > 150) throw new ApiError(400, 'Search is too long.');
      const params = new URLSearchParams({ limit: '24', offset: String(paging.offset), 'availableTranslatedLanguage[]': language(q), hasAvailableChapters: 'true' });
      browseIncludes(params); ratings(params);
      if (term) params.set('title', term);
      const status = q.get('status');
      if (status) {
        if (!['ongoing', 'completed', 'hiatus', 'cancelled'].includes(status)) throw new ApiError(400, 'Invalid publication status.');
        params.append('status[]', status);
      }
      if (q.get('genre')) params.append('includedTags[]', validId(q.get('genre')));
      const sort = q.get('sort') || 'popular';
      const sorts = { popular: ['followedCount', 'desc'], latest: ['latestUploadedChapter', 'desc'], newest: ['createdAt', 'desc'], title: ['title', 'asc'], rating: ['rating', 'desc'] };
      if (!sorts[sort]) throw new ApiError(400, 'Invalid manga sorting.');
      params.set(`order[${sorts[sort][0]}]`, sorts[sort][1]);
      const found = await upstream('/manga', params);
      return { status: 200, maxAge: 60, body: resultPage(found.data.map(safeManga), paging.number, 24, found.total) };
    }
    if (path === '/api/tags') {
      validateQuery(q, []);
      const found = await upstream('/manga/tag');
      return { status: 200, maxAge: 3600, body: { data: found.data.filter((t) => t.attributes?.group === 'genre').map((t) => ({ id: t.id, name: localized(t.attributes.name) })).sort((a,b) => a.name.localeCompare(b.name)) } };
    }
    const manga = path.match(/^\/api\/manga\/([^/]+)(\/chapters)?$/);
    if (manga) {
      const id = validId(manga[1]);
      validateQuery(q, manga[2] ? ['language', 'page', 'source', 'all', 'preferred'] : []);
      const source = q.get('source') || 'mangadex', all = q.get('all') === '1';
      if (!['auto', 'mangadex', 'weebcentral', 'mangakatana', 'atsumaru'].includes(source) || (q.has('all') && !['0', '1'].includes(q.get('all')))) throw new ApiError(400, 'Invalid chapter source or catalogue mode.');
      const preferred = q.get('preferred');
      if (preferred && (source !== 'auto' || !['mangadex', 'weebcentral', 'mangakatana', 'atsumaru'].includes(preferred))) throw new ApiError(400, 'Invalid preferred source.');
      const lang = language(q), paging = page(q, 100);
      if (all && paging.number !== 1) throw new ApiError(400, 'Complete chapter lists start at page one.');
      const include = new URLSearchParams(); browseIncludes(include);
      const detail = safeManga((await upstream('/manga/' + id, include)).data);
      if (!manga[2]) {
        try {
          const stats = (await upstream('/statistics/manga/' + id)).statistics?.[id];
          if (Number.isFinite(stats?.rating?.average)) detail.rating = stats.rating.average;
          if (Number.isFinite(stats?.follows)) detail.follows = stats.follows;
        } catch { /* Optional catalogue statistics must not hide the manga. */ }
        return { status: 200, maxAge: 120, body: { data: detail } };
      }
      if (['atsumaru', 'weebcentral', 'mangakatana'].includes(source) && lang !== 'en') throw new ApiError(400, 'This source supplies English chapters. Choose MangaDex for other languages.');
      let mdTotal = 0, mdTruncated = false;
      async function mdRows() {
        const params = new URLSearchParams({ limit: all ? '500' : '100', offset: String(paging.offset), 'translatedLanguage[]': lang, includeEmptyPages: '0', includeExternalUrl: '0', 'includes[]': 'scanlation_group', 'order[volume]': 'asc', 'order[chapter]': 'asc' });
        const feed = await upstream('/manga/' + id + '/feed', params);
        let rows = feed.data; mdTotal = feed.total; mdTruncated = all && feed.total > 5000;
        if (all) for (let offset = 500; offset < Math.min(feed.total, 5000); offset += 500) {
          params.set('offset', String(offset));
          rows = rows.concat((await upstream('/manga/' + id + '/feed', params)).data);
        }
        return rows.filter(c => c.attributes?.pages > 0 && !c.attributes.externalUrl).map(chapterRow);
      }
      // Preserve the legacy MangaDex list endpoint. Auto mode additionally proves that pages load.
      if (source === 'mangadex') {
        const rows = await mdRows();
        return {status:200,maxAge:60,body:{...resultPage(rows,paging.number,all?Math.max(mdTotal,1):100,mdTotal),source:'mangadex',sourceName:'MangaDex',language:lang,truncated:mdTruncated}};
      }
      const adapters = {atsumaru:{name:'Atsumaru',api:atsu},mangakatana:{name:'MangaKatana',api:katana},weebcentral:{name:'Weeb Central',api:weeb}};
      const order = source === 'auto' ? (lang === 'en' ? [...new Set([preferred, 'mangakatana', 'atsumaru', 'mangadex'].filter(Boolean))] : ['mangadex']) : [source];
      const selected = await selectWorkingSource(order.map(name => ({
        id:name,name:name === 'mangadex'?'MangaDex':adapters[name].name,
        chapters:()=>name === 'mangadex'?mdRows():adapters[name].api.chapters(detail),
        chapter:async row=>{
          if(name !== 'mangadex')return adapters[name].api.chapter(detail,row.id);
          const result=await handleRequest('/api/chapter/'+row.id+'?manga='+id);
          if(result.status!==200)throw new ApiError(result.status,result.body.error);
          return result.body.data;
        },
      })),probeImage);
      const rows=selected.rows, isMd=selected.source==='mangadex';
      return {status:200,maxAge:60,body:{
        ...resultPage(all||isMd?rows:rows.slice(paging.offset,paging.offset+100),all?1:paging.number,all?Math.max(isMd?mdTotal:rows.length,1):100,isMd?mdTotal:rows.length),
        source:selected.source,sourceName:selected.sourceName,sourceHealth:selected.sourceHealth,language:lang,truncated:isMd&&mdTruncated,
        sourceWarning:selected.sourceHealth.attempts.some(a=>a.status==='unavailable')?'An unavailable source was skipped.':undefined,
      }};
    }
    const chapter = path.match(/^\/api\/chapter\/([^/]+)$/);
    if (chapter) {
      validateQuery(q, ['manga']);
      const mangaId = validId(q.get('manga'));
      if (CHAPTER_ID.test(chapter[1])) {
        const m = safeManga((await upstream('/manga/' + mangaId)).data);
        return { status: 200, maxAge: 60, body: { data: await weeb.chapter(m, chapter[1]) } };
      }
      if (ATSU_CHAPTER_ID.test(chapter[1])) {
        const m = safeManga((await upstream('/manga/' + mangaId)).data);
        return {status:200,maxAge:15,body:{data:await atsu.chapter(m,chapter[1])}};
      }
      if (KATANA_CHAPTER_ID.test(chapter[1])) {
        const m = safeManga((await upstream('/manga/' + mangaId)).data);
        return { status: 200, maxAge: 15, body: { data: await katana.chapter(m, chapter[1]) } };
      }
      const id = validId(chapter[1]);
      const c = (await upstream('/chapter/' + id)).data;
      if (c.relationships?.find((r) => r.type === 'manga')?.id !== mangaId) throw new ApiError(400, 'This chapter does not belong to this manga.');
      await upstream('/manga/' + mangaId).then((d) => safeManga(d.data));
      if (!c.attributes?.pages || c.attributes.externalUrl) throw new ApiError(404, 'This chapter is not available in the reader.');
      const images = await upstream('/at-home/server/' + id);
      const base = new URL(images.baseUrl);
      if (base.protocol !== 'https:' || base.username || base.password || base.port || !(base.hostname.endsWith('.mangadex.network') || base.hostname === 'uploads.mangadex.org')) throw new ApiError(502, 'The chapter image host could not be verified.');
      if (!/^[a-f0-9]{32}$/i.test(images.chapter?.hash) || !Array.isArray(images.chapter.data) || images.chapter.data.length > 1000 || !images.chapter.data.length || images.chapter.data.some((f) => typeof f !== 'string' || !/^[a-z0-9._-]+$/i.test(f))) throw new ApiError(502, 'The chapter page list is unavailable.');
      return { status: 200, maxAge: 30, body: { data: { ...chapterRow(c), images: images.chapter.data.map((f) => `${base.origin}/data/${images.chapter.hash}/${f}`) } } };
    }
    throw new ApiError(404, 'Endpoint not found.');
  } catch (error) {
    const status = error instanceof SourceError ? error.status : 502;
    if (status === 502) console.error('MangaHook upstream request failed:', error.name);
    return { status, maxAge: 0, body: { error: error instanceof SourceError ? error.message : 'The manga source could not be reached. Please retry.', ...(error.sourceHealth?{sourceHealth:error.sourceHealth}:{}) } };
  }
}
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const result = await handleRequest(req.url, req.method);
  res.setHeader('Cache-Control', result.maxAge ? `public, max-age=15, s-maxage=${result.maxAge}, stale-while-revalidate=30` : 'no-store');
  if (result.status === 429) res.setHeader('Retry-After', '10');
  return res.status(result.status).json(result.body);
}
module.exports = handler;
module.exports.handleRequest = handleRequest;
