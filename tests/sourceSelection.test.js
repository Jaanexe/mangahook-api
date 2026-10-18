const {test}=require('node:test');const assert=require('node:assert/strict');
const {createImageProbe,selectWorkingSource}=require('../lib/sourceSelection');
const image='https://cdn.atsu.moe/static/pages/fixture/0.webp';
test('image health checks reject HTML, blocked images and arbitrary hosts before marking a source working',async()=>{
  let calls=0;const probe=createImageProbe({fetcher:async()=>{calls++;return new Response('<html>challenge</html>',{headers:{'content-type':'image/webp'}});}});
  await assert.rejects(()=>probe(image),/readable chapter image/);
  await assert.rejects(()=>probe('http://localhost/private'),/host could not/);assert.equal(calls,1);
  const blocked=createImageProbe({fetcher:async()=>new Response('',{status:403})});await assert.rejects(()=>blocked(image),/unavailable/);
});

test('Auto returns the first fully readable source without waiting for a slow earlier adapter', async () => {
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  let timer;
  const row = {id:'chapter1',chapter:'1'};
  const fast = {id:'fast',name:'Fast',chapters:async()=>[row],chapter:async()=>({images:[image]})};
  try {
    const result = await Promise.race([
      selectWorkingSource([
        {id:'slow',name:'Slow',chapters:()=>slow,chapter:fast.chapter}, fast,
      ], async()=>12345),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fast source waited for slow source')),1000);}),
    ]);
    assert.equal(result.source,'fast');
    assert.deepEqual(result.sourceHealth.attempts.map(a=>a.source),['fast']);
    releaseSlow([row]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(result.sourceHealth.attempts.map(a=>a.source),['fast'],'late results must not mutate the response');
  } finally { clearTimeout(timer); releaseSlow([]); }
});

test('a fast list or blocked image cannot beat a source whose actual pages pass verification', async () => {
  const row={id:'chapter1',chapter:'1'};
  const result=await selectWorkingSource([
    {id:'blocked',name:'Blocked',chapters:async()=>[row],chapter:async()=>({images:['blocked-image']})},
    {id:'readable',name:'Readable',chapters:async()=>[row],chapter:async()=>({images:[image]})},
  ],async url=>{if(url!==image)throw Error('Blocked');return 12345;});
  assert.equal(result.source,'readable');
  assert.equal(result.sourceHealth.status,'working');
});

test('explicit healthy preferences are retained and failed preferences use the prepared fastest fallback', async () => {
  let release;
  const ready=new Promise(resolve=>{release=resolve;});
  const row={id:'chapter1',chapter:'1'};
  const fast={id:'fast',name:'Fast',chapters:async()=>[row],chapter:async()=>({images:[image]})};
  const pending=selectWorkingSource([
    fast,{...fast,id:'preferred',name:'Preferred',chapters:()=>ready},
  ],async()=>12345,{preferred:'preferred'});
  release([row]);
  assert.equal((await pending).source,'preferred');
  const fallback=await selectWorkingSource([
    {...fast,id:'preferred',chapters:async()=>{throw Error('Unavailable');}},fast,
  ],async()=>12345,{preferred:'preferred'});
  assert.equal(fallback.source,'fast');
});
test('a real image signature is checked once while fresh public health requests coalesce',async()=>{
  let calls=0;const probe=createImageProbe({fetcher:async()=>{calls++;return new Response(Buffer.from('RIFF0000WEBPpayload'),{status:206});}});
  const [a,b]=await Promise.all([probe(image),probe(image)]);assert.ok(a>0);assert.equal(a,b);assert.equal(await probe(image),a);assert.equal(calls,1);
});

test('a valid image blocked from cross-site embedding is unavailable even when a direct request succeeds',async()=>{
  for (const policy of ['same-site','same-origin']) {
    const probe=createImageProbe({fetcher:async(url,options)=>{
      assert.equal(options.headers.Origin,'https://shark-stream.vercel.app');
      assert.equal(options.headers['Sec-Fetch-Site'],'cross-site');
      return new Response(Buffer.from('RIFF0000WEBPpayload'),{headers:{'Cross-Origin-Resource-Policy':policy}});
    }});
    await assert.rejects(()=>probe(image),/does not allow.*embedded/);
  }
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
