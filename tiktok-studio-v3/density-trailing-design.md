# HAMODYBR trailing-sample diagnostic

The old interleaved sample insertion causes decode errors in the provided `Archive.zip`. This branch keeps original video samples first and appends non-picture filler only after the original video decode sequence. This **does not** repair the trailing filler: a full decode will still report errors, and Public TikTok behavior is unknown. Do not use these outputs as upload-ready. Real sample packet bytes and the original mdhd duration/timescale are guarded. The original interleaved engine remains in source only for reproducibility but is no longer called by the UI.

Before enabling TikTok tests, run `ffmpeg -v error -i output.mp4 -map 0:v:0 -f null -` and verify the decode errors and actual playback behavior. A structure-only check is insufficient.
