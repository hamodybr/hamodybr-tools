/**
 * HAMODYBR independent experimental MP4 density patcher.
 * No NoBlur source code is used. Experimental output adds non-picture samples
 * and is not standards-compliant; it may fail decoding or remain Private.
 */
const asBytes = (v) => v instanceof Uint8Array ? v : new Uint8Array(v);
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const word = (b, i) => String.fromCharCode(...b.slice(i, i + 4));
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const uint = (b, i) => view(b).getUint32(i, false);
const signed = (b, i) => view(b).getInt32(i, false);
function need(ok, msg) { if (!ok) throw new Error(msg); }
function put(b, i, n) {
  need(Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff, 'MP4 32-bit offset/size overflow');
  view(b).setUint32(i, n, false);
}
function get64(b, i) {
  const n = (BigInt(uint(b, i)) << 32n) + BigInt(uint(b, i + 4));
  need(n <= BigInt(Number.MAX_SAFE_INTEGER), '64-bit offset unsupported');
  return Number(n);
}
function put64(b, i, n) {
  need(Number.isSafeInteger(n) && n >= 0, '64-bit offset overflow');
  put(b, i, Number(BigInt(n) >> 32n));
  put(b, i + 4, Number(BigInt(n) & 0xffffffffn));
}
function join(...parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}
function box(type, contents) {
  need(contents.length + 8 < 0x100000000, 'MP4 atom too large');
  const b = new Uint8Array(contents.length + 8);
  put(b, 0, b.length); b.set(ascii(type), 4); b.set(contents, 8);
  return b;
}
function boxes(b, begin, end) {
  const items = [];
  for (let p = begin; p < end;) {
    need(p + 8 <= end, 'Truncated MP4 atom');
    let size = uint(b, p);
    const type = word(b, p + 4);
    need(size !== 1, 'Extended MP4 atom headers not supported');
    if (size === 0) size = end - p;
    need(size >= 8 && p + size <= end, 'Invalid atom: ' + type);
    items.push({ type, start: p, body: p + 8, end: p + size, size });
    p += size;
  }
  return items;
}
function children(b, item) { return boxes(b, item.body, item.end); }
function first(b, item, type) { return children(b, item).find((i) => i.type === type); }
function original(b, item) { return b.slice(item.start, item.end); }
function positions(b, item, stride) {
  need(item && item.size >= 16, 'Missing or corrupt sample table');
  const count = uint(b, item.body + 4);
  need(count < 5000000 && item.body + 8 + count * stride <= item.end, 'Bad MP4 table count');
  return Array.from({ length: count }, (_, i) => item.body + 8 + i * stride);
}
function table(b, item, stride, values) {
  const content = new Uint8Array(8 + stride * values.length);
  content.set(b.slice(item.body, item.body + 4)); put(content, 4, values.length);
  values.forEach((row, i) => row.forEach((n, j) => put(content, 8 + stride * i + 4 * j, n)));
  return box(item.type, content);
}
function findVideo(b, moov) {
  const vids = children(b, moov).filter((trk) => {
    if (trk.type !== 'trak') return false;
    const mdia = first(b, trk, 'mdia'), h = mdia && first(b, mdia, 'hdlr');
    return h && word(b, h.body + 8) === 'vide';
  });
  need(vids.length === 1, 'Exactly one video track required');
  const mdia = first(b, vids[0], 'mdia'), minf = first(b, mdia, 'minf');
  const stbl = minf && first(b, minf, 'stbl');
  const mdhd = first(b, mdia, 'mdhd');
  need(stbl && mdhd, 'Missing video sample table or media timebase');
  return { stbl, mdhd };
}
function parseVideo(b, stbl, mdhd) {
  const items = children(b, stbl);
  const unsupported = ['sdtp', 'subs', 'sgpd', 'sbgp', 'saiz', 'saio', 'stsh', 'padb'];
  for (const t of items) need(!unsupported.includes(t.type), 'Unsupported video box: ' + t.type);
  const get = (type) => items.find((i) => i.type === type);
  const stsz = get('stsz'), stts = get('stts'), stsc = get('stsc'), stco = get('stco') || get('co64');
  need(stsz && stts && stsc && stco, 'Missing stts/stsz/stsc/offsets');
  need(uint(b, stsz.body + 4) === 0, 'Fixed-size stsz not supported');
  const count = uint(b, stsz.body + 8);
  need(count > 0 && count <= 150000 && stsz.body + 12 + count * 4 <= stsz.end, 'Invalid frame count');
  const sizes = Array.from({ length: count }, (_, i) => uint(b, stsz.body + 12 + 4 * i));
  const chunks = positions(b, stco, stco.type === 'co64' ? 8 : 4).map((p) =>
    stco.type === 'co64' ? get64(b, p) : uint(b, p));
  const mapping = positions(b, stsc, 12).map((p) => ({
    chunk: uint(b, p), count: uint(b, p + 4), descriptor: uint(b, p + 8)
  }));
  need(mapping.length && mapping[0].chunk === 1, 'Invalid stsc');
  const offsets = [], active = (n) => mapping.reduce((v, row) => row.chunk <= n ? row : v, mapping[0]);
  let sample = 0;
  for (let i = 1; i <= chunks.length; i++) {
    const info = active(i); let offset = chunks[i - 1];
    need(info.count > 0 && info.descriptor === 1, 'Unsupported chunk description');
    for (let j = 0; j < info.count; j++) {
      need(sample < count && offset + sizes[sample] <= b.length, 'Chunk points outside media');
      offsets.push(offset); offset += sizes[sample++];
    }
  }
  need(sample === count, 'stsc and stsz counts disagree');
  const stsd = get('stsd');
  need(stsd && uint(b, stsd.body + 4) === 1, 'Only one sample description supported');
  const codec = word(b, stsd.body + 12);
  need(['avc1', 'avc3', 'hvc1', 'hev1'].includes(codec), 'AVC/HEVC only');
  return { count, sizes, offsets, codec, mdhd, stsz, stts, stsc, stco, stss: get('stss'), ctts: get('ctts') };
}
function readMediaTimebase(b, mdhd) {
  need(mdhd && mdhd.size >= 24, 'Missing or truncated video mdhd');
  const version = b[mdhd.body];
  need(version === 0 || version === 1, 'Unsupported mdhd version');
  const t = mdhd.body + (version === 1 ? 20 : 12);
  const d = mdhd.body + (version === 1 ? 24 : 16);
  need(d + (version === 1 ? 8 : 4) <= mdhd.end, 'Truncated mdhd timescale or duration');
  const timescale = uint(b, t), duration = version === 1 ? get64(b, d) : uint(b, d);
  need(timescale > 0 && duration > 0 && duration !== 0xffffffff,
    'Invalid or unknown video timebase/duration');
  return { version, timescale, duration, timescaleAt: t, durationAt: d };
}
function chooseTimebaseMultiplier(b, video, factor) {
  const rows = positions(b, video.stts, 8);
  need(rows.length > 0, 'No video time-to-sample entries');
  const minDelta = Math.min(...rows.map((p) => uint(b, p + 4)));
  need(minDelta > 0, 'Zero-duration video samples cannot be inflated');
  const multiplier = Math.max(1, Math.ceil(factor / minDelta));
  const media = readMediaTimebase(b, video.mdhd);
  need(media.timescale * multiplier <= 0xffffffff &&
    media.duration * multiplier <= Number.MAX_SAFE_INTEGER &&
    (media.version === 1 || media.duration * multiplier <= 0xffffffff),
    'Increasing the video timebase would overflow mdhd');
  for (const p of rows) need(uint(b, p + 4) * multiplier <= 0xffffffff,
    'Increasing the video timebase would overflow stts');
  if (video.ctts) {
    need([0, 1].includes(b[video.ctts.body]), 'Unsupported ctts version');
    const signedOffset = b[video.ctts.body] === 1;
    for (const p of positions(b, video.ctts, 8)) {
      const old = signedOffset ? signed(b, p + 4) : uint(b, p + 4);
      const next = old * multiplier;
      need(Number.isSafeInteger(next) &&
        (signedOffset ? next >= -0x80000000 && next <= 0x7fffffff : next >= 0 && next <= 0xffffffff),
        'Increasing the video timebase would overflow composition offsets');
    }
  }
  return multiplier;
}
function expandDurations(b, item, factor, multiplier) {
  const rows = []; let count = 0;
  function add(n, dur) {
    if (!n) return;
    if (rows.length && rows[rows.length - 1][1] === dur) rows[rows.length - 1][0] += n;
    else rows.push([n, dur]);
  }
  for (const p of positions(b, item, 8)) {
    const frames = uint(b, p), duration = uint(b, p + 4) * multiplier;
    const lo = Math.floor(duration / factor), rem = duration % factor;
    need(lo > 0, 'Sub-sample duration must remain positive');
    for (let i = 0; i < frames; i++) { add(rem, lo + 1); add(factor - rem, lo); }
    count += frames;
  }
  return { rows, count };
}
function scaledMediaHeader(b, mdhd, multiplier) {
  const header = original(b, mdhd);
  if (multiplier === 1) return header;
  const media = readMediaTimebase(b, mdhd);
  put(header, media.timescaleAt - mdhd.start, media.timescale * multiplier);
  if (media.version === 1) put64(header, media.durationAt - mdhd.start, media.duration * multiplier);
  else put(header, media.durationAt - mdhd.start, media.duration * multiplier);
  return header;
}
function filler(codec) {
  return codec.startsWith('avc')
    ? Uint8Array.from([0, 0, 0, 4, 12, 255, 255, 128])
    : Uint8Array.from([0, 0, 0, 12, 76, 1, 255, 255, 255, 255, 255, 255, 255, 255, 255, 128]);
}
function rebuildMoov(b, moov, video, factor, multiplier, shift, fakeStart, fakeSize) {
  const custom = new Map(), newSizes = [], newOffsets = [];
  let fake = 0;
  for (let i = 0; i < video.count; i++) {
    newSizes.push(video.sizes[i]); newOffsets.push(video.offsets[i] + shift);
    for (let j = 1; j < factor; j++) {
      newSizes.push(fakeSize); newOffsets.push(fakeStart + fake++ * fakeSize);
    }
  }
  const stsz = new Uint8Array(12 + newSizes.length * 4);
  stsz.set(b.slice(video.stsz.body, video.stsz.body + 4), 0);
  put(stsz, 4, 0); put(stsz, 8, newSizes.length);
  newSizes.forEach((size, i) => put(stsz, 12 + 4 * i, size));
  custom.set(video.stsz.start, box('stsz', stsz));
  const time = expandDurations(b, video.stts, factor, multiplier);
  custom.set(video.mdhd.start, scaledMediaHeader(b, video.mdhd, multiplier));
  need(time.count === video.count, 'Timing and sample count mismatch');
  custom.set(video.stts.start, table(b, video.stts, 8, time.rows));
  custom.set(video.stsc.start, table(b, video.stsc, 12, [[1, 1, 1]]));
  const width = video.stco.type === 'co64' ? 8 : 4;
  const stco = new Uint8Array(8 + newOffsets.length * width);
  stco.set(b.slice(video.stco.body, video.stco.body + 4)); put(stco, 4, newOffsets.length);
  newOffsets.forEach((offset, i) => width === 8 ? put64(stco, 8 + i * width, offset) : put(stco, 8 + i * width, offset));
  custom.set(video.stco.start, box(video.stco.type, stco));
  if (video.stss) {
    custom.set(video.stss.start, table(b, video.stss, 4,
      positions(b, video.stss, 4).map((p) => [(uint(b, p) - 1) * factor + 1])));
  }
  if (video.ctts) {
    const signedOffset = b[video.ctts.body] === 1;
    const rows = positions(b, video.ctts, 8).map((p) => [
      uint(b, p) * factor, (signedOffset ? signed(b, p + 4) : uint(b, p + 4)) * multiplier
    ]);
    const ctts = new Uint8Array(8 + rows.length * 8);
    ctts.set(b.slice(video.ctts.body, video.ctts.body + 4)); put(ctts, 4, rows.length);
    rows.forEach((row, i) => {
      put(ctts, 8 + 8 * i, row[0]);
      if (signedOffset) view(ctts).setInt32(12 + 8 * i, row[1], false);
      else put(ctts, 12 + 8 * i, row[1]);
    });
    custom.set(video.ctts.start, box('ctts', ctts));
  }
  function rewrite(item) {
    if (custom.has(item.start)) return custom.get(item.start);
    if (item.type === 'stco' || item.type === 'co64') {
      const bytes = original(b, item), stride = item.type === 'co64' ? 8 : 4;
      for (const p of positions(b, item, stride)) {
        const at = p - item.start, next = (stride === 8 ? get64(b, p) : uint(b, p)) + shift;
        if (stride === 8) put64(bytes, at, next); else put(bytes, at, next);
      }
      return bytes;
    }
    if (!['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(item.type)) return original(b, item);
    return box(item.type, join(...children(b, item).map(rewrite)));
  }
  return rewrite(moov);
}
export function inspectNormalizedMp4(input) {
  const bytes = asBytes(input), top = boxes(bytes, 0, bytes.length);
  need(top.length === 3 && top[0].type === 'ftyp' && top[1].type === 'moov' && top[2].type === 'mdat',
    'Normalize to ftyp/moov/mdat MP4 before patching');
  const located = findVideo(bytes, top[1]);
  const video = parseVideo(bytes, located.stbl, located.mdhd);
  return { bytes, top, video };
}
export function buildDensity(input, factor = 10) {
  need(factor === 2 || factor === 10, 'Density factor must be 2 or 10');
  const { bytes, top, video } = inspectNormalizedMp4(input);
  const multiplier = chooseTimebaseMultiplier(bytes, video, factor);
  const sourceMedia = readMediaTimebase(bytes, video.mdhd);
  const fakePayload = filler(video.codec), pseudoCount = video.count * (factor - 1);
  const fake = new Uint8Array(pseudoCount * fakePayload.length);
  for (let i = 0; i < fake.length; i += fakePayload.length) fake.set(fakePayload, i);
  const secondMedia = box('mdat', fake);
  const testMoov = rebuildMoov(bytes, top[1], video, factor, multiplier, 0, 0, fakePayload.length);
  const shift = testMoov.length - top[1].size;
  need(shift > 0 && bytes.length + shift + secondMedia.length < 0x100000000, 'Output is too large');
  const fakeStart = bytes.length + shift + 8;
  const moov = rebuildMoov(bytes, top[1], video, factor, multiplier, shift, fakeStart, fakePayload.length);
  need(moov.length === testMoov.length, 'MP4 offset relocation was unstable');
  const result = join(bytes.slice(0, top[0].end), moov, bytes.slice(top[2].start), secondMedia);
  const out = boxes(result, 0, result.length);
  need(out.length === 4 && out[3].type === 'mdat', 'Final MP4 structure mismatch');
  const located = findVideo(result, out[1]);
  const updated = parseVideo(result, located.stbl, located.mdhd);
  const outputMedia = readMediaTimebase(result, updated.mdhd);
  need(outputMedia.timescale === sourceMedia.timescale * multiplier &&
    outputMedia.duration === sourceMedia.duration * multiplier,
    'Output media timebase or duration mismatch');
  need(updated.count === video.count * factor, 'Declared density count mismatch');
  for (let i = 0; i < video.count; i++) {
    const a = bytes.subarray(video.offsets[i], video.offsets[i] + video.sizes[i]);
    const off = updated.offsets[i * factor], b = result.subarray(off, off + video.sizes[i]);
    need(a.length === b.length && a.every((byte, j) => byte === b[j]),
      'Real compressed sample changed: ' + i);
  }
  return {
    bytes: result,
    report: {
      codec: video.codec, factor, timebaseMultiplier: multiplier,
      sourceTimescale: sourceMedia.timescale, outputTimescale: outputMedia.timescale,
      originalSamples: video.count, declaredSamples: updated.count,
      pseudoSamples: pseudoCount, realPayloadIdentical: true,
      beforeBytes: bytes.length, afterBytes: result.length,
      warning: 'Filler-only samples are not pictures; decoding or Public posting may fail.'
    }
  };
}


/**
 * Trailing-sample diagnostic: all original compressed pictures remain the FIRST
 * samples in decode order. The appended samples remain non-picture filler.
 * This is NOT a compliant stream or a TikTok public-quality workaround.
 */
export function buildTrailingDensity(input, factor = 10) {
  need(factor === 2 || factor === 10, 'Density factor must be 2 or 10');
  const { bytes, top, video } = inspectNormalizedMp4(input);
  const media = readMediaTimebase(bytes, video.mdhd);
  const fillerBytes = filler(video.codec);
  const extra = video.count * (factor - 1);
  const sampleCount = video.count + extra;
  need(sampleCount <= 150000, 'Expanded sample count exceeds safe limit');
  const fake = new Uint8Array(extra * fillerBytes.length);
  for (let i = 0; i < fake.length; i += fillerBytes.length) fake.set(fillerBytes, i);
  const secondMedia = box('mdat', fake);
  const sourceRows = positions(bytes, video.stts, 8).map((p) => [uint(bytes, p), uint(bytes, p + 4)]);
  need(sourceRows.reduce((sum, row) => sum + row[0], 0) === video.count,
    'Source timing table count differs from sample count');
  const lastDelta = sourceRows[sourceRows.length - 1][1];
  need(lastDelta > 0, 'Last real frame has no duration');
  const durations = sourceRows.concat([[extra, lastDelta]]);
  const sourceCtts = video.ctts ? positions(bytes, video.ctts, 8).map((p) =>
    [uint(bytes, p), uint(bytes, p + 4)]) : null;
  if (sourceCtts) need(sourceCtts.reduce((sum, row) => sum + row[0], 0) === video.count,
    'Source composition table count differs from sample count');
  const rebuild = (shift, fakeStart) => {
    const replacements = new Map();
    const sizes = video.sizes.concat(Array(extra).fill(fillerBytes.length));
    const stsz = new Uint8Array(12 + sampleCount * 4);
    stsz.set(bytes.slice(video.stsz.body, video.stsz.body + 4));
    put(stsz, 4, 0); put(stsz, 8, sampleCount);
    sizes.forEach((size, i) => put(stsz, 12 + 4 * i, size));
    replacements.set(video.stsz.start, box('stsz', stsz));
    replacements.set(video.stts.start, table(bytes, video.stts, 8, durations));
    replacements.set(video.stsc.start, table(bytes, video.stsc, 12, [[1, 1, 1]]));
    const offsets = video.offsets.map((n) => n + shift);
    for (let i = 0; i < extra; i++) offsets.push(fakeStart + i * fillerBytes.length);
    const stride = video.stco.type === 'co64' ? 8 : 4;
    const offsetData = new Uint8Array(8 + offsets.length * stride);
    offsetData.set(bytes.slice(video.stco.body, video.stco.body + 4));
    put(offsetData, 4, offsets.length);
    offsets.forEach((offset, i) => {
      if (stride === 8) put64(offsetData, 8 + i * stride, offset);
      else put(offsetData, 8 + i * stride, offset);
    });
    replacements.set(video.stco.start, box(video.stco.type, offsetData));
    // Sync samples retain their original sample numbers; filler is appended.
    if (sourceCtts) replacements.set(video.ctts.start,
      table(bytes, video.ctts, 8, sourceCtts.concat([[extra, 0]])));
    const rewrite = (item) => {
      if (replacements.has(item.start)) return replacements.get(item.start);
      if (item.type === 'stco' || item.type === 'co64') {
        const copy = original(bytes, item), step = item.type === 'co64' ? 8 : 4;
        for (const p of positions(bytes, item, step)) {
          const next = (step === 8 ? get64(bytes, p) : uint(bytes, p)) + shift;
          if (step === 8) put64(copy, p - item.start, next);
          else put(copy, p - item.start, next);
        }
        return copy;
      }
      if (!['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(item.type))
        return original(bytes, item);
      return box(item.type, join(...children(bytes, item).map(rewrite)));
    };
    return rewrite(top[1]);
  };
  const firstPass = rebuild(0, 0);
  const shift = firstPass.length - top[1].size;
  need(shift > 0 && bytes.length + shift + secondMedia.length < 0x100000000,
    'Expanded file is too large');
  const trailingStart = bytes.length + shift + 8;
  const moov = rebuild(shift, trailingStart);
  need(moov.length === firstPass.length, 'Unstable MP4 relocation');
  const result = join(bytes.slice(0, top[0].end), moov, bytes.slice(top[2].start), secondMedia);
  const output = inspectNormalizedMp4WithTrailing(result);
  need(output.video.count === sampleCount, 'Output declared sample count mismatch');
  const outputMedia = readMediaTimebase(result, output.video.mdhd);
  need(outputMedia.timescale === media.timescale && outputMedia.duration === media.duration,
    'Real video media duration changed');
  for (let i = 0; i < video.count; i++) {
    const originalSample = bytes.subarray(video.offsets[i], video.offsets[i] + video.sizes[i]);
    const off = output.video.offsets[i];
    const patchedSample = result.subarray(off, off + video.sizes[i]);
    need(originalSample.length === patchedSample.length &&
      originalSample.every((value, j) => value === patchedSample[j]),
      'Real video sample mismatch at ' + i);
  }
  for (let i = video.count; i < sampleCount; i++) {
    need(output.video.sizes[i] === fillerBytes.length &&
      output.video.offsets[i] === trailingStart + (i - video.count) * fillerBytes.length,
      'Non-picture samples were inserted before the original video finished');
  }
  return {
    bytes: result,
    report: {
      mode: 'trailing diagnostic', factor, codec: video.codec,
      originalSamples: video.count, declaredSamples: sampleCount, pseudoSamples: extra,
      originalPicturesFirst: true, realPayloadIdentical: true,
      sourceTimescale: media.timescale, outputTimescale: outputMedia.timescale,
      originalDurationTicks: media.duration, outputDurationTicks: outputMedia.duration,
      beforeBytes: bytes.length, afterBytes: result.length,
      warning: 'Trailing filler is NOT decodable video. Full decode and TikTok Public status are unverified.'
    }
  };
}
function inspectNormalizedMp4WithTrailing(input) {
  const bytes = asBytes(input), top = boxes(bytes, 0, bytes.length);
  need(top.length === 4 && top[0].type === 'ftyp' && top[1].type === 'moov' &&
    top[2].type === 'mdat' && top[3].type === 'mdat', 'Expected canonical MP4 with trailing media');
  const track = findVideo(bytes, top[1]);
  return { bytes, top, video: parseVideo(bytes, track.stbl, track.mdhd) };
}
