import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, Mp4OutputFormat, BufferTarget,
  EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource,
  Quality, canEncodeVideo
} from "https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm";

const $ = (id) => document.getElementById(id);
const fileEl = $("labFile"), sourceEl = $("labSource"), noticeEl = $("labNotice");
const runBtn = $("labRun"), resetBtn = $("labReset"), statusEl = $("labStatus");
const progressEl = $("labProgress"), resultEl = $("labResult"), detailsEl = $("labDetails");
const downloadBtn = $("labDownload"), shareBtn = $("labShare");
let inputFile = null, input = null, sourceVideo = null, sourceAudio = null;
let src = null, current = false, chosen = "A", outputUrl = null, resultBlob = null, resultName = "";
let encoderAvc = false, encoderHevc = false, token = 0;
const fmt = (n) => (n / 1048576).toFixed(2) + " MiB";
const err = (e) => e?.message || String(e);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
function hdr(color) {
  const p = String(color?.primaries ?? color?.colorPrimaries ?? "");
  const t = String(color?.transfer ?? color?.transferCharacteristics ?? "");
  return /2020|hlg|arib|pq|2084/i.test(p + " " + t);
}
function status(s, n = 0) {
  statusEl.textContent = s;
  progressEl.value = Math.min(100, Math.max(0, n));
}
function mode() { return document.querySelector('input[name="labMode"]:checked')?.value || "A"; }
function showState() {
  chosen = mode();
  runBtn.textContent = "Build experiment " + chosen;
  const bDisabled = chosen === "B" && src && (src.hdr || !src.bEncoder || (src.w % 2 || src.h % 2));
  noticeEl.className = bDisabled ? "note bad" : "note warn";
  noticeEl.textContent = chosen === "A"
    ? "A: Lossless compressed-packet copy into a Fast Start MP4, with original timing. This is a control, not a TikTok quality bypass."
    : chosen === "C"
      ? "C: Same unchanged encoded packets with moov metadata placed at the end. This only changes container placement, not picture detail."
      : src?.hdr
        ? "B disabled: HDR source. Re-encoding can change HDR tone mapping or metadata; choose A/C to preserve original encoded video."
        : "B: SDR high-bitrate re-encode to real 60 FPS samples. May duplicate frames; cannot restore missing detail or guarantee TikTok Public quality.";
  runBtn.disabled = !src || current || !!bDisabled;
}
document.querySelectorAll('input[name="labMode"]').forEach((r) => r.addEventListener("change", showState));
async function metrics(v) {
  const [stats, duration, fps, codec, w, h, rotation, color, config] = await Promise.all([
    v.computePacketStats(), v.computeDuration(),
    v.computeFrameRateMetrics({ targetPacketCount: 256 }), v.getCodec(),
    v.getDisplayWidth(), v.getDisplayHeight(), v.getRotation(),
    v.getColorSpace().catch(() => null), v.getDecoderConfig()
  ]);
  return { count: stats.packetCount, duration, fps: fps.bestGuessFrameRate,
    codec, w, h, rotation, color, hdr: hdr(color), config };
}
async function analyze(file) {
  const localToken = ++token;
  src = null; resultEl.hidden = true; resultEl.classList.remove("show"); resultBlob = null;
  sourceEl.textContent = "Reading local file…";
  status("Opening source locally…", 5);
  runBtn.disabled = true;
  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  if (!v) throw new Error("No video track found.");
  const data = await metrics(v);
  if (!Number.isFinite(data.fps) || data.fps <= 0 || !Number.isFinite(data.duration) || data.duration <= 0)
    throw new Error("Invalid duration or FPS.");
  const [audioCodec, audioConfig] = a ? await Promise.all([a.getCodec(), a.getDecoderConfig()]) : [null, null];
  if (a && (!audioCodec || !audioConfig))
    throw new Error("Audio cannot be preserved by the packet-copy path; use a supported file.");
  if (localToken !== token) return;
  const bCodec = data.codec === "hevc" && encoderHevc ? "hevc" : "avc";
  src = { ...data, audioCodec, audioConfig, bCodec, bEncoder: bCodec === "hevc" ? encoderHevc : encoderAvc };
  sourceVideo = v; sourceAudio = a; inputFile = file;
  sourceEl.textContent = file.name + " • " + fmt(file.size) + "\n" +
    data.w + " × " + data.h + " • " + data.fps.toFixed(3) + " FPS • " +
    data.codec.toUpperCase() + " • " + (data.hdr ? "HDR" : "SDR") +
    " • " + data.count + " encoded packets • " + data.duration.toFixed(3) + " s";
  status("Ready. Select an experiment.", 100);
  showState();
}
fileEl.addEventListener("change", async () => {
  const f = fileEl.files?.[0];
  if (!f || current) return;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null; inputFile = null;
  try { await analyze(f); }
  catch (e) { src = null; sourceEl.textContent = "Source failed: " + err(e); status("Source analysis failed.", 0); showState(); }
});
async function comparePackets(firstTrack, secondTrack, label) {
  if (!!firstTrack !== !!secondTrack) throw new Error(label + " track is missing.");
  if (!firstTrack) return 0;
  const a = new EncodedPacketSink(firstTrack).packets()[Symbol.asyncIterator]();
  const b = new EncodedPacketSink(secondTrack).packets()[Symbol.asyncIterator]();
  let count = 0;
  while (true) {
    const [x, y] = await Promise.all([a.next(), b.next()]);
    if (x.done || y.done) {
      if (x.done !== y.done) throw new Error(label + " packet count mismatch.");
      break;
    }
    const ad = x.value.data, bd = y.value.data;
    if (ad.length !== bd.length) throw new Error(label + " packet length changed at " + count);
    for (let i = 0; i < ad.length; i++)
      if (ad[i] !== bd[i]) throw new Error(label + " payload changed at packet " + count);
    count++;
    if (count % 120 === 0) status("Verifying " + label + " packet " + count + "…", 88);
  }
  return count;
}
async function remux(placement) {
  status("Creating packet-copy MP4…", 10);
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: placement === "C" ? false : "in-memory" }),
    target
  });
  const vSource = new EncodedVideoPacketSource(src.codec);
  output.addVideoTrack(vSource, { rotation: src.rotation, frameRate: src.fps });
  let aSource = null;
  if (sourceAudio) {
    aSource = new EncodedAudioPacketSource(src.audioCodec);
    output.addAudioTrack(aSource);
  }
  await output.start();
  const copyV = (async () => {
    const packets = new EncodedPacketSink(sourceVideo), it = packets.packets();
    let first = true, n = 0;
    for await (const packet of it) {
      await vSource.add(packet.clone({ timestamp: packet.timestamp, duration: packet.duration }),
        first ? { decoderConfig: src.config } : undefined);
      first = false; n++;
      if (n % 120 === 0) status("Copying video packet " + n + "/" + src.count + "…", 20 + 48 * n / src.count);
    }
    vSource.close();
    return n;
  })();
  const copyA = (async () => {
    if (!aSource) return;
    let first = true;
    for await (const packet of new EncodedPacketSink(sourceAudio).packets()) {
      await aSource.add(packet.clone({ timestamp: packet.timestamp, duration: packet.duration }),
        first ? { decoderConfig: src.audioConfig } : undefined);
      first = false;
    }
    aSource.close();
  })();
  await Promise.all([copyV, copyA]);
  await output.finalize();
  if (!target.buffer) throw new Error("Muxer returned no data.");
  return new Blob([target.buffer], { type: "video/mp4" });
}
async function valid60() {
  if (src.hdr) throw new Error("Valid 60 FPS disabled for HDR.");
  if (!src.bEncoder || src.w % 2 || src.h % 2)
    throw new Error("Encoder unavailable or dimensions are odd.");
  const targetMbps = Math.min(60, Math.max(20, (inputFile.size * 8 / src.duration / 1e6) * 1.25));
  const bitrateBps = Math.max(1, Math.round(targetMbps * 1e6));
  const q = new Quality({ bitrate: bitrateBps, bitrateMode: "constant" });
  const supported = await canEncodeVideo(src.bCodec, {
    width: src.w, height: src.h, quality: q, hardwareAcceleration: "prefer-hardware"
  });
  if (!supported) throw new Error("This device cannot encode the selected codec and dimensions.");
  status("Initializing real 60 FPS encoding…", 9);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const conversion = await Conversion.init({
    input, output, tracks: "primary",
    video: { codec: src.bCodec, width: src.w, height: src.h, frameRate: 60, fit: "contain",
      quality: q, keyFrameInterval: 1, hardwareAcceleration: "prefer-hardware", forceTranscode: true },
    copy: { mode: "preferred" }, showWarnings: false
  });
  if (!conversion.isValid) throw new Error("60 FPS conversion configuration is not supported.");
  conversion.onProgress = (p) => status("Encoding real video samples… " + Math.round(p * 100) + "%", 10 + 65 * p);
  await conversion.execute();
  if (!target.buffer) throw new Error("Encoder returned no data.");
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), targetMbps };
}
async function verify(blob, selected, targetMbps) {
  status("Inspecting output structure…", 79);
  const outputInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const [outVideo, outAudio] = await Promise.all([
    outputInput.getPrimaryVideoTrack(), outputInput.getPrimaryAudioTrack()
  ]);
  if (!outVideo) throw new Error("Output video track missing.");
  const out = await metrics(outVideo);
  const durationOk = near(out.duration, src.duration, Math.max(.2, 3 / src.fps));
  const displayOk = out.w === src.w && out.h === src.h && near(out.rotation, src.rotation, .01);
  const hdrOk = src.hdr === out.hdr;
  if (!durationOk || !displayOk || !hdrOk) throw new Error("Duration, display geometry, rotation or HDR check failed.");
  let payloadMessage;
  if (selected === "B") {
    if (!near(out.fps, 60, .1) || Math.abs(out.count - out.duration * 60) > 5)
      throw new Error("60 FPS or encoded sample count is inconsistent.");
    if (!["avc", "hevc"].includes(out.codec))
      throw new Error("Unexpected output codec.");
    payloadMessage = "Real re-encoded samples: " + out.count + " (not packet-identical)";
  } else {
    if (!near(out.fps, src.fps, .1) || out.count !== src.count || out.codec !== src.codec)
      throw new Error("Source FPS, packet count or codec changed.");
    const vCount = await comparePackets(sourceVideo, outVideo, "Video");
    await comparePackets(sourceAudio, outAudio, "Audio");
    payloadMessage = "Exact encoded packet payload match: " + vCount + " video packets ✓; audio checked ✓";
  }
  status("Local container checks passed. TikTok is untested.", 100);
  return [
    "EXPERIMENT " + selected + " • LOCAL CHECKS PASSED",
    "File size: " + fmt(inputFile.size) + " → " + fmt(blob.size),
    "Video: " + src.codec + " → " + out.codec,
    "FPS: " + src.fps.toFixed(3) + " → " + out.fps.toFixed(3),
    "Frames: " + src.count + " → " + out.count,
    "Duration: " + src.duration.toFixed(3) + " → " + out.duration.toFixed(3) + " s",
    "Resolution: " + out.w + " × " + out.h + " • rotation " + out.rotation + "°",
    "Color signaling: " + (out.hdr ? "HDR" : "SDR") + " ✓",
    payloadMessage,
    selected === "B" ? "Requested bitrate (not actual): " + targetMbps.toFixed(2) + " Mb/s" : "MP4 metadata: " + (selected === "A" ? "Fast Start" : "moov at end"),
    "No fake/ghost samples are added by this lab.",
    "Not a complete frame-decoding test; not proof of TikTok Public quality."
  ].join("\n");
}
function ready(blob, name, report) {
  resultBlob = blob; resultName = name;
  detailsEl.textContent = report; resultEl.hidden = false; resultEl.classList.add("show");
  const file = new File([blob], name, { type: "video/mp4" });
  shareBtn.hidden = !(navigator.share && navigator.canShare?.({ files: [file] }));
  shareBtn.onclick = async () => { try { await navigator.share({ files: [file], title: "HAMODYBR Valid-Sample Lab" }); } catch {} };
  downloadBtn.onclick = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = outputUrl; a.download = resultName; document.body.appendChild(a); a.click(); a.remove();
  };
}
runBtn.addEventListener("click", async () => {
  if (!src || current) return;
  current = true; fileEl.disabled = true; resetBtn.disabled = true; showState(); resultEl.hidden = true; resultEl.classList.remove("show");
  const selected = mode();
  try {
    const built = selected === "B" ? await valid60() : { blob: await remux(selected), targetMbps: null };
    const report = await verify(built.blob, selected, built.targetMbps);
    const base = inputFile.name.replace(/\.[^.]+$/, "") || "video";
    ready(built.blob, base + "-hamodybr-valid-" + selected + ".mp4", report);
  } catch (e) {
    status("Experiment failed: " + err(e), 0);
  } finally { current = false; fileEl.disabled = false; resetBtn.disabled = false; showState(); }
});
resetBtn.addEventListener("click", () => {
  if (current) return;
  ++token; fileEl.value = ""; inputFile = input = sourceVideo = sourceAudio = src = null;
  resultEl.hidden = true; resultEl.classList.remove("show"); resultBlob = null;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null; sourceEl.textContent = "Choose a video to read its metadata.";
  status("Waiting for a video.", 0); showState();
});
(async () => {
  try {
    const sample = new Quality({ bitrate: 20e6, bitrateMode: "constant" });
    const [avc, hevc] = await Promise.all([
      canEncodeVideo("avc", { width: 1080, height: 1920, quality: sample, hardwareAcceleration: "prefer-hardware" }),
      canEncodeVideo("hevc", { width: 1080, height: 1920, quality: sample, hardwareAcceleration: "prefer-hardware" })
    ]);
    encoderAvc = !!avc; encoderHevc = !!hevc;
  } catch { encoderAvc = encoderHevc = false; }
  if (src) { src.bEncoder = src.bCodec === "hevc" ? encoderHevc : encoderAvc; showState(); }
})();
showState();
