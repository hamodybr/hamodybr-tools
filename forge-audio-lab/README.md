# HAMODYBR Forge Audio Track Lab — isolated experiment

This is a standalone, opt-in research tool hosted separately at `/forge-audio-lab/`. It does **not** change production V3.4 or other site routing. It runs wholly in the browser. No media upload or server API is involved.

## Supported inputs

- Non-fragmented MP4 with exactly one `moov` and one `mdat`, in either order (fast-start or moov-last). Well-formed trailing boxes after `mdat` are supported; a standalone `sidx` is allowed and **does not** imply fragments. Actual `moof`/`mfra` fragmented sources take an optional lossless remux preparation step before this lab's existing MP4-patcher runs. Unstructured trailing bytes remain unsupported.
- Exactly one AVC/H.264 video track and at least one `mp4a` AAC audio track. Other original audio and metadata tracks are preserved; the first AAC track is used as the source for the synthetic track. AAC media timescales other than 48 kHz (including 44.1 kHz) are supported without resampling.
- Supports large files up to approximately **3.87 GiB**, subject to MP4's 32-bit chunk offsets and the size of its metadata. The browser scans small top-level atom headers and reads only `moov` (up to 64 MiB), not the full video payload; it also supports `moov` located after `mdat`. Output is a `Blob` of file-backed slices, the patched `moov`, and a 55,296-byte tail; no full-file `ArrayBuffer` copy.
- A phone/browser can still impose smaller saving, sharing, free-storage or file-provider limits, so the theoretical size is **not** a guarantee on every iPhone.
- Use a compatible SDR/H.264 input such as the earlier HAMODYBR Forge Clean file. An original HEVC/HDR MOV must be separately converted first. Color and frame rate are **not** modified by this tool.

## Experimental transformation

- Preserves the existing video and audio packet bytes; adjusts old chunk offsets when the `moov` atom grows.
- Adds a duplicate AAC track referencing the existing encoded AAC bytes, without its original edit list.
- Extends its `stts`, `stsz`, `stsc`, and `stco`/`co64` tables to reference 6,912 additional eight-byte packets `0000000400000000` placed after `mdat`.
- Intentionally leaves the copied track media-header duration unchanged, resembling the observed Forge structure.
- The added AAC packets are not decodable. The file is not a standards-compliant archival deliverable. **There is no established claim that this changes TikTok's video processing.**

## Verification performed on the user's 16.34-second clean Forge comparison source

`node test.mjs /path/to/clean.mp4 /path/to/output.mp4` or run the public browser lab on the same source. On the local clean source, ffprobe reported 491 AVC frames, 768 primary AAC packets and 7,680 secondary AAC packets. FFmpeg verified unchanged SHA256 copy-stream content on all three tracks when compared to the prior Forge reference; strict decode passed for video and primary audio, while the synthetic audio correctly failed. The MP4 container's headers, exact timing and filesize are **not** byte-for-byte identical to Forge.

## TikTok test protocol

Keep the previously successful Forge original as control; test this generated variant under the same public posting and device settings. View the public rendition on a second account/device and record detailed differences. A downloaded file that byte-matches the uploaded file may reflect the downloader's source selection, and is not proof of streaming rendition quality. Avoid inferring causation from one A/B comparison because the earlier removal also rebuilt the MP4 container.
## Large file regression verification

- Local 45.6-MB Forge Clean reference generated an output SHA256 identical to the previous version: `e5495c5d0f2057eb79e6039579595136e278a18e2a2b6ed76f17268d6686a8df`.
- A synthetic 320-MiB file (same valid A/V samples and extended `mdat`) produced 335,638,010 bytes, 491 video frames, 768 primary AAC packets and 7,680 experimental AAC packets; strict primary video decode succeeded. Browser-side iOS storage/save and actual 320-MiB real-footage TikTok behavior remain unverified.

## Atom layout regression

- Fast-start MP4 (`moov` before `mdat`), default FFmpeg MP4 (`mdat` before `moov`) and MP4 with an extra top-level `free` atom after `mdat` are covered by automated tests.
- The patched chunk offsets apply the size delta only when source payload lies **after** the original `moov` location. Preceding media bytes remain in place. Output retains each original top-level atom (other than rebuilt `moov`) and appends the Forge-like tail outside `mdat`.
- This removes the rigid `Requires a fast-start, non-fragmented MP4 with mdat last` limitation but does **not** add support for HEVC/HDR, multi-track/multi-`mdat` videos, or every MP4 variant.

## AAC timebase update

- Previously the lab rejected every audio media-header timescale except 48000. It now validates the declared timescale is positive and retains the existing audio packets and original media headers as-is.
- The synthetic 6,912 audio samples still have one media-timebase tick each (as observed in the Forge 48-kHz reference). Their nominal extra span is therefore timescale-dependent, and an output from another source is **not** identical to the 48-kHz reference.
- `44.1 kHz` regression checks the main AAC sample rate, both tracks' encoded packet hashes, the extra sample count, and full decode of video plus the valid primary AAC.

## Multiple audio and idempotency (V1.4)

- Previous builds rejected inputs with more than one original audio track; compatible multi-AAC sources now retain all original tracks and add one experimental track. More than two total audio tracks may not be supported by every playback/upload platform, so test the result before relying on it.
- Recognize our existing Forge-like output **only** when a second AAC track contains an extended 6,912 × 8-byte sample table pointing to the exact known 55,296-byte payload after `mdat`. In that case, return the original source file untouched, rather than adding a third intentionally invalid stream.
- Do not silently discard or alter source audio. Malformed files and non-AVC videos remain explicitly unsupported; a message about audio-track count no longer obscures the actual format.

## Fragmented MP4 / Pexels input (V1.5)

- The old guard wrongly rejected any `sidx` index as fragmented. Now only actual `moof`/`mfra` boxes trigger the separate remux path.
- `normalize-fragmented.mjs` uses Mediabunny 1.56.3 from CDN only when a genuine fragmented MP4 is selected. It requires one primary H.264 video and AAC audio stream, `copy: { mode: 'forced' }`, and an output MP4 with fast-start. It fails closed if either stream would be discarded or transcoded.
- The remux stage uses BufferTarget and thus temporarily holds the normalized video in memory. It limits fragmented remux to 220 MiB on iOS and 600 MiB on desktop (the standard non-fragmented lab can still process large files by Blob slicing). These limits are for memory safety and do not change the previous direct MP4 size limit.
- Sources with no audio (common in stock footage) can now receive a valid 48-kHz stereo AAC-LC silence track during the optional preparation step; original video packets are copied without re-encoding. A source with non-AAC audio, or HEVC/HDR video, still requires a separate preparation route and is not silently transcoded. TikTok quality behavior remains an empirical experiment, not a guarantee.
- New automated tests generate a real fragmented H.264/AAC MP4 with FFmpeg, strictly verify original encoded video/audio packet hashes after remux and after Forge Track, and also exercise a non-fragmented MP4 with a standalone sidx atom.

## Silent stock footage (V1.6)

- For either fragmented or ordinary H.264 MP4 with **zero audio tracks**, use forced packet copy for video and add a valid 48 kHz stereo AAC-LC silence track. The source's original picture bytes are preserved, and there was no original audio to change.
- The six-byte AAC-LC silent frame `21 10 04 60 8C 1C` with ASC `11 90` was validated by a strict FFmpeg AAC decode; the standalone sound is encoded silence. Subsequent experimental secondary AAC packets remain deliberately invalid, as before.
- This additional AAC silence step runs only when the source truly has no audio. Non-AAC original sound is *not* discarded or replaced. Remux memory caps remain in effect.
- Automated tests exercise both fragmented and ordinary silent stock-video cases, comparing source and final video packet MD5s, inspecting AAC, and strictly decoding video and primary audio.

## HEVC SDR preparation (V1.7 experimental)

- Compatible HEVC SDR Pexels video gets an **optional** local decode/re-encode stage using Mediabunny's H.264 encoder (nominal target bitrate 6–22 Mbps depending on source resolution), keyframe interval 1 second and original frame rate. This is **not lossless** and is not identical to Forge's private encoder. MP4 audio is kept as AAC and its compressed packet stream is verified against the original; if a source is silent, a valid AAC silent primary track is generated as before.
- Guardrails: check HEVC decodability and H.264 encodability on the current device; reject explicitly tagged HDR/PQ/HLG sources because this path has no validated tone mapping. Unsupported codecs, AAC formats and 4K+ sizes continue to return specific errors. An SDR tag alone does not guarantee color parity in every browser.
- Because this path decodes+re-encodes, the in-memory input cap is 160 MiB on mobile and 360 MiB on desktop. Other AVC MP4 file paths retain their previous caps.
- The site reports whether HEVC conversion happened. The existing Forge AAC sample-table patch is used only after the converted MP4 is checked as AVC/AAC. TikTok quality must be checked on actual posts; automated tests only check media structure and stream decode.

## HEVC HDR / HLG copy-through experiment (V1.8)

- On ordinary nonfragmented MP4, HEVC sample descriptions `hvc1` and `hev1` are now accepted. No video decode, re-encode or tone map occurs: the entire original HEVC payload and color metadata are preserved while the experimental AAC track is appended.
- On genuinely fragmented HEVC, the preparation remux defaults to forced packet copy for the primary HEVC video and AAC audio. Video and audio encoded packets are hashed before and after remux. If a source has no audio, the valid silent AAC addition remains available.
- The earlier HEVC SDR to H.264 conversion remains available only through explicit `normalizeFragmentedFile(..., {videoMode:'avc-sdr'})` in the internal API; it is **not** the default for HDR footage and is not shown as a public automatic option.
- Tests generate genuine 10-bit HLG BT.2020 HEVC and verify compressed video/audio bytes, video color primaries/transfer/space, two original playable streams and the 6,912-packet experimental AAC on regular and fragmented MP4s.
- **Important**: this experiment does not reproduce Forge's full video transcode (reference Forge is H.264 SDR) and has not established whether TikTok preserves HEVC HDR playback or upload quality on the user's actual Pexels file. It deliberately avoids applying unverified SDR tone mapping.
