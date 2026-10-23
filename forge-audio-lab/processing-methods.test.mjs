import test from 'node:test';
import assert from 'node:assert/strict';
import {validMethod,inspectMethod,processMethod} from './processing-methods.mjs';
test('Istanbul routes inspection and applies timing after the pattern, including existing output',async()=>{
 const input={},pattern={},timed={},events=[],engines={istanbul:{
  inspect:async f=>{assert.equal(f,input);return {codec:'avc'};},
  create:async f=>{assert.equal(f,input);events.push('pattern');return {file:pattern,report:{unchanged:true}};},
  timing:async f=>{assert.equal(f,pattern);events.push('timing');return {file:timed,report:{referenceTiming:true}};},
 }};
 assert.deepEqual(await inspectMethod(input,'istanbul',engines),{codec:'avc'});
 const result=await processMethod(input,'istanbul',()=>{},engines);
 assert.equal(result.file,timed);assert.equal(result.report.referenceTiming,true);assert.deepEqual(events,['pattern','timing']);
});
test('Haze uses the original Haze engine without applying Istanbul',async()=>{
 const input={},out={},engines={haze:{inspectHaze52Source:async f=>({file:f}),createHaze52Replica:async f=>{assert.equal(f,input);return {file:out};}}};
 assert.equal((await inspectMethod(input,'haze',engines)).file,input);
 assert.equal((await processMethod(input,'haze',()=>{},engines)).file,out);
});
test('reject unknown methods and do not return an output when timing fails',async()=>{
 assert.equal(validMethod('istanbul'),true);assert.equal(validMethod('haze'),true);assert.equal(validMethod('__proto__'),false);
 await assert.rejects(processMethod({},'invalid'));
 await assert.rejects(processMethod({},'istanbul',()=>{},{istanbul:{create:async()=>({file:{}}),timing:async()=>{throw Error('bad timing');}}}),/bad timing/);
});
