import test from 'node:test';
import assert from 'node:assert/strict';
import {SMOOTH_4K,COMPAT_4K,makeSmoothPlan,validateSmoothOutput,isHlg,isBt2020,isMain10} from './smooth4k-plan.mjs';

const hdr = {transfer:'hlg',primaries:'bt2020',matrix:'bt2020-ncl'};
const sdr = {transfer:'bt709',primaries:'bt709',matrix:'bt709'};
const source = {width:3840,height:2160,fps:59.94,codec:'hevc',duration:16.333,rotation:0,color:hdr};
const hdrOutput = {width:3840,height:2160,fps:30,codec:'hevc',duration:16.333,rotation:0,color:hdr,decoderCodec:'hvc1.2.4.L153.B0'};
test('B preset is HEVC 4K 30fps and 18.6Mbps with real duration',()=>{
  const p=makeSmoothPlan(source);
  assert.equal(p.targetFps,30);
  assert.equal(p.bitrate,18_600_000);
  assert.equal(p.keyFrameInterval,2);
  assert.equal(p.codec,'hevc');assert.equal(p.colorMode,'hlg');
  assert.equal(validateSmoothOutput(source,hdrOutput,p),true);
});
test('AVC HLG BT.2020 can enter HEVC B preset without throwing solely for source codec',()=>{
  const src={...source,codec:'avc'};
  const p=makeSmoothPlan(src);
  assert.equal(p.codec,'hevc');
  assert.equal(p.sourceCodec,'avc');
  assert.equal(validateSmoothOutput(src,hdrOutput,p),true);
});
test('AVC or HEVC SDR uses explicit 4K H.264 compatibility without fake HDR',()=>{
  for (const codec of ['avc','hevc']) {
    const src={...source,codec,color:sdr};
    const p=makeSmoothPlan(src);
    assert.equal(p.codec,'avc');assert.equal(p.colorMode,'sdr');
    assert.equal(p.bitrate,22_100_000);
    assert.equal(validateSmoothOutput(src,{...hdrOutput,codec:'avc',decoderCodec:'avc1.640033',color:sdr},p),true);
    assert.throws(()=>validateSmoothOutput(src,hdrOutput,p),/Output safety check failed/);
  }
});
test('preserve source FPS, no invented upscaling, unknown color or PQ conversion',()=>{
  assert.equal(makeSmoothPlan({...source,width:2160,height:3840,fps:30}).targetFps,30);
  assert.equal(makeSmoothPlan({...source,fps:25}).targetFps,25);
  assert.equal(makeSmoothPlan({...source,preserveFps:true}).targetFps,59.94);
  for(const src of [
    {...source,fps:120,preserveFps:true},
    {...source,width:1920,height:1080},
    {...source,codec:'av1'},
    {...source,color:{transfer:'pq',primaries:'bt2020'}},
    {...source,color:null},
    {...source,color:{transfer:'bt709',primaries:'bt2020'}}
  ]) assert.throws(()=>makeSmoothPlan(src));
});
test('HDR output must be Main10 HLG BT.2020 with duration, rotation, FPS verified',()=>{
  const p=makeSmoothPlan(source);
  for(const change of [
    {decoderCodec:'hvc1.1.6.L153.B0'}, {decoderCodec:undefined},
    {color:sdr},{color:{transfer:'hlg',primaries:'bt709'}},
    {fps:60},{duration:32.666},{width:1920},{rotation:90},{codec:'avc'}
  ]) assert.throws(()=>validateSmoothOutput(source,{...hdrOutput,...change},p),/Output safety check failed/);
});
test('no HDR inference from PQ, no Main10 assumption for Main profile',()=>{
  assert.equal(isHlg(hdr),true);assert.equal(isBt2020(hdr),true);
  assert.equal(isMain10(hdrOutput.decoderCodec),true);
  assert.equal(isMain10('hvc1.1.6.L153.B0'),false);
  assert.equal(isHlg({transfer:'smpte2084'}),false);
  assert.equal(SMOOTH_4K.fps,30);
  assert.equal(COMPAT_4K.fps,30);
});
