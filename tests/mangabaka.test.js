const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handleRequest,resetPublicCache}=require('../api/index');
const {safeSeries}=require('../lib/mangabaka');
const m={id:99101,title:'Fixture manga',content_rating:'safe',type:'manga',authors:['Author'],artists:[],year:2020,status:'releasing',genres:['action'],cover:{x350:{x1:'https://cdn.mangabaka.dev/fixture.jpg'}},source:{anilist:{id:321}},secondary_titles:{en:[{title:'Fixture alias'}]}};
test('backup IDs are namespaced, content ratings stay explicit, aliases and provider identity survive',()=>{
  const d=safeSeries(m);assert.equal(d.id,'mb-99101');assert.equal(d.source,'mangabaka');assert.equal(d.anilistId,321);assert.equal(d.status,'ongoing');assert.deepEqual(d.alternativeTitles,['Fixture alias']);
  assert.throws(()=>safeSeries({...m,content_rating:'unknown'}));assert.throws(()=>safeSeries({...m,type:'novel'}));assert.equal(safeSeries({...m,cover:{raw:{url:'https://evil.test/page'}}}).image,'');
});
test('MangaDex outage switches discovery to bounded public metadata without claiming chapter updates',async()=>{
 const old=global.fetch;resetPublicCache();try{
  global.fetch=async input=>{const u=new URL(input);if(u.hostname==='api.mangadex.org')return new Response('Maintenance',{status:503});assert.equal(u.hostname,'api.mangabaka.org');assert.equal(u.searchParams.get('sort_by'),'latest');assert.deepEqual(u.searchParams.getAll('content_rating'),['safe','suggestive']);assert.equal(u.searchParams.get('limit'),'24');return Response.json({status:200,data:[m],pagination:{next:'https://api.mangabaka.org/v1/series/search?page=2'}});};
  const r=await handleRequest('/api/discover?section=latest');assert.equal(r.status,200);assert.equal(r.body.data[0].id,'mb-99101');assert.equal(r.body.data[0].latestChapter,undefined);assert.match(r.body.note,/not confirmed chapter/);assert.equal(r.body.pagination.hasNext,true);
 }finally{global.fetch=old;resetPublicCache();}
});
test('backup details and chapter lists work without MangaDex, and other languages never receive English chapters',async()=>{
 const old=global.fetch;resetPublicCache();let mdCalls=0;try{
  global.fetch=async input=>{const u=new URL(input);if(u.hostname==='api.mangadex.org'){mdCalls++;return new Response('Maintenance',{status:503});}
   if(u.hostname==='api.mangabaka.org')return Response.json({status:200,data:m});
   assert.equal(u.hostname,'mangakatana.com');
   return new Response(u.pathname.includes('/page/')?'<div id="book_list"><div class="item"><div class="text"><h3><a href="https://mangakatana.com/manga/fixture.991">Fixture manga</a></h3></div></div></div>':'<table><tr><td class="chapter"><a href="https://mangakatana.com/manga/fixture.991/c1">Chapter 1</a></td></tr></table>',{headers:{'content-type':'text/html'}});
  };
  const d=await handleRequest('/api/manga/mb-99101');assert.equal(d.status,200);assert.equal(d.body.data.id,'mb-99101');
  const r=await handleRequest('/api/manga/mb-99101/chapters?source=mangakatana&metadata=1&language=en');assert.equal(r.status,200);assert.equal(r.body.data[0].mangaId,'mb-99101');assert.equal(r.body.data[0].id,'mk-991-1');
  assert.equal((await handleRequest('/api/manga/mb-99101/chapters?source=auto&language=fr')).status,503);assert.equal(mdCalls,1);
 }finally{global.fetch=old;resetPublicCache();}
});
test('foreign filters and URLs cannot be silently reinterpreted by the backup',async()=>{
  const old=global.fetch;resetPublicCache();try{global.fetch=async()=>new Response('Maintenance',{status:503});
   assert.equal((await handleRequest('/api/discover?genre=mbg-action&url=http://localhost')).status,400);
   assert.equal((await handleRequest('/api/discover?genre=00000000-0000-4000-8000-000000000001')).status,503);
   assert.equal((await handleRequest('/api/manga/mb-0')).status,400);
  }finally{global.fetch=old;resetPublicCache();}
});
test('MangaDex chapters for a backup record require a unique explicit cross-service mapping',async()=>{
 const old=global.fetch;resetPublicCache();const md='00000000-0000-4000-8000-000000009102',chapter='00000000-0000-4000-8000-000000009103';try{
  global.fetch=async input=>{const u=new URL(input);
   if(u.hostname==='api.mangabaka.org')return Response.json({status:200,data:{...m,id:99102}});
   if(u.pathname==='/manga')return Response.json({result:'ok',data:[{id:md,attributes:{title:{en:m.title},contentRating:'safe',links:{al:'321'}},relationships:[]}]});
   assert.equal(u.pathname,'/manga/'+md+'/feed');return Response.json({result:'ok',data:[{id:chapter,attributes:{chapter:'1',pages:10,translatedLanguage:'fr'},relationships:[{type:'manga',id:md}]}],total:1});
  };
  const r=await handleRequest('/api/manga/mb-99102/chapters?source=mangadex&language=fr');assert.equal(r.status,200);assert.equal(r.body.data[0].mangaId,'mb-99102');assert.equal(r.body.data[0].language,'fr');assert.equal(r.body.data[0].id,chapter);
  resetPublicCache();global.fetch=async input=>new URL(input).hostname==='api.mangabaka.org'?Response.json({status:200,data:{...m,id:99104}}):Response.json({result:'ok',data:[{id:md,attributes:{links:{al:'999'}},relationships:[]}]});
  assert.equal((await handleRequest('/api/manga/mb-99104/chapters?source=mangadex')).status,503);
 }finally{global.fetch=old;resetPublicCache();}
});
