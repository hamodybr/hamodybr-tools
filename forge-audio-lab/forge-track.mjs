// HAMODYBR Forge-track structure experiment. No video/audio re-encoding.
// Deliberately produces an invalid secondary AAC track. Do not use as a master/archive.
export const TAIL_COUNT = 6912;
export const TAIL_PAYLOAD = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 0]);
const enc = new TextEncoder();
const dec = new TextDecoder('ascii');
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
function verifyInput(a){
 if(!isData(a))fail('Expected Uint8Array');
 if(a.length<128 || a.length>250*1024*1024)fail('Video must be an MP4 under 250 MB');
 const top=boxList(a),moov=top.find(b=>b.type==='moov'),mdat=top.find(b=>b.type==='mdat');
 if(!moov||!mdat||moov.start>mdat.start || top.at(-1)!==mdat)fail('Requires a fast-start, non-fragmented MP4 with mdat last');
 if(top.some(b=>['moof','sidx'].includes(b.type)))fail('Fragmented MP4 not supported');
 const tracks=children(a,moov).filter(b=>b.type==='trak');
 const audios=tracks.filter(b=>aTrackKind(a,b)==='soun');
 const videos=tracks.filter(b=>aTrackKind(a,b)==='vide');
 if(audios.length!==1||videos.length!==1)fail('Requires exactly one video and one AAC audio track');
 if(codecFromTrack(a,audios[0])!=='mp4a')fail('Requires AAC audio in MP4');
 if(!['avc1','avc3'].includes(codecFromTrack(a,videos[0])))fail('Requires H.264 (AVC) video. Preprocess HDR/HEVC first.');
 const audio=audios[0],stbl=stblFromTrack(a,audio),mdhd=child(a,child(a,audio,'mdia'),'mdhd');
 const time=versionedDuration(a,mdhd);
 if(time.scale!==48000)fail('Forge reference uses 48kHz AAC. Convert other sample rates before this experiment.');
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
 return {a,top,moov,mdat,tracks,audio,stbl,stts,stsc,stsz,stco,mdhd,time,samples,chunkCount,scEntries,descIndex};
}
export function inspectForgeReady(data){const x=verifyInput(data);return {videoCodec:codecFromTrack(data,x.tracks.find(b=>aTrackKind(data,b)==='vide')),audioCodec:'mp4a',samples:x.samples,audioSeconds:x.time.seconds,sizeBytes:data.length,tailPackets:TAIL_COUNT};}
export function addForgeLikeTrack(data){
 const x=verifyInput(data), {a,moov,mdat,audio,stts,stsc,stsz,stco,samples,chunkCount,scEntries,descIndex}=x;
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
 if(a.length+delta+tail.length>0xffffffff)fail('File too large for 32-bit offsets');
 // All original sample data moved forward by delta when the larger moov is inserted.
 // The duplicated audio track shares the original AAC bytes, like the Forge sample.
 const newMoovRoot=boxList(newMoov)[0];let patchCount=0,tailCount=0;
 for(const b of gatherChunkBoxes(newMoov,newMoovRoot)){
   const n=u32(newMoov,b.start+12),step=b.type==='stco'?4:8;
   for(let i=0;i<n;i++){
     const pos=b.start+16+i*step;
     const original=b.type==='stco'?u32(newMoov,pos):Number(view(newMoov).getBigUint64(pos,false));
     const isTail=(b.type==='stco'?original===0xffffffff:view(newMoov).getBigUint64(pos,false)===0xffffffffffffffffn);
     const updated=isTail?a.length+delta:original>=mdat.start?original+delta:original;
     if(updated>0xffffffff && b.type==='stco')fail('Chunk offset overflow');
     if(b.type==='stco')w32(newMoov,pos,updated);else view(newMoov).setBigUint64(pos,BigInt(updated),false);
     patchCount++;if(isTail)tailCount++;
   }
 }
 if(tailCount!==1)fail('Synthetic track offset could not be written');
 const output=pack([a.subarray(0,moov.start),newMoov,a.subarray(moov.end),tail]);
 return {output,report:{sourceBytes:a.length,outputBytes:output.length,videoAndOriginalAudio:'Packet payloads unchanged (no transcode)',originalAudioSamples:samples,secondAudioSamples:samples+TAIL_COUNT,addedTailPackets:TAIL_COUNT,addedTailBytes:tail.length,originalDeclaredAudioSeconds:x.time.seconds,mp4MoovGrowthBytes:delta,chunkOffsetsPatched:patchCount,tailOutsideMdat:true,note:'Secondary AAC track intentionally invalid; platform behavior not guaranteed.'}};
}