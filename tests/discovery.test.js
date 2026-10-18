const {test}=require('node:test');const assert=require('node:assert/strict');
const {discoveryQuery,rankTrends,createDiscovery}=require('../lib/discovery');
const g='00000000-0000-4000-8000-000000000001',t='00000000-0000-4000-8000-000000000002',g2='00000000-0000-4000-8000-000000000003';
const manga=(year=2020,count='150',tags=[g,t],lang='ja')=>({attributes:{year,lastChapter:count,tags:tags.map(id=>({id})),originalLanguage:lang,status:'completed'}});
test('combined discovery filters retain native author/language/rating scope and apply independent genre/theme modes, year ranges and known chapter totals',()=>{
 const f=discoveryQuery(new URLSearchParams({q:'hero',rating:'safe',type:'manga',language:'en,fr',status:'completed',author:g,genre:g+','+g2,theme:t,tagMode:'any',themeMode:'all',yearFrom:'2010',yearTo:'2025',minChapters:'100'}));
 assert.equal(f.params.get('title'),'hero');assert.equal(f.params.get('authorOrArtist'),g);assert.deepEqual(f.params.getAll('availableTranslatedLanguage[]'),['en','fr']);assert.deepEqual(f.params.getAll('contentRating[]'),['safe']);
 assert.equal(f.matches(manga()),true);assert.equal(f.matches(manga(2009)),false);assert.equal(f.matches(manga(null)),false);assert.equal(f.matches(manga(2020,null)),false);assert.equal(f.matches(manga(2020,'90')),false);assert.equal(f.matches(manga(2020,'150',[g])),false);assert.equal(f.matches(manga(2020,'150',[g,t],'ko')),false);
});
test('invalid discovery filters fail before any provider request and exact release-year filters use the native index',()=>{
 for(const query of ['page=0','page=-1','yearFrom=2025&yearTo=2020','minChapters=-1','type=wrong','sort=views-week','genre=bad','author=../private','period=year','rating=invalid','unknown=1'])assert.throws(()=>discoveryQuery(new URLSearchParams(query)),/Invalid/,query);
 const f=discoveryQuery(new URLSearchParams('yearFrom=2020&yearTo=2020'));assert.equal(f.params.get('year'),'2020');
});
test('trend periods use real daily activity rather than repeated follower counts or invented views',()=>{
 const day=1700000000,rows=[{id:'one',anilistId:1},{id:'two',anilistId:2},{id:'unmapped'}];
 const history=[{id:1,trends:{nodes:[{date:day,trending:100},{date:day-86400*2,trending:1}]}},{id:2,trends:{nodes:[{date:day,trending:10},{date:day-86400*2,trending:200},{date:day-86400*12,trending:500}]}}];
 assert.equal(rankTrends(rows,history,'day').rows[0].id,'one');assert.equal(rankTrends(rows,history,'week').rows[0].id,'two');assert.equal(rankTrends(rows,history,'month').rows[0].trendActivity,710);assert.equal(rankTrends(rows,history,'day').rows.length,2);
});
test('minimum-chapter filtering preserves upstream batch pagination even when this batch contains no matches',async()=>{
 const api=createDiscovery({upstream:async()=>({data:[manga(2020,null)],total:1000}),safeManga:m=>m,chapterRow:c=>c});
 const d=await api.browse(new URLSearchParams('minChapters=100'));assert.deepEqual(d.body.data,[]);assert.equal(d.body.pagination.hasNext,true);assert.equal(d.body.filtered,true);
});
test('trend history requests coalesce and reuse public history across day and month filters',async()=>{
 let calls=0;const api=createDiscovery({upstream:async()=>({data:[manga()],total:1}),safeManga:()=>({id:g,anilistId:1}),chapterRow:c=>c,fetcher:async()=>{calls++;return Response.json({data:{Page:{media:[{id:1,trends:{nodes:[{date:1700000000,trending:20}]}}]}}});}});
 const [a,b]=await Promise.all([api.browse(new URLSearchParams('section=trending&period=day')),api.browse(new URLSearchParams('section=trending&period=month'))]);assert.equal(calls,1);assert.equal(a.body.ranking,'anilist-activity');assert.equal(b.body.data[0].trendActivity,20);
});
test('missing popularity statistics never disguise a latest feed as a verified Hot ranking',async()=>{
  const api=createDiscovery({upstream:async(path)=>{if(path==='/statistics/manga')throw Error('Unavailable');return {data:[manga()],total:1};},safeManga:()=>({id:g}),chapterRow:c=>c});
  await assert.rejects(()=>api.browse(new URLSearchParams('section=latest&heat=hot')),/Hot rankings.*unavailable/);
  assert.equal(rankTrends([{id:g,anilistId:1}],[{id:1,trends:{nodes:[]}}],'week').rows.length,0);
});
