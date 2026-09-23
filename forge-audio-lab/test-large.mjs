import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openAsBlob,openSync,closeSync,readSync,writeSync,ftruncateSync} from 'node:fs';
import {mkdtemp,copyFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectForgeReadyFile,addForgeLikeTrackFile,TAIL_COUNT} from './forge-track.mjs';
const temp=await mkdtemp(join(tmpdir(),'hamodybr-forge-large-'));
const original=join(temp,'source.mp4'),smallOut=join(temp,'output.mp4');
try {
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=240x426:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.25','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-movflags','+faststart',original],{timeout:40000});
 await test('fast-start MP4 retains video and primary audio',async()=>{
  const file=await openAsBlob(original),before=await inspectForgeReadyFile(file),{output,report}=await addForgeLikeTrackFile(file);
  assert.equal(report.secondAudioSamples,before.samples+TAIL_COUNT);assert.equal(output.size,report.outputBytes);
  await writeFile(smallOut,Buffer.from(await output.arrayBuffer()));
  const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,nb_frames','-of','json',smallOut]).toString());
  assert.equal(p.streams.length,3);assert.equal(+p.streams[2].nb_frames,before.samples+TAIL_COUNT);
  for(const map of ['0:v:0','0:a:0']){
   const hash=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
   assert.equal(hash(original),hash(smallOut),map+' payload changed');
  }
  execFileSync('ffmpeg',['-v','error','-xerror','-i',smallOut,'-map','0:v:0','-f','null','-'],{timeout:40000});
 });
 await test('moov-last MP4 works without fast-start and retains original packets',async()=>{
  const slow=join(temp,'moov-last.mp4'),out=join(temp,'moov-last-output.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-i',original,'-map','0:v:0','-map','0:a:0','-c','copy',slow],{timeout:40000});
  const file=await openAsBlob(slow),info=await inspectForgeReadyFile(file),{output,report}=await addForgeLikeTrackFile(file);
  assert.equal(output.size,report.outputBytes);
  assert.equal(report.secondAudioSamples,info.samples+TAIL_COUNT);
  await writeFile(out,Buffer.from(await output.arrayBuffer()));
  const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,nb_frames','-of','json',out]).toString());
  assert.equal(p.streams.length,3);
  assert.equal(+p.streams[2].nb_frames,info.samples+TAIL_COUNT);
  for(const map of ['0:v:0','0:a:0']){
   const hash=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
   assert.equal(hash(slow),hash(out),map+' payload changed');
  }
  execFileSync('ffmpeg',['-v','error','-xerror','-i',out,'-map','0:v:0','-f','null','-'],{timeout:40000});
 });
 await test('extra top-level atom after mdat is preserved',async()=>{
  const source=join(temp,'trailing-free.mp4'),out=join(temp,'trailing-free-output.mp4');
  const free=Buffer.alloc(16);free.writeUInt32BE(16,0);free.write('free',4,'ascii');
  await copyFile(original,source);
  const {appendFile}=await import('node:fs/promises');await appendFile(source,free);
  const file=await openAsBlob(source),info=await inspectForgeReadyFile(file),{output,report}=await addForgeLikeTrackFile(file);
  assert.equal(report.secondAudioSamples,info.samples+TAIL_COUNT);
  const buf=Buffer.from(await output.arrayBuffer());await writeFile(out,buf);
  assert.ok(buf.includes(free),'trailing free atom missing');
  const hash=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-c','copy','-f','md5','-']).toString().trim();
  assert.equal(hash(source),hash(out),'video packets changed after trailing free atom');
 });
 await test('large 320-MiB MP4 works without reading whole input',async()=>{
  const large=join(temp,'large.mp4');await copyFile(original,large);const fd=openSync(large,'r+');
  try{let pos=0,mdat=-1;while(pos<16*1024*1024){const h=Buffer.alloc(16);readSync(fd,h,0,16,pos);
   let sz=h.readUInt32BE(0);if(sz===1)sz=Number(h.readBigUInt64BE(8));
   if(h.toString('ascii',4,8)==='mdat'){mdat=pos;break;}assert.ok(sz>=8);pos+=sz;}
   assert.ok(mdat>=0);const target=320*1024*1024;ftruncateSync(fd,target);
   const size=Buffer.alloc(4);size.writeUInt32BE(target-mdat);writeSync(fd,size,0,4,mdat);
  }finally{closeSync(fd);}
  const file=await openAsBlob(large),input=await inspectForgeReadyFile(file),{output,report}=await addForgeLikeTrackFile(file);
  assert.ok(file.size>250*1024*1024);assert.equal(report.sourceBytes,file.size);
  assert.equal(output.size,report.outputBytes);assert.equal(report.secondAudioSamples,input.samples+TAIL_COUNT);
  assert.equal(output.slice(-8).size,8);
 });
}finally{await rm(temp,{recursive:true,force:true});}
