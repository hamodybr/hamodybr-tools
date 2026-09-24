import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 inspectForgeReadyFile,addForgeLikeTrackFile,addForgeInsideMdatFile,TAIL_COUNT
} from './forge-track.mjs';

function ffprobe(file, streamSelector) {
 const args=['-v','error','-select_streams',streamSelector,'-show_entries',
   'packet=pts,dts,duration,size,data_hash','-show_packets','-show_data_hash','sha256','-of','json',file];
 return JSON.parse(execFileSync('ffprobe',args,{maxBuffer:16*1024*1024}).toString()).packets
  .map(x=>[x.pts,x.dts,x.duration,x.size,x.data_hash]);
}
function allStreams(path) {
 return JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries',
   'stream=index,codec_name,codec_type,width,height,pix_fmt,color_transfer,color_primaries,nb_frames,r_frame_rate,codec_tag_string',
   '-show_streams','-of','json',path]).toString()).streams;
}
function generate(path, kind, hevc=false) {
 const args=['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=60',
   '-f','lavfi','-i','sine=frequency=700:sample_rate=48000',
   '-t','1.25','-c:v',hevc?'libx265':'libx264','-preset','ultrafast',
   ...(hevc?['-pix_fmt','yuv420p10le','-color_primaries','bt2020','-color_trc','arib-std-b67','-colorspace','bt2020nc','-tag:v','hvc1',
     '-x265-params','log-level=error:frame-threads=1:pools=none']:
       ['-pix_fmt','yuv420p']),
   '-c:a','aac','-b:a','128k','-shortest',
   ...(kind==='mp4'?['-movflags','+faststart']:[]),
   '-f',kind,path];
 execFileSync('ffmpeg',args,{maxBuffer:2*1024*1024,timeout:120000,env:{...process.env,OMP_NUM_THREADS:'1'}});
}
const folder=mkdtempSync(join(tmpdir(),'hamody-forge-addonly-'));
test.after(()=>rmSync(folder,{recursive:true,force:true}));
for (const [kind,hevc] of [['mp4',false],['mov',true]]) {
 test('original '+kind+(hevc?' HEVC10 HLG':' AVC')+': video, AAC, timing, metadata copied and inside-mdat Forge detected',
   {timeout:160000},async()=>{
     const input=join(folder,'sample-'+kind+'.'+kind),dest=join(folder,'output-'+kind+'.'+kind);
     generate(input,kind,hevc);
     const originalBytes=readFileSync(input);
     const original=new File([originalBytes],'sample.'+kind,{type:kind==='mov'?'video/quicktime':'video/mp4'});
     const before=await inspectForgeReadyFile(original);
     assert.equal(before.videoWidth,320);assert.equal(before.videoHeight,180);
     assert.equal(before.videoFps,60);
     assert.ok(before.videoFrames>=70);
     assert.equal(before.alreadyProcessed,false);
     const result=await addForgeInsideMdatFile(original);
     const outputBytes=Buffer.from(await result.output.arrayBuffer());
     writeFileSync(dest,outputBytes);
     const after=await inspectForgeReadyFile(new File([outputBytes],'result.'+kind));
     assert.equal(after.alreadyProcessed,true);
     assert.equal(after.videoWidth,before.videoWidth);
     assert.equal(after.videoHeight,before.videoHeight);
     assert.equal(after.videoFps,before.videoFps);
     assert.equal(after.videoFrames,before.videoFrames);
     assert.equal(after.audioTrackCount,before.audioTrackCount+1);
     assert.equal(result.report.addedTailPackets,TAIL_COUNT);
     assert.equal(result.report.tailOutsideMdat,false);
     const inputStreams=allStreams(input),outStreams=allStreams(dest);
     assert.equal(inputStreams.length+1,outStreams.length);
     for(let i=0;i<inputStreams.length;i++)assert.deepEqual(outStreams[i],inputStreams[i],
       'Original stream metadata '+i+' changed.');
     for (const stream of ['v:0','a:0']) assert.deepEqual(ffprobe(dest,stream),ffprobe(input,stream),
       'Original '+stream+' packet data/timestamps changed.');
     execFileSync('ffmpeg',['-v','error','-xerror','-i',dest,
       '-map','0:v:0','-f','null','-'],{timeout:120000});
     execFileSync('ffmpeg',['-v','error','-xerror','-i',dest,
       '-map','0:a:0','-f','null','-'],{timeout:120000});
     const double=await addForgeInsideMdatFile(new File([outputBytes],'result.'+kind));
     assert.equal(double.report.alreadyProcessed,true);
     assert.equal(double.output.size,outputBytes.length);
     // Existing legacy outside-mdat variant is still detected without duplication.
     const legacy=await addForgeLikeTrackFile(original);
     assert.equal((await inspectForgeReadyFile(new File([await legacy.output.arrayBuffer()],'legacy.'+kind))).alreadyProcessed,true);
   });
}
