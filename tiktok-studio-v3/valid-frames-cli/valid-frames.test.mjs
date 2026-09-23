import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = join(dirname(fileURLToPath(import.meta.url)), 'valid-frames.mjs');
const temp = await mkdtemp(join(tmpdir(), 'hamodybr-frames-'));
const source = join(temp, 'source.mp4');
try {
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    'testsrc2=size=320x576:rate=30', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000', '-t', '1.2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22',
    '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', source]);

  for (const mode of ['duplicate', 'interpolate']) {
    await test(mode + ': valid 60fps pictures, AAC and strict decoding', async () => {
      const output = join(temp, mode + '.mp4');
      const { stdout } = await exec('node', [script, '--input', source,
        '--output', output, '--mode', mode, '--height', 'original'], { timeout: 120000 });
      const report = JSON.parse(stdout);
      assert.equal(report.valid, true);
      assert.equal(report.strictVideoDecode.ok, true);
      assert.equal(report.outputVideo.fps, 60);
      assert.equal(report.outputVideo.frames, 72);
      assert.equal(report.outputVideo.width, 320);
      assert.equal(report.outputVideo.height, 576);
      assert.equal(report.outputAudio, 'aac');
      await access(output);
    });
  }

  await test('reject unsupported settings before encoding', async () => {
    await assert.rejects(exec('node', [script, '--input', source,
      '--output', join(temp, 'invalid.mp4'), '--mode', 'invalid']),
      /Mode must be duplicate or interpolate/);
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
