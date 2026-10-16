# HAMODYBR Valid Frames — offline proof of concept

This folder is a **separate desktop experiment**, not the production GitHub Pages website. Node.js 20+ and a locally installed FFmpeg + FFprobe on PATH are required. The original video stays on your computer; there is no upload.

## What it does

- Requires a decodable H.264/HEVC **SDR, 8-bit, 4:2:0** source; blocks HDR to avoid silently changing its colors.
- Rejects invalid video input, including files like the earlier NoBlur/pseudo-sample variants that fail strict decoding. Use the camera original or verified packet-copy A as input.
- Builds real H.264 60 FPS picture samples using FFmpeg. The duplicate mode repeats decoded frames (fast, **does not add detail**). The interpolate mode motion-estimates intermediate frames (slow, may introduce artifacts). **Neither is known to preserve quality after Public TikTok posting.**
- Preserves AAC audio by stream copy when possible, writes fast-start MP4, and records metadata and a JSON verification report.
- Performs strict **full video decode** of the output with FFmpeg -xerror. It rejects/deletes an output if count, 60 FPS, duration, audio-presence, color, or decoding checks fail.
- Keeps the source original. Use a **different output filename**; the output will be overwritten if it already exists.

## Windows 11 usage

Install FFmpeg and FFprobe and make sure both version commands work in your terminal. Install Node.js 20+. Run from this directory:

    node valid-frames.mjs --input "C:\Videos\original.mp4" --output "C:\Videos\test-1080.mp4" --mode duplicate --height 1080 --seconds 2

For a brief motion-interpolated test:

    node valid-frames.mjs --input "C:\Videos\original.mp4" --output "C:\Videos\interpolated-preview.mp4" --mode interpolate --height 720 --seconds 2

Only after reviewing small previews, try --height original for original spatial resolution. Full-length 4K motion interpolation can be **very slow and memory-intensive**. Downscaling to 720 or 1080 removes image detail; do not mistake a decodable preview for production-quality output. Default CRF is 17 (lossy); adjust --crf from 0 to 25. A smaller CRF uses more data, not a TikTok quality guarantee.

The command writes output.report.json beside the MP4; require "valid": true and "strictVideoDecode": {"ok": true} before further evaluation.

Run synthetic unit tests:

    node --test valid-frames.test.mjs

## Comparison procedure

1. Use the **same original** for all experiments. Do not feed malformed NoBlur/density-patched MP4 into this pipeline.
2. First verify metadata and complete local video decode. Check the file's visuals and audio manually.
3. Only a completed **Public** TikTok post viewed from another account/device counts for streaming-quality evaluation. Private owner previews and videos under review do not.
4. Record publication status, resolution/bitrate of the actually delivered rendition when accessible, and compare matching frames.

This milestone replaces broken pseudo-samples with real decodable pictures. It is **not** a fix for TikTok recompression and is not yet integrated with the iPhone browser preview.
