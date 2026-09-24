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
function sameBytes(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
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
function hasForgeSyntheticTrack(a, track, tailEnd, tailStart){
 if(tailStart===null)return false;
 try{
  const tbl=stblFromTrack(a,track);
  const stts=child(a,tbl,'stts'),stsz=child(a,tbl,'stsz'),stsc=child(a,tbl,'stsc');
  const offsetBox=children(a,tbl).find(b=>b.type==='stco'||b.type==='co64');
  if(!offsetBox||u32(a,stsz.start+12)!==0)return false;
  const sizeCount=u32(a,stsz.start+16),entries=u32(a,stts.start+12),chunks=u32(a,offsetBox.start+12);
  if(sizeCount<TAIL_COUNT+1||entries<1||chunks<1)return false;
  const lastTts=stts.start+16+(entries-1)*8;
  if(u32(a,lastTts)!==TAIL_COUNT||u32(a,lastTts+4)!==1)return false;
  const lastStsc=stsc.start+16+(u32(a,stsc.start+12)-1)*12;
  if(u32(a,lastStsc)!==chunks||u32(a,lastStsc+4)!==TAIL_COUNT)return false;
  const offsetPos=offsetBox.start+16+(chunks-1)*(offsetBox.type==='stco'?4:8);
  const endOffset=offsetBox.type==='stco'?u32(a,offsetPos):Number(view(a).getBigUint64(offsetPos,false));
  if(endOffset!==tailStart||tailStart+TAIL_COUNT*8!==tailEnd)return false;
  const startSizes=stsz.start+20+(sizeCount-TAIL_COUNT)*4;
  for(let i=0;i<TAIL_COUNT;i++)if(u32(a,startSizes+i*4)!==8)return false;
  return true;
 }catch{return false;}
}
function verifyInput({a,top,moov,moovFile,mdat,fullSize,syntheticTailStart=null,syntheticTailEnd=null}){
 if(!isData(a)||a.length<128)fail('Invalid MP4 metadata');
 const tracks=children(a,moov).filter(b=>b.type==='trak');
 const audios=tracks.filter(b=>aTrackKind(a,b)==='soun');
 const videos=tracks.filter(b=>aTrackKind(a,b)==='vide');
 if(videos.length!==1)fail('Requires exactly one video track; found '+videos.length);
 const videoCodec=codecFromTrack(a,videos[0]);
 if(!['avc1','avc3','hvc1','hev1'].includes(videoCodec))fail('Unsupported video codec '+videoCodec+'. This lab supports AVC and HEVC in MP4.');
 const aacs=audios.filter(b=>codecFromTrack(a,b)==='mp4a');
 if(!aacs.length)fail('Requires at least one AAC audio track; found '+audios.length+' audio tracks');
 // Use the first AAC track and preserve any additional original audio/metadata tracks.
 // A known processed input is handled idempotently instead of adding another corrupt track.
 const audio=aacs[0],stbl=stblFromTrack(a,audio),mdhd=child(a,child(a,audio,'mdia'),'mdhd');
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
 const otherAac=aacs.find(b=>b!==audio && hasForgeSyntheticTrack(a,b,syntheticTailEnd,syntheticTailStart));
 if(syntheticTailStart!==null && !otherAac)fail('Forge-like trailing data exists but no matching secondary AAC track was found');
 if(otherAac && syntheticTailStart===null)fail('Secondary Forge track exists but the synthetic tail is missing');
 const alreadyProcessed=!!otherAac;
 return {a,top,moov,moovFile,mdat,fullSize,tracks,videoCodec,audio,stbl,stts,stsc,stsz,stco,mdhd,time,samples,chunkCount,scEntries,descIndex,audioTrackCount:audios.length,alreadyProcessed,syntheticTailStart,syntheticTailEnd};
}
function buildPlan(x,{insideMdat=false}={}){
 // The forged samples belong to the existing mdat when the user chooses the
 // inside-container variant. The original media samples remain file-backed.

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
 if (insideMdat && mdat.size+tail.length>0xffffffff && mdat.hdr===8)
   fail('Inside-mdat variant exceeds 32-bit mdat box size.');
 // The new mdat tail starts at the original mdat end, shifted by moov growth
 // only when moov physically precedes mdat.
 const syntheticOffset = insideMdat
   ? mdat.end + (moovFile.start < mdat.start ? delta : 0)
   : fullSize+delta;
 // All original sample data moved forward by delta when the larger moov is inserted.
 // The duplicated audio track shares the original AAC bytes, like the Forge sample.
 const newMoovRoot=boxList(newMoov)[0];let patchCount=0,tailCount=0;
 for(const b of gatherChunkBoxes(newMoov,newMoovRoot)){
   const n=u32(newMoov,b.start+12),step=b.type==='stco'?4:8;
   for(let i=0;i<n;i++){
     const pos=b.start+16+i*step;
     const original=b.type==='stco'?u32(newMoov,pos):Number(view(newMoov).getBigUint64(pos,false));
     const isTail=(b.type==='stco'?original===0xffffffff:view(newMoov).getBigUint64(pos,false)===0xffffffffffffffffn);
     const updated=isTail?syntheticOffset:original>=moovFile.end?original+delta:original;
     if(updated>0xffffffff && b.type==='stco')fail('Chunk offset overflow');
     if(b.type==='stco')w32(newMoov,pos,updated);else view(newMoov).setBigUint64(pos,BigInt(updated),false);
     patchCount++;if(isTail)tailCount++;
   }
 }
 if(tailCount!==1)fail('Synthetic track offset could not be written');
 return {newMoov,tail,report:{sourceBytes:fullSize,outputBytes:fullSize+delta+tail.length,videoCodec:x.videoCodec,videoAndOriginalAudio:'Packet payloads unchanged (no transcode)',originalAudioSamples:samples,secondAudioSamples:samples+TAIL_COUNT,addedTailPackets:TAIL_COUNT,addedTailBytes:tail.length,originalDeclaredAudioSeconds:x.time.seconds,originalAudioTimescale:x.time.scale,mp4MoovGrowthBytes:delta,chunkOffsetsPatched:patchCount,tailOutsideMdat:!insideMdat,note:'Secondary AAC track intentionally invalid; platform behavior not guaranteed.'}};
}
async function matchesForgeTail(file,offset,end=file.size){
 if(end-offset!==TAIL_COUNT*8)return false;
 const bytes=new Uint8Array(await file.slice(offset,end).arrayBuffer());
 for(let i=0;i<bytes.length;i+=8)for(let j=0;j<8;j++)if(bytes[i+j]!==TAIL_PAYLOAD[j])return false;
 return true;
}
async function readTop(file){
 if(!file||typeof file.size!=='number'||typeof file.slice!=='function')fail('Choose an MP4 video file');
 if(file.size<128)fail('Video file is too small');
 if(file.size>MAX_OUTPUT_BYTES-2*MAX_HEADER_BYTES)fail('Video is too large for this 32-bit MP4 lab (approximately 3.87 GiB).');
 // Walk the entire top-level file, skipping mdat payloads with File.slice instead of loading them.
 // Both fast-start (moov before mdat) and moov-last (mdat before moov) are supported.
 const top=[];let pos=0,syntheticTailStart=null,syntheticTailEnd=null;
 while(pos<file.size){
  // Forge's deliberately invalid AAC payload is intentionally outside mdat.
  // Recognize only the exact 6,912 x 8-byte fingerprint, never skip arbitrary junk.
  if(top.some(b=>b.type==='mdat') && await matchesForgeTail(file,pos)){
   syntheticTailStart=pos;syntheticTailEnd=file.size;break;
  }
  if(file.size-pos<8)fail('Incomplete trailing MP4 box');
  const b=new Uint8Array(await file.slice(pos,Math.min(pos+16,file.size)).arrayBuffer());
  const size32=u32(b,0),type=str(b,4);let size=size32,hdr=8;
  if(size32===1){if(b.length<16)fail('Truncated extended MP4 atom');size=Number(view(b).getBigUint64(8,false));hdr=16;}
  else if(size32===0)fail('Unbounded '+type+' box is unsupported by this experiment');
  if(!Number.isSafeInteger(size)||size<hdr||pos+size>file.size)fail('Invalid MP4 atom '+type);
  if(type==='moof')fail('FRAGMENTED_MP4');
  const item={start:pos,end:pos+size,size,hdr,type};top.push(item);pos+=size;
  if(top.length>128)fail('Too many top-level MP4 atoms');
 }
 if(top.some(b=>b.type==='mfra'))fail('FRAGMENTED_MP4');
 // sidx is an index; its presence alone does not make the media fragmented.
 const moovs=top.filter(b=>b.type==='moov'),mdats=top.filter(b=>b.type==='mdat');
 if(moovs.length!==1||mdats.length!==1)fail('Requires an MP4 containing exactly one moov and one mdat atom');
 const moovFile=moovs[0], mdat=mdats[0];
 if(moovFile.size>MAX_HEADER_BYTES)fail('MP4 metadata exceeds 64 MB');
 // Older Forge variants appended samples after mdat; the new, directly
 // comparable variant stores them inside mdat. Detect both idempotently.
 if (syntheticTailStart===null) {
   const candidate = mdat.end - TAIL_COUNT*8;
   if (candidate >= mdat.start+mdat.hdr &&
       await matchesForgeTail(file,candidate,mdat.end)) {
     syntheticTailStart=candidate;
     syntheticTailEnd=mdat.end;
   }
 }
 const a=new Uint8Array(await file.slice(moovFile.start,moovFile.end).arrayBuffer());
 const moov=boxList(a)[0];
 if(moov.type!=='moov'||moov.size!==moovFile.size)fail('MP4 metadata could not be parsed');
 return {a,top,moov,moovFile,mdat,fullSize:file.size,syntheticTailStart,syntheticTailEnd};
}
function videoTrackMetrics(x) {
 const vt=x.tracks.find(t=>aTrackKind(x.a,t)==='vide');
 const tbl=stblFromTrack(x.a,vt);
 const stsz=child(x.a,tbl,'stsz');
 const tkhd=child(x.a,vt,'tkhd');
 const duration=versionedDuration(x.a,child(x.a,child(x.a,vt,'mdia'),'mdhd'));
 const frames=u32(x.a,stsz.start+16);
 const width=u32(x.a,tkhd.end-8)/65536;
 const height=u32(x.a,tkhd.end-4)/65536;
 return {videoFrames:frames,videoWidth:width,videoHeight:height,
   videoFps:duration.seconds>0?frames/duration.seconds:null};
}
export async function inspectForgeReadyFile(file){
 const x=verifyInput(await readTop(file));
 return {...videoTrackMetrics(x),videoCodec:x.videoCodec,audioCodec:'mp4a',
   samples:x.samples,audioSeconds:x.time.seconds,sizeBytes:file.size,
   audioTimescale:x.time.scale,audioTrackCount:x.audioTrackCount,
   alreadyProcessed:x.alreadyProcessed,tailPackets:TAIL_COUNT};
}
export async function addForgeLikeTrackFile(file){
 const x=verifyInput(await readTop(file));
 if(x.alreadyProcessed)return {output:file,report:{sourceBytes:file.size,outputBytes:file.size,originalAudioSamples:x.samples,secondAudioSamples:x.samples+TAIL_COUNT,addedTailPackets:0,originalAudioTimescale:x.time.scale,alreadyProcessed:true,note:'Recognized existing Forge-like track. Original file returned unchanged.'}};
 const plan=buildPlan(x);
 const output=new Blob([file.slice(0,x.moovFile.start),plan.newMoov,file.slice(x.moovFile.end),plan.tail],{type:'video/mp4'});
 if(output.size!==plan.report.outputBytes)fail('Unexpected output size');
 return {output,report:plan.report};
}

/**
 * Forge add-only variant: source HEVC/AVC and every original media track are
 * preserved byte-for-byte. The original moov sample metadata is copied, and
 * only global offsets affected by moov growth and the extra AAC track differ.
 * Works with ordinary MP4 and compatible iPhone MOV (qt brand) with a single
 * moov and mdat. Rejects fragmented inputs instead of re-encoding.
 */
export async function addForgeInsideMdatFile(file) {
 const x=verifyInput(await readTop(file));
 if(x.alreadyProcessed) return {
   output:file,
   report:{sourceBytes:file.size,outputBytes:file.size,addedTailPackets:0,
     originalAudioSamples:x.samples,alreadyProcessed:true,
     note:'Existing experimental track found. Input returned unchanged.'}
 };
 const plan=buildPlan(x,{insideMdat:true});
 const header=new Uint8Array(await file.slice(x.mdat.start,x.mdat.start+x.mdat.hdr).arrayBuffer());
 if(x.mdat.hdr===8)w32(header,0,x.mdat.size+plan.tail.length);
 else view(header).setBigUint64(8,BigInt(x.mdat.size+plan.tail.length),false);
 const parts=[];
 for(const item of x.top) {
   if(item.type==='moov')parts.push(plan.newMoov);
   else if(item.start===x.mdat.start){
     parts.push(header,file.slice(item.start+item.hdr,item.end),plan.tail);
   } else parts.push(file.slice(item.start,item.end));
 }
 const output=new Blob(parts,{type:file.name.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4'});
 if(output.size!==plan.report.outputBytes)fail('Unexpected output size');
 const verified=verifyInput(await readTop(output));
 if(!verified.alreadyProcessed || verified.videoCodec!==x.videoCodec ||
    verified.samples!==x.samples || verified.audioTrackCount!==x.audioTrackCount+1 ||
    verified.syntheticTailEnd!==verified.mdat.end)
   fail('Output safety check failed: new track or original streams differ.');
 // Validate the copied video and primary AAC descriptions, timing and sample
 // sizes. Chunk offset tables legitimately change when moov grows.
 for (const kind of ['vide','soun']) {
   const before=x.tracks.find(t=>aTrackKind(x.a,t)===kind);
   const after=verified.tracks.find(t=>aTrackKind(verified.a,t)===kind);
   if(!before || !after)fail('Missing original '+kind+' track');
   const pairs=[
     [x.a,stblFromTrack(x.a,before)],
     [verified.a,stblFromTrack(verified.a,after)]
   ];
   for(const type of ['stsd','stts','stsz','ctts','stss']) {
     const b1=children(pairs[0][0],pairs[0][1]).find(b=>b.type===type);
     const b2=children(pairs[1][0],pairs[1][1]).find(b=>b.type===type);
     if(!!b1!==!!b2)fail('Original '+kind+' '+type+' metadata lost');
     if(b1 && !sameBytes(pairs[0][0].subarray(b1.start,b1.end),
                         pairs[1][0].subarray(b2.start,b2.end)))
       fail('Original '+kind+' '+type+' metadata changed');
   }
 }
 const a=videoTrackMetrics(x),b=videoTrackMetrics(verified);
 if(a.videoFrames!==b.videoFrames || a.videoFps!==b.videoFps ||
    a.videoWidth!==b.videoWidth || a.videoHeight!==b.videoHeight)
   fail('Source frame-rate or dimensions changed.');
 return {output,report:{...plan.report,...a,
   originalContainer:file.name.toLowerCase().endsWith('.mov')?'MOV':'MP4'}};
}
