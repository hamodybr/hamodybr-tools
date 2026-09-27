// HAMODYBR Today Reference Mode — experimental browser transcode.
// Goal: approximate the observed Today.MP4 video/audio characteristics before
// applying the separate Dynamic X9 Forge container patch. This mode intentionally
// re-encodes; use Original mode when packet-for-packet preservation is required.
const MEDIABUNNY_URL='https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';

export const TODAY_PRESET=Object.freeze({
  width:1080,
  height:1920,
  frameRate:60000/1001,
  videoBitrate:34_000_000,
  keyFrameInterval:0.5,
  audioSampleRate:44_100,
  audioBitrate:320_000,
  audioChannels:2,
  outputCodec:'avc',
  audioCodec:'aac',
});

const MAX_INPUT_MOBILE=260*1024*1024;
const MAX_INPUT_DESKTOP=600*1024*1024;
const MAX_DURATION_SECONDS=60;

function fail(message){throw new Error(message);}
function isMobile(){
  return /iPhone|iPad|iPod/i.test(typeof navigator==='undefined'?'':navigator.userAgent);
}
function makeCanvas(width,height){
  let canvas;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(width,height);
  else if(typeof document!=='undefined'){
    canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  }else fail('Today Mode needs a browser canvas.');
  const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'})||canvas.getContext('2d',{alpha:false});
  if(!ctx)fail('Safari could not create the SDR canvas.');
  return {canvas,ctx};
}
async function loadLibrary(library=null){
  if(library)return library;
  try{return await import(MEDIABUNNY_URL);}
  catch{fail('تعذّر تحميل محرّك Today Mode. تأكد من الإنترنت وحاول مرة ثانية.');}
}
function transferLabel(color){
  const t=String(color?.transfer||'').toLowerCase();
  if(!t)return 'unknown';
  return t;
}
function primariesLabel(color){
  return String(color?.primaries||'unknown').toLowerCase();
}

export async function inspectTodaySource(file,library=null){
  if(!file||typeof file.size!=='number')fail('اختار فيديو MOV أو MP4.');
  const max=isMobile()?MAX_INPUT_MOBILE:MAX_INPUT_DESKTOP;
  if(file.size>max)fail('حجم الملف كبير على Today Mode المحلي: '+Math.round(file.size/1048576)+'MB. الحد الحالي '+Math.round(max/1048576)+'MB.');
  const M=await loadLibrary(library);
  const input=new M.Input({formats:M.ALL_FORMATS,source:new M.BlobSource(file)});
  const video=await input.getPrimaryVideoTrack();
  const audio=await input.getPrimaryAudioTrack();
  if(!video)fail('ما لقينا مسار فيديو.');
  if(!audio)fail('Today Mode يحتاج مسار صوت حتى ننتج AAC 44.1kHz مطابق للتجربة.');
  const codec=await video.getCodec();
  const audioCodec=await audio.getCodec();
  const width=await video.getCodedWidth();
  const height=await video.getCodedHeight();
  const duration=await video.computeDuration();
  const color=await video.getColorSpace();
  const frameRate=await video.computePacketStats?.().then?.(x=>x?.averagePacketRate).catch?.(()=>null);
  if(!Number.isFinite(duration)||duration<=0)fail('مدة الفيديو غير صالحة.');
  if(duration>MAX_DURATION_SECONDS)fail('Today Mode الحالي محدود إلى '+MAX_DURATION_SECONDS+' ثانية لحماية ذاكرة الآيفون.');
  if(!(await video.canDecode()))fail('Safari على هذا الجهاز ما يقدر يفك ترميز فيديو '+codec+'.');
  const videoQuality=new M.Quality({bitrate:TODAY_PRESET.videoBitrate,bitrateMode:'constant'});
  const audioQuality=new M.Quality({bitrate:TODAY_PRESET.audioBitrate,bitrateMode:'constant'});
  const canVideo=await M.canEncodeVideo('avc',{
    width:TODAY_PRESET.width,height:TODAY_PRESET.height,frameRate:TODAY_PRESET.frameRate,
    quality:videoQuality,hardwareAcceleration:'prefer-hardware',
  });
  if(!canVideo)fail('Safari ما يدعم H.264 1080×1920 ~60fps بهذا الإعداد على جهازك.');
  const canAudio=await M.canEncodeAudio('aac',{
    numberOfChannels:TODAY_PRESET.audioChannels,sampleRate:TODAY_PRESET.audioSampleRate,
    quality:audioQuality,
  });
  if(!canAudio)fail('Safari ما يدعم AAC 44.1kHz المطلوب على جهازك.');
  return {
    codec,audioCodec,width,height,duration,
    colorTransfer:transferLabel(color),colorPrimaries:primariesLabel(color),
    frameRate:Number.isFinite(frameRate)?frameRate:null,
    inputBytes:file.size,
    preset:TODAY_PRESET,
  };
}

export async function createTodayReferenceFile(file,onProgress=()=>{},library=null){
  const M=await loadLibrary(library);
  const inspected=await inspectTodaySource(file,M);
  const input=new M.Input({formats:M.ALL_FORMATS,source:new M.BlobSource(file)});
  const target=new M.BufferTarget();
  const output=new M.Output({
    format:new M.Mp4OutputFormat({fastStart:'in-memory'}),
    target,
  });
  const videoQuality=new M.Quality({bitrate:TODAY_PRESET.videoBitrate,bitrateMode:'constant'});
  const audioQuality=new M.Quality({bitrate:TODAY_PRESET.audioBitrate,bitrateMode:'constant'});
  let raster=null;
  const process=(sample)=>{
    if(!raster)raster=makeCanvas(TODAY_PRESET.width,TODAY_PRESET.height);
    raster.ctx.clearRect(0,0,TODAY_PRESET.width,TODAY_PRESET.height);
    sample.draw(raster.ctx,0,0,TODAY_PRESET.width,TODAY_PRESET.height);
    return raster.canvas;
  };
  const conversion=await M.Conversion.init({
    input,output,tracks:'primary',copy:false,showWarnings:false,
    video:{
      codec:'avc',
      width:TODAY_PRESET.width,
      height:TODAY_PRESET.height,
      fit:'cover',
      allowTransformationMetadata:false,
      frameRate:TODAY_PRESET.frameRate,
      bitrate:videoQuality,
      keyFrameInterval:TODAY_PRESET.keyFrameInterval,
      hardwareAcceleration:'prefer-hardware',
      forceTranscode:true,
      process,
      processedWidth:TODAY_PRESET.width,
      processedHeight:TODAY_PRESET.height,
    },
    audio:{
      codec:'aac',
      numberOfChannels:TODAY_PRESET.audioChannels,
      sampleRate:TODAY_PRESET.audioSampleRate,
      bitrate:audioQuality,
      forceTranscode:true,
    },
  });
  if(!conversion.isValid)fail('Today Mode ما قدر يبني مسار التحويل على هذا الجهاز.');
  conversion.onProgress=f=>onProgress(Math.max(0,Math.min(1,f)));
  await conversion.execute();
  if(!target.buffer?.byteLength)fail('Today Mode ما أنتج ملف MP4.');
  const basename=(file.name||'video').replace(/\.(mov|mp4)$/i,'');
  const result=new File([target.buffer],(basename||'video')+'-HAMODYBR-TODAY-BASE.mp4',{type:'video/mp4'});
  onProgress(1);
  return {
    file:result,
    report:{
      inputBytes:file.size,
      outputBytes:result.size,
      inputCodec:inspected.codec,
      inputTransfer:inspected.colorTransfer,
      outputWidth:TODAY_PRESET.width,
      outputHeight:TODAY_PRESET.height,
      targetFrameRate:TODAY_PRESET.frameRate,
      targetVideoBitrate:TODAY_PRESET.videoBitrate,
      keyFrameInterval:TODAY_PRESET.keyFrameInterval,
      targetAudioRate:TODAY_PRESET.audioSampleRate,
      targetAudioBitrate:TODAY_PRESET.audioBitrate,
      toneMapMethod:'browser-srgb-canvas',
      note:'B-frame layout and exact encoder profile are browser-controlled and may differ from Today.MP4.',
    },
  };
}
