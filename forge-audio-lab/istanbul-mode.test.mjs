import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createIstanbulReplica,inspectIstanbulSource,matchIstanbulVideoTiming,prepareSpatialAacFallback} from './istanbul-mode.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function scan(a,start=0,end=a.length){const out=[];for(let o=start;o<end;){let n=a.readUInt32BE(o),h=8;if(n===1){n=Number(a.readBigUInt64BE(o+8));h=16;}if(!n)n=end-o;out.push({type:a.toString('latin1',o+4,o+8),o,n,h});o+=n;}return out;}
function find(a,type){let result;function walk(start,end){for(const b of scan(a,start,end)){if(b.type===type){result=b;return;}if(['moov','trak','mdia','minf','stbl'].includes(b.type))walk(b.o+b.h,b.o+b.n);if(result)return;}}walk(0,a.length);return result;}
const payload=(a,b)=>a.subarray(b.o+b.h,b.o+b.n);
for(const fast of [true,false])test('preserve media and timing, '+(fast?'faststart':'moov last'),async()=>{
 const dir=await mkdtemp(join(tmpdir(),'istanbul-'));
 try{
  const p=join(dir,'source.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x288:rate=60','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.5','-c:v','libx264','-bf','2','-c:a','aac',...(fast?['-movflags','+faststart']:[]),p]);
  const src=await readFile(p),file=new File([src],'source.mp4');
  assert.equal((await inspectIstanbulSource(file)).extraVideoSamples,0);
  const {file:out,report}=await createIstanbulReplica(file);
  assert.equal(report.extraVideoSamples,8200);assert.equal(report.videoSamples,30);assert.equal(report.width,160);assert.equal(report.height,288);
  const dst=Buffer.from(await out.arrayBuffer());const m1=find(src,'mdat'),m2=find(dst,'mdat');
  assert.equal(hash(payload(src,m1)),hash(payload(dst,m2).subarray(0,-8)));
  assert.equal(payload(dst,m2).subarray(-8).toString('hex'),'0000000400000000');
  for(const type of ['stts','ctts','stsd','mdhd','mvhd'])assert.deepEqual(payload(src,find(src,type)),payload(dst,find(dst,type)));
  const sz=find(dst,'stsz');assert.equal(dst.readUInt32BE(sz.o+16),8230);
  const re=await createIstanbulReplica(out);assert.equal(re.file,out);assert.equal(re.report.unchanged,true);
  // Use a second, independent demuxer to check actual packets still match;
  // intentional phantom packets are distinguishable by their eight-byte size.
  const op=join(dir,'output.mp4');await writeFile(op,dst);
  const packets=path=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,size,data_hash,pts_time,dts_time','-of','json',path],{maxBuffer:10*1024*1024})).packets;
  const before=packets(p),after=packets(op);
  assert.deepEqual(after.filter(x=>x.stream_index===0&&Number(x.size)>8),before.filter(x=>x.stream_index===0));
  assert.deepEqual(after.filter(x=>x.stream_index===1),before.filter(x=>x.stream_index===1));
  const timed=await matchIstanbulVideoTiming(out),tp=join(dir,'timed.mp4');
  await writeFile(tp,Buffer.from(await timed.file.arrayBuffer()));
  const afterTiming=packets(tp);
  assert.deepEqual(afterTiming.filter(x=>x.stream_index===0&&Number(x.size)>8),before.filter(x=>x.stream_index===0));
  assert.deepEqual(afterTiming.filter(x=>x.stream_index===1),before.filter(x=>x.stream_index===1));
  const ghost=afterTiming.filter(x=>x.stream_index===0&&Number(x.size)===8);
  assert.equal(ghost.length,8200);
  assert.ok(Number(ghost.at(-1).dts_time)-Number(ghost[0].dts_time)<0.092);
  assert.equal((await matchIstanbulVideoTiming(timed.file)).file,timed.file);
  // A malformed sample count must fail rather than create a second mutation.
  const bad=Buffer.from(src),bs=find(bad,'stsz');bad.writeUInt32BE(bad.readUInt32BE(bs.o+16)+1,bs.o+16);
  await assert.rejects(createIstanbulReplica(new File([bad],'bad.mp4')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reject non-MP4 and oversized virtual inputs without reading payload',async()=>{
 await assert.rejects(inspectIstanbulSource(new File([new Uint8Array(15)],'bad.mp4')));
 await assert.rejects(inspectIstanbulSource({size:0xffffffff}));
});

test('QuickTime MOV version-1 AAC, nested wave and preserved zero padding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'istanbul-mov-'));
 try{
  const p=join(dir,'source.mov');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x288:rate=30','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.5','-c:v','libx264','-c:a','aac',p]);
  const src=await readFile(p);
  const wrap=(type,body)=>{const h=Buffer.alloc(8);h.writeUInt32BE(body.length+8);h.write(type,4);return Buffer.concat([h,body]);};
  function padded(input,bad=false){
   return Buffer.concat(scan(input).map(b=>{
    const body=input.subarray(b.o+b.h,b.o+b.n);
    if(['moov','trak','mdia','minf','stbl'].includes(b.type)){
     let result=padded(body,bad);if(b.type==='moov')result=Buffer.concat([result,Buffer.alloc(4)]);
     return wrap(b.type,result);
    }
    if(b.type==='stsd'&&body.toString('latin1',12,16)==='avc1'){
     // Count + FullBox remain intact, grow only the visual sample description.
     const entry=Buffer.from(body.subarray(8));entry.writeUInt32BE(entry.length+4);
     return wrap('stsd',Buffer.concat([body.subarray(0,8),entry,bad?Buffer.from([1,0,0,0]):Buffer.alloc(4),Buffer.alloc(4)]));
    }
    return input.subarray(b.o,b.o+b.n);
   }));
  }
  // FFmpeg MOV puts moov after mdat; expanding only moov keeps input chunks valid.
  assert.ok(find(src,'moov').o>find(src,'mdat').o);
  const source=padded(src),f=new File([source],'camera.mov');
  assert.equal((await inspectIstanbulSource(f)).videoSamples,15);
  const {file:out}=await createIstanbulReplica(f);const dst=Buffer.from(await out.arrayBuffer());
  const m1=find(src,'mdat'),m2=find(dst,'mdat');assert.deepEqual(payload(src,m1),payload(dst,m2).subarray(0,-8));
  assert.equal((await createIstanbulReplica(out)).file,out);
  await assert.rejects(inspectIstanbulSource(new File([padded(src,true)],'bad.mov')),/تعذّر قراءة/);
  const mp4a=src.indexOf(Buffer.from('mp4a'));assert.equal(src.readUInt16BE(mp4a+12),1);
  const outputPath=join(dir,'output.mp4');await writeFile(outputPath,dst);
  const packets=path=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,size,data_hash,pts_time,dts_time','-of','json',path],{maxBuffer:10*1024*1024})).packets;
  const a=packets(p),b=packets(outputPath);
  assert.deepEqual(b.filter(x=>x.stream_index===0&&Number(x.size)>8),a.filter(x=>x.stream_index===0));
  assert.deepEqual(b.filter(x=>x.stream_index===1),a.filter(x=>x.stream_index===1));
  const corrected=await matchIstanbulVideoTiming(out),timedPath=join(dir,'timing.mp4');
  await writeFile(timedPath,Buffer.from(await corrected.file.arrayBuffer()));
  const cp=packets(timedPath);
  assert.deepEqual(cp.filter(x=>x.stream_index===0&&Number(x.size)>8),a.filter(x=>x.stream_index===0));
  assert.deepEqual(cp.filter(x=>x.stream_index===1),a.filter(x=>x.stream_index===1));

 }finally{await rm(dir,{recursive:true,force:true});}
});

for(const apacFirst of [true,false])test('Spatial Audio selects existing AAC with APAC '+(apacFirst?'first':'second'),async()=>{
 const dir=await mkdtemp(join(tmpdir(),'istanbul-spatial-'));
 try{
  const path=join(dir,'spatial.mov');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x288:rate=30','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.5','-map','0:v','-map','1:a','-map','1:a','-c:v','libx264','-c:a','aac','-timecode','00:00:00:00',...(apacFirst?['-movflags','+faststart']:[]),path]);
  const src=await readFile(path),moov=find(src,'moov'),root=scan(src,moov.o+moov.h,moov.o+moov.n);
  const tracks=root.filter(b=>b.type==='trak');
  function description(tr){const md=scan(src,tr.o+tr.h,tr.o+tr.n).find(b=>b.type==='mdia');const minf=scan(src,md.o+md.h,md.o+md.n).find(b=>b.type==='minf');const stbl=scan(src,minf.o+minf.h,minf.o+minf.n).find(b=>b.type==='stbl');return scan(src,stbl.o+stbl.h,stbl.o+stbl.n).find(b=>b.type==='stsd');}
  const audio=tracks.map(description).filter(b=>src.toString('latin1',b.o+20,b.o+24)==='mp4a');assert.equal(audio.length,2);
  // APAC-tagged fixture only models selection/routing. No APAC decoder is used.
  const excluded=audio[apacFirst?0:1];src.write('apac',excluded.o+20);await writeFile(path,src);
  const f=new File([src],'spatial.mov');const prepared=await prepareSpatialAacFallback(f);
  assert.equal(prepared.report.audioFallbackSelected,true);assert.equal(prepared.report.audioTranscoded,false);
  const dst=Buffer.from(await prepared.file.arrayBuffer());assert.deepEqual(payload(src,find(src,'mdat')),payload(dst,find(dst,'mdat')));
  assert.equal((await inspectIstanbulSource(f)).audioFallbackSelected,true);
  const target=join(dir,'selected.mov');await writeFile(target,dst);
  const packet=(p,select)=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-select_streams',select,'-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,dts_time,data_hash','-of','json',p],{maxBuffer:10*1024*1024})).packets;
  assert.deepEqual(packet(target,'v:0'),packet(path,'v:0'));
  assert.deepEqual(packet(target,'a:0'),packet(path,apacFirst?'a:1':'a:0'));
  const forged=await createIstanbulReplica(f);assert.equal(forged.report.audioFallbackSelected,true);
  const fixed=await matchIstanbulVideoTiming(forged.file);assert.ok(fixed.file.size>0);
  // The fallback selector returns ordinary two-track output unchanged on re-entry.
  assert.equal((await prepareSpatialAacFallback(prepared.file)).file,prepared.file);
  const noAac=Buffer.from(src);for(const b of audio)noAac.write('apac',b.o+20);
  await assert.rejects(prepareSpatialAacFallback(new File([noAac],'only-apac.mov')),/AAC/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
