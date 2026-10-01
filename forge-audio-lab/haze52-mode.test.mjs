import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {HAZE52_PRESET,inspectHaze52Source,copyPrimaryAacPacketsExact} from './haze52-mode.mjs';

function fakeLibrary({videoCodec='hevc',audioCodec='aac',fps=120,width=3840,height=2160}={}){
 const video={
  getCodec:async()=>videoCodec,
  getCodedWidth:async()=>width,
  getCodedHeight:async()=>height,
  computeDuration:async()=>6.4,
  computeFrameRateMetrics:async()=>({bestGuessFrameRate:fps}),
  getColorSpace:async()=>({transfer:'bt709',primaries:'bt709',matrix:'bt709'}),
  canDecode:async()=>true,
 };
 const audio={getCodec:async()=>audioCodec};
 class BlobSource{constructor(file){this.file=file;}}
 class Input{
  constructor(opts){this.opts=opts;}
  async getPrimaryVideoTrack(){return video;}
  async getPrimaryAudioTrack(){return audio;}
 }
 class Quality{constructor(opts){this.opts=opts;}}
 return {
  ALL_FORMATS:{},BlobSource,Input,Quality,
  canEncodeVideo:async(codec,config)=>{
   assert.equal(codec,'avc');
   assert.equal(config.width,width);assert.equal(config.height,height);assert.equal(config.frameRate,30);
   assert.equal(config.quality.opts.bitrate,25_000_000);
   return true;
  },
 };
}

test('Haze 5.2 preset matches analyzed Haze file target',()=>{
 assert.equal(HAZE52_PRESET.frameRate,30);
 assert.equal(HAZE52_PRESET.videoBitrate,25_000_000);
 assert.ok(Math.abs(HAZE52_PRESET.keyFrameInterval-29/30)<1e-12);
 assert.equal(HAZE52_PRESET.outputCodec,'avc');
 assert.equal(HAZE52_PRESET.encoderTag,'Haze Quality Method https://hazemethod.xyz');
});

test('HEVC high-frame-rate source is marked for AVC30 transcode while AAC stays eligible',async()=>{
 const M=fakeLibrary();
 const f=new File([new Uint8Array(1024)],'iphone.mov',{type:'video/quicktime'});
 const info=await inspectHaze52Source(f,M);
 assert.equal(info.codec,'hevc');assert.equal(info.audioCodec,'aac');
 assert.equal(info.width,3840);assert.equal(info.height,2160);
 assert.equal(info.frameRate,120);assert.equal(info.requiresTranscode,true);
 assert.equal(info.colorTransfer,'bt709');
});

test('existing AVC 30 source is eligible for stream-copy video path',async()=>{
 const M=fakeLibrary({videoCodec:'avc',fps:30});
 const f=new File([new Uint8Array(1024)],'avc.mp4',{type:'video/mp4'});
 const info=await inspectHaze52Source(f,M);
 assert.equal(info.requiresTranscode,false);
});

test('non-AAC primary audio is rejected to preserve the Haze AAC-copy invariant',async()=>{
 const M=fakeLibrary({audioCodec:'opus'});
 const f=new File([new Uint8Array(1024)],'bad.mp4',{type:'video/mp4'});
 await assert.rejects(inspectHaze52Source(f,M),/الصوت الأصلي مو AAC/);
});

test('manual AAC mux path forwards exact packets and decoder config without transcoding',async()=>{
 const packets=[
  {data:new Uint8Array([1,2,3]),timestamp:0,duration:0.021333,type:'key'},
  {data:new Uint8Array([4,5]),timestamp:0.021333,duration:0.021333,type:'key'},
 ];
 const decoderConfig={codec:'mp4a.40.2',numberOfChannels:2,sampleRate:48000,description:new Uint8Array([17,144])};
 const track={getDecoderConfig:async()=>decoderConfig};
 class EncodedPacketSink{
  constructor(t){assert.equal(t,track);}
  async *packets(){for(const p of packets)yield p;}
 }
 const added=[];let closed=false;
 const source={
  async add(packet,meta){added.push({packet,meta});},
  close(){closed=true;},
 };
 const result=await copyPrimaryAacPacketsExact({EncodedPacketSink},track,source);
 assert.equal(result.count,2);
 assert.equal(result.total,5);
 assert.equal(closed,true);
 assert.equal(added[0].packet,packets[0]);
 assert.equal(added[1].packet,packets[1]);
 assert.deepEqual(added[0].meta,{decoderConfig});
 assert.equal(added[1].meta,undefined);
});

test('composable Haze conversion owns no tags; metadata is cleared on Output before start',()=>{
 const src=readFileSync(new URL('./haze52-mode.mjs',import.meta.url),'utf8');
 const init=src.slice(src.indexOf('const conversion=await M.Conversion.init'),src.indexOf('if(!conversion.utilizedTracks'));
 assert.doesNotMatch(init,/tags\s*:/);
 const set=src.indexOf('output.setMetadataTags({})');
 const start=src.indexOf('await output.start()');
 assert.ok(set>0&&start>set,'metadata must be set directly on Output before start');
});

test('public UI exposes only the stable Haze optimizer path',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/createHaze52Replica/);
 assert.match(html,/تحسين الفيديو/);
 assert.doesNotMatch(html,/modeOriginal|modeToday|Original \+ X9|Today Reference/);
 assert.doesNotMatch(html,/forge-track\.mjs|today-mode\.mjs/);
});

test('polished public UI keeps the workflow simple and mobile-safe',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/id="previewVideo"/);
 assert.match(html,/id="step1"/);
 assert.match(html,/id="step4"/);
 assert.match(html,/id="newVideo"/);
 assert.match(html,/playsinline/);
 assert.match(html,/prefers-reduced-motion/);
 assert.match(html,/المعالجة تتم على جهازك/);
 assert.doesNotMatch(html,/modeOriginal|modeToday|Original \+ X9|Today Reference/);
});

test('HAMODYBR Video product shell has manifest, accessible progress and no experiment UI',()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('./manifest.webmanifest',import.meta.url),'utf8'));
 const icon=readFileSync(new URL('./app-icon.svg',import.meta.url),'utf8');
 assert.match(html,/<title>HAMODYBR Video<\/title>/);
 assert.match(html,/rel="manifest"/);
 assert.match(html,/role="progressbar"/);
 assert.match(html,/aria-live="polite"/);
 assert.match(html,/dragenter/);
 assert.match(html,/inspectFile/);
 assert.equal(manifest.name,'HAMODYBR Video');
 assert.equal(manifest.display,'standalone');
 assert.match(icon,/<svg/);
 assert.doesNotMatch(html,/Original \+ X9|Today Reference|Haze 5\.2 Replica/);
});
