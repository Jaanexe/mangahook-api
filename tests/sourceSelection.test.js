const {test}=require('node:test');const assert=require('node:assert/strict');
const {createImageProbe,selectWorkingSource}=require('../lib/sourceSelection');
const image='https://cdn.atsu.moe/static/pages/fixture/0.webp';
test('image health checks reject HTML, blocked images and arbitrary hosts before marking a source working',async()=>{
  let calls=0;const probe=createImageProbe({fetcher:async()=>{calls++;return new Response('<html>challenge</html>',{headers:{'content-type':'image/webp'}});}});
  await assert.rejects(()=>probe(image),/readable chapter image/);
  await assert.rejects(()=>probe('http://localhost/private'),/host could not/);assert.equal(calls,1);
  const blocked=createImageProbe({fetcher:async()=>new Response('',{status:403})});await assert.rejects(()=>blocked(image),/unavailable/);
});
test('a real image signature is checked once while fresh public health requests coalesce',async()=>{
  let calls=0;const probe=createImageProbe({fetcher:async()=>{calls++;return new Response(Buffer.from('RIFF0000WEBPpayload'),{status:206});}});
  const [a,b]=await Promise.all([probe(image),probe(image)]);assert.ok(a>0);assert.equal(a,b);assert.equal(await probe(image),a);assert.equal(calls,1);
});
test('automatic selection skips a listed source whose actual page fails, then reports the working fallback',async()=>{
  const row={id:'chapter1',chapter:'1'};
  const selected=await selectWorkingSource([
    {id:'broken',name:'Broken',chapters:async()=>[row],chapter:async()=>({images:[]})},
    {id:'good',name:'Good',chapters:async()=>[row],chapter:async()=>({images:[image]})},
  ],async()=>12345);
  assert.equal(selected.source,'good');assert.equal(selected.sourceHealth.checkedAt,12345);assert.deepEqual(selected.sourceHealth.attempts.map(a=>a.status),['unavailable','working']);
  await assert.rejects(()=>selectWorkingSource([{id:'empty',name:'Empty',chapters:async()=>[],chapter:async()=>{throw Error('Should not fetch');}}],async()=>0),e=>e.status===503&&e.sourceHealth.status==='unavailable');
});
