const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWeebSource, parseSearch, parseChapters, parsePages, safeImage } = require('../lib/weebcentral');
const series = '01J76XYCERXE60T7FKXVCCAQ0H', chapter = '01J8Z8P9QM1BAS1VAEX8T40XQ3';
const manga = { id: '00000000-0000-4000-8000-000000000001', title: 'Example', alternativeTitles: [] };
const search = `<article><section><a href="/series/${series}/Example"><div>Example</div></a></section></article>`;
const list = `<div x-data="{}"><a href="/chapters/${chapter}"><img src="/static/images/chapter-badge-official.svg"><span class="grow"><span>Chapter 1: Arrival</span></span><time datetime="2026-10-18T00:00:00Z"></time></a></div>`;
const images = '<section x-data="scroll"><img src="https://hot.planeptune.us/manga/Example/0001-001.png"></section>';
const response = (body) => new Response(body, { headers: { 'content-type': 'text/html' } });
test('source parsers retain chapter zero/decimals, language, provenance and translation labels', () => {
  assert.equal(parseSearch(search)[0].title, 'Example');
  const [row] = parseChapters(list.replace('Chapter 1:', 'Chapter 0.5:'), series, manga.id);
  assert.equal(row.chapter, '0.5'); assert.equal(row.title, 'Arrival');
  assert.equal(row.id, `wc-${series}-${chapter}`); assert.equal(row.mangaId, manga.id);
  assert.equal(row.language, 'en'); assert.equal(row.translationType, 'official');
  assert.equal(row.sourceUrl, 'https://weebcentral.com/chapters/' + chapter);
});
test('source metadata cannot inject foreign or malformed source links', () => {
  assert.deepEqual(parseSearch(search.replace('/series/', 'https://evil.example/series/')), []);
  assert.deepEqual(parseChapters(list.replace('/chapters/', 'https://evil.example/chapters/'), series, manga.id), []);
  assert.deepEqual(parseChapters('<p>No chapters</p>', series, manga.id), []);
});
test('chapter pages require verified HTTPS source CDN paths', () => {
  assert.equal(parsePages(images).length, 1);
  for (const bad of ['http://hot.planeptune.us/manga/a.png', 'https://hot.planeptune.us.evil.example/manga/a.png', 'https://u:p@hot.planeptune.us/manga/a.png', 'https://localhost/manga/a.png', 'https://hot.planeptune.us:444/manga/a.png', 'https://hot.planeptune.us/manga/..%2Fsecret.png', 'https://hot.planeptune.us/manga/a.png?url=http://localhost']) assert.equal(safeImage(bad), false, bad);
  assert.throws(() => parsePages(images.replace('hot.planeptune.us', 'evil.example')), /could not be verified/);
  assert.throws(() => parsePages('<section x-data="scroll"></section>'), /no readable pages/);
});
test('title matching never substitutes a sequel or a similarly named manga', async () => {
  const source = createWeebSource({ interval: 0, fetcher: async () => response(search.replaceAll('>Example<', '>Example 0<')) });
  assert.equal(await source.chapters(manga), null);
});
test('reader checks series and chapter ownership before requesting page images', async () => {
  const urls = [];
  const source = createWeebSource({ interval: 0, fetcher: async (url) => {
    urls.push(url);
    return response(url.includes('/search/') ? search : url.includes('/full-chapter-list') ? list : images);
  } });
  const rows = await source.chapters(manga);
  const found = await source.chapter(manga, rows[0].id);
  assert.equal(found.images.length, 1); assert.equal(found.pages, 1);
  assert.equal(urls.filter((url) => url.includes('/search/')).length, 1, 'public metadata requests should coalesce/cache');
  const pageRequests = urls.length;
  await assert.rejects(() => source.chapter(manga, `wc-01J76XYE9NJR1MFYY7929ZC1DS-${chapter}`), /does not belong/);
  await assert.rejects(() => source.chapter(manga, `wc-${series}-01J76XYE9NJR1MFYY7929ZC1DS`), /not listed/);
  await assert.rejects(() => source.chapter(manga, '../../private'), /Invalid source/);
  assert.equal(urls.length, pageRequests, 'foreign IDs must not cause image requests');
});
test('access challenges and upstream failures stay errors without bypasses or fake chapters', async () => {
  for (const failure of [new Response('', { status: 403 }), response('<title>Just a moment</title>')]) {
    const source = createWeebSource({ interval: 0, fetcher: async () => failure });
    await assert.rejects(() => source.chapters(manga), /unavailable|not currently accessible/);
  }
});
