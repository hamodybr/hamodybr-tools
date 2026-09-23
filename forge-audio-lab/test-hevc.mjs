import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openAsBlob} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerMediabunnyServer} from '@mediabunny/server';
import * as M from 'mediabunny';
import {normalizeFragmentedFile} from './normalize-fragmented.mjs';
import {inspectForgeReadyFile,addForgeLikeTrackFile,TAIL_COUNT} from './forge-track.mjs';
registerMediabunnyServer();
const dir=await mkdtemp(join(tmpdir(),'hamodybr-hevc-'));
const original=join(dir,'hevc-sdr.mp4'),preparedPath=join(dir,'hevc-prepared.mp4'),forgePath=join(dir,'hevc-forge.mp4');
const md5=(file,map)=>execFileSync('ffmpeg',['-v','error','-i',file,'-map',map,'-c','copy','-f','md5','-'],{timeout:40000}).toString().trim();
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=index,codec_name,nb_frames,sample_rate','-of','json',file]).toString());
try {
  execFileSync('ffmpeg',['-v','error','-y',
    '-f','lavfi','-i','testsrc2=size=240x426:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','1.0','-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p',
    '-x265-params','log-level=error:pools=1:frame-threads=1','-tag:v','hvc1',
    '-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart',original],{timeout:40000});
  await test('HEVC SDR becomes AVC and AAC bitstream survives both preparation and Forge Track',async()=>{
    const f=await openAsBlob(original);
    assert.equal(probe(original).streams[0].codec_name,'hevc');
    await assert.rejects(inspectForgeReadyFile(f),/Requires H.264/);
    const result=await normalizeFragmentedFile(f,()=>{},M,{mobile:false,videoMode:'avc-sdr'});
    assert.equal(result.method,'hevc-to-avc');assert.equal(result.videoTranscoded,true);
    assert.equal(result.addedSilentAudio,false);
    await writeFile(preparedPath,Buffer.from(await result.file.arrayBuffer()));
    assert.equal(probe(preparedPath).streams[0].codec_name,'h264');
    assert.equal(md5(original,'0:a:0'),md5(preparedPath,'0:a:0'),'encoded AAC changed during preparation');
    const metrics=await inspectForgeReadyFile(result.file);
    const final=await addForgeLikeTrackFile(result.file);
    await writeFile(forgePath,Buffer.from(await final.output.arrayBuffer()));
    const streams=probe(forgePath).streams;
    assert.equal(streams.length,3);assert.equal(streams[0].codec_name,'h264');
    assert.equal(+streams[2].nb_frames,metrics.samples+TAIL_COUNT);
    for(const map of ['0:v:0','0:a:0'])assert.equal(md5(preparedPath,map),md5(forgePath,map),'Forge step altered original packets '+map);
    execFileSync('ffmpeg',['-v','error','-xerror','-i',forgePath,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeout:40000});
  });
}finally{await rm(dir,{recursive:true,force:true});}
