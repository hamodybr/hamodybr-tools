# HAMODYBR Forge Audio Track Lab — isolated experiment

This is a standalone, opt-in research tool hosted separately at `/forge-audio-lab/`. It does **not** change V3.4, `main` or other site routing until reviewed/merged. It runs wholly in the browser. No media upload or server API is involved.

## Supported inputs

- Fast-start, non-fragmented MP4 ending with `mdat`.
- Exactly one AVC/H.264 video track and one `mp4a` AAC audio track, with a 48 kHz audio media timescale.
- Under 250 MB (browser memory may still be limiting on phones).
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