import test from 'node:test';
import assert from 'node:assert/strict';
import {SMOOTH_4K,makeSmoothPlan,validateSmoothOutput,isHlg,isBt2020,isMain10} from './smooth4k-plan.mjs';

const color = {transfer:'hlg',primaries:'bt2020',matrix:'bt2020-ncl'};
const source = {width:3840,height:2160,fps:59.94,codec:'hevc',duration:16.333,rotation:0,color};
const output = {width:3840,height:2160,fps:30,codec:'hevc',duration:16.333,rotation:0,color,decoderCodec:'hvc1.2.4.L153.B0'};
test('B preset is HEVC 4K 30fps and 18.6Mbps, retains real duration',()=>{
  const p=makeSmoothPlan(source);
  assert.equal(p.targetFps,30);
  assert.equal(p.bitrate,18_600_000);
  assert.equal(p.keyFrameInterval,2);
  assert.equal(p.codec,'hevc');
  assert.equal(validateSmoothOutput(source,output,p),true);
});
test('allows portrait 4K and optional source fps without inventing 60fps',()=>{
  const p=makeSmoothPlan({...source,width:2160,height:3840,fps:30});
  assert.equal(p.targetFps,30);
  assert.equal(makeSmoothPlan({...source,fps:25}).targetFps,25);
  assert.equal(makeSmoothPlan({...source,preserveFps:true}).targetFps,59.94);
  assert.throws(()=>makeSmoothPlan({...source,fps:120,preserveFps:true}),/60fps/);
});
test('SDR, PQ, unknown HDR, AVC, upscales rejected',()=>{
  for(const variation of [
    {...source,color:{transfer:'bt709',primaries:'bt709'}},
    {...source,color:{transfer:'pq',primaries:'bt2020'}},
    {...source,color:null},
    {...source,codec:'avc'},
    {...source,width:1920,height:1080}
  ]) assert.throws(()=>makeSmoothPlan(variation));
});
test('output must be Main10 HLG BT.2020 without duration or fps corruption',()=>{
  const p=makeSmoothPlan(source);
  for (const change of [
    {decoderCodec:'hvc1.1.6.L153.B0'},
    {decoderCodec:undefined},
    {color:{transfer:'bt709',primaries:'bt709'}},
    {color:{transfer:'hlg',primaries:'bt709'}},
    {fps:60}, {duration:32.666},{width:1920},{rotation:90},{codec:'avc'}
  ]) assert.throws(()=>validateSmoothOutput(source,{...output,...change},p),/Output safety check failed/);
});
test('transfer and profile identification is strict, no HDR guesswork',()=>{
  assert.equal(isHlg(color),true); assert.equal(isBt2020(color),true);
  assert.equal(isMain10(output.decoderCodec),true);
  assert.equal(isMain10('hvc1.1.6.L153.B0'),false);
  assert.equal(isHlg({transfer:'smpte2084'}),false);
  assert.equal(SMOOTH_4K.fps,30);
});
