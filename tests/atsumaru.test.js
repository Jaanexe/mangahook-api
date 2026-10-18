const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAtsuSource,parseChapters,imageUrl}=require('../lib/atsumaru');
const {titleKey,matchingTitles}=require('../lib/titleMatch');
const manga={id:'00000000-0000-4000-8000-000000000015',title:'One Punch-Man',year:2012,alternativeTitles:['ワンパンマン']};
const raw=[{id:'ch01',number:0,pageCount:2,title:'Prologue',scanlationMangaId:'grp01',createdAt:1700000000000},{id:'ch02',number:1.5,pageCount:3,title:'Extra',scanlationMangaId:'grp02'},{id:'ch03',number:1.5,pageCount:3,title:'Extra',scanlationMangaId:'grp01'}];
test('title matching tolerates punctuation and joined words while preserving editions, sequels and known years',()=>{
  assert.equal(titleKey('One Punch-Man'),titleKey('Onepunch-Man'));
  const candidates=[{id:'main',title:'Onepunch-Man',year:2012},{id:'web',title:'Onepunch-Man (Webcomic)',year:2009},{id:'sequel',title:'Onepunch-Man 2',year:2012}];
  assert.deepEqual(matchingTitles(candidates,manga).map(c=>c.id),['main']);
  assert.deepEqual(matchingTitles(candidates,{...manga,title:'One Punch-Man (Webcomic)',year:2009,alternativeTitles:['One Punch Man']}).map(c=>c.id),['web']);
  assert.deepEqual(matchingTitles([{title:'One Punch Man',year:2009}],manga),[]);
});
test('Atsumaru preserves chapter zero, decimal numbers and distinct translation groups',()=>{
  const rows=parseChapters(raw,'manga01',manga.id,[{id:'grp01',name:'Alpha',score:1},{id:'grp02',name:'Delta',score:5}]);
  assert.equal(rows[0].chapter,'0');assert.equal(rows[1].chapter,'1.5');assert.equal(rows[1].groups[0],'Delta');assert.equal(rows[1].id,'at~manga01~ch02');
  assert.equal(parseChapters([...raw,{id:'../bad',number:3,pageCount:2},{id:'empty',number:4,pageCount:0}],'manga01',manga.id).length,3);
});
test('Atsumaru only resolves verified chapter CDN images, including AVIF',()=>{
  assert.equal(imageUrl('/static/pages/ch01/001.avif'),'https://cdn.atsu.moe/static/pages/ch01/001.avif');
  assert.equal(imageUrl('pages/manga01/ch01/0.webp'),'https://cdn.atsu.moe/static/pages/manga01/ch01/0.webp');
  for(const url of ['https://evil.example/static/pages/a.jpg','http://cdn.atsu.moe/static/pages/a.jpg','https://user:pass@cdn.atsu.moe/static/pages/a.jpg','/static/pages/../private/a.jpg','/static/pages/%2e%2e/a.jpg','https://cdn.atsu.moe/static/pages/a.jpg?x=1'])assert.throws(()=>imageUrl(url));
});
test('Atsumaru verifies manga and chapter ownership before page requests and coalesces metadata',async()=>{
  const calls=[];const source=createAtsuSource({interval:0,fetcher:async input=>{
    calls.push(input);const u=new URL(input);
    return Response.json(u.pathname.includes('/search')?{hits:[{document:{id:'manga01',title:'Onepunch-Man',releaseYear:2012}}]}:u.pathname.endsWith('allChapters')?{chapters:raw}:u.pathname.endsWith('/page')?{mangaPage:{scanlators:[]}}:{readChapter:{pages:[{image:'/static/pages/ch01/0.webp'}]}});
  }});
  const [rows,again]=await Promise.all([source.chapters(manga),source.chapters(manga)]);assert.equal(rows.length,3);assert.equal(again.length,3);
  const chapter=await source.chapter(manga,rows[0].id);assert.equal(chapter.images[0],'https://cdn.atsu.moe/static/pages/ch01/0.webp');
  const count=calls.length;await assert.rejects(()=>source.chapter(manga,'at~other01~ch01'),/does not belong/);await assert.rejects(()=>source.chapter(manga,'at~manga01~missing'),/not listed/);assert.equal(calls.length,count);assert.equal(calls.filter(u=>u.includes('/search')).length,1);
});
