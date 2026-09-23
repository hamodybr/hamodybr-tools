// V3.5 experimental presets. Pure policy, shared by browser and Node tests.
// Preserve the detected transfer function; never fabricate HDR or silently tone-map.
export const SMOOTH_4K = Object.freeze({codec:'hevc',fps:30,bitrate:18_600_000,keyFrameInterval:2});
export const COMPAT_4K = Object.freeze({codec:'avc',fps:30,bitrate:22_100_000,keyFrameInterval:2});
const norm = v => String(v ?? '').toLowerCase().trim();
export const isHlg = color => /(^|[^a-z])hlg([^a-z]|$)|arib-std-b67/.test(norm(color?.transfer ?? color?.transferCharacteristics));
export const isBt2020 = color => /2020/.test(norm(color?.primaries ?? color?.colorPrimaries));
export const isBt709 = color => /^(bt709|bt-709|rec709|rec-709)$/.test(norm(color?.primaries ?? color?.colorPrimaries));
export const isSdrTransfer = color => /^(bt709|bt-709|iec61966-2-1|srgb)$/.test(norm(color?.transfer ?? color?.transferCharacteristics));
export const isMain10 = codec => /^(hvc1|hev1)\.2\./i.test(String(codec ?? ''));
export const fpsNear = (actual, expected, tolerance=.08) => Number.isFinite(actual) && Math.abs(actual-expected) <= tolerance;
export function makeSmoothPlan({width,height,fps,codec,color,preserveFps=false}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width*height !== 3840*2160)
    throw new Error('Smooth 4K needs a native 3840×2160 or 2160×3840 source; upscaling is disabled.');
  if (!['hevc','avc'].includes(codec))
    throw new Error('Detected video codec: '+(codec||'unknown')+'. Supports AVC (H.264) or HEVC (H.265) only.');
  const hlg = isHlg(color) && isBt2020(color);
  const sdr = isSdrTransfer(color) && isBt709(color);
  if (!hlg && !sdr) throw new Error('Codec: '+codec+' • primaries: '+(color?.primaries||'unknown')+' • transfer: '+(color?.transfer||'unknown')+'. Neither HLG BT.2020 nor verified SDR BT.709; no automatic tone mapping or invented HDR.');
  if (!Number.isFinite(fps) || fps<24 || fps>120) throw new Error('Unsupported source frame rate.');
  if (preserveFps && fps>60.1) throw new Error('Preserve FPS is limited to 60fps for this experiment.');
  const preset=hlg?SMOOTH_4K:COMPAT_4K;
  return {
    width,height,sourceCodec:codec,colorMode:hlg?'hlg':'sdr',
    targetFps:preserveFps?fps:Math.min(fps,preset.fps),
    bitrate:preset.bitrate,codec:preset.codec,
    keyFrameInterval:preset.keyFrameInterval
  };
}
export function validateSmoothOutput(source,output,plan) {
  const failures=[];
  if(output.codec!==plan.codec) failures.push('expected '+plan.codec+' codec');
  if(output.width!==plan.width || output.height!==plan.height) failures.push('4K display resolution');
  if(!fpsNear(output.fps,plan.targetFps)) failures.push('frame rate');
  if(!Number.isFinite(output.duration) || !Number.isFinite(source.duration) ||
     Math.abs(output.duration-source.duration)>Math.max(.25,2/plan.targetFps)) failures.push('real-time duration');
  if(output.rotation!==source.rotation) failures.push('rotation');
  if(plan.colorMode==='hlg') {
    if(!isHlg(output.color) || !isBt2020(output.color)) failures.push('HLG BT.2020 color signaling');
    if(!isMain10(output.decoderCodec)) failures.push('10-bit HEVC Main10 profile');
  } else if(plan.colorMode==='sdr') {
    if(!isSdrTransfer(output.color) || !isBt709(output.color)) failures.push('SDR BT.709 color signaling');
  } else failures.push('recognized color mode');
  if(failures.length) throw new Error('Output safety check failed: '+failures.join(', ')+'. Original file remains untouched.');
  return true;
}

/** Mediabunny requires fit whenever both explicit output dimensions are supplied.
 * Contain leaves native 4K pixels uncropped; both dimensions match the source.
 */
export function makeVideoConversionOptions(plan, quality) {
  if (!plan || !Number.isInteger(plan.width) || !Number.isInteger(plan.height) ||
      !['hevc','avc'].includes(plan.codec) || !Number.isFinite(plan.targetFps) ||
      !Number.isFinite(plan.keyFrameInterval) || !quality)
    throw new Error('Invalid Smooth 4K conversion configuration.');
  return {
    width: plan.width,
    height: plan.height,
    fit: 'contain',
    frameRate: plan.targetFps,
    codec: plan.codec,
    quality,
    keyFrameInterval: plan.keyFrameInterval,
    hardwareAcceleration: 'prefer-hardware',
    forceTranscode: true
  };
}
