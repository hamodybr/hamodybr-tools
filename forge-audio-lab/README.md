# HAMODYBR Forge Audio Track Lab — isolated experiment

This is a standalone, opt-in research tool hosted separately at `/forge-audio-lab/`. It does **not** change production V3.4 or other site routing. It runs wholly in the browser. No media upload or server API is involved.

## Supported inputs

- Non-fragmented MP4 with exactly one `moov` and one `mdat`, in either order (fast-start or moov-last). Well-formed trailing boxes after `mdat` are supported; fragmented `moof`/`sidx` and arbitrary unstructured trailing bytes remain unsupported.
- Exactly one AVC/H.264 video track and one `mp4a` AAC audio track. AAC media timescales other than 48 kHz (including 44.1 kHz) are supported without resampling.
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
