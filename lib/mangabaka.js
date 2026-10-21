// Public metadata only; chapter pages still come from separately verified adapters.
const {SourceError}=require('./weebcentral');
const {discoveryQuery}=require('./discovery');
const ID=/^mb-([1-9]\d{0,8})$/;
const GENRE=/^mbg-([a-z_-]{2,40})$/;
const THEME=/^mbt-([1-9]\d{0,8})$/;
const STAFF=/^mbstaff-([A-Za-z0-9_-]{2,540})$/;
const cache=new Map(),pending=new Map();
async function api(path,params=new URLSearchParams()) {
  const url='https://api.mangabaka.org/v1/'+path+(params.size?'?'+params:'');
  const hit=cache.get(url);
  if(hit?.until>Date.now())return hit.value;
  if(pending.has(url))return pending.get(url);
  const task=(async()=>{
    try {
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SharkStream-MangaHook/5.0 (cached public metadata)'},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!r.ok)throw new SourceError(r.status===429?429:r.status===404?404:502,'The backup manga catalogue is temporarily unavailable.');
      const t=await r.text();if(t.length>6000000)throw new Error('Oversized metadata');
      const j=JSON.parse(t);if(j.status!==200||!j.data)throw new Error('Invalid metadata');
      cache.set(url,{value:j,until:Date.now()+300000,staleUntil:Date.now()+86400000});
      while(cache.size>100)cache.delete(cache.keys().next().value);
      return j;
    }catch(e){if(hit?.staleUntil>Date.now())return hit.value;throw e;}
  })();pending.set(url,task);try{return await task;}finally{pending.delete(url);}
}
const names=v=>Array.isArray(v)?v.filter(s=>typeof s==='string').slice(0,50):[];
function safeSeries(m) {
  if(!Number.isSafeInteger(m?.id)||m.id<1||!['safe','suggestive','erotica','pornographic'].includes(m.content_rating)||m.type==='novel')throw new SourceError(404,'This manga record could not be verified.');
  const titleNames=Object.values(m.secondary_titles||{}).flat().map(t=>t?.title).filter(t=>typeof t==='string');
  const titleCase=s=>s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
  const genres=[...new Set([...names(m.genres).map(titleCase),...(m.tags_v2||[]).filter(t=>!t.is_spoiler&&typeof t.name==='string').map(t=>t.name)])];
  const image=m.cover?.x350?.x1||m.cover?.x250?.x2||m.cover?.raw?.url||'';
  return {id:'mb-'+m.id,title:m.title,alternativeTitles:[...new Set([m.romanized_title,m.native_title,...titleNames].filter(t=>typeof t==='string'&&t!==m.title))].slice(0,30),
    image:/^https:\/\/(cdn|images)\.mangabaka\.dev\//.test(image)?image:'',description:typeof m.description==='string'?m.description:'',
    authors:names(m.authors),artists:names(m.artists),year:Number.isInteger(m.year)?m.year:null,
    status:({releasing:'ongoing',upcoming:'unreleased'})[m.status]||m.status||'unknown',
    contentRating:m.content_rating,demographic:['shounen','shoujo','seinen','josei'].find(g=>(m.genres||[]).includes(g))||'',genres,
    originalLanguage:({manga:'ja',manhwa:'ko',manhua:'zh'})[m.type]||'other',languages:[],
    source:'mangabaka',sourceUrl:'https://mangabaka.org/'+m.id,
    anilistId:Number.isSafeInteger(m.source?.anilist?.id)?m.source.anilist.id:undefined,
    rating:Number.isFinite(m.rating)?m.rating/10:undefined,knownChapters:Number.isFinite(m.total_chapters)?m.total_chapters:undefined};
}
async function detail(id){if(!ID.test(id))throw new SourceError(400,'Invalid backup catalogue ID.');return safeSeries((await api('series/'+ID.exec(id)[1])).data);}
async function browse(q) {
  // Reuse strict validation of all standard filters. Provider IDs are validated separately.
  const standard=new URLSearchParams(q);for(const k of ['genre','theme','author'])standard.delete(k);
  discoveryQuery(standard);
  const p=new URLSearchParams({page:q.get('page')||'1',limit:'24'});
  if(+p.get('page')>500)throw new SourceError(400,'Invalid catalogue page.');
  const list=k=>(q.get(k)||'').split(',').filter(Boolean);
  for(const rating of list('rating').length?list('rating'):['safe','suggestive'])p.append('content_rating',rating);
  const types=list('type');
  for(const type of types.length?types:['manga','manhwa','manhua','other'])for(const t of type==='other'?['oel','other']:[type])p.append('type',t);
  if(q.get('q'))p.set('q',q.get('q'));
  for(const s of list('status'))p.append('status',({ongoing:'releasing',unreleased:'upcoming'})[s]||s);
  const genre=list('genre'),theme=list('theme'),demographic=list('demographic');
  if(genre.length>30||theme.length>30||genre.some(v=>!GENRE.test(v))||theme.some(v=>!THEME.test(v)))throw new SourceError(503,'This filter belongs to MangaDex, which is under maintenance. Reset filters to use the backup catalogue.');
  if(q.get('tagMode')!=='any')for(const g of genre)p.append('genre',GENRE.exec(g)[1]);
  for(const t of theme)p.append('tag',THEME.exec(t)[1]);
  p.set('tag_mode',q.get('themeMode')==='any'?'or':'and');
  // The backup has no translated-chapter language field; never pretend it does.
  if(list('language').length)throw new SourceError(503,'Translated-language catalogue filters are unavailable during MangaDex maintenance. Choose the language on a manga detail page.');
  if(q.get('author')){
    const match=STAFF.exec(q.get('author'));if(!match)throw new SourceError(503,'Reset the author filter to search the backup catalogue.');
    const name=Buffer.from(match[1],'base64url').toString('utf8');if(!name||name.length>150||Buffer.from(name).toString('base64url')!==match[1])throw new SourceError(400,'Invalid author filter.');p.set('staff',name);
  }
  if(q.get('yearFrom'))p.set('published_start_date_lower',q.get('yearFrom')+'-01-01');
  if(q.get('yearTo'))p.set('published_start_date_upper',q.get('yearTo')+'-12-31');
  if(q.get('minChapters'))p.set('chapters_lower',q.get('minChapters'));
  const section=q.get('section'),period=q.get('period')||'week',sort=q.get('sort')||'popular';
  const sorting={popular:'popularity_asc',latest:'latest',newest:'published_start_date_desc',title:'name_asc','title-desc':'name_desc','year-desc':'published_year_desc','year-asc':'published_year_asc',rating:'score_desc',relevance:'relevance_desc',trending:period==='month'?'trending_30d':'trending_7d'};
  p.set('sort_by',section==='trending'?(period==='day'?'popularity_asc':sorting.trending):section==='latest'?(q.get('heat')==='hot'?'popularity_asc':'latest'):sorting[sort]);
  const d=await api('series/search',p);
  if(!Array.isArray(d.data))throw new SourceError(502,'Invalid manga catalogue response.');
  let rows=d.data.filter(m=>m.state!=='deleted'&&['safe','suggestive','erotica','pornographic'].includes(m.content_rating)&&m.type!=='novel').map(safeSeries);
  const match=(selected,values,mode)=>!selected.length||(mode==='any'?selected.some(v=>values.includes(v)):selected.every(v=>values.includes(v)));
  rows=rows.filter(m=>match(genre.map(g=>GENRE.exec(g)[1].replaceAll('_',' ').toLowerCase()),m.genres.map(g=>g.toLowerCase()),q.get('tagMode'))&&(!demographic.length||demographic.includes(m.demographic||'none')));
  return {status:200,maxAge:120,body:{data:rows,pagination:{currentPage:+p.get('page'),hasNext:!!d.pagination?.next},metadataFallback:true,
    ranking:section==='trending'?(period==='day'?'popularity':'mangabaka-trending'):undefined,
    note:section==='latest'?'Catalogue metadata updates from MangaBaka; these are not confirmed chapter releases.':section==='trending'&&period==='day'?'Daily activity is unavailable; showing overall popularity.':'MangaBaka metadata is keeping the catalogue available during MangaDex maintenance.'}};
}
async function tags(all){
  const g=(await api('genres')).data.map(g=>({id:'mbg-'+g.value,name:g.label,group:'genre'}));
  if(!all)return g;
  const t=(await api('tags')).data.filter(t=>!t.is_genre&&!t.is_spoiler&&Number.isSafeInteger(t.id)&&typeof t.name==='string'&&t.content_rating==='safe').slice(0,1500).map(t=>({id:'mbt-'+t.id,name:t.name,group:'theme'}));
  return [...g,...t].sort((a,b)=>a.name.localeCompare(b.name));
}
async function authors(term){const p=new URLSearchParams({staff:term,limit:'24',content_rating:'safe'});const d=await api('series/search',p);return [...new Set(d.data.flatMap(m=>[...names(m.authors),...names(m.artists)]))].filter(n=>n.toLowerCase().includes(term.toLowerCase())).slice(0,12).map(name=>({id:'mbstaff-'+Buffer.from(name).toString('base64url'),name}));}
async function related(id){const root=(await api('series/'+ID.exec(id)[1])).data;safeSeries(root);const allowed={prequel:'prequel',sequel:'sequel',spin_off:'spin_off',side_story:'side_story',alternative:'alternate_version',adaptation:'adapted_from'};const links=(root.relationships_v2||[]).filter(r=>allowed[r.relation_type]&&Number.isSafeInteger(r.to_series_id)&&r.to_series_id!==root.id).slice(0,12);return (await Promise.allSettled(links.map(async r=>({...await detail('mb-'+r.to_series_id),relation:allowed[r.relation_type]})))).filter(r=>r.status==='fulfilled').map(r=>r.value);}
module.exports={ID,api,detail,browse,tags,authors,related,safeSeries};
