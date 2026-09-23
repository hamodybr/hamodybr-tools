// Keep the original AAC bitstream byte-for-byte. Conversion transcodes video only;
// audio packets are supplied independently to the same MP4 Output.
// Do not suppress differences between the source and written packet fingerprints.
export function emptyAacFingerprint() {
  return { packets: 0, bytes: 0, hash: 2166136261 >>> 0 };
}
export function feedAacFingerprint(state, data) {
  for (let i = 0; i < data.length; i++) {
    state.hash = Math.imul(state.hash ^ data[i], 16777619) >>> 0;
  }
  state.bytes += data.length;
  state.packets++;
}
export function sameAacFingerprint(a, b) {
  return !!a && !!b && a.packets === b.packets &&
    a.bytes === b.bytes && a.hash === b.hash;
}
export function aacFingerprintText(s) {
  return s ? s.packets + ' packets / ' + s.bytes + ' bytes / 0x' +
    s.hash.toString(16).padStart(8, '0') : 'none';
}

/** @param {object} options
 * @param {object} options.track - original Mediabunny AudioTrack
 * @param {object} options.sinkFactory - (track)=>AsyncIterable packets in decode order
 * @param {object} options.source - EncodedAudioPacketSource('aac'), already added to Output
 * @param {object} options.decoderConfig - exact original decoder configuration
 * @param {()=>boolean} [options.isCanceled] - abort after current packet when true
 */
export async function pipeOriginalAac({ track, sinkFactory, source, decoderConfig, isCanceled = () => false }) {
  if (!track || !source || !decoderConfig || typeof sinkFactory !== 'function')
    throw new Error('Original AAC packet copy requires source, track and decoder config.');
  const written = emptyAacFingerprint();
  let first = true;
  try {
    for await (const packet of sinkFactory(track)) {
      if (isCanceled()) throw new Error('AAC packet copy canceled.');
      // No decode/re-encode and no timestamp scaling. Writer may remux the MP4
      // container, but must retain each AAC packet's encoded payload.
      await source.add(packet, first ? { decoderConfig } : undefined);
      first = false;
      feedAacFingerprint(written, packet.data);
    }
  } finally {
    source.close();
  }
  if (!written.packets) throw new Error('Source AAC track has no packets.');
  return written;
}
