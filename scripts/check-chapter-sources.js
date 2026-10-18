const assert = require('node:assert/strict');
const { handleRequest } = require('../api/index');
async function check(title) {
  const found = await handleRequest('/api/manga?q=' + encodeURIComponent(title));
  assert.equal(found.status, 200);
  const manga = found.body.data.find((m) => m.title.toLowerCase() === title.toLowerCase());
  assert.ok(manga, 'Exact catalogue title: ' + title);
  const list = await handleRequest(`/api/manga/${manga.id}/chapters?language=en&source=auto&all=1`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.source, 'weebcentral');
  assert.ok(list.body.data.length > 100);
  const first = list.body.data.find((c) => c.chapter === '1');
  assert.ok(first, 'Chapter one');
  const pages = await handleRequest(`/api/chapter/${first.id}?manga=${manga.id}`);
  assert.equal(pages.status, 200, JSON.stringify(pages.body));
  const image = await fetch(pages.body.data.images[0], { signal: AbortSignal.timeout(15000) });
  assert.equal(image.status, 200);
  assert.ok(image.headers.get('content-type').startsWith('image/'));
  await image.body.cancel();
  console.log(JSON.stringify({ title, id: manga.id, source: list.body.source, chapters: list.body.data.length, first: first.id, pages: pages.body.data.images.length, imageStatus: image.status, host: new URL(pages.body.data.images[0]).hostname }));
}
(async () => { for (const title of process.argv.slice(2).length ? process.argv.slice(2) : ['Jujutsu Kaisen', 'One Piece']) await check(title); })().catch((e) => { console.error(e); process.exitCode = 1; });
