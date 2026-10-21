const { matchingTitles } = require('./titleMatch');
// Public HTML endpoints documented by the Apache-2.0 Keiyoushi MangaKatana source.
// https://github.com/keiyoushi/extensions-source/tree/main/src/en/mangakatana
const { load } = require('cheerio');
const { SourceError } = require('./weebcentral');
const ORIGIN = 'https://mangakatana.com';
const CHAPTER_ID = /^mk-(\d{1,9})-(\d{1,6}(?:\.\d{1,3})?)$/;
const SERIES = /^\/manga\/([a-z0-9-]+)\.(\d{1,9})$/;
function safeImage(value) {
  try {
    if (typeof value !== 'string' || /%2e|%2f|%5c/i.test(value)) return false;
    const u=new URL(value);
    return u.protocol==='https:' && /^i\d+\.mangakatana\.com$/.test(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/token\/[a-z0-9%._:-]+\/\d+\.(?:jpg|png|webp)$/i.test(u.pathname) && !decodeURIComponent(u.pathname).split('/').includes('..');
  } catch { return false; }
}
function seriesPath(value) {
  try {const u=new URL(value,ORIGIN);return u.origin===ORIGIN && !u.username && !u.password && !u.search && !u.hash && SERIES.test(u.pathname) ? u.pathname : null;} catch{return null;}
}
function parseSearch(html, finalUrl) {
  const $=load(html), candidates=new Map();
  $('#book_list .item .text h3 a').each((_,a)=>{const path=seriesPath($(a).attr('href'));if(path)candidates.set(path,{path,id:SERIES.exec(path)[2],title:$(a).text().trim()});});
  const direct=seriesPath(finalUrl);
  if(direct && $('h1.heading').text().trim()) candidates.set(direct,{path:direct,id:SERIES.exec(direct)[2],title:$('h1.heading').text().trim()});
  return [...candidates.values()];
}
function parseChapters(html,series,mangaId) {
  const $=load(html), rows=new Map();
  $('tr:has(.chapter)').each((_,tr)=>{
    const a=$(tr).find('a').first();let u;try{u=new URL(a.attr('href'),ORIGIN);}catch{return;}
    const suffix=u.pathname.slice(series.path.length), number=/^\/c(\d{1,6}(?:\.\d{1,3})?)$/.exec(suffix)?.[1];
    if(!number || u.origin!==ORIGIN || u.username || u.password || u.search || u.hash || !u.pathname.startsWith(series.path+'/'))return;
    const date=$(tr).find('.update_time').text().trim();const parsed=Date.parse(date);
    const id=`mk-${series.id}-${number}`;
    rows.set(id,{id,mangaId,chapter:number,volume:'',title:a.text().trim().replace(/^(?:chapter|ch\.?)\s*\d+(?:\.\d+)?\s*[:–—-]?\s*/i,''),language:'en',pages:0,groups:[],publishedAt:Number.isFinite(parsed)?new Date(parsed).toISOString():'',translationType:'unknown',source:'mangakatana',sourceName:'MangaKatana',sourceUrl:u.href});
  });
  return [...rows.values()].sort((a,b)=>Number(a.chapter)-Number(b.chapter));
}
function parsePages(html) {
  const $=load(html), script=$('script').map((_,s)=>$(s).html()).get().find(s=>s.includes('data-src'));
  const name=script?.match(/data-src['"],\s*(\w+)/)?.[1];
  const list=name ? script.match(new RegExp('var '+name+'=\\[([^\\[]*)]'))?.[1] : undefined;
  const images=[...(list || '').matchAll(/'([^']*)'/g)].map(m=>m[1]);
  if(!images.length || images.length>1000)throw new SourceError(404,'MangaKatana has no readable pages for this chapter.');
  if(images.some(url=>!safeImage(url)))throw new SourceError(502,'The chapter image host could not be verified.');
  return images;
}
function createKatanaSource({fetcher=(...args)=>fetch(...args),interval=2000}={}) {
  const cache=new Map(),pending=new Map();let gate=Promise.resolve(),nextAt=0;
  async function cached(key,loader,ttl=300000) {
    const old=cache.get(key);if(old?.until>Date.now())return old.value;if(pending.has(key))return pending.get(key);
    const task=loader().then(value=>{cache.set(key,{value,until:Date.now()+ttl});while(cache.size>64)cache.delete(cache.keys().next().value);return value;});
    pending.set(key,task);task.then(()=>pending.delete(key),()=>pending.delete(key));return task;
  }
  async function html(path) {
    const slot=gate.then(async()=>{const delay=nextAt-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));nextAt=Date.now()+interval;});gate=slot.catch(()=>{});await slot;
    const options={headers:{Accept:'text/html','User-Agent':'SharkStream-MangaHook/3.0'},redirect:'manual',signal:AbortSignal.timeout(10000)};
    let response=await fetcher(ORIGIN+path,options), finalUrl=ORIGIN+path;
    if([301,302,303,307,308].includes(response.status)) {
      const target=seriesPath(response.headers.get('location'));
      if(!target)throw new SourceError(502,'The chapter source redirected outside its catalogue.');
      finalUrl=ORIGIN+target;response=await fetcher(finalUrl,options);
    }
    if(!response.ok)throw new SourceError(response.status===429?429:502,`MangaKatana returned HTTP ${response.status}. Choose another source.`);
    const body=await response.text();
    if(!response.headers.get('content-type')?.includes('text/html') || body.length>12000000 || /cf-chl-|<title>\s*(?:Just a moment|Maintenance)|^\s*maintenance\s*$/i.test(body))throw new SourceError(503,'MangaKatana is not currently accessible. Choose another source.');
    return {body,url:response.url || finalUrl};
  }
  async function match(manga) {
    return cached('match:'+manga.id,async()=>{
      const names=[...new Set([manga.title,...(manga.alternativeTitles||[])].filter(Boolean))];
      for(const name of names.slice(0,2)){
        const result=await html('/page/1?'+new URLSearchParams({search:name,search_by:'book_name'}));
        const candidates=matchingTitles(parseSearch(result.body,result.url),manga);
        if(candidates.length>1)throw new SourceError(409,'Multiple MangaKatana editions matched. Choose another source.');
        if(candidates[0])return candidates[0];
      }return null;
    });
  }
  async function chapters(manga) {
    const series=await match(manga);if(!series)return null;
    return cached('chapters:'+manga.id+':'+series.id,async()=>parseChapters((await html(series.path)).body,series,manga.id));
  }
  async function chapter(manga,id) {
    const parts=CHAPTER_ID.exec(id);if(!parts)throw new SourceError(400,'Invalid source chapter ID.');
    const series=await match(manga);if(!series || series.id!==parts[1])throw new SourceError(400,'This chapter does not belong to this manga.');
    const row=(await chapters(manga))?.find(c=>c.id===id);if(!row)throw new SourceError(404,'This chapter is not listed by the selected source.');
    const images=await cached('pages:'+id,async()=>parsePages((await html(series.path+'/c'+parts[2])).body),30000);
    return {...row,pages:images.length,images};
  }
  return {chapters,chapter};
}
module.exports={CHAPTER_ID,createKatanaSource,parseSearch,parseChapters,parsePages,safeImage};
