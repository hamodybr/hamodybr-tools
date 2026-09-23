import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, Mp4OutputFormat,
  BufferTarget, Quality, canEncodeVideo, EncodedPacketSink
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';
import { addForgeLikeTrackFile, inspectForgeReadyFile } from '../forge-audio-lab/forge-track.mjs?v=6';
import { makeSmoothPlan, validateSmoothOutput, makeVideoConversionOptions } from './smooth4k-plan.mjs?v=3';

const $ = id => document.getElementById(id);
const mib = n => (n / 1048576).toFixed(2) + ' MB';
const sleepFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const isMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent);
const maxSourceBytes = (isMobile ? 160 : 360) * 1048576;
let file = null, input = null, video = null, audio = null, source = null, plan = null;
let busy = false, selected = 0, conversion = null, wake = null, outputUrl = null, outputFile = null;
let pct = 0, began = 0, ticker = null, phase = 'بانتظار الملف', detail = '0%';

function progress(p, message, extra = '') {
  pct = Math.max(pct, Math.min(100, Math.max(0, p)));
  phase = message;
  detail = extra;
  const elapsed = began ? Math.floor((performance.now() - began) / 1000) : 0;
  $('bar').style.width = pct.toFixed(1) + '%';
  $('phase').textContent = phase;
  $('numbers').textContent = Math.round(pct) + '% • ' + elapsed + 's' + (detail ? ' • ' + detail : '');
}
function report(message, bad = false) {
  $('status').textContent = message;
  $('status').style.color = bad ? '#b53b3b' : '';
}
function clearResult() {
  $('result').classList.remove('show'); outputFile = null;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function refresh() {
  $('run').disabled = busy || !plan || !$('agree').checked;
  $('run').textContent = plan?.colorMode === 'sdr' ? 'إنشاء 4K SDR Compatibility (H.264)' : 'إنشاء Smooth 4K HDR (HEVC)';
  $('stop').hidden = !busy; $('stop').disabled = !busy || !conversion;
  $('fpsTarget').textContent = plan ? plan.targetFps.toFixed(3) + 'fps • real-time' : '30fps • real-time';
  $('videoTarget').textContent = plan ? (plan.codec === 'hevc' ? 'HEVC Main10' : 'H.264 AVC') + ' • ' + (plan.bitrate / 1e6).toFixed(1) + ' Mbps target' : 'Auto • HDR HEVC / SDR H.264';
  $('colorTarget').textContent = plan ? (plan.colorMode === 'hlg' ? 'HLG BT.2020 • no tone mapping' : 'SDR BT.709 • no tone mapping') : 'Detect source color before encoding';
}
function colorString(color) { return [color?.primaries, color?.transfer, color?.matrix].filter(Boolean).join(' / ') || 'Unknown'; }

async function fingerprint(track) {
  const result = { packets: 0, bytes: 0, hash: 2166136261 >>> 0 };
  if (!track) return result;
  for await (const packet of new EncodedPacketSink(track).packets()) {
    const b = packet.data;
    for (let i = 0; i < b.length; i++) result.hash = Math.imul(result.hash ^ b[i], 16777619) >>> 0;
    result.bytes += b.length;
    result.packets++;
  }
  return result;
}
function sameFingerprint(a, b) {
  return a.packets === b.packets && a.bytes === b.bytes && a.hash === b.hash;
}
function blank() {
  file = input = video = audio = source = plan = null;
  $('meta').hidden = true; $('analysis').textContent = 'جاري انتظار فحص الملف…';
  refresh(); clearResult();
}

async function checkSource(f, token) {
  blank();
  file = f;
  $('name').textContent = f.name; $('size').textContent = mib(f.size);
  $('meta').hidden = false;
  progress(2, 'جاري فحص ملف المصدر محلياً…', mib(f.size));
  if (f.size > maxSourceBytes) throw new Error('الملف أكبر من حد المعالجة المحلية الآمن على هذا الجهاز (' + mib(maxSourceBytes) + '). الملف الأصلي يبقى بدون تعديل.');
  const opened = new Input({formats: ALL_FORMATS, source: new BlobSource(f)});
  const [vTracks, aTracks] = await Promise.all([opened.getVideoTracks(), opened.getAudioTracks()]);
  if (token !== selected) return;
  if (vTracks.length !== 1 || aTracks.length !== 1)
    throw new Error('هذا المسار التجريبي يحتاج فيديو واحد ومسار AAC أصلي واحد. لا نحذف أي مسارات إضافية بصمت؛ استخدم النسخة الأصلية غير المعالجة.');
  const v = vTracks[0], a = aTracks[0];
  const [codec, ac, fpsMetric, duration, w, h, color, rot, decoded, audioCfg] = await Promise.all([
    v.getCodec(), a.getCodec(), v.computeFrameRateMetrics({targetPacketCount:256}),
    v.computeDuration(), v.getDisplayWidth(), v.getDisplayHeight(),
    v.getColorSpace().catch(() => null), v.getRotation(),
    v.canDecode(), a.getDecoderConfig()
  ]);
  if (token !== selected) return;
  const fps = fpsMetric.bestGuessFrameRate;
  $('codec').textContent = String(codec).toUpperCase();
  $('resolution').textContent = w + ' × ' + h;
  $('fps').textContent = Number.isFinite(fps) ? fps.toFixed(3) : 'Unknown';
  $('color').textContent = colorString(color);
  $('duration').textContent = Number.isFinite(duration) ? duration.toFixed(3) + 's' : 'Unknown';
  if (ac !== 'aac' || !audioCfg) throw new Error('صوت المصدر مو AAC سليم. ما راح نعيد ترميزه أو نستبدله بدون علمك.');
  if (!decoded) throw new Error('المتصفح ما يدعم فك ترميز هذا الفيديو HLG/HEVC.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('مدة الفيديو غير صحيحة.');
  const p = makeSmoothPlan({width:w,height:h,fps,codec,color,preserveFps:$('preserveFps').checked});
  const q = new Quality({bitrate:p.bitrate,bitrateMode:'constant'});
  const supported = await canEncodeVideo(p.codec, {
    width:p.width,height:p.height,quality:q,hardwareAcceleration:'prefer-hardware'
  }).catch(() => false);
  if (token !== selected) return;
  if (!supported) throw new Error('متصفح هذا الجهاز لا يدعم ترميز '+p.codec.toUpperCase()+' بدقة 4K. ما راح نقلل الدقة أو نغيّر نظام الألوان بصمت.');
  source = { width:w,height:h,fps,duration,rotation:rot,color };
  input = opened; video = v; audio = a; plan = p;
  $('analysis').className = 'note ok';
  $('analysis').textContent = p.colorMode === 'hlg'
    ? 'المصدر '+codec.toUpperCase()+' / HLG BT.2020. اخترنا وصفة B: HEVC Main10 4K / '+p.targetFps.toFixed(2)+'fps / 18.6Mbps. يتم تدقيق Main10 والصوت بعد الترميز.'
    : 'المصدر '+codec.toUpperCase()+' / SDR BT.709. اخترنا تلقائياً وضع 4K Compatibility: H.264 / '+p.targetFps.toFixed(2)+'fps / 22.1Mbps. هذا ليس HDR B ولن نضيف ألوان HDR وهمية. افحص النتيجة قبل TikTok.';
  progress(100,'فحص المصدر اكتمل',mib(f.size));
  report('اختر إعداداتك، وافق على التنبيه، ثم ابدأ.');
  refresh();
}
$('file').addEventListener('change', async () => {
  const f = $('file').files?.[0]; const token = ++selected;
  if (!f) { blank(); return; }
  if (busy) { report('انتظر حتى تنتهي المعالجة الحالية أو أوقفها.', true); return; }
  began = performance.now(); pct = 0; clearInterval(ticker); ticker = setInterval(() => progress(pct,phase,detail),1000);
  try { await sleepFrame(); await checkSource(f, token); }
  catch(e) {
    if (token !== selected) return;
    plan = null;
    $('analysis').className = 'note bad';
    $('analysis').textContent = e?.message || String(e);
    report('فشل فحص الملف: ' + (e?.message || e),true);
    refresh();
  } finally { if (token === selected) { clearInterval(ticker);ticker=null;began=0; } }
});
$('preserveFps').addEventListener('change', async () => {
  if (!file || busy) return;
  const f = file, token = ++selected;
  began = performance.now(); pct = 0;
  try { await checkSource(f, token); }
  catch(e) { plan=null; $('analysis').className='note bad'; $('analysis').textContent=e.message;report(e.message,true);refresh(); }
  finally { began=0; }
});
$('agree').addEventListener('change',refresh);

async function holdWake() {
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch {}
}
async function releaseWake() { try { await wake?.release(); } catch {} wake = null; }

async function verifyEncoded(blob, audioBefore, expectedPlan) {
  const converted = new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
  const [v,a] = await Promise.all([converted.getPrimaryVideoTrack(),converted.getPrimaryAudioTrack()]);
  if (!v || !a) throw new Error('Output lost its primary video or AAC sound.');
  const [w,h,codec,cs,rot,dur,fpsMetrics,decConfig,frameStats,aCodec,afterAudio] = await Promise.all([
    v.getDisplayWidth(),v.getDisplayHeight(),v.getCodec(),
    v.getColorSpace().catch(()=>null),v.getRotation(),v.computeDuration(),
    v.computeFrameRateMetrics({targetPacketCount:256}),v.getDecoderConfig(),
    v.computePacketStats(),a.getCodec(),fingerprint(a)
  ]);
  validateSmoothOutput(source,{
    width:w,height:h,codec,color:cs,rotation:rot,duration:dur,
    fps:fpsMetrics.bestGuessFrameRate,decoderCodec:decConfig?.codec
  },expectedPlan);
  if (aCodec !== 'aac' || !sameFingerprint(audioBefore,afterAudio))
    throw new Error('Primary AAC packet-copy verification failed. No file will be offered.');
  const expectedFrames = source.duration * expectedPlan.targetFps;
  if (Math.abs(frameStats.packetCount - expectedFrames) > Math.max(2,expectedFrames * .02))
    throw new Error('Encoded frame count differs unexpectedly from real-time 30fps target.');
  return {frameStats,actualFps:fpsMetrics.bestGuessFrameRate,audio:afterAudio,decoderCodec:decConfig?.codec};
}

$('stop').addEventListener('click', async () => {
  $('stop').disabled = true; report('جاري إيقاف العملية…');
  try { await conversion?.cancel(); } catch {}
});
$('run').addEventListener('click', async () => {
  if ($('run').disabled || busy || !file || !input || !plan) return;
  busy = true; clearResult(); refresh(); pct=0; began=performance.now();
  ticker = setInterval(() => progress(pct,phase,detail),1000);
  await holdWake();
  const f = file, activePlan = plan, useForge = $('forge').checked;
  try {
    progress(2,'المرحلة 1/4: فحص بصمة الصوت الأساسي…');
    const sourceAudio = await fingerprint(audio);
    progress(9,'المرحلة 2/4: بدء ترميز '+activePlan.codec.toUpperCase()+' محلياً…','هدف '+(activePlan.bitrate/1e6).toFixed(1)+' Mbps');
    await sleepFrame();
    const q = new Quality({bitrate:activePlan.bitrate,bitrateMode:'constant'});
    const target = new BufferTarget();
    const out = new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target});
    conversion = await Conversion.init({
      input,output:out,tracks:'primary',copy:{mode:'preferred'},showWarnings:false,
      video:makeVideoConversionOptions(activePlan,q)
    });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video) || !conversion.utilizedTracks.includes(audio))
      throw new Error('محرّك المعالجة رفض إعداد '+activePlan.codec.toUpperCase()+' / AAC. لا توجد نتيجة.');
    refresh();
    conversion.onProgress = p => {
      const fraction = Math.max(0,Math.min(1,p));
      const estimated = (activePlan.bitrate/8 * source.duration * fraction);
      progress(10 + fraction*65,'المرحلة 2/4: ترميز الفيديو محلياً…',Math.round(fraction*100)+'% من المدة • حجم متوقع '+mib(estimated));
    };
    await conversion.execute();
    conversion=null;refresh();
    if (!target.buffer) throw new Error('لم ينتج المحرك ملف MP4.');
    let blob = new Blob([target.buffer],{type:'video/mp4'});
    progress(80,'المرحلة 3/4: تدقيق '+(activePlan.colorMode === 'hlg' ? '10-bit/HDR' : 'SDR BT.709')+'/FPS والصوت…',mib(blob.size));
    const checked = await verifyEncoded(blob,sourceAudio,activePlan);
    if (useForge) {
      progress(88,'المرحلة 4/4: تطبيق مسار Forge المجرب بدون تعديل الصوت الأساسي…');
      const encoded = new File([blob],'encoded.mp4',{type:'video/mp4'});
      const inspection = await inspectForgeReadyFile(encoded);
      if (inspection.alreadyProcessed || inspection.audioTrackCount !== 1)
        throw new Error('وقفنا التطبيق لتجنب تكرار مسار Forge أو فقدان الصوت.');
      const forged = await addForgeLikeTrackFile(encoded);
      if (forged.report.alreadyProcessed || forged.report.addedTailPackets !== 6912)
        throw new Error('مسار Forge الناتج لا يطابق التجربة الأصلية.');
      blob = forged.output;
    }
    if (blob.size > 0xffffffff) throw new Error('MP4 exceeds the Forge 4GB limit.');
    const name = (f.name.replace(/\.[^.]+$/,'') || 'video') + '-hamodybr-v35-smooth4k' + (useForge ? '-forge-test' : '') + '.mp4';
    outputFile = new File([blob],name,{type:'video/mp4'});
    outputUrl = URL.createObjectURL(outputFile);
    $('download').href = outputUrl; $('download').download = name;
    $('share').hidden = !(navigator.share && navigator.canShare?.({files:[outputFile]}));
    $('resultText').textContent = 'الحجم '+mib(f.size)+' → '+mib(blob.size)+' • 4K / '+checked.actualFps.toFixed(3)+'fps • '+(activePlan.colorMode === 'hlg' ? 'HLG BT.2020' : 'SDR BT.709')+' • الصوت الأصلي مطابق'+(useForge?' • مسار Forge التجريبي مضاف':'');
    $('report').textContent = [
      'Video: '+activePlan.codec.toUpperCase()+' ('+checked.decoderCodec+')',
      'Frame packets: '+checked.frameStats.packetCount,
      'Source duration: '+source.duration.toFixed(3)+' s',
      'Output FPS: '+checked.actualFps.toFixed(3),
      'Bitrate target: '+(activePlan.bitrate/1e6).toFixed(1)+' Mbps (actual may vary)',
      'Primary AAC packets: '+checked.audio.packets+'; bytes: '+checked.audio.bytes,
      'Forge experiment: '+(useForge?'ON (deliberately invalid secondary AAC)':'OFF'),
      'TikTok playback quality: must be checked after upload'
    ].join('\n');
    $('result').classList.add('show');
    progress(100,'الملف التجريبي جاهز',mib(blob.size));
    report('اكتمل فحص 4K / '+(activePlan.colorMode === 'hlg' ? 'HDR / Main10' : 'SDR BT.709')+' / الصوت بنجاح. تأكد من التشغيل قبل الرفع.');
  } catch(e) {
    console.error(e);
    clearResult();
    report((e?.name === 'ConversionCanceledError' ? 'تم إيقاف المعالجة.' : 'فشلت المعالجة بأمان: '+(e?.message || e)),true);
    progress(0,'لم يكتمل الملف');
  } finally {
    clearInterval(ticker);ticker=null;began=0;conversion=null;busy=false;
    await releaseWake();refresh();
  }
});
$('share').addEventListener('click', async () => {
  if (!outputFile) return;
  try { await navigator.share({files:[outputFile],title:'HAMODYBR Smooth 4K HDR V3.5 Test'}); } catch(e) { if (e?.name!=='AbortError') report('المشاركة لم تكتمل: '+e.message,true); }
});
$('engine').textContent = 'المعالجة محلية بالكامل. يحدد الموقع نوع المصدر وألوانه ثم يختار HDR (HEVC) أو SDR (H.264)؛ لن يضيف HDR إلى مصدر SDR.';
refresh();
