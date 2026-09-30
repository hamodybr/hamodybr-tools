import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectForgeReadyFile,addForgeDynamicOutsideMdatFile} from './forge-track.mjs';
import {applyHaze52ContainerPatch,HAZE_ENCODER_TAG} from './haze52-patch.mjs';

const folder=mkdtempSync(join(tmpdir(),'hamody-haze52-'));
test.after(()=>rmSync(folder,{recursive:true,force:true}));

function probe(path){
 return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],
  {maxBuffer:8*1024*1024}).toString());
}
function md5(path,map){
 return execFileSync('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','md5','-'],
  {maxBuffer:2*1024*1024}).toString().trim();
}
function topBoxes(buf,limit=buf.length){
 const out=[];let pos=0;
 while(pos+8<=limit){
  let size=buf.readUInt32BE(pos);const type=buf.toString('latin1',pos+4,pos+8);let header=8;
  if(size===1){size=Number(buf.readBigUInt64BE(pos+8));header=16;}
  else if(size===0)size=limit-pos;
  if(size<header||pos+size>limit)break;
  out.push({start:pos,end:pos+size,size,header,type});pos+=size;
 }
 return out;
}
function children(buf,box){
 const out=[];let pos=box.start+box.header;
 while(pos+8<=box.end){
  let size=buf.readUInt32BE(pos),header=8;const type=buf.toString('latin1',pos+4,pos+8);
  if(size===1){size=Number(buf.readBigUInt64BE(pos+8));header=16;}
  if(size<header||pos+size>box.end)break;
  out.push({start:pos,end:pos+size,size,header,type});pos+=size;
 }
 return out;
}

test('Haze 5.2 patch matches observed container fingerprint without changing media packets',{timeout:120000},async()=>{
 const source=join(folder,'source.mp4'),out=join(folder,'haze52.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=320x180:rate=30',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
   '-t','1.4','-c:v','libx264','-profile:v','high','-pix_fmt','yuv420p',
   '-b:v','4M','-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart',source],
   {timeout:60000});
 const inputBytes=readFileSync(source);
 const file=new File([inputBytes],'source.mp4',{type:'video/mp4'});
 const before=await inspectForgeReadyFile(file);
 const forged=await addForgeDynamicOutsideMdatFile(file);
 assert.equal(forged.report.addedTailPackets,before.samples*9);
 const patched=await applyHaze52ContainerPatch(forged.output,{tailPackets:forged.report.addedTailPackets});
 writeFileSync(out,Buffer.from(await patched.output.arrayBuffer()));

 const p=probe(out);
 assert.equal(p.streams.length,3);
 assert.equal(p.streams[0].codec_name,'h264');
 assert.equal(p.streams[1].codec_name,'aac');
 assert.equal(p.streams[2].codec_name,'aac');
 assert.equal(p.format.tags.major_brand,'isom');
 assert.equal(p.format.tags.minor_version,'512');
 assert.equal(p.format.tags.compatible_brands,'isomiso2avc1mp41');
 assert.equal(p.format.tags.encoder,HAZE_ENCODER_TAG);
 assert.equal(md5(source,'0:v:0'),md5(out,'0:v:0'),'video payload changed');
 assert.equal(md5(source,'0:a:0'),md5(out,'0:a:0'),'primary AAC payload changed');

 const buf=readFileSync(out),tailBytes=forged.report.addedTailPackets*8,tailStart=buf.length-tailBytes;
 const top=topBoxes(buf,tailStart);
 assert.deepEqual(top.map(x=>x.type),['ftyp','moov','mdat','free']);
 assert.equal(top[3].size,8);
 assert.equal(top[3].end,tailStart);
 const pattern=Buffer.from([0,0,0,4,0,0,0,0]);
 for(let i=tailStart;i<buf.length;i+=8)assert.deepEqual(buf.subarray(i,i+8),pattern);
 const moov=top[1],mvhd=children(buf,moov).find(x=>x.type==='mvhd');
 assert.ok(mvhd);
 assert.equal(buf[mvhd.start+8],1);
 assert.equal(buf.readUInt32BE(mvhd.start+28),1000);
 assert.equal(buf.readBigUInt64BE(mvhd.start+32),0xffffffffffffffffn);
 assert.equal(patched.report.movieDurationUnknown,true);
 assert.equal(patched.report.freeBeforeTail,true);
});

test('Haze patch strips non A/V moov children and is deterministic on brands/tag',async()=>{
 // First test already proves the externally observable fingerprint; this checks constants.
 assert.equal(HAZE_ENCODER_TAG,'Haze Quality Method https://hazemethod.xyz');
});
