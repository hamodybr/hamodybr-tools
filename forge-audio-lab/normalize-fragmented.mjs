// Optional browser-only fragmented-MP4 normalization. Strict packet-copy; never transcode.
const MAX_NORMALIZE_MOBILE = 220 * 1024 * 1024;
const MAX_NORMALIZE_DESKTOP = 600 * 1024 * 1024;
const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm';
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
  if (!audio) throw new Error('هذا الفيديو ما يحتوي صوت AAC. إضافة صوت صامت تحتاج مسار تجهيز منفصل، وما راح أصدّر ملفاً معطوباً.');
  if ((await audio.getCodec()) !== 'aac') throw new Error('صوت الفيديو مو AAC. هذا المحرك يحافظ على الصوت الأصلي ولا يعيد ترميزه.');
  const target = new M.BufferTarget();
  const output = new M.Output({
    format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target,
  });
  const conversion = await M.Conversion.init({
    input, output, tracks: 'primary', copy: { mode: 'forced' },
    showWarnings: false,
  });
  if (!conversion.isValid ||
      !conversion.utilizedTracks.includes(video) ||
      !conversion.utilizedTracks.includes(audio)) {
    throw new Error('تعذر نسخ الفيديو والصوت معاً بدون إعادة ترميز. تم إيقاف التجربة حفاظاً على الجودة.');
  }
  if (conversion.discardedTracks.some(entry =>
    entry.track === video || entry.track === audio)) {
    throw new Error('أحد المسارات الأصلية غير قابل للنسخ؛ لن نعيد ترميزه تلقائياً.');
  }
  conversion.onProgress = fraction => onProgress(Math.max(0, Math.min(1, fraction)));
  await conversion.execute();
  if (!target.buffer || !target.buffer.byteLength) throw new Error('لم ينتج ملف MP4 بعد التحويل.');
  const name = (file.name || 'video').replace(/\.mp4$/i,'') + '-hamodybr-normalized.mp4';
  const normalized = new File([target.buffer], name, { type: 'video/mp4' });
  onProgress(1);
  return {file: normalized, method:'encoded-packet-copy', inputBytes:file.size, outputBytes:normalized.size};
}
