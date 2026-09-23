// Optional browser-only MP4 normalization. Original video/audio packets are never transcoded.
const MAX_NORMALIZE_MOBILE = 220 * 1024 * 1024;
const MAX_NORMALIZE_DESKTOP = 600 * 1024 * 1024;
// The HEVC branch must decode+re-encode every frame; use a stricter mobile limit.
const MAX_HEVC_MOBILE = 160 * 1024 * 1024;
const MAX_HEVC_DESKTOP = 360 * 1024 * 1024;
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
  const sourceCodec = await video.getCodec();
  if (!['avc','hevc'].includes(sourceCodec)) throw new Error('نوع الصورة غير مدعوم: '+(sourceCodec||'unknown')+'. الأداة تحتاج H.264 أو HEVC.');
  // Preserve HEVC/HLG/PQ by default: remux compressed packets, never apply an implicit tone map.
  // The older HEVC-to-AVC SDR path remains available only by explicit caller opt-in.
  const transcodeHevc = sourceCodec === 'hevc' && options.videoMode === 'avc-sdr';
  let transcodeQuality = null;
  if (transcodeHevc) {
    const maxHevc = mobile ? MAX_HEVC_MOBILE : MAX_HEVC_DESKTOP;
    if (file.size > maxHevc) throw new Error('ملف HEVC حجمه '+Math.round(file.size/1048576)+'MB؛ التحويل المحلي على جهازك محدود إلى '+Math.round(maxHevc/1048576)+'MB. تحتاج تحويل H.264 خارجي قبل Forge Track.');
    const color = await video.getColorSpace();
    const transfer = String(color?.transfer||'').toLowerCase();
    if (['pq','hlg','smpte2084','arib-std-b67'].includes(transfer)) throw new Error('الملف HEVC HDR ('+transfer+'). تحويل الألوان إلى SDR يحتاج Tone Mapping متخصص؛ ما راح نغيّر الألوان بصمت. حوّله إلى H.264 SDR أولاً.');
    const width = await video.getCodedWidth(), height = await video.getCodedHeight();
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>3840*2160) throw new Error('دقة فيديو HEVC تتجاوز قدرة المعالجة المحلية الحالية.');
    if (!(await video.canDecode())) throw new Error('متصفح هذا الجهاز ما يدعم فك HEVC لهالفيديو. جرّب جهازاً يدعم HEVC أو جهّز H.264 خارج الموقع.');
    const bitrate = Math.min(22000000,Math.max(6000000,Math.round(width*height/(3840*2160)*22000000)));
    transcodeQuality = new M.Quality({bitrate,bitrateMode:'constant'});
    if (!(await M.canEncodeVideo('avc',{width,height,quality:transcodeQuality,hardwareAcceleration:'prefer-hardware'}))) throw new Error('متصفح هذا الجهاز ما يدعم ترميز H.264 بدقة الفيديو. يحتاج تحويل خارج الموقع.');
  }
  // Missing audio is normal in stock footage; create a valid AAC silence track.
  if (audio && (await audio.getCodec()) !== 'aac') throw new Error('صوت الفيديو مو AAC. هذا المحرك يحافظ على الصوت الأصلي ولا يعيد ترميزه.');
  const target = new M.BufferTarget();
  const output = new M.Output({
    format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target,
  });
  const conversion = await M.Conversion.init({
    input, output, tracks: 'primary', copy: { mode: transcodeHevc ? 'preferred' : 'forced' },
    video: transcodeHevc ? {codec:'avc',quality:transcodeQuality,keyFrameInterval:1,hardwareAcceleration:'prefer-hardware',forceTranscode:true}:undefined,
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
  // Copy-preferred allows the forced HEVC video transcode; verify AAC packet integrity below.
  const hashPackets = async(track)=>{
    if (!track) return null;
    let hash=2166136261,total=0,count=0;
    const packets = new M.EncodedPacketSink(track);
    for await (const p of packets.packets()){
      for(const b of p.data) hash=Math.imul(hash^b,16777619)>>>0;
      total+=p.data.byteLength;count++;
    }
    return [hash,total,count].join(':');
  };
  const sourceAudioHash = audio ? await hashPackets(audio) : null;
  const sourceVideoHash = sourceCodec === 'hevc' && !transcodeHevc ? await hashPackets(video) : null;
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
  if (sourceCodec === 'hevc') {
    const check = new M.Input({formats:M.ALL_FORMATS, source:new M.BlobSource(normalized)});
    const outVideo = await check.getPrimaryVideoTrack();
    const expectedCodec = transcodeHevc ? 'avc' : 'hevc';
    if (!outVideo || (await outVideo.getCodec())!==expectedCodec)throw new Error('فشل التحقق من ترميز الصورة بعد التحضير.');
    if (sourceVideoHash && (await hashPackets(outVideo))!==sourceVideoHash)throw new Error('فشل التحقق: بيانات صورة HEVC الأصلية تغيّرت أثناء إعادة التغليف.');
    if (audio) {
      const outAudio=await check.getPrimaryAudioTrack();
      if (!outAudio || (await hashPackets(outAudio))!==sourceAudioHash)throw new Error('فشل التحقق من حفظ الصوت الأصلي بدون إعادة ترميز.');
    }
  }
  onProgress(1);
  return {file: normalized, method: transcodeHevc?'hevc-to-avc':'encoded-packet-copy', videoTranscoded:transcodeHevc, videoCodec:sourceCodec, hdrPreserved:sourceCodec==='hevc'&&!transcodeHevc, addedSilentAudio:!audio, inputBytes:file.size, outputBytes:normalized.size};
}
