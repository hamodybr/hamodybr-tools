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
 await test('two valid AAC tracks remain intact and one experiment track is appended',async()=>{
  const multi=join(temp,'two-audio.mp4'),out=join(temp,'two-audio-output.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-i',original,'-map','0:v:0','-map','0:a:0','-map','0:a:0','-c','copy','-movflags','+faststart',multi],{timeout:40000});
  const f=await openAsBlob(multi),before=await inspectForgeReadyFile(f);
  assert.equal(before.audioTrackCount,2);assert.equal(before.alreadyProcessed,false);
  const {output,report}=await addForgeLikeTrackFile(f);
  assert.equal(report.secondAudioSamples,before.samples+TAIL_COUNT);
  await writeFile(out,Buffer.from(await output.arrayBuffer()));
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,nb_frames','-of','json',out]).toString());
  assert.equal(info.streams.length,4);assert.equal(+info.streams[3].nb_frames,before.samples+TAIL_COUNT);
  const hash=(path,map)=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
  for(const map of ['0:v:0','0:a:0','0:a:1'])assert.equal(hash(multi,map),hash(out,map),map+' payload changed');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',out,'-map','0:v:0','-map','0:a:0','-map','0:a:1','-f','null','-'],{timeout:40000});
 });
 await test('recognized Forge output is idempotent and returned byte-for-byte',async()=>{
  const f=await openAsBlob(smallOut),state=await inspectForgeReadyFile(f);
  assert.equal(state.audioTrackCount,2);assert.equal(state.alreadyProcessed,true);
  const {output,report}=await addForgeLikeTrackFile(f);
  assert.equal(report.alreadyProcessed,true);assert.equal(report.addedTailPackets,0);assert.equal(output.size,f.size);
  const {readFile}=await import('node:fs/promises');
  assert.deepEqual(Buffer.from(await output.arrayBuffer()),await readFile(smallOut));
 });
 await test('standalone sidx box is allowed in a non-fragmented MP4',async()=>{
  const source=join(temp,'index-only.mp4'),output=join(temp,'index-only-output.mp4');
  const sidx=Buffer.alloc(16);sidx.writeUInt32BE(16,0);sidx.write('sidx',4,'ascii');
  await copyFile(original,source);
  const {appendFile}=await import('node:fs/promises');await appendFile(source,sidx);
  const f=await openAsBlob(source),metadata=await inspectForgeReadyFile(f);
  assert.equal(metadata.alreadyProcessed,false);
  const result=await addForgeLikeTrackFile(f);
  assert.equal(result.report.secondAudioSamples,metadata.samples+TAIL_COUNT);
  await writeFile(output,Buffer.from(await result.output.arrayBuffer()));
  const hash=(path,map)=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
  for(const map of ['0:v:0','0:a:0'])assert.equal(hash(source,map),hash(output,map),map+' payload changed');
 });
 await test('genuine fragmented H264/AAC MP4 normalizes with encoded packet copying',async()=>{
  const fragmented=join(temp,'fragmented.mp4'),normalizedPath=join(temp,'normalized.mp4'),forgePath=join(temp,'fragmented-forge.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-i',original,'-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+frag_keyframe+empty_moov+default_base_moof','-frag_duration','500000',fragmented],{timeout:40000});
  const {normalizeFragmentedFile}=await import('./normalize-fragmented.mjs');
  const M=await import('mediabunny');
  const f=await openAsBlob(fragmented);
  await assert.rejects(inspectForgeReadyFile(f),/FRAGMENTED_MP4/);
  let lastProgress=0;
  const prepared=await normalizeFragmentedFile(f,n=>{lastProgress=n;},M,{mobile:false});
  assert.equal(prepared.method,'encoded-packet-copy');assert.equal(lastProgress,1);
  await writeFile(normalizedPath,Buffer.from(await prepared.file.arrayBuffer()));
  const checked=await inspectForgeReadyFile(prepared.file);
  assert.equal(checked.alreadyProcessed,false);
  const forged=await addForgeLikeTrackFile(prepared.file);
  await writeFile(forgePath,Buffer.from(await forged.output.arrayBuffer()));
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,nb_frames','-of','json',forgePath]).toString());
  assert.equal(info.streams.length,3);
  assert.equal(+info.streams[2].nb_frames,checked.samples+TAIL_COUNT);
  const hash=(path,map)=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
  for(const map of ['0:v:0','0:a:0']){
   assert.equal(hash(fragmented,map),hash(normalizedPath,map),map+' changed during remux');
   assert.equal(hash(fragmented,map),hash(forgePath,map),map+' changed during Forge Track');
  }
  execFileSync('ffmpeg',['-v','error','-xerror','-i',forgePath,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
 });
 await test('silent Pexels-like fragmented MP4 receives valid AAC silence without video transcode',async()=>{
  const silent=join(temp,'silent-fragmented.mp4'),normalized=join(temp,'silent-normalized.mp4'),forge=join(temp,'silent-forge.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-i',original,'-map','0:v:0','-an','-c','copy','-movflags','+frag_keyframe+empty_moov+default_base_moof','-frag_duration','500000',silent],{timeout:40000});
  const {normalizeFragmentedFile}=await import('./normalize-fragmented.mjs'),M=await import('mediabunny');
  const source=await openAsBlob(silent);
  await assert.rejects(inspectForgeReadyFile(source),/FRAGMENTED_MP4/);
  const prepared=await normalizeFragmentedFile(source,()=>{},M,{mobile:false});
  assert.equal(prepared.addedSilentAudio,true);
  await writeFile(normalized,Buffer.from(await prepared.file.arrayBuffer()));
  const state=await inspectForgeReadyFile(prepared.file);
  assert.equal(state.audioTrackCount,1);assert.equal(state.audioTimescale,48000);
  const result=await addForgeLikeTrackFile(prepared.file);
  await writeFile(forge,Buffer.from(await result.output.arrayBuffer()));
  const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,sample_rate,nb_frames','-of','json',forge]).toString());
  assert.equal(stream.streams.length,3);assert.equal(stream.streams[1].codec_name,'aac');
  assert.equal(stream.streams[1].sample_rate,'48000');
  assert.equal(+stream.streams[2].nb_frames,state.samples+TAIL_COUNT);
  const hash=(path,map)=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
  assert.equal(hash(silent,'0:v:0'),hash(normalized,'0:v:0'));
  assert.equal(hash(silent,'0:v:0'),hash(forge,'0:v:0'));
  execFileSync('ffmpeg',['-v','error','-xerror','-i',forge,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
 });
 await test('non-fragmented silent MP4 can also receive AAC without touching video packets',async()=>{
  const silent=join(temp,'silent-regular.mp4'),forge=join(temp,'silent-regular-forge.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-i',original,'-map','0:v:0','-an','-c','copy','-movflags','+faststart',silent],{timeout:40000});
  const {normalizeFragmentedFile}=await import('./normalize-fragmented.mjs'),M=await import('mediabunny');
  const source=await openAsBlob(silent);
  await assert.rejects(inspectForgeReadyFile(source),/Requires at least one AAC audio track; found 0 audio tracks/);
  const prepared=await normalizeFragmentedFile(source,()=>{},M,{mobile:false});
  assert.equal(prepared.addedSilentAudio,true);
  const result=await addForgeLikeTrackFile(prepared.file);
  await writeFile(forge,Buffer.from(await result.output.arrayBuffer()));
  const hash=(path)=>execFileSync('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-c','copy','-f','md5','-']).toString().trim();
  assert.equal(hash(silent),hash(forge));
  execFileSync('ffmpeg',['-v','error','-xerror','-i',forge,'-map','0:a:0','-f','null','-'],{timeout:40000});
 });
 await test('44.1 kHz AAC timebase is accepted without resampling or re-encoding',async()=>{
  const input=join(temp,'aac-44100.mp4'),out=join(temp,'aac-44100-output.mp4');
  execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=240x426:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1.25','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ar','44100','-movflags','+faststart',input],{timeout:40000});
  const file=await openAsBlob(input),before=await inspectForgeReadyFile(file),{output,report}=await addForgeLikeTrackFile(file);
  assert.equal(before.audioTimescale,44100);
  assert.equal(report.originalAudioTimescale,44100);
  assert.equal(report.secondAudioSamples,before.samples+TAIL_COUNT);
  await writeFile(out,Buffer.from(await output.arrayBuffer()));
  const p=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,sample_rate,time_base,nb_frames','-of','json',out]).toString());
  assert.equal(p.streams.length,3);
  assert.equal(p.streams[1].sample_rate,'44100');
  assert.equal(p.streams[2].sample_rate,'44100');
  assert.equal(+p.streams[2].nb_frames,before.samples+TAIL_COUNT);
  for(const map of ['0:v:0','0:a:0']){
   const hash=path=>execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-']).toString().trim();
   assert.equal(hash(input),hash(out),map+' payload changed');
  }
  execFileSync('ffmpeg',['-v','error','-xerror','-i',out,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
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
