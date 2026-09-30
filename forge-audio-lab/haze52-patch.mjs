// HAMODYBR Haze 5.2 container replica patch.
// Applies only container-level changes after Dynamic X9 has already been added.
// Media packet payloads are never decoded or re-encoded here.

export const HAZE_ENCODER_TAG='Haze Quality Method https://hazemethod.xyz';
export const HAZE_TAIL_PAYLOAD=new Uint8Array([0,0,0,4,0,0,0,0]);

const enc=new TextEncoder();
const dec=new TextDecoder('latin1');
const MAX_MOOV=64*1024*1024;

function fail(msg){throw new Error(msg);}
function dv(a){return new DataView(a.buffer,a.byteOffset,a.byteLength);}
function u32(a,o){return dv(a).getUint32(o,false);}
function w32(a,o,n){dv(a).setUint32(o,n>>>0,false);}
function type(a,o){return dec.decode(a.subarray(o,o+4));}
function concat(parts){
 const n=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(n);let o=0;
 for(const p of parts){out.set(p,o);o+=p.length;}return out;
}
function makeBox(name,payload){
 const out=new Uint8Array(8+payload.length);w32(out,0,out.length);
 const typeBytes=enc.encode(name);
 if(typeBytes.length!==4)fail('MP4 box type must be exactly 4 bytes: '+name);
 out.set(typeBytes,4);out.set(payload,8);return out;
}
function makeBoxTypeBytes(typeBytes,payload){
 if(!(typeBytes instanceof Uint8Array)||typeBytes.length!==4)fail('MP4 box type must be 4 raw bytes');
 const out=new Uint8Array(8+payload.length);w32(out,0,out.length);
 out.set(typeBytes,4);out.set(payload,8);return out;
}
function boxes(a,start=0,end=a.length){
 const out=[];let pos=start;
 while(pos+8<=end){
  const size32=u32(a,pos),name=type(a,pos+4);let size=size32,header=8;
  if(size32===1){
   if(pos+16>end)fail('Truncated extended MP4 box');
   size=Number(dv(a).getBigUint64(pos+8,false));header=16;
  }else if(size32===0)size=end-pos;
  if(!Number.isSafeInteger(size)||size<header||pos+size>end)fail('Invalid MP4 box '+name);
  out.push({start:pos,end:pos+size,size,header,type:name});pos+=size;
 }
 if(pos!==end)fail('Unparsed MP4 bytes');
 return out;
}
function children(a,b){return boxes(a,b.start+b.header,b.end);}
function child(a,b,name){const x=children(a,b).find(v=>v.type===name);if(!x)fail('Missing '+name);return x;}
function trackKind(a,tr){
 const mdia=child(a,tr,'mdia'),hdlr=child(a,mdia,'hdlr');
 return type(a,hdlr.start+16);
}
function patchMvhdUnknown(boxBytes){
 const b=boxBytes.slice(),version=b[8];
 if(version===1){
  if(b.length<40)fail('Invalid v1 mvhd');
  b.fill(0xff,32,40);
  // Haze reference uses movie timescale 1000.
  w32(b,28,1000);
  return b;
 }
 if(version!==0||b.length<28)fail('Unsupported mvhd version');
 const out=new Uint8Array(b.length+12);
 w32(out,0,out.length);out.set(enc.encode('mvhd'),4);
 out[8]=1;out[9]=b[9];out[10]=b[10];out[11]=b[11];
 const old=dv(b),v=dv(out);
 v.setBigUint64(12,BigInt(old.getUint32(12,false)),false);
 v.setBigUint64(20,BigInt(old.getUint32(16,false)),false);
 v.setUint32(28,1000,false);
 v.setBigUint64(32,0xffffffffffffffffn,false);
 out.set(b.subarray(28),40);
 return out;
}
function hazeUdta(tag=HAZE_ENCODER_TAG){
 const hdlrPayload=new Uint8Array(25);
 // FullBox flags + pre_defined remain zero.
 hdlrPayload.set(enc.encode('mdir'),8);
 // 12 reserved bytes remain zero, followed by a zero-length C string.
 const hdlr=makeBox('hdlr',hdlrPayload);
 const text=enc.encode(tag);
 const dataPayload=new Uint8Array(8+text.length);
 w32(dataPayload,0,1); // UTF-8 data type
 // locale remains zero
 dataPayload.set(text,8);
 const data=makeBox('data',dataPayload);
 // QuickTime metadata key is raw 0xA9 0x74 0x6F 0x6F (©too), not UTF-8 C2 A9.
 const too=makeBoxTypeBytes(new Uint8Array([0xa9,0x74,0x6f,0x6f]),data);
 const ilst=makeBox('ilst',too);
 const metaPayload=concat([new Uint8Array(4),hdlr,ilst]);
 return makeBox('udta',makeBox('meta',metaPayload));
}
function cleanMoovAndPatchMvhd(moovBytes,tag){
 const root=boxes(moovBytes)[0];
 if(root.type!=='moov')fail('Expected moov');
 const kept=[],kids=children(moovBytes,root);
 for(const b of kids){
  if(b.type==='mvhd'){
   kept.push(patchMvhdUnknown(moovBytes.subarray(b.start,b.end)));
  }else if(b.type==='trak'){
   const kind=trackKind(moovBytes,b);
   if(kind==='vide'||kind==='soun')kept.push(moovBytes.subarray(b.start,b.end));
  }
  // Drop udta/meta and non A/V tracks: Haze output keeps only video + audio.
 }
 if(!kids.some(b=>b.type==='mvhd'))fail('Missing mvhd');
 kept.push(hazeUdta(tag));
 return makeBox('moov',concat(kept));
}
function gatherChunkBoxes(a,root){
 const found=[];
 const containers=new Set(['moov','trak','mdia','minf','stbl']);
 function walk(b){
  if(b.type==='stco'||b.type==='co64')found.push(b);
  if(containers.has(b.type))for(const c of children(a,b))walk(c);
 }
 walk(root);return found;
}
function exactFtyp(){
 const payload=new Uint8Array(24);
 payload.set(enc.encode('isom'),0);w32(payload,4,512);
 payload.set(enc.encode('isom'),8);
 payload.set(enc.encode('iso2'),12);
 payload.set(enc.encode('avc1'),16);
 payload.set(enc.encode('mp41'),20);
 return makeBox('ftyp',payload);
}
async function verifyTail(file,start,count){
 if(count<1||file.size-start!==count*8)return false;
 const chunk=1024*1024;
 for(let pos=start;pos<file.size;pos+=chunk){
  const end=Math.min(file.size,pos+chunk);
  const a=new Uint8Array(await file.slice(pos,end).arrayBuffer());
  for(let i=0;i<a.length;i++)if(a[i]!==HAZE_TAIL_PAYLOAD[(pos-start+i)%8])return false;
 }
 return true;
}
async function readTopUntil(file,end){
 const out=[];let pos=0;
 while(pos<end){
  if(end-pos<8)fail('Incomplete top-level MP4 box');
  const h=new Uint8Array(await file.slice(pos,Math.min(pos+16,end)).arrayBuffer());
  const size32=u32(h,0),name=type(h,4);let size=size32,header=8;
  if(size32===1){if(h.length<16)fail('Truncated top-level box');size=Number(dv(h).getBigUint64(8,false));header=16;}
  else if(size32===0)size=end-pos;
  if(!Number.isSafeInteger(size)||size<header||pos+size>end)fail('Invalid top-level '+name);
  out.push({start:pos,end:pos+size,size,header,type:name});pos+=size;
 }
 return out;
}
function patchChunkOffsets(moov,oldMdat,newMdatStart,oldTailStart,newTailStart){
 const root=boxes(moov)[0],delta=newMdatStart-oldMdat.start;
 for(const b of gatherChunkBoxes(moov,root)){
  const n=u32(moov,b.start+12),step=b.type==='stco'?4:8;
  for(let i=0;i<n;i++){
   const pos=b.start+16+i*step;
   const old=b.type==='stco'?u32(moov,pos):Number(dv(moov).getBigUint64(pos,false));
   let next;
   if(old===oldTailStart)next=newTailStart;
   else if(old>=oldMdat.start+oldMdat.header&&old<oldMdat.end)next=old+delta;
   else fail('Unexpected media chunk offset '+old+' outside mdat/tail');
   if(b.type==='stco'){
    if(next>0xffffffff)fail('stco overflow');
    w32(moov,pos,next);
   }else dv(moov).setBigUint64(pos,BigInt(next),false);
  }
 }
}

export async function applyHaze52ContainerPatch(file,{tailPackets,encoderTag=HAZE_ENCODER_TAG}={}){
 if(!file||typeof file.size!=='number'||typeof file.slice!=='function')fail('Choose an MP4 file');
 if(!Number.isSafeInteger(tailPackets)||tailPackets<1)fail('Valid Dynamic X9 tail count required');
 const tailBytes=tailPackets*8,tailStart=file.size-tailBytes;
 if(tailStart<=0||!(await verifyTail(file,tailStart,tailPackets)))fail('Dynamic X9 tail fingerprint not found');
 const top=await readTopUntil(file,tailStart);
 const ftyp=top.find(b=>b.type==='ftyp'),moov=top.find(b=>b.type==='moov'),mdat=top.find(b=>b.type==='mdat');
 if(!ftyp||!moov||!mdat)fail('Haze replica needs ftyp + moov + mdat');
 if(top.filter(b=>b.type==='moov').length!==1||top.filter(b=>b.type==='mdat').length!==1)fail('Haze replica requires one moov and one mdat');
 if(moov.start>mdat.start)fail('Base file must be faststart before Haze patch');
 if(moov.size>MAX_MOOV)fail('moov too large');
 const oldMoov=new Uint8Array(await file.slice(moov.start,moov.end).arrayBuffer());
 const newFtyp=exactFtyp();
 const newMoov=cleanMoovAndPatchMvhd(oldMoov,encoderTag);
 const newMdatStart=newFtyp.length+newMoov.length;
 const free=makeBox('free',new Uint8Array());
 const newTailStart=newMdatStart+mdat.size+free.length;
 patchChunkOffsets(newMoov,mdat,newMdatStart,tailStart,newTailStart);
 const output=new Blob([
  newFtyp,newMoov,
  file.slice(mdat.start,mdat.end),
  free,
  file.slice(tailStart)
 ],{type:'video/mp4'});
 const expected=newTailStart+tailBytes;
 if(output.size!==expected)fail('Unexpected Haze replica output size');
 // Final structural checks.
 const checkTop=await readTopUntil(output,newTailStart);
 const names=checkTop.map(b=>b.type).join(',');
 if(names!=='ftyp,moov,mdat,free')fail('Unexpected Haze top-level order: '+names);
 if(!(await verifyTail(output,newTailStart,tailPackets)))fail('Tail verification failed after Haze patch');
 const checkMoov=new Uint8Array(await output.slice(newFtyp.length,newFtyp.length+newMoov.length).arrayBuffer());
 const root=boxes(checkMoov)[0],mvhd=child(checkMoov,root,'mvhd');
 if(checkMoov[mvhd.start+8]!==1||dv(checkMoov).getBigUint64(mvhd.start+32,false)!==0xffffffffffffffffn)
  fail('Unknown movie duration sentinel was not written');
 const kinds=children(checkMoov,root).filter(b=>b.type==='trak').map(b=>trackKind(checkMoov,b));
 if(kinds.filter(x=>x==='vide').length!==1||kinds.filter(x=>x==='soun').length!==2)
  fail('Haze replica must contain exactly 1 video + 2 audio tracks');
 const tagBytes=enc.encode(encoderTag);
 let tagFound=false;
 for(let i=0;i+tagBytes.length<=checkMoov.length;i++){
  let ok=true;for(let j=0;j<tagBytes.length;j++)if(checkMoov[i+j]!==tagBytes[j]){ok=false;break;}
  if(ok){tagFound=true;break;}
 }
 if(!tagFound)fail('Haze encoder tag missing');
 return {output,report:{
   tailPackets,tailBytes,tailOutsideMdat:true,freeBeforeTail:true,
   movieDurationUnknown:true,movieDurationSentinel:'0xFFFFFFFFFFFFFFFF',
   metadataTracksRemoved:true,encoderTag,majorBrand:'isom',minorVersion:512,
   compatibleBrands:'isom iso2 avc1 mp41',topLevelOrder:'ftyp → moov → mdat → free → synthetic tail',
 }};
}
