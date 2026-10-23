import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createIstanbulReplica,inspectIstanbulSource} from './istanbul-mode.mjs';
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
  const packets=path=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,size,data_hash','-of','json',path],{maxBuffer:10*1024*1024})).packets;
  const before=packets(p),after=packets(op);
  assert.deepEqual(after.filter(x=>x.stream_index===0&&Number(x.size)>8),before.filter(x=>x.stream_index===0));
  assert.deepEqual(after.filter(x=>x.stream_index===1),before.filter(x=>x.stream_index===1));
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
  const packets=path=>JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_packets','-show_data_hash','sha256','-show_entries','packet=stream_index,size,data_hash','-of','json',path],{maxBuffer:10*1024*1024})).packets;
  const a=packets(p),b=packets(outputPath);
  assert.deepEqual(b.filter(x=>x.stream_index===0&&Number(x.size)>8),a.filter(x=>x.stream_index===0));
  assert.deepEqual(b.filter(x=>x.stream_index===1),a.filter(x=>x.stream_index===1));
 }finally{await rm(dir,{recursive:true,force:true});}
});
