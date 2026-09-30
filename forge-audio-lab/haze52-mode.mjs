// HAMODYBR Haze 5.2 Replica Mode.
// Stage 1: clean faststart MP4, H.264 30fps ~25 Mbps when transcoding is required,
//          primary AAC copied without re-encoding.
// Stage 2: Dynamic X9 decoy audio outside mdat.
// Stage 3: Haze-like container fingerprint (unknown mvhd duration, metadata strip,
//          isom/iso2/avc1/mp41 brands, encoder tag, free box before synthetic tail).

import {addForgeDynamicOutsideMdatFile,inspectForgeReadyFile} from './forge-track.mjs';
import {applyHaze52ContainerPatch,HAZE_ENCODER_TAG} from './haze52-patch.mjs';

const MEDIABUNNY_URL='https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';

export const HAZE52_PRESET=Object.freeze({
  frameRate:30,
  videoBitrate:25_000_000,
  keyFrameInterval:29/30,
  outputCodec:'avc',
  encoderTag:HAZE_ENCODER_TAG,
});

const MAX_INPUT_MOBILE=300*1024*1024;
const MAX_INPUT_DESKTOP=800*1024*1024;
const MAX_DURATION_SECONDS=120;

function fail(msg){throw new Error(msg);}
function mobile(){
  return /iPhone|iPad|iPod/i.test(typeof navigator==='undefined'?'':navigator.userAgent);
}
async function library(M=null){
  if(M)return M;
  try{return await import(MEDIABUNNY_URL);}
  catch{fail('تعذّر تحميل محرّك Haze Replica. تأكد من الإنترنت وحاول مرة ثانية.');}
}
async function packetHash(M,track){
  let hash=2166136261,total=0,count=0;
  const sink=new M.EncodedPacketSink(track);
  for await(const p of sink.packets()){
    for(const b of p.data)hash=Math.imul(hash^b,16777619)>>>0;
    total+=p.data.byteLength;count++;
  }
  return {hash,total,count,key:hash+':'+total+':'+count};
}
export async function copyPrimaryAacPacketsExact(M,sourceAudio,audioSource,onPacket=()=>{}){
  const decoderConfig=await sourceAudio.getDecoderConfig();
  if(!decoderConfig||!decoderConfig.codec||!decoderConfig.numberOfChannels||!decoderConfig.sampleRate)
    fail('تعذر قراءة AAC decoder config الأصلي.');
  const sink=new M.EncodedPacketSink(sourceAudio);
  let count=0,total=0,hash=2166136261,first=true;
  for await(const packet of sink.packets()){
    const meta=first?{decoderConfig}:undefined;
    await audioSource.add(packet,meta);
    first=false;count++;total+=packet.data.byteLength;
    for(const b of packet.data)hash=Math.imul(hash^b,16777619)>>>0;
    onPacket(count);
  }
  if(!count)fail('AAC الأصلي ما يحتوي packets.');
  audioSource.close();
  return {hash,total,count,key:hash+':'+total+':'+count,decoderConfig};
}
async function frameRateOf(video){
  try{return (await video.computeFrameRateMetrics()).bestGuessFrameRate;}
  catch{return null;}
}
function isAvc(codec){return codec==='avc';}
function isAac(codec){return codec==='aac';}
function colorLabel(c,k){return String(c?.[k]||'unknown').toLowerCase();}

export async function inspectHaze52Source(file,M=null){
  if(!file||typeof file.size!=='number')fail('اختار MOV أو MP4.');
  const max=mobile()?MAX_INPUT_MOBILE:MAX_INPUT_DESKTOP;
  if(file.size>max)fail('حجم الملف '+Math.round(file.size/1048576)+'MB أكبر من حد Haze Replica المحلي '+Math.round(max/1048576)+'MB.');
  M=await library(M);
  const input=new M.Input({formats:M.ALL_FORMATS,source:new M.BlobSource(file)});
  const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
  if(!video)fail('ما لقينا مسار فيديو.');
  if(!audio)fail('Haze Replica يحتاج AAC أصلي حتى يحافظ عليه ويصنع الـdecoy.');
  const codec=await video.getCodec(),audioCodec=await audio.getCodec();
  if(!isAac(audioCodec))fail('الصوت الأصلي مو AAC؛ هذا الوضع ما يعيد ترميز الصوت حتى يبقى مطابق.');
  if(!['avc','hevc'].includes(codec))fail('الفيديو لازم H.264 أو HEVC.');
  const width=await video.getCodedWidth(),height=await video.getCodedHeight();
  const duration=await video.computeDuration(),fps=await frameRateOf(video),color=await video.getColorSpace();
  if(!Number.isFinite(duration)||duration<=0||duration>MAX_DURATION_SECONDS)fail('مدة الفيديو غير مناسبة لهذا الاختبار.');
  if(!(await video.canDecode()))fail('هذا الجهاز ما يقدر يفك ترميز '+codec+' لهذا الفيديو.');
  const requiresTranscode=!isAvc(codec)||!Number.isFinite(fps)||Math.abs(fps-30)>0.01;
  if(requiresTranscode){
    const quality=new M.Quality({bitrate:HAZE52_PRESET.videoBitrate,bitrateMode:'constant'});
    const can=await M.canEncodeVideo('avc',{
      width,height,frameRate:30,quality,hardwareAcceleration:'prefer-hardware',
    });
    if(!can)fail('هذا الجهاز ما يدعم H.264 '+width+'×'+height+' 30fps بهذا الإعداد.');
  }
  return {
    codec,audioCodec,width,height,duration,frameRate:fps,requiresTranscode,
    colorTransfer:colorLabel(color,'transfer'),
    colorPrimaries:colorLabel(color,'primaries'),
    colorMatrix:colorLabel(color,'matrix'),
    inputBytes:file.size,
  };
}

export async function createHaze52Replica(file,onProgress=()=>{},M=null){
  M=await library(M);
  const info=await inspectHaze52Source(file,M);
  const input=new M.Input({formats:M.ALL_FORMATS,source:new M.BlobSource(file)});
  const sourceVideo=await input.getPrimaryVideoTrack(),sourceAudio=await input.getPrimaryAudioTrack();
  const sourceAudioHash=await packetHash(M,sourceAudio);
  const sourceVideoHash=!info.requiresTranscode?await packetHash(M,sourceVideo):null;

  const target=new M.BufferTarget();
  const output=new M.Output({
    format:new M.Mp4OutputFormat({fastStart:'in-memory'}),
    target,
  });
  const videoQuality=new M.Quality({bitrate:HAZE52_PRESET.videoBitrate,bitrateMode:'constant'});
  const videoOptions=info.requiresTranscode?{
    codec:'avc',
    frameRate:HAZE52_PRESET.frameRate,
    bitrate:videoQuality,
    keyFrameInterval:HAZE52_PRESET.keyFrameInterval,
    hardwareAcceleration:'prefer-hardware',
    forceTranscode:true,
    allowTransformationMetadata:true,
  }:undefined;

  // IMPORTANT: Conversion never owns the AAC track. Even a "copy" conversion can
  // normalize AAC packet boundaries. Haze's analyzed output preserved every primary
  // AAC packet payload, so we drive the AAC output track manually packet-by-packet.
  const conversion=await M.Conversion.init({
    input,output,tracks:'primary',
    copy:{mode:'preferred',shiftTolerance:0},
    video:videoOptions,
    audio:{discard:true},
    showWarnings:false,
    composable:true,
  });
  if(!conversion.utilizedTracks.includes(sourceVideo))
    fail('تعذر بناء مسار الفيديو لـ Haze Replica.');
  if(conversion.discardedTracks.some(x=>x.track===sourceVideo))
    fail('المحرك حاول يحذف الفيديو؛ أوقفنا العملية.');

  const decoderConfig=await sourceAudio.getDecoderConfig();
  if(!decoderConfig)fail('تعذر قراءة AAC decoder config الأصلي.');
  const exactAudioSource=new M.EncodedAudioPacketSource('aac');
  output.addAudioTrack(exactAudioSource,{
    decoderConfig,
    languageCode:await sourceAudio.getLanguageCode(),
    disposition:await sourceAudio.getDisposition(),
  });
  // A composable Conversion cannot own metadata. Clear source metadata directly
  // on the Output before start(), matching Haze's clean-container stage.
  output.setMetadataTags({});

  conversion.onProgress=f=>onProgress(Math.max(0,Math.min(0.62,f*0.62)),'refinery');
  await output.start();
  const audioCopyPromise=copyPrimaryAacPacketsExact(M,sourceAudio,exactAudioSource,count=>{
    if((count&31)===0)onProgress(0.64,'aac-copy');
  });
  const [audioCopy] = await Promise.all([
    audioCopyPromise,
    conversion.execute(),
  ]);
  if(audioCopy.key!==sourceAudioHash.key)
    fail('AAC packet-copy الداخلي ما طابق المصدر؛ تم إيقاف Haze Replica.');
  await output.finalize();
  if(!target.buffer?.byteLength)fail('Refinery ما أنتج MP4.');

  const baseName=(file.name||'video').replace(/\.(mov|mp4)$/i,'');
  const base=new File([target.buffer],(baseName||'video')+'-HAZE52-BASE.mp4',{type:'video/mp4'});

  // Verify the base: H.264 + exact primary AAC packet payloads. For pre-existing
  // H.264/30 input, video packets must also be exact.
  const check=new M.Input({formats:M.ALL_FORMATS,source:new M.BlobSource(base)});
  const outVideo=await check.getPrimaryVideoTrack(),outAudio=await check.getPrimaryAudioTrack();
  if(!outVideo||await outVideo.getCodec()!=='avc')fail('Refinery output مو H.264.');
  if(!outAudio||await outAudio.getCodec()!=='aac')fail('Refinery output فقد AAC.');
  const outAudioHash=await packetHash(M,outAudio);
  if(outAudioHash.key!==sourceAudioHash.key)fail('AAC الأصلي ما طابق بعد التغليف اليدوي؛ تم إيقاف Haze Replica.');
  if(sourceVideoHash){
    const outVideoHash=await packetHash(M,outVideo);
    if(outVideoHash.key!==sourceVideoHash.key)fail('H.264 الأصلي تغيّر رغم أن المفروض Stream Copy.');
  }

  onProgress(0.72,'x9');
  const baseForgeInfo=await inspectForgeReadyFile(base);
  const forged=await addForgeDynamicOutsideMdatFile(base);
  if(forged.report.addedTailPackets!==baseForgeInfo.samples*9)
    fail('Dynamic X9 count mismatch.');

  onProgress(0.88,'container');
  const patched=await applyHaze52ContainerPatch(forged.output,{
    tailPackets:forged.report.addedTailPackets,
    encoderTag:HAZE52_PRESET.encoderTag,
  });
  onProgress(1,'done');

  const finalFile=new File(
    [patched.output],
    (baseName||'video')+'-HAMODYBR-HAZE52-REPLICA.mp4',
    {type:'video/mp4'}
  );
  return {file:finalFile,report:{
    ...patched.report,
    inputCodec:info.codec,
    inputFrameRate:info.frameRate,
    width:info.width,height:info.height,
    videoTranscoded:info.requiresTranscode,
    targetFrameRate:info.requiresTranscode?30:info.frameRate,
    targetVideoBitrate:info.requiresTranscode?HAZE52_PRESET.videoBitrate:null,
    keyFrameInterval:info.requiresTranscode?HAZE52_PRESET.keyFrameInterval:null,
    sourceAacPackets:sourceAudioHash.count,
    sourceAacBytes:sourceAudioHash.total,
    aacPacketPayloadsPreserved:true,
    dynamicDecoySamples:baseForgeInfo.samples*10,
    declaredTotalAudioSamples:baseForgeInfo.samples*11,
    outputBytes:finalFile.size,
    note:'Exact H.264 profile/B-frame decisions are controlled by the browser hardware encoder when transcoding is required.',
  }};
}
