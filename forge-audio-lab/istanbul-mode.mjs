// Observed Istanbul4k pattern: extra video sample sizes/chunks alias one 8-byte
// payload inside mdat, without adding stts/ctts entries. Deliberately nonstandard.
// This is a container experiment, not a TikTok quality guarantee or an uploader.
export const ISTANBUL_EXTRA_SAMPLES=8200;
const TAIL=new Uint8Array([0,0,0,4,0,0,0,0]);
const MAX_MOOV=64*1024*1024;
const containers=new Set(['moov','trak','mdia','minf','stbl']);
const enc=new TextEncoder();
const view=a=>new DataView(a.buffer,a.byteOffset,a.byteLength);
const u32=(a,o)=>view(a).getUint32(o);
const put=(a,o,n)=>{if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw Error('MP4 offset/count overflow');view(a).setUint32(o,n);};
const type=(a,o)=>String.fromCharCode(...a.subarray(o,o+4));
function fail(s){throw Error(s);}
function join(parts){const a=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){a.set(p,o);o+=p.length;}return a;}
function box(t,p){const a=new Uint8Array(8+p.length);put(a,0,a.length);a.set(enc.encode(t),4);a.set(p,8);return a;}
function boxes(a,start=0,end=a.length,{padding=false,context="MP4"}={}){
 const out=[];let o=start;
 while(o+8<=end){let n=u32(a,o),h=8;const t=type(a,o+4);
  if(n===1){if(o+16>end)fail('Truncated MP4 box');n=Number(view(a).getBigUint64(o+8));h=16;}
  else if(!n)n=end-o;
  if(!Number.isSafeInteger(n)||n<h||o+n>end)fail('Invalid MP4 '+t);
  out.push({start:o,end:o+n,size:n,header:h,type:t});o+=n;
 }
 if(o!==end){
  if(padding&&end-o<8&&a.subarray(o,end).every(b=>b===0))out.padding=a.slice(o,end);
  else fail('تعذّر قراءة '+context+' عند البايت '+o+'؛ بقيت '+(end-o)+' بايت غير معروفة. أرسل ملف الفيديو داخل ZIP لفحصه.');
 }return out;
}
const kids=(a,b)=>boxes(a,b.start+b.header,b.end,{padding:true,context:b.type});
function child(a,b,t){const v=kids(a,b).filter(x=>x.type===t);if(v.length!==1)fail('Expected one '+t);return v[0];}
async function topBoxes(file){
 const out=[];let o=0;
 while(o<file.size){
  const a=new Uint8Array(await file.slice(o,o+16).arrayBuffer());if(a.length<8)fail('Invalid trailing bytes');
  let n=u32(a,0),h=8;const t=type(a,4);
  if(n===1){if(a.length<16)fail('Truncated MP4');n=Number(view(a).getBigUint64(8));h=16;}else if(!n)n=file.size-o;
  if(!Number.isSafeInteger(n)||n<h||o+n>file.size)fail('Invalid '+t);
  out.push({start:o,end:o+n,size:n,header:h,type:t});o+=n;
 }return out;
}
function table(a,b,step){
 if(b.header!==8||b.size<16||a[b.start+8]!==0)fail('Unsupported '+b.type+' table');
 const count=u32(a,b.start+12);if(b.size!==16+step*count)fail('Invalid '+b.type+' table length');return count;
}
function sampleTable(a,b){
 if(b.header!==8||b.size<20||a[b.start+8]!==0)fail('Invalid stsz');
 const fixed=u32(a,b.start+12),count=u32(a,b.start+16);
 if(b.size!==(fixed?20:20+count*4))fail('Invalid stsz length');
 return {count,fixed,size:i=>fixed||u32(a,b.start+20+4*i)};
}
function timedSamples(a,b){const n=table(a,b,8);let count=0;for(let i=0;i<n;i++)count+=u32(a,b.start+16+8*i);return count;}
function trackInfo(a,tr,mdat){
 const mdia=child(a,tr,'mdia'),hdlr=child(a,mdia,'hdlr'),kind=type(a,hdlr.start+16);
 if(!['vide','soun'].includes(kind))fail('الملف يحتوي مسار '+kind+' إضافي غير مدعوم بهذا الاختبار. نحتاج فحصه قبل تعديله.');
 const stbl=child(a,child(a,mdia,'minf'),'stbl');
 const stsd=child(a,stbl,'stsd');
 if(stsd.size<16||u32(a,stsd.start+12)!==1)fail('هذا الملف يحتوي أكثر من وصف للترميز.');
 const entries=boxes(a,stsd.start+16,stsd.end,{padding:true,context:'stsd'});
 if(entries.length!==1)fail('وصف ترميز الملف غير منتظم.');
 const codec=entries[0].type;
 if(kind==='vide'&&!['avc1','avc3'].includes(codec))fail('ترميز الفيديو '+codec+'؛ وضع Istanbul يحتاج H.264. تغيير الامتداد إلى MP4 وحده ما يكفي.');
 if(kind==='soun'&&codec!=='mp4a')fail('ترميز الصوت '+codec+'؛ وضع Istanbul يحتاج AAC.');
 const sz=child(a,stbl,'stsz'),stts=child(a,stbl,'stts'),sc=child(a,stbl,'stsc');
 const cb=kids(a,stbl).filter(b=>['stco','co64'].includes(b.type));if(cb.length!==1)fail('Missing chunk offsets');
 const co=cb[0],step=co.type==='co64'?8:4,n=table(a,co,step),sn=table(a,sc,12),sizes=sampleTable(a,sz);
 if(!n||!sn)fail('Empty media track');
 const offsets=Array.from({length:n},(_,i)=>step===4?u32(a,co.start+16+i*step):Number(view(a).getBigUint64(co.start+16+i*step)));
 const rows=Array.from({length:sn},(_,i)=>[0,4,8].map(j=>u32(a,sc.start+16+i*12+j)));
 if(rows[0][0]!==1||rows.some((r,i)=>!r[1]||!r[2]||r[0]>n||(i&&r[0]<=rows[i-1][0])))fail('Invalid stsc');
 const chunks=[];let row=0,sample=0;
 for(let i=0;i<n;i++){
  while(row+1<rows.length&&i+1>=rows[row+1][0])row++;
  const count=rows[row][1];if(sample+count>sizes.count)fail('Chunk sample count exceeds stsz');
  let bytes=0;for(let j=0;j<count;j++)bytes+=sizes.size(sample+j);
  if(!Number.isSafeInteger(offsets[i])||offsets[i]<mdat.start+mdat.header||offsets[i]+bytes>mdat.end)fail('Media chunk outside mdat');
  chunks.push({offset:offsets[i],count,bytes,first:sample,description:rows[row][2]});sample+=count;
 }
 if(sample!==sizes.count)fail('stsc/stsz mismatch');
 const mdhd=child(a,mdia,'mdhd'),ts=u32(a,mdhd.start+(a[mdhd.start+8]===1?28:20));
 const ctts=kids(a,stbl).find(b=>b.type==='ctts');
 // ctts may be version 1 (signed offsets); only the count matters here.
 if(ctts){const copy=a.slice(ctts.start,ctts.end);copy[8]=0;if(timedSamples(copy,boxes(copy)[0])!==timedSamples(a,stts))fail('ctts/stts mismatch');}
 return {tr,kind,stbl,sz,stts,sc,co,sizes,chunks,codec:entries[0].type,entry:entries[0],timescale:ts,timed:timedSamples(a,stts)};
}
async function analyze(file){
 if(!file||!Number.isSafeInteger(file.size)||file.size<=0)fail('اختار ملف MP4.');
 if(file.size>0xf0000000)fail('هذا الاختبار يدعم ملفات أصغر من 3.75GB.');
 const top=await topBoxes(file);
 if(top.some(b=>['moof','mfra','sidx','ssix'].includes(b.type)))fail('الملف مجزأ؛ يحتاج MP4 عادي قبل هذا الاختبار.');
 const ms=top.filter(b=>b.type==='moov'),ds=top.filter(b=>b.type==='mdat');
 if(ms.length!==1||ds.length!==1||!top.some(b=>b.type==='ftyp'))fail('نحتاج MP4 يحتوي moov واحد وmdat واحد.');
 const m=ms[0],mdat=ds[0];if(m.size>MAX_MOOV)fail('MP4 metadata too large');
 const a=new Uint8Array(await file.slice(m.start,m.end).arrayBuffer());const root=boxes(a)[0];
 const tracks=kids(a,root).filter(b=>b.type==='trak').map(t=>trackInfo(a,t,mdat));
 if(tracks.length!==2)fail('وضع Istanbul يحتاج مسار فيديو واحد ومسار صوت AAC واحد.');
 const v=tracks.find(t=>t.kind==='vide'),au=tracks.find(t=>t.kind==='soun');
 if(!v||!au||!['avc1','avc3'].includes(v.codec)||au.codec!=='mp4a')fail('هذا الوضع يحتاج H.264 + AAC؛ ما يحوّل HEVC أو HDR تلقائياً.');
 const avcc=boxes(a,v.entry.start+86,v.entry.end,{padding:true,context:'H.264 sample entry'}).find(b=>b.type==='avcC');
 if(!avcc||avcc.size<13||(a[avcc.start+12]&3)!==3)fail('H.264 يحتاج NAL length من 4 بايت لهذا الاختبار.');
 const audioEntry=au.entry;
 if(audioEntry.size<36||au.sizes.count!==au.timed)fail('جدول الصوت غير منتظم.');
 const audioVersion=view(a).getUint16(audioEntry.start+16);
 const audioHeader={0:36,1:52,2:72}[audioVersion];
 if(!audioHeader||audioEntry.size<audioHeader)fail('إصدار صوت QuickTime غير مدعوم: '+audioVersion);
 function findEsds(start,end){
  const list=boxes(a,start,end,{padding:true,context:'AAC sample entry'});
  for(const b of list){if(b.type==='esds')return b;if(b.type==='wave'){const nested=findEsds(b.start+b.header,b.end);if(nested)return nested;}}
 }
 const esds=findEsds(audioEntry.start+audioHeader,audioEntry.end);
 if(!esds)fail('ملف الصوت لا يحتوي وصف AAC مدعوماً.');
 // ISO ES_Descriptor -> DecoderConfigDescriptor objectTypeIndication.
 const descriptor=(at)=>{const tag=a[at++];let n=0,k=0,b;do{if(at>=esds.end||k++===4)fail('Invalid ESDS');b=a[at++];n=n*128+(b&127);}while(b&128);if(at+n>esds.end)fail('Invalid ESDS length');return {tag,at,end:at+n};};
 const es=descriptor(esds.start+12);if(es.tag!==3||es.at+3>es.end)fail('Invalid ES descriptor');
 let pos=es.at+3;const flags=a[es.at+2];if(flags&128)pos+=2;if(flags&64){if(pos>=es.end)fail('Invalid ES URL');pos+=1+a[pos];}if(flags&32)pos+=2;
 const dc=descriptor(pos);if(dc.tag!==4||dc.at>=dc.end||a[dc.at]!==0x40)fail('الصوت لازم يكون AAC MPEG-4.');
 const diff=v.sizes.count-v.timed;let already=false;
 if(diff===ISTANBUL_EXTRA_SAMPLES){
  const tail=v.chunks.slice(-diff);const p=mdat.end-8;
  const bytes=new Uint8Array(await file.slice(p,p+8).arrayBuffer());
  already=tail.length===diff&&tail.every(c=>c.count===1&&c.bytes===8&&c.offset===p)&&bytes.every((b,i)=>b===TAIL[i]);
  if(!already)fail('جدول الفيديو غير متوافق مع بصمة Istanbul.');
 }else if(diff!==0)fail('جدول الفيديو غير منتظم؛ لن نضيف تعديلاً فوقه.');
 if(v.chunks.length<1)fail('Empty video');
 return {top,m,mdat,a,root,v,au,already,width:view(a).getUint16(v.entry.start+32),height:view(a).getUint16(v.entry.start+34)};
}
function summary(x){let ticks=0;const b=x.v.stts;for(let i=0;i<table(x.a,b,8);i++)ticks+=u32(x.a,b.start+16+8*i)*u32(x.a,b.start+20+8*i);return {frameRate:ticks?x.v.timed*x.v.timescale/ticks:null,width:x.width,height:x.height,videoSamples:x.v.timed,extraVideoSamples:x.already?ISTANBUL_EXTRA_SAMPLES:0,alreadyApplied:x.already,videoCodec:x.v.codec,audioCodec:x.au.codec};}
export async function inspectIstanbulSource(file){const prepared=await prepareSpatialAacFallback(file);return {...summary(await analyze(prepared.file)),...prepared.report};}
export async function createIstanbulReplica(file,onProgress=()=>{}){
 const prepared=await prepareSpatialAacFallback(file);file=prepared.file;
 onProgress(.1);const x=await analyze(file);const {a,m,mdat,v}=x;
 if(x.already){onProgress(1);return {file,report:{...summary(x),...prepared.report,unchanged:!prepared.report.preparationChanged,mediaBytesPreserved:true}};}
 const extra=ISTANBUL_EXTRA_SAMPLES;
 function rebuild(b){
  if(containers.has(b.type)){const list=kids(a,b);return box(b.type,join([...list.map(rebuild),...(list.padding?[list.padding]:[])]));}
  if(b.start===v.sz.start){
   const payload=new Uint8Array(12+4*(v.sizes.count+extra));payload.set(a.subarray(b.start+8,b.start+12));
   put(payload,8,v.sizes.count+extra);
   for(let i=0;i<v.sizes.count;i++)put(payload,12+i*4,v.sizes.size(i));
   for(let i=v.sizes.count;i<v.sizes.count+extra;i++)put(payload,12+i*4,8);
   return box('stsz',payload);
  }
  if(b.start===v.sc.start){
   const count=table(a,b,12),payload=new Uint8Array(b.size-8+12);payload.set(a.subarray(b.start+8,b.end));put(payload,4,count+1);
   const at=payload.length-12;put(payload,at,v.chunks.length+1);put(payload,at+4,1);put(payload,at+8,v.chunks.at(-1).description);return box('stsc',payload);
  }
  if(b.start===v.co.start){
   const step=b.type==='co64'?8:4,count=v.chunks.length,payload=new Uint8Array(8+(count+extra)*step);payload.set(a.subarray(b.start+8,b.end));put(payload,4,count+extra);
   return box(b.type,payload);
  }
  return a.slice(b.start,b.end);
 }
 const moov=rebuild(x.root);let pos=0;const mapped=x.top.map(b=>{const size=b===m?moov.length:b===mdat?b.size+8:b.size;const q={...b,newStart:pos,newSize:size};pos+=size;return q;});
 const newMdat=mapped.find(b=>b.start===mdat.start);const phantomOffset=newMdat.newStart+mdat.size;
 function move(old){if(old<mdat.start+mdat.header||old>=mdat.end)fail('Unexpected media offset');return old+newMdat.newStart-mdat.start;}
 function offsets(b){
  if(['stco','co64'].includes(b.type)){
   const n=table(moov,b,b.type==='stco'?4:8),step=b.type==='stco'?4:8;
   for(let i=0;i<n;i++){
    const p=b.start+16+i*step;let old=step===4?u32(moov,p):Number(view(moov).getBigUint64(p));
    const next=old?move(old):phantomOffset;
    if(step===4)put(moov,p,next);else view(moov).setBigUint64(p,BigInt(next));
   }
  }else if(containers.has(b.type))for(const c of kids(moov,b))offsets(c);
 }
 offsets(boxes(moov)[0]);onProgress(.7);
 const header=new Uint8Array(await file.slice(mdat.start,mdat.start+mdat.header).arrayBuffer());
 if(mdat.header===16)view(header).setBigUint64(8,BigInt(mdat.size+8));else put(header,0,mdat.size+8);
 const parts=[];
 for(const b of x.top){
  if(b===m)parts.push(moov);
  else if(b===mdat)parts.push(header,file.slice(mdat.start+mdat.header,mdat.end),TAIL);
  else parts.push(file.slice(b.start,b.end));
 }
 const name=(file.name||'video.mp4').replace(/\.[^.]+$/,'')+'-HAMODYBR-ISTANBUL.mp4';
 const out=new File(parts,name,{type:'video/mp4'});
 const checked=await analyze(out);if(!checked.already||out.size!==pos)fail('Istanbul output verification failed');
 onProgress(1);return {file:out,report:{...summary(checked),...prepared.report,unchanged:false,mediaBytesPreserved:true,addedPayloadBytes:8,nonstandard:true,timingPreserved:true,outputBytes:out.size}};
}

// Reproduce the reference's terminal one-tick video timing. The previous pattern
// alone inherited the input's last stts delta; demuxers extrapolated 8,200 full
// frame durations. This is a controlled compatibility experiment, not a claim
// about the reason TikTok locks visibility. Original encoded packets are exact.
export async function matchIstanbulVideoTiming(file){
 const x=await analyze(file);if(!x.already)fail('Istanbul sample pattern required before timing matching');
 const {a,m,mdat,v}=x;
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 const scale=v.timescale/gcd(v.timescale,90000)*90000;
 if(!Number.isSafeInteger(scale)||scale>0xffffffff)fail('Video timescale cannot be matched losslessly');
 const mul=scale/v.timescale;
 const count=table(a,v.stts,8),last=v.stts.start+16+(count-1)*8;
 if(mul===1&&u32(a,last+4)===1)return {file,report:{referenceTiming:true,timingUnchanged:true,videoTimescale:scale}};
 const mdia=child(a,v.tr,'mdia'),mdhd=child(a,mdia,'mdhd');
 const edts=kids(a,v.tr).find(b=>b.type==='edts');
 const elst=edts?kids(a,edts).find(b=>b.type==='elst'):null;
 const ctts=kids(a,v.stbl).find(b=>b.type==='ctts');
 const cslg=kids(a,v.stbl).find(b=>b.type==='cslg');
 const nested=new Set([...containers,'edts']);
 function signed32(b,o,n){if(!Number.isSafeInteger(n)||n< -2147483648||n>2147483647)fail('Signed timestamp overflow');view(b).setInt32(o,n);}
 function rewrite(b){
  if(nested.has(b.type)){const list=kids(a,b);return box(b.type,join([...list.map(rewrite),...(list.padding?[list.padding]:[])]));}
  if(b.start===v.stts.start){
   const entries=[];
   for(let i=0;i<count;i++){
    const n=u32(a,b.start+16+i*8),d=u32(a,b.start+20+i*8)*mul;
    if(i!==count-1)entries.push([n,d]);
    else{if(n>1)entries.push([n-1,d]);entries.push([1,1]);}
   }
   const p=new Uint8Array(8+8*entries.length);p.set(a.subarray(b.start+8,b.start+12));put(p,4,entries.length);
   entries.forEach((r,i)=>{put(p,8+i*8,r[0]);put(p,12+i*8,r[1]);});return box('stts',p);
  }
  if(b.start===mdhd.start){
   const src=a.slice(b.start,b.end),ver=src[8];
   if(ver===0){
    const dur=u32(src,24)*mul;
    if(dur<=0xffffffff){put(src,20,scale);put(src,24,dur);return src;}
    const p=new Uint8Array(src.length-8+12);p.set(src.subarray(8,12));p[0]=1;
    view(p).setBigUint64(4,BigInt(u32(src,12)));view(p).setBigUint64(12,BigInt(u32(src,16)));
    put(p,20,scale);view(p).setBigUint64(24,BigInt(u32(src,24))*BigInt(mul));p.set(src.subarray(28),32);return box('mdhd',p);
   }
   if(ver!==1)fail('Unsupported mdhd version');
   put(src,28,scale);view(src).setBigUint64(32,view(src).getBigUint64(32)*BigInt(mul));return src;
  }
  if(ctts&&b.start===ctts.start){
   const out=a.slice(b.start,b.end),n=u32(out,12),ver=out[8];
   if(![0,1].includes(ver)||out.length!==16+n*8)fail('Invalid ctts');
   const wrapped=ver===0&&Array.from({length:n},(_,i)=>u32(out,20+i*8)).some(v=>v>0x7fffffff);
   if(wrapped&&!cslg)fail('Unsigned composition offsets overflow; a verified QuickTime cslg is required');
   if(wrapped)out[8]=1;
   for(let i=0;i<n;i++){const p=20+i*8;if(ver===1||wrapped)signed32(out,p,view(out).getInt32(p)*mul);else put(out,p,u32(out,p)*mul);}return out;
  }
  if(cslg&&b.start===cslg.start){
   const out=a.slice(b.start,b.end),ver=out[8],step=ver===1?8:4;
   if(![0,1].includes(ver)||out.length!==12+step*5)fail('Invalid composition shift');
   for(let i=0;i<5;i++){const p=12+i*step;if(ver===1)view(out).setBigInt64(p,view(out).getBigInt64(p)*BigInt(mul));else signed32(out,p,view(out).getInt32(p)*mul);}return out;
  }
  if(elst&&b.start===elst.start){
   const out=a.slice(b.start,b.end),ver=out[8],n=u32(out,12),step=ver===1?20:12;
   if(![0,1].includes(ver)||out.length!==16+n*step)fail('Invalid edit list');
   for(let i=0;i<n;i++){
    const p=16+i*step+(ver===1?8:4);
    if(ver===1){const old=view(out).getBigInt64(p);if(old!==-1n)view(out).setBigInt64(p,old*BigInt(mul));}
    else{const old=view(out).getInt32(p);if(old!==-1)signed32(out,p,old*mul);}
   }return out;
  }
  return a.slice(b.start,b.end);
 }
 const moov=rewrite(x.root),delta=m.start<mdat.start?moov.length-m.size:0;
 function relocate(b){
  if(['stco','co64'].includes(b.type)){
   const step=b.type==='stco'?4:8,n=table(moov,b,step);
   for(let i=0;i<n;i++){const p=b.start+16+i*step,old=step===4?u32(moov,p):Number(view(moov).getBigUint64(p));
    if(old<mdat.start+mdat.header||old>=mdat.end)fail('Unexpected media offset');
    if(step===4)put(moov,p,old+delta);else view(moov).setBigUint64(p,BigInt(old+delta));}
  }else if(nested.has(b.type))for(const c of kids(moov,b))relocate(c);
 }
 relocate(boxes(moov)[0]);
 const out=new File(x.top.map(b=>b===m?moov:file.slice(b.start,b.end)),(file.name||'video.mp4').replace(/\.mp4$/i,'')+'-TIMING.mp4',{type:'video/mp4'});
 const check=await analyze(out);
 if(!check.already||check.v.timed!==v.timed||check.v.timescale!==scale)fail('Timing verification failed');
 return {file:out,report:{referenceTiming:true,timingUnchanged:false,videoTimescale:scale,timingPreserved:false,encodedMediaPreserved:true,outputBytes:out.size}};
}


// iPhone Spatial Audio movies carry a separate AAC stereo compatibility track.
// Select that existing track without decoding APAC or re-encoding any media.
// Ordinary files may also carry meta/mdta/tmcd auxiliary tracks without APAC.
export async function prepareSpatialAacFallback(file){
 if(!file||typeof file.slice!=='function')return {file,report:{audioFallbackSelected:false}};
 const top=await topBoxes(file),ms=top.filter(b=>b.type==='moov'),ds=top.filter(b=>b.type==='mdat');
 if(ms.length!==1||ds.length!==1||top.some(b=>['moof','mfra'].includes(b.type)))return {file,report:{audioFallbackSelected:false}};
 const m=ms[0],mdat=ds[0];if(m.size>MAX_MOOV)fail('MP4 metadata too large');
 const a=new Uint8Array(await file.slice(m.start,m.end).arrayBuffer()),root=boxes(a)[0];
 const tracks=kids(a,root).filter(b=>b.type==='trak').map(tr=>{
  const mdia=child(a,tr,'mdia'),kind=type(a,child(a,mdia,'hdlr').start+16);
  if(!['vide','soun'].includes(kind))return {tr,kind};
  const stsd=child(a,child(a,child(a,mdia,'minf'),'stbl'),'stsd');
  const entries=boxes(a,stsd.start+16,stsd.end,{padding:true,context:'stsd'});
  return {tr,kind,codec:entries.length===1?entries[0].type:null,entry:entries[0]};
 });
 const hasSpatial=tracks.some(t=>t.kind==='soun'&&t.codec==='apac');
 const metadata=tracks.filter(t=>['meta','mdta','tmcd'].includes(t.kind));
 if(!hasSpatial&&!metadata.length)return {file,report:{audioFallbackSelected:false,preparationChanged:false}};
 if(tracks.some(t=>!['vide','soun','meta','mdta','tmcd'].includes(t.kind)))fail('الفيديو يحتوي مسارات إضافية غير مدعومة. أرسل الملف داخل ZIP لفحصه.');
 const videos=tracks.filter(t=>t.kind==='vide');
 const audios=tracks.filter(t=>t.kind==='soun');
 const aac=audios.filter(t=>{
  if(t.codec!=='mp4a'||t.entry.size<36)return false;
  const version=view(a).getUint16(t.entry.start+16);
  const channels=version===2&&t.entry.size>=52?u32(a,t.entry.start+48):view(a).getUint16(t.entry.start+24);
  return !hasSpatial||channels===2;
 });
 if(aac.length!==1)fail(hasSpatial?'هذا الفيديو يحتوي APAC، لكن ما لقينا مسار AAC ستيريو مرافق واحد. أرسل الفيديو داخل ZIP لفحصه؛ لن نستبدل الصوت بصمت.':'الفيديو يحتاج مسار صوت AAC واحد واضح حتى نفصل مسارات البيانات الإضافية.');
 if(videos.length!==1||audios.some(t=>!['mp4a','apac'].includes(t.codec)))fail('مسارات Spatial Audio في هذا الملف غير مدعومة. أرسل الملف داخل ZIP.');
 const selected=new Set([videos[0].tr.start,aac[0].tr.start]);
 function rewrite(b){
  if(b.type==='trak'){
   const list=kids(a,b);const parts=[];
   for(const c of list){
    if(c.type==='tref')continue; // References to the removed spatial/metadata tracks.
    const bytes=a.slice(c.start,c.end);
    if(hasSpatial&&b.start===aac[0].tr.start&&c.type==='tkhd'){
     bytes[11]|=1;const alternate=bytes[8]===1?54:42;
     if(bytes.length<alternate+2)fail('Invalid audio track header');view(bytes).setUint16(alternate,0);
    }
    parts.push(bytes);
   }
   if(list.padding)parts.push(list.padding);return box('trak',join(parts));
  }
  if(b.type==='moov'){
   const list=kids(a,b),parts=list.filter(c=>c.type!=='trak'||selected.has(c.start)).map(rewrite);
   if(list.padding)parts.push(list.padding);return box('moov',join(parts));
  }
  return a.slice(b.start,b.end);
 }
 const moov=rewrite(root),delta=m.start<mdat.start?moov.length-m.size:0;
 function relocate(b){
  if(['stco','co64'].includes(b.type)){
   const step=b.type==='stco'?4:8,n=table(moov,b,step);
   for(let i=0;i<n;i++){
    const p=b.start+16+i*step,old=step===4?u32(moov,p):Number(view(moov).getBigUint64(p));
    if(old<mdat.start+mdat.header||old>=mdat.end)fail('Media chunk outside mdat');
    if(step===4)put(moov,p,old+delta);else view(moov).setBigUint64(p,BigInt(old+delta));
   }
  }else if(containers.has(b.type))for(const c of kids(moov,b))relocate(c);
 }
 relocate(boxes(moov)[0]);
 const out=new File(top.map(b=>b===m?moov:file.slice(b.start,b.end)),file.name||'video.mov',{type:file.type||'video/quicktime'});
 // Each caller validates its selected codecs/tables after this lossless selection.
 return {file:out,report:{audioFallbackSelected:hasSpatial,preparationChanged:true,metadataTracksExcluded:metadata.length,selectedAudioCodec:'aac',audioTranscoded:false,videoTranscoded:false,spatialAudioExcluded:hasSpatial}};
}
