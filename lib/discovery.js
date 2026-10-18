// Public discovery data only. No reading libraries or personal preferences enter this module.
const {SourceError}=require('./weebcentral');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const allowed=['section','q','page','rating','type','genre','theme','demographic','tagMode','themeMode','language','status','author','yearFrom','yearTo','minChapters','sort','period','heat'];
function discoveryQuery(q) {
  const fail=()=>{throw new SourceError(400,'Invalid manga discovery filter.');};
  if([...q.keys()].some(k=>!allowed.includes(k)))fail();
  const list=(key,check,max=30)=>{const values=[...new Set((q.get(key)||'').split(',').filter(Boolean))];if(values.length>max||values.some(v=>!check(v)))fail();return values;};
  const ratings=list('rating',v=>['safe','suggestive','erotica','pornographic'].includes(v));
  const types=list('type',v=>['manga','manhwa','manhua','other'].includes(v));
  const genres=list('genre',v=>UUID.test(v)), themes=list('theme',v=>UUID.test(v));
  const demographics=list('demographic',v=>['shounen','shoujo','seinen','josei','none'].includes(v));
  const languages=list('language',v=>/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(v),20);
  const statuses=list('status',v=>['ongoing','completed','hiatus','cancelled','unreleased'].includes(v));
  const number=(key,max)=>{const s=q.get(key);if(!s)return 0;if(!/^\d{1,5}$/.test(s)||+s>max)fail();return +s;};
  const from=number('yearFrom',2100),to=number('yearTo',2100),min=number('minChapters',10000);
  if((from&&from<1800)||(to&&to<1800)||(from&&to&&from>to))fail();
  const term=(q.get('q')||'').trim();if(term.length>150)fail();
  const section=q.get('section')||'browse',sort=q.get('sort')||(term?'relevance':'popular'),period=q.get('period')||'week',heat=q.get('heat')||'new';
  if(!['browse','trending','latest'].includes(section)||!['popular','latest','newest','title','title-desc','year-desc','year-asc','rating','relevance','trending'].includes(sort)||!['day','week','month'].includes(period)||!['hot','new'].includes(heat))fail();
  for(const key of ['tagMode','themeMode'])if(q.has(key)&&!['all','any'].includes(q.get(key)))fail();
  const author=q.get('author');if(author&&!UUID.test(author))fail();
  const residual=!!(from||to||min||types.includes('other')||statuses.includes('unreleased')||(genres.length&&themes.length&&q.get('tagMode')!==q.get('themeMode')));
  const limit=section==='trending'||sort==='trending'?50:residual||section==='latest'&&heat==='hot'?100:24;
  const page=number('page',400)||1,offset=(page-1)*limit;if(offset>=10000||q.get('page')==='0')fail();
  const params=new URLSearchParams({limit:String(limit),offset:String(offset)});
  for(const r of ratings.length?ratings:['safe','suggestive'])params.append('contentRating[]',r);
  for(const l of languages)params.append('availableTranslatedLanguage[]',l);
  for(const d of demographics)params.append('publicationDemographic[]',d);
  if(term)params.set('title',term);if(author)params.set('authorOrArtist',author);
  if(from&&from===to)params.set('year',String(from));
  if(!types.includes('other'))for(const type of types)for(const l of ({manga:['ja'],manhwa:['ko'],manhua:['zh','zh-hk']})[type])params.append('originalLanguage[]',l);
  if(!statuses.includes('unreleased'))for(const s of statuses)params.append('status[]',s);
  for(const tag of [...new Set([...genres,...themes])])params.append('includedTags[]',tag);
  params.set('includedTagsMode',residual?'OR':(genres.length?q.get('tagMode'):q.get('themeMode'))==='any'?'OR':'AND');
  const sorts={popular:['followedCount','desc'],latest:['latestUploadedChapter','desc'],newest:['createdAt','desc'],title:['title','asc'],'title-desc':['title','desc'],'year-desc':['year','desc'],'year-asc':['year','asc'],rating:['rating','desc'],relevance:['relevance','desc'],trending:['followedCount','desc']};
  const order=section==='latest'?sorts.latest:section==='trending'?sorts.popular:sorts[sort];params.set(`order[${order[0]}]`,order[1]);
  if(statuses.length===1&&statuses[0]==='unreleased'){params.delete(`order[${order[0]}]`);params.set('order[year]','desc');}
  for(const type of ['cover_art','author','artist'])params.append('includes[]',type);
  const matchTags=(tags,selected,mode)=>!selected.length||(mode==='any'?selected.some(t=>tags.has(t)):selected.every(t=>tags.has(t)));
  const matches=m=>{
    const a=m.attributes||{},tags=new Set((a.tags||[]).map(t=>t.id)),year=a.year,count=Number(a.lastChapter);
    const kind=a.originalLanguage==='ja'?'manga':a.originalLanguage==='ko'?'manhwa':['zh','zh-hk'].includes(a.originalLanguage)?'manhua':'other';
    return (!types.length||types.includes(kind))&&(!from||Number.isInteger(year)&&year>=from)&&(!to||Number.isInteger(year)&&year<=to)&&(!min||a.lastChapter!==null&&a.lastChapter!==''&&Number.isFinite(count)&&count>=min)&&(!statuses.length||statuses.includes(a.status)||statuses.includes('unreleased')&&year>new Date().getUTCFullYear())&&matchTags(tags,genres,q.get('tagMode'))&&matchTags(tags,themes,q.get('themeMode'));
  };
  return {params,matches,page,limit,offset,section,sort,period,heat,residual};
}
function rankTrends(rows,histories,period) {
  const last=Math.max(0,...histories.flatMap(m=>(m.trends?.nodes||[]).map(n=>n.date||0)));
  const span={day:1,week:7,month:30}[period]*86400;
  const scores=new Map(histories.map(m=>[m.id,(m.trends?.nodes||[]).filter(n=>n.date>last-span&&n.date<=last&&Number.isFinite(n.trending)).reduce((s,n)=>s+Math.max(0,n.trending),0)]));
  return {rows:rows.filter(m=>scores.has(m.anilistId)).map(m=>({...m,trendActivity:scores.get(m.anilistId)})).sort((a,b)=>b.trendActivity-a.trendActivity),asOf:last?new Date(last*1000).toISOString():null};
}
function createDiscovery({upstream,safeManga,chapterRow,fetcher=(...a)=>fetch(...a)}) {
  const trendCache=new Map(),pending=new Map();
  async function histories(ids) {
    const key=ids.slice().sort((a,b)=>a-b).join(',');const old=trendCache.get(key);if(old?.until>Date.now())return old.rows;if(pending.has(key))return pending.get(key);
    const task=(async()=>{const query='query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:MANGA,isAdult:false){id trends(perPage:31,sort:DATE_DESC){nodes{date trending}}}}}';
      const r=await fetcher('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,variables:{ids}}),signal:AbortSignal.timeout(8000),redirect:'error'});
      if(!r.ok)throw new SourceError(r.status===429?429:502,'Trend activity is temporarily unavailable.');const d=await r.json();if(d.errors||!Array.isArray(d.data?.Page?.media))throw new SourceError(502,'Trend activity could not be verified.');
      const rows=d.data.Page.media;trendCache.set(key,{rows,until:Date.now()+300000});while(trendCache.size>24)trendCache.delete(trendCache.keys().next().value);return rows;
    })();pending.set(key,task);task.then(()=>pending.delete(key),()=>pending.delete(key));return task;
  }
  async function stats(rows) {if(!rows.length)return rows;const p=new URLSearchParams();rows.forEach(m=>p.append('manga[]',m.id));let d;try{d=await upstream('/statistics/manga',p);}catch{return rows;}return rows.map(m=>({...m,follows:d.statistics?.[m.id]?.follows||0,rating:d.statistics?.[m.id]?.rating?.bayesian||undefined}));}
  async function browse(q) {
    const f=discoveryQuery(q),d=await upstream('/manga',f.params);let rows=d.data.filter(f.matches).map(safeManga),asOf=null;
    if(f.section==='trending'||f.sort==='trending') {
      const ids=[...new Set(rows.map(m=>m.anilistId).filter(Boolean))];if(ids.length){const ranked=rankTrends(rows,await histories(ids),f.period);rows=ranked.rows;asOf=ranked.asOf;}else rows=[];
    }else if(f.section==='latest') {
      if(f.heat==='hot')rows=(await stats(rows)).sort((a,b)=>(b.follows||0)-(a.follows||0)).slice(0,24);
      const p=new URLSearchParams({limit:'100'});rows.filter(m=>UUID.test(m.latestChapterId||'')).forEach(m=>p.append('ids[]',m.latestChapterId));
      if(p.has('ids[]'))try{const chapters=(await upstream('/chapter',p)).data;const byId=new Map(chapters.map(c=>[c.id,chapterRow(c)]));rows=rows.map(m=>({...m,latestChapter:byId.get(m.latestChapterId)}));}catch{/* Titles remain usable if optional chapter labels fail. */}
    }
    return {status:200,maxAge:120,body:{data:rows,pagination:{currentPage:f.page,hasNext:f.offset+f.limit<Math.min(d.total,10000)},ranking:f.section==='trending'||f.sort==='trending'?'anilist-activity':undefined,asOf,filtered:f.residual,note:f.residual?'Unknown release years and final chapter totals are excluded when those filters are set.':undefined}};
  }
  return {browse};
}
module.exports={discoveryQuery,rankTrends,createDiscovery};
