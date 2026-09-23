// V3.5 experimental preset. Pure functions, shared by the browser and Node tests.
// Never fabricate HDR signaling or silently tone-map a source.
export const SMOOTH_4K = Object.freeze({ codec: 'hevc', fps: 30, bitrate: 18_600_000, keyFrameInterval: 2 });
const norm = v => String(v ?? '').toLowerCase();
export const isHlg = color => /(^|[^a-z])hlg([^a-z]|$)|arib-std-b67/.test(norm(color?.transfer ?? color?.transferCharacteristics));
export const isBt2020 = color => /2020/.test(norm(color?.primaries ?? color?.colorPrimaries));
export const isMain10 = codec => /^(hvc1|hev1)\.2\./i.test(String(codec ?? ''));
export const fpsNear = (actual, expected, tolerance = .08) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
export function makeSmoothPlan({ width, height, fps, codec, color, preserveFps = false }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width * height !== 3840 * 2160)
    throw new Error('Smooth 4K needs a native 3840×2160 or 2160×3840 source; upscaling is disabled.');
  if (codec !== 'hevc') throw new Error('This HDR preset requires a source HEVC file. Use V3.4 for other codecs.');
  if (!isHlg(color) || !isBt2020(color)) throw new Error('HLG BT.2020 was not confirmed; will not manufacture HDR or silently convert SDR/PQ.');
  if (!Number.isFinite(fps) || fps < 24 || fps > 120) throw new Error('Unsupported source frame rate.');
  if (preserveFps && fps > 60.1) throw new Error('Preserve FPS is limited to 60fps for this experiment.');
  const targetFps = preserveFps ? fps : (fps < 30 ? fps : SMOOTH_4K.fps);
  return { width, height, targetFps, bitrate: SMOOTH_4K.bitrate, codec: SMOOTH_4K.codec, keyFrameInterval: SMOOTH_4K.keyFrameInterval };
}
export function validateSmoothOutput(source, output, plan) {
  const failures = [];
  if (output.codec !== 'hevc') failures.push('HEVC codec');
  if (output.width !== plan.width || output.height !== plan.height) failures.push('4K display resolution');
  if (!fpsNear(output.fps, plan.targetFps)) failures.push('frame rate');
  if (!Number.isFinite(output.duration) || !Number.isFinite(source.duration) ||
      Math.abs(output.duration - source.duration) > Math.max(.25, 2 / plan.targetFps))
    failures.push('real-time duration');
  if (output.rotation !== source.rotation) failures.push('rotation');
  if (!isHlg(output.color) || !isBt2020(output.color)) failures.push('HLG BT.2020 color signaling');
  if (!isMain10(output.decoderCodec)) failures.push('10-bit HEVC Main10 profile');
  if (failures.length) throw new Error('Output safety check failed: ' + failures.join(', ') + '. Original file remains untouched.');
  return true;
}
