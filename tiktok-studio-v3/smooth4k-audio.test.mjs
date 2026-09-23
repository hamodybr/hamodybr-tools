import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyAacFingerprint, feedAacFingerprint, sameAacFingerprint, aacFingerprintText,
  pipeOriginalAac
} from './smooth4k-audio.mjs';

function fakePacket(bytes, index) {
  return {data:Uint8Array.from(bytes),timestamp:index*1024/48000,duration:1024/48000,type:'key'};
}
const packets=[fakePacket([0x21,0x10,0x04,0x60,0x8c,0x1c],0),fakePacket([1,2,3,4],1),fakePacket([6,7,8],2)];
const config={codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,description:new Uint8Array([0x11,0x90])};

test('AAC source packets retain exact bytes, order, timestamps and decoder config',async()=>{
  const inputs={};const received=[];
  const source={
    async add(packet,meta){received.push({packet,meta});},
    close(){inputs.closed=true;}
  };
  const written=await pipeOriginalAac({
    track:inputs,sinkFactory:async function* (track){assert.equal(track,inputs);for(const p of packets)yield p;},
    source,decoderConfig:config
  });
  const original=emptyAacFingerprint();
  for(const p of packets)feedAacFingerprint(original,p.data);
  assert.equal(sameAacFingerprint(original,written),true);
  assert.equal(inputs.closed,true);
  assert.equal(received.length,3);
  assert.equal(received[0].meta.decoderConfig,config);
  assert.equal(received[1].meta,undefined);
  for(let i=0;i<packets.length;i++)assert.equal(received[i].packet,packets[i]);
});
test('AAC bitstream guard catches re-encode, packet loss and reorder',()=>{
  const a=emptyAacFingerprint(),b=emptyAacFingerprint(),c=emptyAacFingerprint();
  packets.forEach(p=>feedAacFingerprint(a,p.data));
  [packets[1],packets[0],packets[2]].forEach(p=>feedAacFingerprint(b,p.data));
  packets.slice(1).forEach(p=>feedAacFingerprint(c,p.data));
  assert.equal(sameAacFingerprint(a,b),false);
  assert.equal(sameAacFingerprint(a,c),false);
  assert.match(aacFingerprintText(a),/3 packets/);
});
test('AAC injection fails safely and closes source when canceled or missing config',async()=>{
  let closed=false;
  const source={async add(){},close(){closed=true;}};
  await assert.rejects(pipeOriginalAac({
    track:{},sinkFactory:async function* () {yield packets[0];},
    source,decoderConfig:config,isCanceled:()=>true
  }),/canceled/);
  assert.equal(closed,true);
  await assert.rejects(pipeOriginalAac({
    track:{},sinkFactory:async function* () {yield packets[0];},
    source,decoderConfig:null
  }),/requires source/);
});
