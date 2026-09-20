import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  Quality,
  canEncodeVideo,
} from "https://cdn.jsdelivr.net/npm/mediabunny@1.56.3/+esm";

const $ = (s) => document.querySelector(s);
const fileEl = $("#file"),
  run = $("#run"),
  stop = $("#stop"),
  reset = $("#reset"),
  bar = $("#bar"),
  status = $("#status"),
  progressPhase = $("#progressPhase"),
  progressNumbers = $("#progressNumbers"),
  meta = $("#meta"),
  analysis = $("#analysis"),
  result = $("#result"),
  resultText = $("#resultText"),
  diag = $("#diag"),
  share = $("#share"),
  download = $("#download"),
  beforeReport = $("#beforeReport"),
  afterReport = $("#afterReport"),
  copyBefore = $("#copyBefore"),
  copyAfter = $("#copyAfter"),
  copyBoth = $("#copyBoth"),
  qualityPanel = $("#qualityPanel"),
  qualityWarning = $("#qualityWarning"),
  compressPanel = $("#compressPanel"),
  compressWarning = $("#compressWarning"),
  cap = $("#cap");
const outputSize = $("#outputSize"),
  outputFps = $("#outputFps"),
  bitrate = $("#bitrate"),
  fit = $("#fit"),
  brightness = $("#brightness"),
  contrast = $("#contrast"),
  saturation = $("#saturation"),
  smoothing = $("#smoothing");
const compressLevel = $("#compressLevel"),
  compressCodec = $("#compressCodec");

let inputFile = null,
  input = null,
  videoTrack = null,
  audioTrack = null,
  sourceFps = NaN,
  sourceDuration = NaN,
  sourceFrames = NaN,
  sourceW = 0,
  sourceH = 0,
  sourceColor = null,
  videoCodec = null,
  audioCodec = null,
  videoConfig = null,
  audioConfig = null,
  rotation = 0,
  currentRun = false,
  currentConversion = null,
  outputBlob = null,
  outputName = "",
  objectUrl = null,
  beforeText = "",
  afterText = "",
  fileToken = 0,
  codecReady = false,
  hevcReady = false,
  wakeLock = null,
  progressStarted = 0,
  progressTimer = null,
  lastProgress = { message: "Waiting", percent: 0, detail: "0 MB" };

const bytes = (n) =>
  n < 1024
    ? n + " B"
    : n < 1048576
      ? (n / 1024).toFixed(1) + " KB"
      : (n / 1048576).toFixed(2) + " MB";
const time = (s) => (Number.isFinite(s) ? `${s.toFixed(3)} s` : "Unknown");
const selectedMode = () =>
  document.querySelector('input[name="mode"]:checked')?.value ||
  "losslessTiming";
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const colorValue = (obj, ...keys) => {
  for (const key of keys) {
    if (obj?.[key] != null) return String(obj[key]);
  }
  return "";
};
function colorObjectIsHdr(color) {
  const p = colorValue(color, "primaries", "colorPrimaries"),
    t = colorValue(color, "transfer", "transferCharacteristics");
  return /2020|hlg|arib|pq|2084/.test((p + " " + t).toLowerCase());
}
function colorLabel() {
  const t = colorValue(sourceColor, "transfer", "transferCharacteristics");
  return `${colorObjectIsHdr(sourceColor) ? "HDR" : "SDR"}${t ? " • " + t : ""}`;
}
function sourceIsHdr() {
  return colorLabel().startsWith("HDR");
}
function elapsedText() {
  if (!progressStarted) return "";
  const seconds = Math.max(
    0,
    Math.floor((performance.now() - progressStarted) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function paintProgress() {
  const p = Number.isFinite(lastProgress.percent)
    ? Math.max(0, Math.min(100, lastProgress.percent))
    : 0;
  bar.style.width = p + "%";
  progressPhase.textContent = lastProgress.message;
  progressNumbers.textContent = `${Math.round(p)}% • ${lastProgress.detail}${progressStarted ? " • " + elapsedText() : ""}`;
}
function startProgress() {
  progressStarted = performance.now();
  clearInterval(progressTimer);
  lastProgress = { message: "Starting…", percent: 0, detail: "0 MB" };
  progressTimer = setInterval(paintProgress, 1000);
}
function stopProgressClock() {
  clearInterval(progressTimer);
  progressTimer = null;
}
function setStatus(msg, p, detail) {
  status.textContent = msg;
  lastProgress = {
    message: msg,
    percent: Number.isFinite(p)
      ? Math.max(lastProgress.percent, p)
      : lastProgress.percent,
    detail: detail || lastProgress.detail,
  };
  paintProgress();
}

let miQueue = Promise.resolve();
const mediaInfoReady = window.MediaInfo.mediaInfoFactory({
  format: "text",
  full: true,
  coverData: false,
  chunkSize: 1024 * 1024,
  locateFile: (path, prefix) =>
    path === "MediaInfoModule.wasm"
      ? "https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.7/dist/MediaInfoModule.wasm"
      : `${prefix}${path}`,
});
function inspectMedia(blob, name, onRead) {
  const job = async () => {
    const mi = await mediaInfoReady;
    let readBytes = 0;
    const readChunk = async (chunkSize, offset) => {
      const data = new Uint8Array(
        await blob.slice(offset, offset + chunkSize).arrayBuffer(),
      );
      readBytes = Math.min(blob.size, readBytes + data.byteLength);
      onRead?.(readBytes, blob.size);
      return data;
    };
    const raw = await mi.analyzeData(blob.size, readChunk);
    onRead?.(blob.size, blob.size);
    return `HAMODYBR Video Inspector\nFile: ${name}\nFile size: ${bytes(blob.size)}\n\n${raw}`;
  };
  miQueue = miQueue.catch(() => {}).then(job);
  return miQueue;
}
async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = "Copied ✓";
    setTimeout(() => (button.textContent = old), 1200);
  } catch {}
}
copyBefore.onclick = () => copyText(beforeText, copyBefore);
copyAfter.onclick = () => copyText(afterText, copyAfter);
copyBoth.onclick = () =>
  copyText(
    `===== BEFORE =====\n${beforeText}\n\n===== AFTER =====\n${afterText}`,
    copyBoth,
  );

function setPreset(mode) {
  const cells = [...document.querySelectorAll(".preset div")];
  let rows;
  if (mode === "losslessTiming")
    rows = [
      ["Video payload", "Packet copy • unchanged"],
      ["Audio payload", "Packet copy • unchanged"],
      ["Timing", "×2 timestamps + durations"],
      ["FPS target", "~60 → ~30"],
      ["Duration target", "~2× source"],
      ["Lossless Guard", "bytes + hash + frame count"],
    ];
  else if (mode === "losslessRemux")
    rows = [
      ["Video payload", "Packet copy • unchanged"],
      ["Audio payload", "Packet copy • unchanged"],
      ["Timing", "Original timing"],
      ["FPS target", "Source FPS"],
      ["Duration target", "Source duration"],
      ["Lossless Guard", "bytes + hash + frame count"],
    ];
  else if (mode === "smartCompress")
    rows = [
      ["Video path", "Efficient hardware re-encode"],
      ["Audio path", "Copy when compatible"],
      ["Resolution", "Original • no resize"],
      ["Frame rate", "Original • no conversion"],
      ["Duration", "Original timing"],
      ["Goal", "Smaller file • minimal visual change"],
    ];
  else
    rows = [
      ["Video path", "Hardware H.264 re-encode"],
      ["Audio path", "Copy when compatible"],
      ["Adjustments", "All OFF by default"],
      ["Frame rate", "Original by default"],
      ["Output size", "Original by default"],
      ["Inspector", "Before + after report"],
    ];
  cells.forEach((cell, i) => {
    cell.querySelector("b").textContent = rows[i][0];
    cell.querySelector("span").textContent = rows[i][1];
  });
}
function refreshMode() {
  const mode = selectedMode();
  document
    .querySelectorAll(".modeCard")
    .forEach((card) =>
      card.classList.toggle("active", card.querySelector("input").checked),
    );
  qualityPanel.hidden = mode !== "qualityLab";
  compressPanel.hidden = mode !== "smartCompress";
  setPreset(mode);
  run.textContent =
    mode === "losslessTiming"
      ? "Build V3.4 lossless timing file"
      : mode === "losslessRemux"
        ? "Build lossless remux"
        : mode === "smartCompress"
          ? "Create smaller video"
          : "Build optional Quality Lab file";
  refreshRun();
}
document
  .querySelectorAll('input[name="mode"]')
  .forEach((el) => el.addEventListener("change", refreshMode));
[
  outputSize,
  outputFps,
  bitrate,
  fit,
  brightness,
  contrast,
  saturation,
  smoothing,
  compressLevel,
  compressCodec,
].forEach((el) => el.addEventListener("change", refreshRun));

function compressionPlan() {
  const ratios = { gentle: 0.75, balanced: 0.55, smaller: 0.4 },
    ratio = ratios[compressLevel.value] || 0.75,
    sourceMbps =
      inputFile && sourceDuration > 0
        ? (inputFile.size * 8) / sourceDuration / 1e6
        : 20,
    targetMbps = Math.max(2, Math.min(60, sourceMbps * ratio)),
    requested = compressCodec.value,
    codec =
      requested === "auto"
        ? (sourceIsHdr() || videoCodec === "hevc") && hevcReady
          ? "hevc"
          : "avc"
        : requested,
    estimatedBytes = (sourceDuration * targetMbps * 1e6) / 8;
  return { ratio, sourceMbps, targetMbps, codec, estimatedBytes };
}
function refreshRun() {
  const mode = selectedMode(),
    hasSource = !!(
      inputFile &&
      videoTrack &&
      videoCodec &&
      videoConfig &&
      Number.isFinite(sourceFps)
    ),
    timingOk = sourceFps >= 55 && sourceFps <= 65,
    smartPlan =
      hasSource && mode === "smartCompress" ? compressionPlan() : null,
    smartHdrOk =
      mode !== "smartCompress" ||
      !hasSource ||
      !sourceIsHdr() ||
      smartPlan?.codec === "hevc",
    compressEngineOk =
      mode !== "smartCompress" ||
      (compressCodec.value === "hevc"
        ? hevcReady
        : compressCodec.value === "avc"
          ? codecReady
          : hevcReady || codecReady),
    engineOk =
      (mode !== "qualityLab" || codecReady) && compressEngineOk && smartHdrOk;
  run.disabled = !(
    hasSource &&
    engineOk &&
    !currentRun &&
    (mode !== "losslessTiming" || timingOk)
  );
  if (!hasSource) return;
  analysis.hidden = false;
  if (mode === "losslessTiming") {
    if (timingOk) {
      analysis.className = "note ok";
      analysis.innerHTML = `<b>Recommended Lossless Timing ready ✓</b> ${sourceFps.toFixed(3)} FPS → ${(sourceFps / 2).toFixed(3)} FPS timing. Encoded video/audio payloads remain unchanged.`;
    } else {
      analysis.className = "note bad";
      analysis.innerHTML = `<b>Lossless Timing expects a ~60 FPS source.</b> Detected ${sourceFps.toFixed(3)} FPS. Choose Lossless Remux, Smart Compress or Quality Lab for this file.`;
    }
  } else if (mode === "losslessRemux") {
    analysis.className = "note ok";
    analysis.innerHTML = `<b>Lossless Remux ready ✓</b> Original ${sourceFps.toFixed(3)} FPS and duration will be preserved while the MP4 container is rebuilt.`;
  } else if (mode === "smartCompress") {
    const plan = compressionPlan(),
      codecOk = plan.codec === "hevc" ? hevcReady : codecReady;
    analysis.className = codecOk && smartHdrOk ? "note warn" : "note bad";
    analysis.innerHTML = !smartHdrOk
      ? "<b>HDR safety:</b> choose Auto or HEVC. H.264 compression is disabled for this HDR source so its HDR signaling is not accidentally lost."
      : codecOk
        ? `<b>Smart Compress will re-encode the video.</b> Target about ${plan.targetMbps.toFixed(1)} Mb/s using ${plan.codec.toUpperCase()}, with an estimated size near ${bytes(plan.estimatedBytes)}. Resolution, FPS, duration and rotation remain unchanged.${sourceIsHdr() ? " HDR preservation will be verified before the result is accepted." : ""}`
        : `<b>${plan.codec.toUpperCase()} encoder is unavailable.</b> Choose Auto or another codec.`;
    compressWarning.innerHTML = `<b>${compressLevel.options[compressLevel.selectedIndex].text}.</b> No resize, crop, FPS conversion or visual filter. Estimated reduction: about ${Math.round((1 - plan.estimatedBytes / inputFile.size) * 100)}%. Re-encoding can still cause a very small visual difference.`;
  } else {
    const adjustments = [];
    if (outputSize.value !== "original") adjustments.push("1080 output");
    if (outputFps.value !== "original")
      adjustments.push(outputFps.value + " FPS");
    if (brightness.value !== "1") adjustments.push("brightness");
    if (contrast.value !== "1") adjustments.push("contrast");
    if (saturation.value !== "1") adjustments.push("saturation");
    if (smoothing.value !== "0") adjustments.push("smoothing");
    analysis.className = "note warn";
    analysis.innerHTML = `<b>Quality Lab will re-encode the video.</b> ${adjustments.length ? "Enabled: " + adjustments.join(", ") + "." : "No visual adjustments enabled; this is a compatibility re-encode."}${sourceIsHdr() ? " HDR input detected: use a lossless mode to preserve its original HDR payload." : ""}`;
    qualityWarning.innerHTML = sourceIsHdr()
      ? "<b>HDR source detected.</b> Quality Lab may alter HDR. Lossless Timing or Lossless Remux is recommended. SDR→HDR conversion is not faked by metadata."
      : "<b>All adjustments are OFF by default.</b> This source is SDR. SDR→HDR conversion is intentionally not faked by metadata.";
  }
}

async function capability() {
  try {
    const q = new Quality({ bitrate: 20e6, bitrateMode: "constant" });
    const [avc, hevc] = await Promise.all([
      canEncodeVideo("avc", {
        width: 1080,
        height: 1920,
        quality: q,
        hardwareAcceleration: "prefer-hardware",
      }).catch(() => false),
      canEncodeVideo("hevc", {
        width: 1080,
        height: 1920,
        quality: q,
        hardwareAcceleration: "prefer-hardware",
      }).catch(() => false),
      mediaInfoReady,
    ]);
    codecReady = !!avc;
    hevcReady = !!hevc;
    if (!codecReady && !hevcReady)
      throw new Error("No compatible hardware video encoder is available");
    cap.className = "note ok";
    cap.innerHTML = `<b>Engines ready ✓</b> Lossless packet copy, MediaInfo and optional hardware encoding are available (${[codecReady ? "H.264" : null, hevcReady ? "HEVC" : null].filter(Boolean).join(" + ")}).`;
  } catch (e) {
    codecReady = hevcReady = false;
    cap.className = "note warn";
    cap.innerHTML =
      "<b>Lossless modes are ready.</b> Optional re-encode tools are unavailable on this browser: " +
      (e?.message || e);
  } finally {
    refreshRun();
  }
}
capability();

function hashInit() {
  return { h: 0xcbf29ce484222325n, total: 0, packets: 0 };
}
function hashFeed(state, data) {
  let h = state.h;
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data[i]);
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  state.h = h;
  state.total += data.length;
  state.packets++;
}
function hashText(state) {
  return state.h.toString(16).padStart(16, "0");
}
async function scanTrack(track, onProgress) {
  const sink = new EncodedPacketSink(track),
    state = hashInit();
  for await (const p of sink.packets()) {
    hashFeed(state, p.data);
    if (state.packets % 120 === 0) onProgress?.(state);
  }
  onProgress?.(state);
  return state;
}

fileEl.onchange = async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  const token = ++fileToken;
  startProgress();
  inputFile = f;
  beforeText = afterText = "";
  beforeReport.textContent = "Reading full MediaInfo report…";
  afterReport.textContent = "The output report will appear after processing.";
  copyBefore.disabled = copyAfter.disabled = copyBoth.disabled = true;
  result.classList.remove("show");
  meta.hidden = false;
  [
    "name",
    "fileSize",
    "codec",
    "fps",
    "frames",
    "size",
    "color",
    "duration",
  ].forEach(
    (id) => ($("#" + id).textContent = id === "name" ? f.name : "Analyzing…"),
  );
  $("#fileSize").textContent = bytes(f.size);
  setStatus(
    "File selected locally — preparing the on-device reader…",
    2,
    `0 MB / ${bytes(f.size)} • no internet upload`,
  );
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(f) });
    setStatus(
      "Opening the local video container…",
      5,
      `0 MB / ${bytes(f.size)} • no internet upload`,
    );
    [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!videoTrack) throw new Error("No video track found");
    const reportPromise = inspectMedia(f, f.name, (read, total) => {
      if (token !== fileToken) return;
      const p = total ? (read / total) * 100 : 0;
      setStatus(
        "Reading local file for the full inspector report…",
        10 + p * 0.45,
        `${bytes(read)} / ${bytes(total)} read locally`,
      );
    });
    setStatus(
      "Analyzing source packets, dimensions and HDR color…",
      12,
      `local file ${bytes(f.size)}`,
    );
    const [metrics, dur, stats, w, h, cs, vCodec, vCfg, rot, aCodec, aCfg] =
      await Promise.all([
        videoTrack.computeFrameRateMetrics({ targetPacketCount: 256 }),
        videoTrack.computeDuration(),
        videoTrack.computePacketStats(),
        videoTrack.getDisplayWidth(),
        videoTrack.getDisplayHeight(),
        videoTrack.getColorSpace().catch(() => null),
        videoTrack.getCodec(),
        videoTrack.getDecoderConfig(),
        videoTrack.getRotation(),
        audioTrack ? audioTrack.getCodec() : Promise.resolve(null),
        audioTrack ? audioTrack.getDecoderConfig() : Promise.resolve(null),
      ]);
    if (token !== fileToken) return;
    sourceFps = metrics.bestGuessFrameRate;
    sourceDuration = dur;
    sourceFrames = stats.packetCount;
    sourceW = w;
    sourceH = h;
    sourceColor = cs;
    videoCodec = vCodec;
    videoConfig = vCfg;
    rotation = rot;
    audioCodec = aCodec;
    audioConfig = aCfg;
    $("#codec").textContent = videoCodec || "Unknown";
    $("#fps").textContent = sourceFps.toFixed(3) + " FPS";
    $("#frames").textContent = String(sourceFrames);
    $("#size").textContent = `${sourceW} × ${sourceH}`;
    $("#color").textContent = colorLabel();
    $("#duration").textContent = time(sourceDuration);
    refreshRun();
    setStatus(
      "Video metadata ready — finishing the local inspector report…",
      72,
      `${bytes(f.size)} local file`,
    );
    try {
      const text = await reportPromise;
      if (token !== fileToken) return;
      beforeText = text;
      beforeReport.textContent = text;
      copyBefore.disabled = false;
      copyBoth.disabled = !(beforeText && afterText);
    } catch (e) {
      beforeReport.textContent = "MediaInfo failed: " + (e?.message || e);
    }
    if (token !== fileToken) return;
    setStatus(
      "Source ready — choose a mode and start processing.",
      100,
      `${bytes(f.size)} ready locally`,
    );
    stopProgressClock();
  } catch (e) {
    stopProgressClock();
    analysis.hidden = false;
    analysis.className = "note bad";
    analysis.textContent = "Source analysis failed: " + (e?.message || e);
    setStatus("Source analysis failed.", 0, `${bytes(f.size)} local file`);
  }
};

reset.onclick = () => {
  if (currentRun) return;
  ++fileToken;
  fileEl.value = "";
  inputFile = input = videoTrack = audioTrack = null;
  sourceFps = sourceDuration = sourceFrames = NaN;
  sourceW = sourceH = 0;
  sourceColor = null;
  videoCodec = audioCodec = videoConfig = audioConfig = null;
  beforeText = afterText = "";
  meta.hidden = true;
  analysis.hidden = true;
  result.classList.remove("show");
  stopProgressClock();
  progressStarted = 0;
  lastProgress = { message: "Waiting", percent: 0, detail: "0 MB" };
  paintProgress();
  beforeReport.textContent = "Choose a video to generate the full report.";
  afterReport.textContent = "The output report will appear after processing.";
  copyBefore.disabled = copyAfter.disabled = copyBoth.disabled = true;
  status.textContent = "Choose an MP4/MOV source.";
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  refreshRun();
};
stop.onclick = async () => {
  if (!currentConversion) return;
  stop.disabled = true;
  setStatus("Stopping safely…");
  try {
    await currentConversion.cancel();
  } catch {}
};
async function holdWake() {
  try {
    if ("wakeLock" in navigator)
      wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
async function releaseWake() {
  try {
    await wakeLock?.release();
  } catch {}
  wakeLock = null;
}

async function verifiedOutputMetrics(blob) {
  const outInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    }),
    v = await outInput.getPrimaryVideoTrack(),
    a = await outInput.getPrimaryAudioTrack();
  if (!v) throw new Error("Output video track missing");
  const [vStats, vDur, vMetrics, vCodec, vHash, aStats, aDur, aCodec, aHash] =
    await Promise.all([
      v.computePacketStats(),
      v.computeDuration(),
      v.computeFrameRateMetrics({ targetPacketCount: 256 }),
      v.getCodec(),
      scanTrack(v),
      a ? a.computePacketStats() : Promise.resolve(null),
      a ? a.computeDuration() : Promise.resolve(NaN),
      a ? a.getCodec() : Promise.resolve(null),
      a ? scanTrack(a) : Promise.resolve(null),
    ]);
  return { vStats, vDur, vMetrics, vCodec, vHash, aStats, aDur, aCodec, aHash };
}
async function basicOutputMetrics(blob) {
  const outInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    }),
    v = await outInput.getPrimaryVideoTrack();
  if (!v) throw new Error("Output video track missing");
  const [stats, duration, metrics, codec, w, h, color, rot] = await Promise.all(
    [
      v.computePacketStats(),
      v.computeDuration(),
      v.computeFrameRateMetrics({ targetPacketCount: 256 }),
      v.getCodec(),
      v.getDisplayWidth(),
      v.getDisplayHeight(),
      v.getColorSpace().catch(() => null),
      v.getRotation(),
    ],
  );
  return { stats, duration, metrics, codec, w, h, color, rotation: rot };
}
async function saveReady(blob, name, text, details) {
  outputBlob = blob;
  outputName = name;
  resultText.textContent = text;
  diag.textContent = details;
  result.classList.add("show");
  const sf = new File([blob], name, { type: "video/mp4" });
  share.hidden = !(navigator.share && navigator.canShare?.({ files: [sf] }));
  share.onclick = async () => {
    try {
      await navigator.share({ files: [sf], title: "HAMODYBR Studio V3.4" });
    } catch {}
  };
  download.onclick = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
}

async function runLossless(scale) {
  setStatus(
    "Stage 1/5 — Hashing original packet payloads…",
    8,
    `0 MB / ${bytes(inputFile.size)} scanned locally`,
  );
  const [srcVHash, srcAHash] = await Promise.all([
    scanTrack(videoTrack, (state) =>
      setStatus(
        `Stage 1/5 — Hashing video packets ${state.packets}/${sourceFrames}…`,
        8 + Math.min(12, (state.packets / sourceFrames) * 12),
        `${bytes(state.total)} video payload scanned`,
      ),
    ),
    audioTrack ? scanTrack(audioTrack) : Promise.resolve(null),
  ]);
  setStatus("Stage 2/5 — Creating MP4 packet-copy output…", 22);
  const target = new BufferTarget(),
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
  const vSource = new EncodedVideoPacketSource(videoCodec);
  output.addVideoTrack(vSource, { rotation, frameRate: sourceFps / scale });
  let aSource = null;
  if (audioTrack && audioCodec && audioConfig) {
    aSource = new EncodedAudioPacketSource(audioCodec);
    output.addAudioTrack(aSource);
  }
  await output.start();
  const pipeVideo = (async () => {
    const sink = new EncodedPacketSink(videoTrack);
    let first = true,
      count = 0,
      copiedBytes = 0;
    for await (const p of sink.packets()) {
      const q = p.clone({
        timestamp: p.timestamp * scale,
        duration: p.duration * scale,
      });
      await vSource.add(q, first ? { decoderConfig: videoConfig } : undefined);
      first = false;
      count++;
      copiedBytes += p.data.byteLength;
      if (count % 120 === 0)
        setStatus(
          `Stage 3/5 — Copying video packets ${count}/${sourceFrames}…`,
          25 + Math.min(45, (count / sourceFrames) * 45),
          `${bytes(copiedBytes)} video payload copied locally`,
        );
    }
    vSource.close();
    return count;
  })();
  const pipeAudio = (async () => {
    if (!aSource || !audioTrack) return 0;
    const sink = new EncodedPacketSink(audioTrack);
    let first = true,
      count = 0;
    for await (const p of sink.packets()) {
      const q = p.clone({
        timestamp: p.timestamp * scale,
        duration: p.duration * scale,
      });
      await aSource.add(q, first ? { decoderConfig: audioConfig } : undefined);
      first = false;
      count++;
    }
    aSource.close();
    return count;
  })();
  const [writtenVideo, writtenAudio] = await Promise.all([
    pipeVideo,
    pipeAudio,
  ]);
  await output.finalize();
  if (!target.buffer) throw new Error("Muxer returned no MP4 buffer");
  setStatus("Stage 4/5 — Verifying packet identity…", 76);
  const blob = new Blob([target.buffer], { type: "video/mp4" }),
    out = await verifiedOutputMetrics(blob),
    videoBytesMatch = out.vHash.total === srcVHash.total,
    videoHashMatch = hashText(out.vHash) === hashText(srcVHash),
    videoFramesMatch = out.vStats.packetCount === sourceFrames,
    audioBytesMatch = !srcAHash || out.aHash?.total === srcAHash.total,
    audioHashMatch = !srcAHash || hashText(out.aHash) === hashText(srcAHash),
    durationRatio = out.vDur / sourceDuration,
    fpsTarget = sourceFps / scale,
    fpsOk = Math.abs(out.vMetrics.bestGuessFrameRate - fpsTarget) < 0.05;
  if (!(
    videoBytesMatch &&
    videoHashMatch &&
    videoFramesMatch &&
    audioBytesMatch &&
    audioHashMatch
  ))
    throw new Error("Lossless Guard failed: encoded packet payload changed");
  const base = inputFile.name.replace(/\.[^.]+$/, "") || "video",
    suffix =
      scale === 2
        ? `lossless-${Math.round(sourceFps)}to${Math.round(fpsTarget)}`
        : "lossless-remux",
    name = `${base}-hamodybr-v34-${suffix}.mp4`;
  const details = `Mode: ${scale === 2 ? "lossless packet-copy retime ×2" : "lossless packet-copy remux"}\nVideo codec: ${videoCodec} → ${out.vCodec}\nVideo frames: ${sourceFrames} → ${out.vStats.packetCount} ${videoFramesMatch ? "✓" : ""}\nVideo payload bytes: ${srcVHash.total} → ${out.vHash.total} ${videoBytesMatch ? "✓" : ""}\nVideo payload hash: ${hashText(srcVHash)} → ${hashText(out.vHash)} ${videoHashMatch ? "✓" : ""}\nSource FPS: ${sourceFps.toFixed(3)}\nOutput FPS: ${out.vMetrics.bestGuessFrameRate.toFixed(3)} ${fpsOk ? "✓" : ""}\nSource duration: ${sourceDuration.toFixed(3)} s\nOutput duration: ${out.vDur.toFixed(3)} s\nDuration ratio: ${durationRatio.toFixed(6)}×\nResolution: ${sourceW} × ${sourceH} preserved\nColor profile: ${colorLabel()} preserved in encoded payload\nRotation metadata: ${rotation}°\nVideo packets written: ${writtenVideo}\nAudio codec: ${audioCodec || "none"} → ${out.aCodec || "none"}\nAudio packets written: ${writtenAudio}\nAudio payload hash match: ${audioHashMatch ? "✓" : "✗"}\nRe-encode: NO`;
  await saveReady(
    blob,
    name,
    `${bytes(blob.size)} • encoded video/audio payload preserved • ${out.vMetrics.bestGuessFrameRate.toFixed(3)} FPS • duration ×${durationRatio.toFixed(3)}.`,
    details,
  );
  return { blob, name };
}

async function runSmartCompress() {
  await holdWake();
  stop.hidden = false;
  stop.disabled = false;
  const plan = compressionPlan(),
    q = new Quality({
      bitrate: plan.targetMbps * 1e6,
      bitrateMode: "constant",
    }),
    target = new BufferTarget(),
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    }),
    video = {
      width: even(sourceW),
      height: even(sourceH),
      frameRate: sourceFps,
      codec: plan.codec,
      quality: q,
      keyFrameInterval: 1,
      hardwareAcceleration: "prefer-hardware",
      forceTranscode: true,
    };
  setStatus(
    "Stage 1/4 — Initializing Smart Compress…",
    6,
    `target ≈ ${bytes(plan.estimatedBytes)} • ${plan.codec.toUpperCase()}`,
  );
  const actualEncoderOk = await canEncodeVideo(plan.codec, {
    width: even(sourceW),
    height: even(sourceH),
    quality: q,
    hardwareAcceleration: "prefer-hardware",
  });
  if (!actualEncoderOk)
    throw new Error(
      `${plan.codec.toUpperCase()} hardware encoding is unavailable at ${sourceW}×${sourceH} on this device`,
    );
  currentConversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video,
    copy: { mode: "preferred" },
    showWarnings: false,
  });
  if (!currentConversion.isValid)
    throw new Error("Smart Compress configuration is not valid on this device");
  currentConversion.onProgress = (p) =>
    setStatus(
      `Stage 2/4 — Compressing locally ${Math.round(p * 100)}%`,
      8 + p * 74,
      `≈ ${bytes(plan.estimatedBytes * p)} / ${bytes(plan.estimatedBytes)} estimated output`,
    );
  await currentConversion.execute();
  currentConversion = null;
  if (!target.buffer) throw new Error("Encoder returned no MP4 buffer");
  setStatus(
    "Stage 3/4 — Verifying resolution, FPS, duration and HDR…",
    86,
    `${bytes(target.buffer.byteLength)} generated locally`,
  );
  const blob = new Blob([target.buffer], { type: "video/mp4" }),
    out = await basicOutputMetrics(blob),
    fpsOk = Math.abs(out.metrics.bestGuessFrameRate - sourceFps) < 0.08,
    durationOk =
      Math.abs(out.duration - sourceDuration) <
      Math.max(0.15, 2 / Math.max(1, sourceFps)),
    sizeOk = out.w === sourceW && out.h === sourceH,
    hdrOk = !sourceIsHdr() || colorObjectIsHdr(out.color);
  if (!sizeOk || !fpsOk || !durationOk || !hdrOk) {
    const failed = [
      !sizeOk ? "resolution" : null,
      !fpsOk ? "frame rate" : null,
      !durationOk ? "duration" : null,
      !hdrOk ? "HDR signaling" : null,
    ].filter(Boolean);
    throw new Error(
      "Smart Compress safety check failed: " + failed.join(", ") + " changed",
    );
  }
  const reduction = (1 - blob.size / inputFile.size) * 100,
    base = inputFile.name.replace(/\.[^.]+$/, "") || "video",
    name = `${base}-hamodybr-v34-smart-compress.mp4`,
    details = `Mode: Smart Compress • optional re-encode
Compression: ${compressLevel.value}
Codec: ${videoCodec} → ${out.codec}
Source size: ${bytes(inputFile.size)}
Output size: ${bytes(blob.size)}
Reduction: ${reduction.toFixed(1)}%
Target bitrate: ${plan.targetMbps.toFixed(2)} Mb/s
Resolution: ${sourceW} × ${sourceH} → ${out.w} × ${out.h} ✓
Frame rate: ${sourceFps.toFixed(3)} → ${out.metrics.bestGuessFrameRate.toFixed(3)} FPS ✓
Duration: ${sourceDuration.toFixed(3)} → ${out.duration.toFixed(3)} s ✓
Display orientation: ${sourceW} × ${sourceH} preserved ✓
Rotation metadata: ${rotation}° → ${out.rotation}°
HDR signaling: ${sourceIsHdr() ? (hdrOk ? "preserved ✓" : "failed") : "SDR"}
Resize / crop / visual filters: NO
Re-encode: YES`;
  await saveReady(
    blob,
    name,
    `${bytes(inputFile.size)} → ${bytes(blob.size)} • ${reduction.toFixed(1)}% smaller • original resolution, FPS and duration preserved.`,
    details,
  );
  return { blob, name };
}

async function runQuality() {
  await holdWake();
  stop.hidden = false;
  stop.disabled = false;
  const portrait = sourceH >= sourceW,
    outW =
      outputSize.value === "1080" ? (portrait ? 1080 : 1920) : even(sourceW),
    outH =
      outputSize.value === "1080" ? (portrait ? 1920 : 1080) : even(sourceH),
    fpsTarget =
      outputFps.value === "original" ? sourceFps : Number(outputFps.value),
    reqMbps = Number(bitrate.value),
    q = new Quality({ bitrate: reqMbps * 1e6, bitrateMode: "constant" }),
    target = new BufferTarget(),
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    }),
    b = Number(brightness.value),
    c = Number(contrast.value),
    s = Number(saturation.value),
    blur = Number(smoothing.value),
    filtersActive = b !== 1 || c !== 1 || s !== 1 || blur > 0,
    video = {
      width: outW,
      height: outH,
      fit: fit.value,
      codec: "avc",
      quality: q,
      keyFrameInterval: 0.5,
      hardwareAcceleration: "prefer-hardware",
      forceTranscode: true,
    };
  if (outputFps.value !== "original") video.frameRate = fpsTarget;
  if (filtersActive) {
    const canvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(outW, outH)
          : Object.assign(document.createElement("canvas"), {
              width: outW,
              height: outH,
            }),
      ctx = canvas.getContext("2d", { alpha: false });
    video.process = (sample) => {
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})${blur ? ` blur(${blur}px)` : ""}`;
      sample.draw(ctx, 0, 0, outW, outH);
      ctx.restore();
      return canvas;
    };
    video.processedWidth = outW;
    video.processedHeight = outH;
  }
  setStatus("Stage 1/4 — Initializing optional hardware re-encode…", 7);
  currentConversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video,
    copy: { mode: "preferred" },
    showWarnings: false,
  });
  if (!currentConversion.isValid)
    throw new Error("Quality Lab configuration is not valid on this device");
  currentConversion.onProgress = (p) =>
    setStatus(`Stage 2/4 — Encoding ${Math.round(p * 100)}%`, 10 + p * 70);
  await currentConversion.execute();
  currentConversion = null;
  if (!target.buffer) throw new Error("Encoder returned no MP4 buffer");
  setStatus("Stage 3/4 — Inspecting output…", 84);
  const blob = new Blob([target.buffer], { type: "video/mp4" }),
    out = await basicOutputMetrics(blob),
    base = inputFile.name.replace(/\.[^.]+$/, "") || "video",
    name = `${base}-hamodybr-v34-quality-lab.mp4`,
    enabled = [
      outputSize.value === "1080" ? "1080 output" : null,
      outputFps.value !== "original" ? outputFps.value + " FPS" : null,
      b !== 1 ? `brightness ${Math.round((b - 1) * 100)}%` : null,
      c !== 1 ? `contrast ${Math.round((c - 1) * 100)}%` : null,
      s !== 1 ? `saturation ${Math.round((s - 1) * 100)}%` : null,
      blur ? `smoothing ${blur}px` : null,
    ].filter(Boolean);
  const details = `Mode: Quality Lab • optional re-encode\nSource: ${sourceW} × ${sourceH} • ${sourceFps.toFixed(3)} FPS • ${colorLabel()}\nOutput: ${out.w} × ${out.h} • ${out.metrics.bestGuessFrameRate.toFixed(3)} FPS\nCodec: ${videoCodec} → ${out.codec}\nBitrate request: ${reqMbps} Mb/s\nFit: ${fit.value}\nAdjustments: ${enabled.length ? enabled.join(", ") : "none"}\nFast Start: yes\nHDR generation: NO\nRe-encode: YES`;
  await saveReady(
    blob,
    name,
    `${bytes(blob.size)} • ${out.w}×${out.h} • ${out.metrics.bestGuessFrameRate.toFixed(3)} FPS • optional re-encode complete.`,
    details,
  );
  return { blob, name };
}

run.onclick = async () => {
  if (run.disabled || currentRun) return;
  startProgress();
  currentRun = true;
  refreshRun();
  result.classList.remove("show");
  afterText = "";
  afterReport.textContent = "Processing…";
  copyAfter.disabled = true;
  copyBoth.disabled = true;
  try {
    const mode = selectedMode(),
      made =
        mode === "qualityLab"
          ? await runQuality()
          : mode === "smartCompress"
            ? await runSmartCompress()
            : await runLossless(mode === "losslessTiming" ? 2 : 1);
    setStatus(
      "Generating AFTER MediaInfo report locally…",
      93,
      `0 MB / ${bytes(made.blob.size)}`,
    );
    const outFile = new File([made.blob], made.name, { type: "video/mp4" });
    afterText = await inspectMedia(outFile, made.name, (read, total) =>
      setStatus(
        "Reading the output for its final local report…",
        93 + (total ? read / total : 0) * 6,
        `${bytes(read)} / ${bytes(total)} read locally`,
      ),
    );
    afterReport.textContent = afterText;
    copyAfter.disabled = false;
    copyBoth.disabled = !(beforeText && afterText);
    setStatus(
      mode === "qualityLab"
        ? "Done. Quality Lab output and reports are ready."
        : mode === "smartCompress"
          ? "Done. Smaller video and verification report are ready."
          : "Done. Lossless Guard passed.",
      100,
      `${bytes(made.blob.size)} output ready`,
    );
  } catch (e) {
    console.error(e);
    afterReport.textContent = "Output was not completed.";
    setStatus(
      e?.name === "ConversionCanceledError"
        ? "Stopped."
        : "V3.4 failed: " + (e?.message || e),
      0,
    );
  } finally {
    stopProgressClock();
    currentConversion = null;
    currentRun = false;
    stop.disabled = true;
    stop.hidden = true;
    await releaseWake();
    refreshRun();
  }
};

refreshMode();
