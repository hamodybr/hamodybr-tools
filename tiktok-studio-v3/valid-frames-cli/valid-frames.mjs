#!/usr/bin/env node
/**
 * HAMODYBR Valid Frames proof of concept.
 * Produces actual H.264 picture samples, not MP4 pseudo-samples.
 * Requires a locally installed FFmpeg/FFprobe. Does not bypass TikTok processing.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const [key, inlineValue] = argv[i].split('=', 2);
    if (!key.startsWith('--')) throw new Error('Unknown argument: ' + key);
    out[key.slice(2)] = inlineValue ?? argv[++i];
  }
  if (!out.input || !out.output) throw new Error('Usage: node valid-frames.mjs --input input.mp4 --output output.mp4 [--mode duplicate|interpolate] [--height 1080|720|original] [--seconds 2] [--crf 17]');
  const mode = out.mode ?? 'duplicate', height = out.height ?? 'original';
  if (!['duplicate', 'interpolate'].includes(mode)) throw new Error('Mode must be duplicate or interpolate');
  if (!['original', '1080', '720'].includes(height)) throw new Error('Height must be original, 1080 or 720');
  const seconds = out.seconds === undefined ? null : Number(out.seconds);
  if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)) throw new Error('Seconds must be 0 < seconds <= 120');
  const crf = Number(out.crf ?? 17);
  if (!Number.isInteger(crf) || crf < 0 || crf > 25) throw new Error('CRF must be an integer between 0 and 25');
  return { input: resolve(out.input), output: resolve(out.output), mode, height, seconds, crf };
}
function command(binary, args, { quiet = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => {
      stderr += b;
      if (!quiet && stderr.length < 5000 && String(b).includes('Error')) process.stderr.write(b);
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(binary + ' exited ' + code + ': ' + stderr.slice(-4000))));
  });
}
const probe = async path => JSON.parse((await command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { quiet: true })).stdout);
const nearly = (a, b, tolerance = 0.07) => Math.abs(a - b) <= tolerance;
const ratio = value => {
  if (!value || value === '0/0') return 0;
  const [n, d] = value.split('/').map(Number);
  return d ? n / d : 0;
};
async function encode(options) {
  const meta = await probe(options.input);
  const video = meta.streams.find(s => s.codec_type === 'video');
  const audio = meta.streams.find(s => s.codec_type === 'audio');
  if (!video) throw new Error('No video stream');
  if (video.codec_name !== 'h264' && video.codec_name !== 'hevc') throw new Error('Only H.264/HEVC source supported');
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer) || ['bt2020'].includes(video.color_primaries))
    throw new Error('HDR input is intentionally blocked: this SDR-only pipeline must not silently change HDR colors');
  if (!['yuv420p', 'yuvj420p'].includes(video.pix_fmt)) throw new Error('Only 8-bit 4:2:0 input supported in this first milestone');
  const fps = ratio(video.avg_frame_rate);
  if (!fps || fps > 60.001) throw new Error('Unsupported source frame rate');
  if (options.input === options.output) throw new Error('Output must not overwrite source');
  const clipDuration = Math.min(options.seconds ?? Number(meta.format.duration), Number(video.duration ?? meta.format.duration));
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) throw new Error('Missing source duration');
  // Refuse synthetic-density input before encoding: do not hide a broken stream.
  try {
    await command('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror',
      '-i', options.input, '-map', '0:v:0', '-f', 'null', '-'], { quiet: true });
  } catch {
    throw new Error('INPUT DECODE FAILED. Use your original camera video or a verified packet-copy A file, not NoBlur, interleaved or trailing output.');
  }
  const targetFrames = Math.round(clipDuration * 60);
  const scale = options.height === 'original' ? '' : 'scale=-2:' + options.height + ':flags=lanczos,';
  const motion = options.mode === 'interpolate'
    ? 'minterpolate=fps=60:mi_mode=mci:mc_mode=obmc:me_mode=bidir:me=epzs:search_param=4:scd=fdiff'
    : 'fps=fps=60:round=near';
  const endFill = options.mode === 'interpolate'
    ? ',tpad=stop_mode=clone:stop_duration=0.20,trim=duration=' + clipDuration.toFixed(6) + ',fps=fps=60:round=near,setpts=PTS-STARTPTS'
    : '';
  const filters = 'setpts=PTS-STARTPTS,' + scale + motion + endFill + ',format=yuv420p';
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', options.input];
  if (options.seconds !== null) args.push('-t', String(options.seconds));
  args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', filters,
    '-r:v:0', '60', '-fps_mode:v:0', 'cfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(options.crf),
    '-pix_fmt', 'yuv420p', '-g', '120', '-video_track_timescale', '60000');
  if (video.color_primaries === 'bt709' && video.color_transfer === 'bt709' && video.color_space === 'bt709')
    args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  args.push('-c:a', audio?.codec_name === 'aac' ? 'copy' : 'aac', '-movflags', '+faststart', options.output);
  await mkdir(dirname(options.output), { recursive: true });
  await command('ffmpeg', args);
  const out = await probe(options.output);
  const v = out.streams.find(s => s.codec_type === 'video'), a = out.streams.find(s => s.codec_type === 'audio');
  const duration = Number(v?.duration), count = Number(v?.nb_frames);
  const checks = {
    codec: v?.codec_name === 'h264',
    frameRate60: nearly(ratio(v?.avg_frame_rate), 60, 0.01),
    frameCount: Number.isInteger(count) && Math.abs(count - targetFrames) <= 2,
    duration: nearly(duration, clipDuration, 0.065),
    dimensions: Number(v?.width) > 0 && Number(v?.height) > 0,
    sourceAudioPreserved: !audio || !!a,
    color: video.color_primaries !== 'bt709' || v.color_primaries === 'bt709',
  };
  let decode = { ok: false, error: null };
  try {
    await command('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror',
      '-i', options.output, '-map', '0:v:0', '-f', 'null', '-'], { quiet: true });
    decode = { ok: true, error: null };
  } catch (error) { decode.error = error.message; }
  const report = {
    created: new Date().toISOString(),
    input: options.input, output: options.output, mode: options.mode,
    inputVideo: { codec: video.codec_name, width: video.width, height: video.height, fps, duration: clipDuration },
    outputVideo: { codec: v?.codec_name, width: v?.width, height: v?.height, fps: ratio(v?.avg_frame_rate), frames: count, duration },
    inputAudio: audio?.codec_name ?? null, outputAudio: a?.codec_name ?? null,
    outputBytes: (await stat(options.output)).size,
    checks, strictVideoDecode: decode,
    valid: Object.values(checks).every(Boolean) && decode.ok,
    note: 'Valid decoded picture frames do not establish that TikTok Public playback will retain quality.'
  };
  await writeFile(options.output.replace(/\.mp4$/i, '') + '.report.json', JSON.stringify(report, null, 2));
  if (!report.valid) { await rm(options.output).catch(() => {}); throw new Error('Validation failed: ' + JSON.stringify(report)); }
  return report;
}
try {
  const opts = parseArgs(process.argv.slice(2));
  await access(opts.input);
  console.log(JSON.stringify(await encode(opts), null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
