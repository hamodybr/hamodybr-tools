import {
  Input, Output, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat,
  EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';
import { inspectNormalizedMp4, buildDensity } from './hamodybr-density.js?v=1';

const $ = (id) => document.getElementById(id);
const fileEl = $('densityFile'), sourceEl = $('densitySource'), statusEl = $('densityStatus');
const runBtn = $('densityRun'), resetBtn = $('densityReset'), confirmEl = $('densityConfirm');
const resultEl = $('densityResult'), detailsEl = $('densityDetails');
const shareBtn = $('densityShare'), downloadBtn = $('densityDownload'), progress = $('densityProgress');
let file = null, input = null, video = null, audio = null, metadata = null;
let current = false, resultBlob = null, resultName = '', lastUrl = null, sequence = 0;
const formatSize = (n) => (n / 1048576).toFixed(2) + ' MiB';
const describeError = (e) => e?.message || String(e);
function updateStatus(message, percent = 0) {
  statusEl.textContent = message;
  progress.value = Math.max(0, Math.min(100, percent));
}
function mode() { return Number(document.querySelector('input[name="densityMode"]:checked')?.value || 10); }
function refresh() { runBtn.disabled = current || !metadata || !confirmEl.checked; }
document.querySelectorAll('input[name="densityMode"]').forEach((el) => el.addEventListener('change', refresh));
confirmEl.addEventListener('change', refresh);

fileEl.addEventListener('change', async () => {
  if (current) return;
  const next = fileEl.files?.[0];
  if (!next) return;
  const token = ++sequence;
  file = input = video = audio = metadata = null;
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = null; resultBlob = null;
  resultEl.classList.remove('show'); resultEl.hidden = true;
  sourceEl.textContent = 'Analyzing original locally…';
  updateStatus('Reading source metadata…', 6);
  refresh();
  try {
    if (next.size > 180 * 1048576) throw new Error('Source exceeds the 180 MiB mobile safety limit. Use a shorter clip.');
    const opened = new Input({ formats: ALL_FORMATS, source: new BlobSource(next) });
    const [v, a] = await Promise.all([opened.getPrimaryVideoTrack(), opened.getPrimaryAudioTrack()]);
    if (!v) throw new Error('No video track found.');
    const [codec, config, fps, duration, w, h, rotation, audioCodec, audioConfig, color] = await Promise.all([
      v.getCodec(), v.getDecoderConfig(),
      v.computeFrameRateMetrics({ targetPacketCount: 256 }), v.computeDuration(),
      v.getDisplayWidth(), v.getDisplayHeight(), v.getRotation(),
      a ? a.getCodec() : Promise.resolve(null),
      a ? a.getDecoderConfig() : Promise.resolve(null),
      v.getColorSpace().catch(() => null)
    ]);
    if (token !== sequence) return;
    if (!['avc', 'hevc'].includes(codec) || !config)
      throw new Error('Only packet-copy H.264 / HEVC source is supported.');
    if (a && (!audioCodec || !audioConfig))
      throw new Error('Audio is incompatible with strict packet-copy normalization.');
    if (!Number.isFinite(fps.bestGuessFrameRate) || !Number.isFinite(duration) || duration <= 0)
      throw new Error('Invalid source frame rate or duration.');
    input = opened; video = v; audio = a; file = next;
    metadata = { codec, config, fps: fps.bestGuessFrameRate, duration, w, h,
      rotation, audioCodec, audioConfig, color };
    sourceEl.textContent = next.name + ' • ' + formatSize(next.size) + '\n' +
      w + ' × ' + h + ' • ' + metadata.fps.toFixed(3) + ' FPS • ' +
      codec.toUpperCase() + ' • ' + duration.toFixed(3) + ' s';
    updateStatus('Source ready. Choose factor and acknowledge the experimental risk.', 100);
  } catch (e) {
    if (token !== sequence) return;
    metadata = null;
    sourceEl.textContent = 'Source inspection failed: ' + describeError(e);
    updateStatus('Source analysis failed.', 0);
  }
  refresh();
});
async function normalize() {
  updateStatus('Normalizing MP4 with original compressed packets…', 10);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const vs = new EncodedVideoPacketSource(metadata.codec);
  output.addVideoTrack(vs, { rotation: metadata.rotation, frameRate: metadata.fps });
  let as = null;
  if (audio) {
    as = new EncodedAudioPacketSource(metadata.audioCodec);
    output.addAudioTrack(as);
  }
  await output.start();
  const vTask = (async () => {
    let first = true, count = 0;
    for await (const packet of new EncodedPacketSink(video).packets()) {
      await vs.add(packet.clone({ timestamp: packet.timestamp, duration: packet.duration }),
        first ? { decoderConfig: metadata.config } : undefined);
      first = false; count++;
      if (count % 150 === 0) updateStatus('Copying original video samples: ' + count, 20);
    }
    vs.close();
    return count;
  })();
  const aTask = (async () => {
    if (!as) return;
    let first = true;
    for await (const packet of new EncodedPacketSink(audio).packets()) {
      await as.add(packet.clone({ timestamp: packet.timestamp, duration: packet.duration }),
        first ? { decoderConfig: metadata.audioConfig } : undefined);
      first = false;
    }
    as.close();
  })();
  const [count] = await Promise.all([vTask, aTask]);
  await output.finalize();
  if (!target.buffer) throw new Error('The MP4 normalizer did not return a buffer.');
  const normalized = new Uint8Array(target.buffer);
  const structure = inspectNormalizedMp4(normalized);
  if (structure.video.count !== count)
    throw new Error('Normalizer packet count differs from original track.');
  return normalized;
}
function outputReady(blob, name, report) {
  resultBlob = blob; resultName = name;
  detailsEl.textContent = report; resultEl.hidden = false; resultEl.classList.add('show');
  const readyFile = new File([blob], name, { type: 'video/mp4' });
  shareBtn.hidden = !(navigator.share && navigator.canShare?.({ files: [readyFile] }));
  shareBtn.onclick = async () => {
    try { await navigator.share({ files: [readyFile], title: 'HAMODYBR Density Experiment' }); } catch {}
  };
  downloadBtn.onclick = () => {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = lastUrl; a.download = resultName; document.body.appendChild(a); a.click(); a.remove();
  };
}
runBtn.addEventListener('click', async () => {
  if (!metadata || current || !confirmEl.checked) return;
  current = true; fileEl.disabled = resetBtn.disabled = true; refresh();
  resultEl.hidden = true; resultEl.classList.remove('show');
  try {
    const normalized = await normalize();
    updateStatus('Applying independently written sample-density patch…', 60);
    const factor = mode();
    const built = buildDensity(normalized, factor);
    updateStatus('Checking real payload identity and sample count…', 88);
    const blob = new Blob([built.bytes], { type: 'video/mp4' });
    const base = file.name.replace(/\.[^.]+$/, '') || 'video';
    const name = base + '-hamodybr-density-' + factor + 'x-EXPERIMENT.mp4';
    outputReady(blob, name, [
      'HAMODYBR Independent Density Experiment',
      'Factor: ×' + factor + ' • NOT standards-compliant',
      'Codec: ' + built.report.codec,
      'Real original video samples: ' + built.report.originalSamples,
      'Declared samples: ' + built.report.declaredSamples,
      'Non-picture filler samples: ' + built.report.pseudoSamples,
      'Real compressed payload: IDENTICAL ✓',
      'Normalized input: ' + formatSize(normalized.byteLength),
      'Experimental output: ' + formatSize(blob.size),
      'No real new video detail or frames have been created.',
      'Unverified for TikTok Public playback. Private/review or decoding failure is possible.'
    ].join('\n'));
    updateStatus('Local patch finished. Public quality and TikTok processing NOT verified.', 100);
  } catch (e) {
    updateStatus('Experiment failed: ' + describeError(e), 0);
  } finally {
    current = false; fileEl.disabled = resetBtn.disabled = false; refresh();
  }
});
resetBtn.addEventListener('click', () => {
  if (current) return;
  ++sequence; file = input = video = audio = metadata = resultBlob = null;
  fileEl.value = ''; confirmEl.checked = false;
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = null; resultEl.hidden = true; resultEl.classList.remove('show');
  sourceEl.textContent = 'Choose a video to inspect its source.';
  updateStatus('Waiting for a video.', 0); refresh();
});
refresh();
