import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openAsBlob} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as M from 'mediabunny';
import {normalizeFragmentedFile} from './normalize-fragmented.mjs';
import {inspectForgeReadyFile,addForgeLikeTrackFile,TAIL_COUNT} from './forge-track.mjs';
const dir=await mkdtemp(join(tmpdir(),'hamodybr-hlg-copy-'));
const source=join(dir,'hlg-hevc.mp4'), fragmented=join(dir,'hlg-fragmented.mp4');
function probe(path) {
 return JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,color_transfer,color_primaries,color_space,nb_frames,sample_rate','-of','json',path]).toString()).streams;
}
function md5(path,map) {
 return execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-'],{timeout:40000}).toString().trim();
}
try {
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=240x426:rate=30',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.0',
  '-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p10le',
  '-x265-params','log-level=error:pools=1:frame-threads=1:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
  '-tag:v','hvc1','-color_primaries','bt2020','-color_trc','arib-std-b67','-colorspace','bt2020nc',
  '-c:a','aac','-ar','48000','-movflags','+faststart',source],{timeout:40000});
 await test('regular HEVC HLG is preserved packet-for-packet while Forge AAC is added',async()=>{
  const src=probe(source);
  assert.equal(src[0].codec_name,'hevc');assert.equal(src[0].color_transfer,'arib-std-b67');
  const file=await openAsBlob(source),state=await inspectForgeReadyFile(file);
  assert.equal(state.videoCodec,'hvc1');
  const res=await addForgeLikeTrackFile(file),dst=join(dir,'hlg-forge.mp4');
  await writeFile(dst,Buffer.from(await res.output.arrayBuffer()));
  const streams=probe(dst);
  assert.equal(streams.length,3);
  assert.equal(streams[0].color_transfer,src[0].color_transfer);
  assert.equal(streams[0].color_primaries,src[0].color_primaries);
  assert.equal(streams[0].color_space,src[0].color_space);
  assert.equal(+streams[2].nb_frames,state.samples+TAIL_COUNT);
  for(const map of ['0:v:0','0:a:0'])assert.equal(md5(source,map),md5(dst,map),map+' encoded data changed');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',dst,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
 });
 execFileSync('ffmpeg',['-v','error','-y','-i',source,'-map','0:v:0','-map','0:a:0','-c','copy',
  '-movflags','+frag_keyframe+empty_moov+default_base_moof','-frag_duration','500000',fragmented],{timeout:40000});
 await test('fragmented HEVC HLG remux copies video/audio packets before Forge step',async()=>{
  const file=await openAsBlob(fragmented);
  await assert.rejects(inspectForgeReadyFile(file),/FRAGMENTED_MP4/);
  const prepared=await normalizeFragmentedFile(file,()=>{},M,{mobile:false});
  assert.equal(prepared.method,'encoded-packet-copy');
  assert.equal(prepared.videoTranscoded,false);
  const midway=join(dir,'hlg-normalized.mp4');
  await writeFile(midway,Buffer.from(await prepared.file.arrayBuffer()));
  assert.equal(probe(midway)[0].codec_name,'hevc');
  assert.equal(md5(fragmented,'0:v:0'),md5(midway,'0:v:0'));
  assert.equal(md5(fragmented,'0:a:0'),md5(midway,'0:a:0'));
  const state=await inspectForgeReadyFile(prepared.file);
  const res=await addForgeLikeTrackFile(prepared.file);
  const dst=join(dir,'hlg-remux-forge.mp4');
  await writeFile(dst,Buffer.from(await res.output.arrayBuffer()));
  assert.equal(probe(dst).length,3);
  assert.equal(+probe(dst)[2].nb_frames,state.samples+TAIL_COUNT);
  for(const map of ['0:v:0','0:a:0'])assert.equal(md5(fragmented,map),md5(dst,map),map+' changed during full pipeline');
  assert.equal(probe(dst)[0].color_transfer,'arib-std-b67');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',dst,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
 });
}finally{await rm(dir,{recursive:true,force:true});}
