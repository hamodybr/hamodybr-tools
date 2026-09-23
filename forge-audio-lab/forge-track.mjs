// HAMODYBR Forge-track structure experiment. No video/audio re-encoding.
// Deliberately produces an invalid secondary AAC track. Do not use as a master/archive.
export const TAIL_COUNT = 6912;
export const TAIL_PAYLOAD = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 0]);
const enc = new TextEncoder();
const dec = new TextDecoder('ascii');
const MAX_HEADER_BYTES = 64*1024*1024;
const MAX_OUTPUT_BYTES = 0xffffffff;
const isData = a => a instanceof Uint8Array;
function fail(reason) { throw new Error(reason); }
function view(a) { return new DataView(a.buffer, a.byteOffset, a.byteLength); }
function u32(a, offset) { return view(a).getUint32(offset, false); }
function w32(a, offset, num) { view(a).setUint32(offset, num >>> 0, false); }
function str(a, offset, n=4) { return dec.decode(a.subarray(offset, offset+n)); }
function boxList(a, start = 0, end = a.length) {
  const out = [];
  for (let pos=start;pos+8<=end;) {
    const size32 = u32(a,pos), type = str(a,pos+4);
    let size = size32, hdr=8;
    if (size32===1) {
      if (pos+16>end) fail('Truncated 64-bit MP4 box');
      size=Number(view(a).getBigUint64(pos+8,false));hdr=16;
    } else if (size32===0) size=end-pos;
    if (!Number.isSafeInteger(size)||size<hdr||pos+size>end) fail('Corrupt MP4 box '+type);
    out.push({start:pos,end:pos+size,size,hdr,type});pos+=size;
  }
  if (out.at(-1)?.end !== end) fail('MP4 contains unparsed bytes');
  return out;
}
function children(a, box) { return boxList(a,box.start+box.hdr,box.end); }
function child(a, box, type) { const found=children(a,box).find(b=>b.type===type);if(!found) fail('Missing MP4 atom '+type);return found; }
function pack(parts) { const size=parts.reduce((n,p)=>n+p.length,0);const a=new Uint8Array(size);let off=0;for(const p of parts){a.set(p,off);off+=p.length;}return a; }
function makeBox(type, payload) { const size=8+payload.length;if(size>0xffffffff)fail('MP4 box exceeds 4GB');const out=new Uint8Array(size);w32(out,0,size);out.set(enc.encode(type),4);out.set(payload,8);return out; }
function extendTable(a,b,bytes,countOffset,newCount){
 const old=a.subarray(b.start,b.end),out=new Uint8Array(old.length+bytes.length);out.set(old);out.set(bytes,old.length);w32(out,0,out.length);w32(out,countOffset,newCount);return out;
}
function aTrackKind(a,track){return str(a,child(a,child(a,track,'mdia'),'hdlr').start+16);}
function stblFromTrack(a,track){return child(a,child(a,child(a,track,'mdia'),'minf'),'stbl');}
function codecFromTrack(a,track){const stsd=child(a,stblFromTrack(a,track),'stsd');return str(a,stsd.start+20);}
function versionedDuration(a,mdhd){const ver=a[mdhd.start+8],scaleOffset=mdhd.start+(ver===1?28:20), durOffset=scaleOffset+4; if(ver!==0 && ver!==1) fail('Unsupported media header version');const scale=u32(a,scaleOffset);const d=ver===1?Number(view(a).getBigUint64(durOffset,false)):u32(a,durOffset);return {scale,duration:d,seconds:d/scale};}
function replaceTree(a,box,replacements){if(replacements.has(box.start))return replacements.get(box.start);if(!['trak','mdia','minf','stbl'].includes(box.type))return a.subarray(box.start,box.end);return makeBox(box.type,pack(children(a,box).filter(b=>box.type!=='trak'||b.type!=='edts').map(b=>replaceTree(a,b,replacements))));}
function gatherChunkBoxes(a,root){const out=[];function walk(b){if(b.type==='stco'||b.type==='co64')out.push(b);for(const c of ['moov','trak','mdia','minf','stbl'].includes(b.type)?children(a,b):[])walk(c);}walk(root);return out;}
function verifyInput({a,top,moov,moovFile,mdat,fullSize}){
 if(!isData(a)||a.length<128)fail('Invalid MP4 metadata');
 const tracks=children(a,moov).filter(b=>b.type==='trak');
 const audios=tracks.filter(b=>aTrackKind(a,b)==='soun');
 const videos=tracks.filter(b=>aTrackKind(a,b)==='vide');
 if(audios.length!==1||videos.length!==1)fail('Requires exactly one video and one AAC audio track');
 if(codecFromTrack(a,audios[0])!=='mp4a')fail('Requires AAC audio in MP4');
 if(!['avc1','avc3'].includes(codecFromTrack(a,videos[0])))fail('Requires H.264 (AVC) video. Preprocess HDR/HEVC first.');
 const audio=audios[0],stbl=stblFromTrack(a,audio),mdhd=child(a,child(a,audio,'mdia'),'mdhd');
 const time=versionedDuration(a,mdhd);
 if(!Number.isInteger(time.scale) || time.scale<=0 || !Number.isFinite(time.seconds))fail('Invalid AAC media timescale');
 const stts=child(a,stbl,'stts'),stsc=child(a,stbl,'stsc'),stsz=child(a,stbl,'stsz');
 const stco=children(a,stbl).find(b=>b.type==='stco'||b.type==='co64');
 if(!stco)fail('Audio chunk offsets missing');
 if(u32(a,stsz.start+12)!==0)fail('Fixed-size AAC tables are not supported');
 const samples=u32(a,stsz.start+16),ttsEntries=u32(a,stts.start+12),chunkCount=u32(a,stco.start+12),scEntries=u32(a,stsc.start+12);
 if(!samples||!chunkCount||!scEntries||samples>100000)fail('Invalid AAC sample layout');
 const lastEntry=stsc.start+16+(scEntries-1)*12,descIndex=u32(a,lastEntry+8);
 if(ttsEntries>1000 || !descIndex)fail('Unsupported audio sample description');
 if(stsz.end-(stsz.start+20)!==samples*4)fail('AAC sample-size table is inconsistent');
 if(stco.end-(stco.start+16)!==chunkCount*(stco.type==='stco'?4:8))fail('Chunk-offset table is inconsistent');
 if(stsc.end-(stsc.start+16)!==scEntries*12 || stts.end-(stts.start+16)!==ttsEntries*8)fail('AAC tables are inconsistent');
 return {a,top,moov,moovFile,mdat,fullSize,tracks,audio,stbl,stts,stsc,stsz,stco,mdhd,time,samples,chunkCount,scEntries,descIndex};
}
function buildPlan(x){
 const {a,moov,moovFile,mdat,audio,stts,stsc,stsz,stco,samples,chunkCount,scEntries,descIndex,fullSize}=x;
 const tail=new Uint8Array(TAIL_COUNT*8);for(let i=0;i<TAIL_COUNT;i++)tail.set(TAIL_PAYLOAD,i*8);
 const replacements=new Map();
 const ttsBytes=new Uint8Array(8);w32(ttsBytes,0,TAIL_COUNT);w32(ttsBytes,4,1);
 replacements.set(stts.start,extendTable(a,stts,ttsBytes,12,u32(a,stts.start+12)+1));
 const szBytes=new Uint8Array(TAIL_COUNT*4);for(let p=0;p<szBytes.length;p+=4)w32(szBytes,p,8);
 replacements.set(stsz.start,extendTable(a,stsz,szBytes,16,samples+TAIL_COUNT));
 const scBytes=new Uint8Array(12);w32(scBytes,0,chunkCount+1);w32(scBytes,4,TAIL_COUNT);w32(scBytes,8,descIndex);
 replacements.set(stsc.start,extendTable(a,stsc,scBytes,12,scEntries+1));
 const offBytes=new Uint8Array(stco.type==='stco'?4:8); // 0xffffffff sentinel is patched below.
 if(stco.type==='stco')w32(offBytes,0,0xffffffff); else view(offBytes).setBigUint64(0,0xffffffffffffffffn,false);
 replacements.set(stco.start,extendTable(a,stco,offBytes,12,chunkCount+1));
 const tkhd=child(a,audio,'tkhd'),newTkhd=a.subarray(tkhd.start,tkhd.end).slice(),trackVersion=a[tkhd.start+8];
 if(trackVersion!==0&&trackVersion!==1)fail('Unsupported tkhd version');
 const trackIdOffset=trackVersion===1?28:20;
 const maxId=Math.max(...x.tracks.map(t=>u32(a,child(a,t,'tkhd').start+(a[child(a,t,'tkhd').start+8]===1?28:20))));
 if(maxId===0xffffffff)fail('Track ID overflow');
 w32(newTkhd,trackIdOffset,maxId+1);
 replacements.set(tkhd.start,newTkhd);
 const duplicate=replaceTree(a,audio,replacements);
 const moovKids=children(a,moov);
 const moovParts=moovKids.map(b=>a.subarray(b.start,b.end));
 // Put new audio track after all existing atoms and update mvhd next_track_ID.
 const mvhd=child(a,moov,'mvhd'),mvhdIndex=moovKids.findIndex(b=>b.start===mvhd.start),nextOffset=a[mvhd.start+8]===1?116:104;
 const newMvhd=a.subarray(mvhd.start,mvhd.end).slice();w32(newMvhd,nextOffset,Math.max(u32(newMvhd,nextOffset),maxId+2));moovParts[mvhdIndex]=newMvhd;
 moovParts.push(duplicate);
 const newMoov=makeBox('moov',pack(moovParts)), delta=newMoov.length-moov.size;
 if(fullSize+delta+tail.length>MAX_OUTPUT_BYTES)fail('Output exceeds 32-bit MP4 offset space');
 // All original sample data moved forward by delta when the larger moov is inserted.
 // The duplicated audio track shares the original AAC bytes, like the Forge sample.
 const newMoovRoot=boxList(newMoov)[0];let patchCount=0,tailCount=0;
 for(const b of gatherChunkBoxes(newMoov,newMoovRoot)){
   const n=u32(newMoov,b.start+12),step=b.type==='stco'?4:8;
   for(let i=0;i<n;i++){
     const pos=b.start+16+i*step;
     const original=b.type==='stco'?u32(newMoov,pos):Number(view(newMoov).getBigUint64(pos,false));
     const isTail=(b.type==='stco'?original===0xffffffff:view(newMoov).getBigUint64(pos,false)===0xffffffffffffffffn);
     const updated=isTail?fullSize+delta:original>=moovFile.end?original+delta:original;
     if(updated>0xffffffff && b.type==='stco')fail('Chunk offset overflow');
     if(b.type==='stco')w32(newMoov,pos,updated);else view(newMoov).setBigUint64(pos,BigInt(updated),false);
     patchCount++;if(isTail)tailCount++;
   }
 }
 if(tailCount!==1)fail('Synthetic track offset could not be written');
 return {newMoov,tail,report:{sourceBytes:fullSize,outputBytes:fullSize+delta+tail.length,videoAndOriginalAudio:'Packet payloads unchanged (no transcode)',originalAudioSamples:samples,secondAudioSamples:samples+TAIL_COUNT,addedTailPackets:TAIL_COUNT,addedTailBytes:tail.length,originalDeclaredAudioSeconds:x.time.seconds,originalAudioTimescale:x.time.scale,mp4MoovGrowthBytes:delta,chunkOffsetsPatched:patchCount,tailOutsideMdat:true,note:'Secondary AAC track intentionally invalid; platform behavior not guaranteed.'}};
}
async function readTop(file){
 if(!file||typeof file.size!=='number'||typeof file.slice!=='function')fail('Choose an MP4 video file');
 if(file.size<128)fail('Video file is too small');
 if(file.size>MAX_OUTPUT_BYTES-2*MAX_HEADER_BYTES)fail('Video is too large for this 32-bit MP4 lab (approximately 3.87 GiB).');
 // Walk the entire top-level file, skipping mdat payloads with File.slice instead of loading them.
 // Both fast-start (moov before mdat) and moov-last (mdat before moov) are supported.
 const top=[];let pos=0;
 while(pos<file.size){
  if(file.size-pos<8)fail('Incomplete trailing MP4 box');
  const b=new Uint8Array(await file.slice(pos,Math.min(pos+16,file.size)).arrayBuffer());
  const size32=u32(b,0),type=str(b,4);let size=size32,hdr=8;
  if(size32===1){if(b.length<16)fail('Truncated extended MP4 atom');size=Number(view(b).getBigUint64(8,false));hdr=16;}
  else if(size32===0)fail('Unbounded '+type+' box is unsupported by this experiment');
  if(!Number.isSafeInteger(size)||size<hdr||pos+size>file.size)fail('Invalid MP4 atom '+type);
  const item={start:pos,end:pos+size,size,hdr,type};top.push(item);pos+=size;
  if(top.length>128)fail('Too many top-level MP4 atoms');
 }
 if(top.some(b=>['moof','sidx','mfra'].includes(b.type)))fail('Fragmented MP4 not supported');
 const moovs=top.filter(b=>b.type==='moov'),mdats=top.filter(b=>b.type==='mdat');
 if(moovs.length!==1||mdats.length!==1)fail('Requires an MP4 containing exactly one moov and one mdat atom');
 const moovFile=moovs[0], mdat=mdats[0];
 if(moovFile.size>MAX_HEADER_BYTES)fail('MP4 metadata exceeds 64 MB');
 const a=new Uint8Array(await file.slice(moovFile.start,moovFile.end).arrayBuffer());
 const moov=boxList(a)[0];
 if(moov.type!=='moov'||moov.size!==moovFile.size)fail('MP4 metadata could not be parsed');
 return {a,top,moov,moovFile,mdat,fullSize:file.size};
}
export async function inspectForgeReadyFile(file){
 const x=verifyInput(await readTop(file));
 return {videoCodec:codecFromTrack(x.a,x.tracks.find(b=>aTrackKind(x.a,b)==='vide')),audioCodec:'mp4a',samples:x.samples,audioSeconds:x.time.seconds,sizeBytes:file.size,audioTimescale:x.time.scale,tailPackets:TAIL_COUNT};
}
export async function addForgeLikeTrackFile(file){
 const x=verifyInput(await readTop(file)),plan=buildPlan(x);
 const output=new Blob([file.slice(0,x.moovFile.start),plan.newMoov,file.slice(x.moovFile.end),plan.tail],{type:'video/mp4'});
 if(output.size!==plan.report.outputBytes)fail('Unexpected output size');
 return {output,report:plan.report};
}
