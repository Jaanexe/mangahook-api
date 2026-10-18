const {SourceError,safeImage:weebImage}=require('./weebcentral');
const {safeImage:katanaImage}=require('./mangakatana');
const {imageUrl:atsuImage}=require('./atsumaru');
function safeImage(url) {
  try {
    if(weebImage(url)||katanaImage(url))return true;
    if(atsuImage(url)===url)return true;
  } catch { /* Continue with the MangaDex image check. */ }
  try {const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/data\/[a-f0-9]{32}\/[a-z0-9._-]+$/i.test(u.pathname)&&(u.hostname.endsWith('.mangadex.network')||u.hostname==='uploads.mangadex.org');}catch{return false;}
}
function imageSignature(bytes) {
  const b=Buffer.from(bytes);
  return (b[0]===0xff&&b[1]===0xd8) || b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP') || (b.toString('ascii',4,8)==='ftyp'&&/(?:avif|avis)/.test(b.toString('ascii',8,32)));
}
function createImageProbe({fetcher=(...args)=>fetch(...args)}={}) {
  const cache=new Map(),pending=new Map();
  return async function probe(url) {
    if(!safeImage(url))throw new SourceError(502,'The sample image host could not be verified.');
    const old=cache.get(url);if(old&&Date.now()-old<120000)return old;if(pending.has(url))return pending.get(url);
    const task=(async()=>{
      const r=await fetcher(url,{headers:{Accept:'image/*',Range:'bytes=0-63',Origin:'https://shark-stream.vercel.app','Sec-Fetch-Dest':'image','Sec-Fetch-Mode':'no-cors','Sec-Fetch-Site':'cross-site'},redirect:'error',signal:AbortSignal.timeout(6000)});
      if(![200,206].includes(r.status)||!r.body)throw new SourceError(502,'The sample chapter image is unavailable.');
      // A direct GET can succeed while the browser is forbidden to embed the image.
      // Respect the CDN policy; do not proxy or strip these protections.
      if(['same-origin','same-site'].includes((r.headers.get('cross-origin-resource-policy')||'').trim().toLowerCase())) {
        await r.body.cancel().catch(()=>{});
        throw new SourceError(503,'This source does not allow chapter images to be embedded on other websites.');
      }
      const reader=r.body.getReader();const chunks=[];let length=0;
      try {while(length<32){const next=await reader.read();if(next.done)break;chunks.push(next.value.subarray(0,64));length+=next.value.length;}}finally{await reader.cancel().catch(()=>{});}
      if(!imageSignature(Buffer.concat(chunks)))throw new SourceError(502,'The source did not return a readable chapter image.');
      const checkedAt=Date.now();cache.set(url,checkedAt);while(cache.size>128)cache.delete(cache.keys().next().value);return checkedAt;
    })();pending.set(url,task);task.then(()=>pending.delete(url),()=>pending.delete(url));return task;
  };
}
async function selectWorkingSource(sources,probe,{preferred}={}) {
  // Race complete chapter + image checks, never chapter-list responses alone.
  // There are at most four trusted adapters; each retains its own request pacing.
  const attempts=new Map();
  const tasks=sources.map(async source=>{
    try {
      const rows=await source.chapters();
      if(!rows?.length){attempts.set(source.id,{source:source.id,sourceName:source.name,status:'empty'});throw new SourceError(404,'This source has no chapters in this language.');}
      const sample=rows.find(c=>c.chapter==='1')||rows[0];
      const chapter=await source.chapter(sample);
      if(!chapter?.images?.length)throw new SourceError(502,'This source has no chapter pages.');
      const checkedAt=await probe(chapter.images[0]);
      attempts.set(source.id,{source:source.id,sourceName:source.name,status:'working',checkedAt});
      return {rows,previewChapter:chapter,source:source.id,sourceName:source.name,checkedAt,sampleChapter:sample.chapter};
    }catch(error){
      if(!attempts.has(source.id))attempts.set(source.id,{source:source.id,sourceName:source.name,status:'unavailable',message:error instanceof SourceError?error.message:'This source could not be reached.'});
      throw error;
    }
  });
  // Attach rejection handlers immediately, including when an explicit preference
  // is being checked. Slower checks cannot mutate an already-returned response.
  const fastest=Promise.any(tasks).then(value=>({value}),()=>({value:null}));
  const snapshot=()=>sources.flatMap(source=>attempts.has(source.id)?[{...attempts.get(source.id)}]:[]);
  let selected;
  const index=sources.findIndex(source=>source.id===preferred);
  if(index>=0)try{selected=await tasks[index];}catch{ /* Use the prepared fallback. */ }
  selected ||= (await fastest).value;
  if(selected){
    const {checkedAt,sampleChapter,...result}=selected;
    return {...result,sourceHealth:{status:'working',checkedAt,sampleChapter,attempts:snapshot()}};
  }
  const error=new SourceError(503,'No source with readable chapter pages could be confirmed. Retry or choose another language.');error.sourceHealth={status:'unavailable',attempts:snapshot()};throw error;
}
module.exports={safeImage,imageSignature,createImageProbe,selectWorkingSource};
