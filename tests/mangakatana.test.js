const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createKatanaSource,parseSearch,parseChapters,parsePages,safeImage}=require('../lib/mangakatana');
const manga={id:'00000000-0000-4000-8000-000000000001',title:'Fixture manga'};
const series={path:'/manga/fixture-manga.123',id:'123',title:'Fixture manga'};
const search='<div id="book_list"><div class="item"><div class="text"><h3><a href="https://mangakatana.com/manga/fixture-manga.123">Fixture manga</a></h3></div></div></div>';
const chapters='<table><tr><td class="chapter"><a href="https://mangakatana.com/manga/fixture-manga.123/c0">Chapter 0: Prologue</a></td><td class="update_time">Oct-18-2026</td></tr><tr><td class="chapter"><a href="https://mangakatana.com/manga/fixture-manga.123/c1.5">Chapter 1.5: Extra</a></td></tr></table>';
const image='https://i1.mangakatana.com/token/abc123%3At%3A456/0.jpg';
const pages=`<script>var thzq=['${image}']; $(this).attr('data-src', thzq[index]);</script>`;
const html=(s)=>new Response(s,{headers:{'Content-Type':'text/html'}});
test('MangaKatana parsing retains chapter zero, decimals and verified source ownership',()=>{
  assert.equal(parseSearch(search,'').length,1);const rows=parseChapters(chapters,series,manga.id);assert.equal(rows.length,2);assert.equal(rows[0].id,'mk-123-0');assert.equal(rows[1].chapter,'1.5');assert.equal(rows[0].title,'Prologue');
  assert.deepEqual(parseChapters(chapters,{...series,path:'/manga/another.456',id:'456'},manga.id),[]);
  assert.equal(parseSearch(search.replace('https://mangakatana.com','https://evil.example'),'').length,0);
});
test('MangaKatana image parsing never evaluates source scripts or accepts arbitrary image URLs',()=>{
  assert.deepEqual(parsePages(pages),[image]);assert.equal(safeImage(image),true);
  for(const url of ['https://evil.example/token/a/0.jpg','https://i1.mangakatana.com.evil.test/token/a/0.jpg','http://i1.mangakatana.com/token/a/0.jpg','https://i1.mangakatana.com/token/%2e%2e/0.jpg','https://user:pass@i1.mangakatana.com/token/a/0.jpg'])assert.equal(safeImage(url),false);
  assert.throws(()=>parsePages(pages.replace(image,'https://evil.example/1.jpg')),/verified/);assert.throws(()=>parsePages('<script>throw new Error("do not execute")</script>'),/no readable/);
});
test('MangaKatana adapter verifies identity before page requests and caches only public data',async()=>{
  const urls=[];const source=createKatanaSource({interval:0,fetcher:async url=>{urls.push(url);return html(url.includes('/page/')?search:url.endsWith('/c0')?pages:chapters);}});
  const rows=await source.chapters(manga);assert.equal(rows.length,2);
  assert.deepEqual((await source.chapter(manga,'mk-123-0')).images,[image]);const count=urls.length;
  await assert.rejects(()=>source.chapter(manga,'mk-456-0'),/does not belong/);await assert.rejects(()=>source.chapter(manga,'mk-123-99'),/not listed/);assert.equal(urls.length,count);
});
test('MangaKatana never substitutes sequels or follows foreign redirects or access challenges',async()=>{
  const sequel=createKatanaSource({interval:0,fetcher:async()=>html(search.replaceAll('Fixture manga','Fixture manga sequel'))});assert.equal(await sequel.chapters(manga),null);
  const redirect=createKatanaSource({interval:0,fetcher:async()=>new Response('',{status:302,headers:{location:'http://localhost/private'}})});await assert.rejects(()=>redirect.chapters(manga),/outside/);
  const blocked=createKatanaSource({interval:0,fetcher:async()=>new Response('',{status:403})});await assert.rejects(()=>blocked.chapters(manga),/HTTP 403/);
});
