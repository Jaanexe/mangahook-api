const assert = require('node:assert/strict');
const { handleRequest } = require('../api/index');
async function check(title) {
  const found = await handleRequest('/api/manga?q=' + encodeURIComponent(title));
  assert.equal(found.status, 200);
  const manga = found.body.data.find((m) => m.title.toLowerCase() === title.toLowerCase());
  assert.ok(manga, 'Exact catalogue title: ' + title);
  const list = await handleRequest(`/api/manga/${manga.id}/chapters?language=en&source=auto&all=1`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(['mangakatana', 'weebcentral'].includes(list.body.source));
  assert.ok(list.body.data.length > 100);
  const first = list.body.data.find((c) => c.chapter === '1');
  assert.ok(first, 'Chapter one');
  const pages = await handleRequest(`/api/chapter/${first.id}?manga=${manga.id}`);
  assert.equal(pages.status, 200, JSON.stringify(pages.body));
  const image = await fetch(pages.body.data.images[0], { signal: AbortSignal.timeout(15000) });
  assert.equal(image.status, 200);
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.ok((bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50) || Buffer.from(bytes.subarray(0,4)).toString() === 'RIFF', 'Real image signature');
  console.log(JSON.stringify({ title, id: manga.id, source: list.body.source, chapters: list.body.data.length, first: first.id, pages: pages.body.data.images.length, imageStatus: image.status, host: new URL(pages.body.data.images[0]).hostname }));
}
(async () => { for (const title of process.argv.slice(2).length ? process.argv.slice(2) : ['Jujutsu Kaisen', 'One Piece']) await check(title); })().catch((e) => { console.error(e); process.exitCode = 1; });
