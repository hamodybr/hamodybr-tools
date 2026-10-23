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
export async function inspectIstanbulSource(file){return summary(await analyze(file));}
export async function createIstanbulReplica(file,onProgress=()=>{}){
 onProgress(.1);const x=await analyze(file);const {a,m,mdat,v}=x;
 if(x.already){onProgress(1);return {file,report:{...summary(x),unchanged:true,mediaBytesPreserved:true}};}
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
 onProgress(1);return {file:out,report:{...summary(checked),unchanged:false,mediaBytesPreserved:true,addedPayloadBytes:8,nonstandard:true,timingPreserved:true,outputBytes:out.size}};
}
