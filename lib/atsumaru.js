// Endpoint formats cross-checked with the Apache-2.0 Keiyoushi Atsumaru adapter.
// https://github.com/keiyoushi/extensions-source/tree/main/src/en/atsumaru
const {SourceError} = require('./weebcentral');
const {matchingTitles} = require('./titleMatch');
const ORIGIN = 'https://atsu.moe';
const SOURCE_ID = /^[a-z0-9_-]{2,80}$/i;
const CHAPTER_ID = /^at~([a-z0-9_-]{2,80})~([a-z0-9_-]{2,80})$/i;
function imageUrl(value) {
  if (typeof value !== 'string' || /%|\\|(?:^|\/)\.\.(?:\/|$)/.test(value)) throw new SourceError(502,'The chapter image path could not be verified.');
  const path = /^(?:https?:)?\/\//.test(value) ? value : '/static/' + value.replace(/^\/?(?:static\/)?/,'');
  const url = new URL(path,ORIGIN);
  if (url.hostname === 'atsu.moe') url.hostname = 'cdn.atsu.moe';
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.atsu.moe' || url.port || url.username || url.password || url.search || url.hash || !/^\/static\/pages\/[a-z0-9_./-]+\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname)) throw new SourceError(502,'The chapter image host could not be verified.');
  return url.href;
}
function parseChapters(chapters, series, mangaId, scanlators=[]) {
  if (!Array.isArray(chapters) || chapters.length > 15000) throw new SourceError(502,'The source chapter list is invalid.');
  const groups=new Map(scanlators.filter(s=>SOURCE_ID.test(s.id)).map(s=>[s.id,s]));
  const rows=new Map();
  for (const c of chapters) {
    if (!SOURCE_ID.test(c.id) || c.number === null || c.number === undefined || !/^\d+(?:\.\d+)?$/.test(String(c.number)) || !Number.isFinite(c.pageCount) || c.pageCount < 1 || c.pageCount > 1000) continue;
    const group=groups.get(c.scanlationMangaId), date=Number(c.createdAt);
    const row={id:`at~${series}~${c.id}`,mangaId,chapter:String(c.number),volume:'',title:typeof c.title === 'string'?c.title.slice(0,300):'',language:'en',pages:c.pageCount,groups:group?.name?[String(group.name)]:[],publishedAt:Number.isFinite(date)&&date>0&&date<8640000000000000?new Date(date).toISOString():'',source:'atsumaru',sourceName:'Atsumaru',sourceUrl:`${ORIGIN}/read/${series}/${c.id}`,translationType:'unknown'};
    rows.set(c.id,{row,score:Number(group?.score)||0});
  }
  return [...rows.values()].sort((a,b)=>Number(a.row.chapter)-Number(b.row.chapter)||b.score-a.score||b.row.publishedAt.localeCompare(a.row.publishedAt)).map(item=>item.row);
}
function createAtsuSource({fetcher=(...args)=>fetch(...args),interval=500}={}) {
  const cache=new Map(),pending=new Map();let gate=Promise.resolve(),nextAt=0;
  async function cached(key,loader,ttl=180000) {
    const old=cache.get(key);if(old?.until>Date.now())return old.value;if(pending.has(key))return pending.get(key);
    const task=loader().then(value=>{cache.set(key,{value,until:Date.now()+ttl});while(cache.size>64)cache.delete(cache.keys().next().value);return value;});
    pending.set(key,task);task.then(()=>pending.delete(key),()=>pending.delete(key));return task;
  }
  async function json(path) {
    const slot=gate.then(async()=>{const delay=nextAt-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));nextAt=Date.now()+interval;});gate=slot.catch(()=>{});await slot;
    const r=await fetcher(ORIGIN+path,{headers:{Accept:'application/json','User-Agent':'SharkStream-MangaHook/4.0'},redirect:'error',signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw new SourceError(r.status===429?429:502,`Atsumaru returned HTTP ${r.status}. Choose another source.`);
    if(!r.headers.get('content-type')?.includes('json'))throw new SourceError(503,'Atsumaru is not currently accessible.');
    const body=await r.text();if(body.length>12000000)throw new SourceError(502,'The source response is too large.');
    try{return JSON.parse(body);}catch{throw new SourceError(502,'The source returned invalid chapter data.');}
  }
  async function match(manga) {
    return cached('match:'+manga.id,async()=>{
      const names=[...new Set([manga.title,...(manga.alternativeTitles||[])].filter(Boolean))];
      for(const name of names.slice(0,2)) {
        const result=await json('/collections/manga/documents/search?'+new URLSearchParams({q:name,query_by:'title,englishTitle,otherNames',per_page:'20',filter_by:'hidden:!=true && isAdult:=false && medium:!=Novel'}));
        if(!Array.isArray(result.hits))throw new SourceError(502,'The source search could not be verified.');
        const candidates=matchingTitles(result.hits.map(h=>h.document).filter(d=>d&&SOURCE_ID.test(d.id)&&typeof d.title==='string'&&!d.isAdult).map(d=>({id:d.id,title:d.title,aliases:d.otherNames,year:d.releaseYear})),manga);
        if(candidates.length>1)throw new SourceError(409,'Multiple source editions matched this manga. Choose another source.');
        if(candidates[0])return candidates[0];
      }return null;
    });
  }
  async function chapters(manga) {
    const series=await match(manga);if(!series)return null;
    return cached('chapters:'+manga.id+':'+series.id,async()=>{
      const [feed,detail]=await Promise.all([json('/api/manga/allChapters?mangaId='+series.id),json('/api/manga/page?id='+series.id).catch(()=>null)]);
      return parseChapters(feed.chapters,series.id,manga.id,detail?.mangaPage?.scanlators||[]);
    });
  }
  async function chapter(manga,id) {
    const parts=CHAPTER_ID.exec(id);if(!parts)throw new SourceError(400,'Invalid source chapter ID.');
    const series=await match(manga);if(!series||series.id!==parts[1])throw new SourceError(400,'This chapter does not belong to this manga.');
    const row=(await chapters(manga))?.find(c=>c.id===id);if(!row)throw new SourceError(404,'This chapter is not listed by the selected source.');
    const images=await cached('pages:'+id,async()=>{
      const result=await json('/api/read/chapter?'+new URLSearchParams({mangaId:series.id,chapterId:parts[2]}));
      const pages=result.readChapter?.pages;if(!Array.isArray(pages)||!pages.length||pages.length>1000)throw new SourceError(404,'This source has no readable pages for this chapter.');
      return pages.map(p=>imageUrl(p.image));
    },30000);
    return {...row,pages:images.length,images};
  }
  return {chapters,chapter};
}
module.exports={CHAPTER_ID,createAtsuSource,parseChapters,imageUrl};
