// Optional browser-only MP4 normalization. Original video/audio packets are never transcoded.
const MAX_NORMALIZE_MOBILE = 220 * 1024 * 1024;
const MAX_NORMALIZE_DESKTOP = 600 * 1024 * 1024;
const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';
const SILENCE_FRAME = new Uint8Array([0x21,0x10,0x04,0x60,0x8c,0x1c]);
const SILENCE_CONFIG = {codec:'mp4a.40.2',numberOfChannels:2,sampleRate:48000,description:new Uint8Array([0x11,0x90])};
export async function normalizeFragmentedFile(file, onProgress = () => {}, library = null, options = {}) {
  if (!file || typeof file.size !== 'number') throw new Error('Choose an MP4 file.');
  const mobile = options.mobile ?? /iPhone|iPad|iPod/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const maxBytes = mobile ? MAX_NORMALIZE_MOBILE : MAX_NORMALIZE_DESKTOP;
  if (file.size > maxBytes) throw new Error(
    'هذا MP4 مجزّأ وكبير (' + Math.round(file.size / 1048576) +
    ' MB). التحضير المحلي الحالي محدود إلى ' + Math.round(maxBytes / 1048576) +
    ' MB على هذا الجهاز لتجنّب انهيار الذاكرة. لا يمكن معالجة الملف بهالطريقة بدون إعادة تغليف مسبق.'
  );
  let M;
  try { M = library || await import(MEDIABUNNY_URL); }
  catch { throw new Error('تعذّر تحميل محرّك تحويل MP4. تأكد من الاتصال بالإنترنت وحاول من جديد.'); }
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  if (!video) throw new Error('ما لقينا مسار فيديو داخل الملف المجزّأ.');
  if ((await video.getCodec()) !== 'avc') throw new Error('فيديو المصدر مو H.264؛ هذا المسار ما يحوّل HEVC أو HDR تلقائياً.');
  // Missing audio is normal in stock footage; create a valid AAC silence track.
  if (audio && (await audio.getCodec()) !== 'aac') throw new Error('صوت الفيديو مو AAC. هذا المحرك يحافظ على الصوت الأصلي ولا يعيد ترميزه.');
  const target = new M.BufferTarget();
  const output = new M.Output({
    format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target,
  });
  const conversion = await M.Conversion.init({
    input, output, tracks: 'primary', copy: { mode: 'forced' },
    composable: !audio, showWarnings: false,
  });
  if (!conversion.isValid ||
      !conversion.utilizedTracks.includes(video) ||
      (audio && !conversion.utilizedTracks.includes(audio))) {
    throw new Error('تعذر نسخ الفيديو والصوت معاً بدون إعادة ترميز. تم إيقاف التجربة حفاظاً على الجودة.');
  }
  if (conversion.discardedTracks.some(entry =>
    entry.track === video || (audio && entry.track === audio))) {
    throw new Error('أحد المسارات الأصلية غير قابل للنسخ؛ لن نعيد ترميزه تلقائياً.');
  }
  conversion.onProgress = fraction => onProgress(Math.max(0, Math.min(1, fraction)));
  if (audio) {
    await conversion.execute();
  } else {
    const silence = new M.EncodedAudioPacketSource('aac');
    output.addAudioTrack(silence);
    const duration = await video.computeDuration();
    if (!Number.isFinite(duration) || duration<=0 || duration>60*60*2) throw new Error('مدة الفيديو غير مناسبة لإضافة صوت صامت.');
    const count = Math.ceil(duration*48000/1024);
    await output.start();
    const sendSilence = async()=>{
      for(let i=0;i<count;i++){
        const t=i*1024/48000;
        await silence.add(new M.EncodedPacket(SILENCE_FRAME,'key',t,1024/48000),
          i===0?{decoderConfig:SILENCE_CONFIG}:undefined);
      }
      silence.close();
    };
    await Promise.all([conversion.execute(),sendSilence()]);
    await output.finalize();
  }
  if (!target.buffer || !target.buffer.byteLength) throw new Error('لم ينتج ملف MP4 بعد التحويل.');
  const name = (file.name || 'video').replace(/\.mp4$/i,'') + '-hamodybr-normalized.mp4';
  const normalized = new File([target.buffer], name, { type: 'video/mp4' });
  onProgress(1);
  return {file: normalized, method:'encoded-packet-copy', addedSilentAudio:!audio, inputBytes:file.size, outputBytes:normalized.size};
}
