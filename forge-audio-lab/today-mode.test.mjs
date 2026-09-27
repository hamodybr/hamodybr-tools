import test from 'node:test';
import assert from 'node:assert/strict';
import {File as NodeFile} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {TODAY_PRESET,inspectTodaySource,createTodayReferenceFile} from './today-mode.mjs';

globalThis.File ??= NodeFile;

function fakeLibrary(capture={}){
  const video={
    getCodec:async()=> 'hevc',
    getCodedWidth:async()=>2160,
    getCodedHeight:async()=>3840,
    computeDuration:async()=>12,
    getColorSpace:async()=>({transfer:'arib-std-b67',primaries:'bt2020'}),
    computeFrameRateMetrics:async()=>({bestGuessFrameRate:60}),
    canDecode:async()=>true,
  };
  const audio={getCodec:async()=> 'aac'};
  class BlobSource{constructor(file){this.file=file;}}
  class Input{
    constructor(opts){this.opts=opts;}
    async getPrimaryVideoTrack(){return video;}
    async getPrimaryAudioTrack(){return audio;}
  }
  class Quality{constructor(opts){this.opts=opts;}}
  class BufferTarget{constructor(){this.buffer=null;}}
  class Mp4OutputFormat{constructor(opts){this.opts=opts;}}
  class Output{
    constructor(opts){this.opts=opts;this.target=opts.target;capture.output=this;}
  }
  const Conversion={
    async init(opts){
      capture.options=opts;
      return {
        isValid:true,
        onProgress:null,
        async execute(){
          opts.output.target.buffer=new Uint8Array([1,2,3,4]).buffer;
          this.onProgress?.(1);
        },
      };
    },
  };
  return {
    ALL_FORMATS:{},BlobSource,Input,Quality,BufferTarget,Mp4OutputFormat,Output,Conversion,
    canEncodeVideo:async(codec,config)=>{capture.canVideo={codec,config};return true;},
    canEncodeAudio:async(codec,config)=>{capture.canAudio={codec,config};return true;},
  };
}

test('Today preset matches the observed reference target',()=>{
  assert.equal(TODAY_PRESET.width,1080);
  assert.equal(TODAY_PRESET.height,1920);
  assert.ok(Math.abs(TODAY_PRESET.frameRate-59.94005994)<0.0001);
  assert.equal(TODAY_PRESET.videoBitrate,34_000_000);
  assert.equal(TODAY_PRESET.keyFrameInterval,0.5);
  assert.equal(TODAY_PRESET.audioSampleRate,44_100);
  assert.equal(TODAY_PRESET.audioBitrate,320_000);
  assert.equal(TODAY_PRESET.audioChannels,2);
});

test('Today source inspection checks device capability without mutating source',async()=>{
  const capture={},M=fakeLibrary(capture);
  const source=new NodeFile([new Uint8Array(1024)],'iphone.mov',{type:'video/quicktime'});
  const info=await inspectTodaySource(source,M);
  assert.equal(info.codec,'hevc');
  assert.equal(info.audioCodec,'aac');
  assert.equal(info.width,2160);
  assert.equal(info.height,3840);
  assert.equal(info.frameRate,60);
  assert.equal(info.colorTransfer,'arib-std-b67');
  assert.equal(capture.canVideo.codec,'avc');
  assert.equal(capture.canVideo.config.width,1080);
  assert.equal(capture.canVideo.config.height,1920);
  assert.equal(capture.canAudio.codec,'aac');
  assert.equal(capture.canAudio.config.sampleRate,44100);
});

test('Today conversion requests the exact reference targets before X9',async()=>{
  const capture={},M=fakeLibrary(capture);
  const source=new NodeFile([new Uint8Array(2048)],'iphone.mov',{type:'video/quicktime'});
  let last=0;
  const result=await createTodayReferenceFile(source,n=>{last=n;},M);
  assert.equal(last,1);
  assert.equal(result.file.name,'iphone-HAMODYBR-TODAY-BASE.mp4');
  const v=capture.options.video,a=capture.options.audio;
  assert.equal(capture.options.copy,false);
  assert.equal(capture.options.tracks,'primary');
  assert.equal(v.codec,'avc');
  assert.equal(v.width,1080);
  assert.equal(v.height,1920);
  assert.equal(v.fit,'cover');
  assert.equal(v.frameRate,TODAY_PRESET.frameRate);
  assert.equal(v.keyFrameInterval,0.5);
  assert.equal(v.forceTranscode,true);
  assert.equal(v.allowTransformationMetadata,false);
  assert.equal(v.processedWidth,1080);
  assert.equal(v.processedHeight,1920);
  assert.equal(v.bitrate.opts.bitrate,34_000_000);
  assert.equal(a.codec,'aac');
  assert.equal(a.sampleRate,44_100);
  assert.equal(a.numberOfChannels,2);
  assert.equal(a.forceTranscode,true);
  assert.equal(a.bitrate.opts.bitrate,320_000);
});

test('public lab exposes both modes and keeps X9 outside mdat',()=>{
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/Original \+ X9/);
  assert.match(html,/Today Reference/);
  assert.match(html,/createTodayReferenceFile/);
  assert.match(html,/addForgeDynamicOutsideMdatFile/);
  assert.match(html,/X9 خارج mdat/);
});
