// Real-media MP4 regression: direct AAC packet copy while video is transcoded.
// Uses a tiny FFmpeg fixture instead of the user's private 4K footage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerMediabunnyServer} from '@mediabunny/server';
import {
  Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,
  EncodedAudioPacketSource,EncodedPacketSink,Quality
} from 'mediabunny';
import {pipeOriginalAac,emptyAacFingerprint,feedAacFingerprint,sameAacFingerprint,aacFingerprintText} from './smooth4k-audio.mjs';
registerMediabunnyServer();

async function fingerprint(track) {
  const result=emptyAacFingerprint();
  for await (const packet of new EncodedPacketSink(track).packets()) feedAacFingerprint(result,packet.data);
  return result;
}
test('FFmpeg AVC+AAC fixture: re-encode picture, copy original AAC packets byte-identically', {timeout:120_000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'smooth4k-aac-'));
  try {
    const path=join(dir,'source.mp4');
    execFileSync('ffmpeg',[
      '-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','testsrc2=size=320x180:rate=30',
      '-f','lavfi','-i','sine=frequency=500:sample_rate=48000',
      '-t','1.5','-c:v','libx264','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','128k','-movflags','+faststart','-shortest',path
    ]);
    const input=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([readFileSync(path)]))});
    const [video,audio]=await Promise.all([input.getPrimaryVideoTrack(),input.getPrimaryAudioTrack()]);
    assert.ok(video && audio);
    const sourceFingerprint=await fingerprint(audio);
    const config=await audio.getDecoderConfig();
    const target=new BufferTarget();
    const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target});
    const conversion=await Conversion.init({
      input,output,tracks:'primary',audio:{discard:true},composable:true,
      video:{width:320,height:180,fit:'contain',codec:'avc',quality:new Quality({bitrate:600_000}),
        frameRate:30,keyFrameInterval:1,hardwareAcceleration:'prefer-software',forceTranscode:true},
      showWarnings:false
    });
    assert.equal(conversion.isValid,true);
    assert.ok(conversion.utilizedTracks.includes(video));
    const aacSource=new EncodedAudioPacketSource('aac');
    output.addAudioTrack(aacSource);
    await output.start();
    const [_,written]=await Promise.all([
      conversion.execute(),
      pipeOriginalAac({track:audio,sinkFactory:t=>new EncodedPacketSink(t).packets(),source:aacSource,decoderConfig:config})
    ]);
    assert.equal(sameAacFingerprint(sourceFingerprint,written),true,
      'Input and manually-fed AAC packets should match');
    await output.finalize();
    assert.ok(target.buffer);
    const result=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([target.buffer]))});
    const [outAudio,outVideo]=await Promise.all([result.getPrimaryAudioTrack(),result.getPrimaryVideoTrack()]);
    assert.ok(outAudio && outVideo);
    const outputFingerprint=await fingerprint(outAudio);
    assert.equal(sameAacFingerprint(sourceFingerprint,outputFingerprint),true,
      'AAC original: '+aacFingerprintText(sourceFingerprint)+'; output: '+aacFingerprintText(outputFingerprint));
    assert.equal(await outVideo.getCodec(),'avc');
    assert.equal(await outAudio.getCodec(),'aac');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
