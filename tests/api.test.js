const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleRequest, resetPublicCache } = require('../api/index');
const id = '00000000-0000-4000-8000-000000000001';
const chapter = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const manga = { id, attributes: { title: { en: 'Fixture manga' }, description: { en: 'Description' }, contentRating: 'safe', status: 'ongoing', availableTranslatedLanguages: ['en'], tags: [] }, relationships: [] };
const c = { id: chapter, attributes: { pages: 2, chapter: '2.5', translatedLanguage: 'en' }, relationships: [{ id, type: 'manga' }] };
const ok = (data) => Response.json({ result: 'ok', data });
async function mocked(fn, body) { const previous = global.fetch; resetPublicCache(); global.fetch = fn; try { await body(); } finally { global.fetch = previous; resetPublicCache(); } }
test('invalid IDs, filters, pages and methods never reach the upstream', async () => {
  await mocked(() => { throw Error('Should not fetch'); }, async () => {
    for (const url of ['/api/manga/123', '/api/manga?url=http://localhost', '/api/manga?page=0', '/api/manga?page=9999', '/api/manga?status=wrong', '/api/manga?language=../en', '/api/manga?sort=wrong', '/api/chapter/' + chapter + '?manga=../x']) assert.equal((await handleRequest(url)).status, 400, url);
    assert.equal((await handleRequest('/api/manga', 'POST')).status, 405);
  });
});
test('search combines filters, limits public content and preserves real pagination', async () => {
  await mocked(async (input) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.mangadex.org');
    assert.equal(url.searchParams.get('title'), 'Fixture');
    assert.equal(url.searchParams.get('offset'), '24');
    assert.equal(url.searchParams.get('availableTranslatedLanguage[]'), 'en');
    assert.equal(url.searchParams.get('status[]'), 'completed');
    assert.equal(url.searchParams.get('includedTags[]'), other);
    assert.deepEqual(url.searchParams.getAll('contentRating[]'), ['safe', 'suggestive']);
    return Response.json({ result: 'ok', data: [manga], total: 100 });
  }, async () => {
    const r = await handleRequest('/api/search?q=Fixture&page=2&status=completed&genre=' + other);
    assert.equal(r.status, 200); assert.equal(r.body.data[0].id, id); assert.equal(r.body.pagination.hasNext, true);
  });
});
test('empty chapter feeds stay empty instead of returning fake chapters', async () => {
  await mocked(async (input) => String(input).includes('/feed?') ? Response.json({ result: 'ok', data: [], total: 0 }) : ok(manga), async () => {
    const r = await handleRequest('/api/manga/' + id + '/chapters?language=en');
    assert.equal(r.status, 200); assert.deepEqual(r.body.data, []); assert.equal(r.body.pagination.hasNext, false);
  });
});
test('automatic sources retain readable MangaDex chapters when an alternate source is unavailable', async () => {
  await mocked(async (input) => {
    const url = new URL(input);
    if (url.hostname === 'fixture.mangadex.network') return new Response(Buffer.from([255,216,255,224,0,0,0,0]));
    if (url.origin !== 'https://api.mangadex.org') return new Response('Unavailable', { status: 403 });
    if (url.pathname.endsWith('/feed')) return Response.json({ result: 'ok', data: [c], total: 1 });
    if (url.pathname.startsWith('/chapter/')) return ok(c);
    if (url.pathname.startsWith('/at-home/')) return Response.json({result:'ok',baseUrl:'https://fixture.mangadex.network',chapter:{hash:'a'.repeat(32),data:['1.jpg']}});
    return ok(manga);
  }, async () => {
    const result = await handleRequest('/api/manga/' + id + '/chapters?source=auto&all=1');
    assert.equal(result.status, 200);
    assert.equal(result.body.source, 'mangadex');
    assert.equal(result.body.data[0].id, chapter);
    assert.equal(result.body.sourceHealth.status, 'working');
    assert.ok(result.body.sourceHealth.attempts.some(a=>a.source==='mangadex'&&a.status==='working'));
  });
});

test('Auto in another language only checks providers that supply that language', async () => {
  const translated={...c,attributes:{...c.attributes,translatedLanguage:'fr'}};
  await mocked(async input=>{
    const url=new URL(input);
    if(url.hostname==='fixture.mangadex.network')return new Response(Buffer.from([255,216,255,224,0,0,0,0]));
    assert.equal(url.origin,'https://api.mangadex.org','English-only sources must not be queried');
    if(url.pathname.endsWith('/feed')){
      assert.equal(url.searchParams.get('translatedLanguage[]'),'fr');
      return Response.json({result:'ok',data:[translated],total:1});
    }
    if(url.pathname.startsWith('/chapter/'))return ok(translated);
    if(url.pathname.startsWith('/at-home/'))return Response.json({result:'ok',baseUrl:'https://fixture.mangadex.network',chapter:{hash:'b'.repeat(32),data:['1.jpg']}});
    return ok(manga);
  },async()=>{
    const result=await handleRequest('/api/manga/'+id+'/chapters?source=auto&language=fr&all=1');
    assert.equal(result.status,200);
    assert.equal(result.body.source,'mangadex');
    assert.equal(result.body.data[0].language,'fr');
    assert.equal(result.body.sourceHealth.status,'working');
  });
});
test('chapter pages verify manga identity and trusted HTTPS image hosts', async () => {
  await mocked(async (input) => {
    const path = new URL(input).pathname;
    if (path.startsWith('/chapter/')) return ok(c);
    if (path.startsWith('/manga/')) return ok(manga);
    return Response.json({ result: 'ok', baseUrl: 'https://fixture.mangadex.network', chapter: { hash: 'a'.repeat(32), data: ['1.jpg', '2.png'] } });
  }, async () => {
    const r = await handleRequest('/api/chapter/' + chapter + '?manga=' + id);
    assert.equal(r.status, 200); assert.equal(r.body.data.images.length, 2); assert.equal(r.body.data.chapter, '2.5');
    assert.equal((await handleRequest('/api/chapter/' + chapter + '?manga=' + other)).status, 400);
  });
});
test('untrusted chapter image hosts and path injection are rejected', async () => {
  for (const baseUrl of ['http://fixture.mangadex.network', 'https://mangadex.network.evil.test', 'https://localhost', 'https://user:pass@fixture.mangadex.network']) {
    await mocked(async (input) => {
      const path = new URL(input).pathname;
      return path.startsWith('/chapter/') ? ok(c) : path.startsWith('/manga/') ? ok(manga) : Response.json({ result: 'ok', baseUrl, chapter: { hash: 'a'.repeat(32), data: ['1.jpg'] } });
    }, async () => assert.equal((await handleRequest('/api/chapter/' + chapter + '?manga=' + id)).status, 502));
  }
});
test('upstream rate limits and missing resources remain explicit', async () => {
  for (const status of [429, 404, 500]) {
    await mocked(async () => new Response('{}', { status }), async () => {
      const r = await handleRequest('/api/manga');
      assert.equal(r.status, status === 500 ? 502 : status); assert.ok(r.body.error); assert.equal(r.body.data, undefined);
    });
  }
});
test('external-only chapters and unrecognised content ratings are never presented as hosted pages', async () => {
  await mocked(async (input) => new URL(input).pathname.startsWith('/chapter/') ? ok({ ...c, attributes: { ...c.attributes, externalUrl: 'https://publisher.test' } }) : ok(manga), async () => assert.equal((await handleRequest('/api/chapter/' + chapter + '?manga=' + id)).status, 404));
  await mocked(async () => ok({ ...manga, attributes: { ...manga.attributes, contentRating: 'unknown' } }), async () => assert.equal((await handleRequest('/api/manga/' + id)).status, 404));
});

test('related works use declared catalogue relationships and one bounded batch without guessing IDs',async()=>{
  let batches=0;
  await mocked(async input=>{
    const url=new URL(input);
    if(url.pathname==='/manga/'+id)return ok({...manga,relationships:[
      {id:other,type:'manga',related:'sequel'},
      {id:'not-a-uuid',type:'manga',related:'spin_off'},
      {id:chapter,type:'manga',related:'unknown'},
      {id,type:'manga',related:'prequel'},
    ]});
    assert.equal(url.pathname,'/manga');batches++;
    assert.deepEqual(url.searchParams.getAll('ids[]'),[other]);
    return Response.json({result:'ok',data:[{...manga,id:other},{...manga,id:chapter}]});
  },async()=>{
    const r=await handleRequest('/api/manga/'+id+'/related');
    assert.equal(r.status,200);assert.equal(batches,1);
    assert.equal(r.body.data.length,1);assert.equal(r.body.data[0].id,other);assert.equal(r.body.data[0].relation,'sequel');
  });
});

test('absent related works remain empty and invalid related filters never reach providers',async()=>{
  await mocked(async()=>ok(manga),async()=>{
    const r=await handleRequest('/api/manga/'+id+'/related');assert.equal(r.status,200);assert.deepEqual(r.body.data,[]);
  });
  await mocked(()=>{throw Error('Unexpected request');},async()=>assert.equal((await handleRequest('/api/manga/'+id+'/related?url=http://localhost')).status,400));
});
