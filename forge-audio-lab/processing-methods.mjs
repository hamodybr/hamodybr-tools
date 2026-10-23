import {inspectIstanbulSource,createIstanbulReplica,matchIstanbulVideoTiming,prepareSpatialAacFallback} from './istanbul-mode.mjs?v=4';
export const METHODS=Object.freeze({
 istanbul:{name:'Istanbul',help:'يحافظ على الصورة والصوت والفريمات. يحتاج فيديو H.264 مع صوت AAC.'},
 haze:{name:'Haze',help:'طريقة Haze 5.2 السابقة. قد تحوّل الفيديو إلى H.264 و30 فريم حسب المصدر.'},
});
export function validMethod(value){return Object.hasOwn(METHODS,value);}
const loadHaze=()=>import('./haze52-mode.mjs?v=4');
export async function inspectMethod(file,method,engines){
 if(!validMethod(method))throw Error('اختار Istanbul أو Haze.');
 if(method==='istanbul')return (engines?.istanbul?.inspect||inspectIstanbulSource)(file);
 const prepared=await prepareSpatialAacFallback(file);
 const h=engines?.haze||await loadHaze();return {...await h.inspectHaze52Source(prepared.file),...prepared.report};
}
export async function processMethod(file,method,progress=()=>{},engines){
 if(!validMethod(method))throw Error('اختار Istanbul أو Haze.');
 if(method==='haze'){
  const prepared=await prepareSpatialAacFallback(file);
  const h=engines?.haze||await loadHaze();const result=await h.createHaze52Replica(prepared.file,progress);
  return {...result,report:{...result.report,...prepared.report}};
 }
 const create=engines?.istanbul?.create||createIstanbulReplica;
 const timing=engines?.istanbul?.timing||matchIstanbulVideoTiming;
 const pattern=await create(file,p=>progress(p*.75,'container'));
 progress(.8,'timing');
 // Both fresh inputs and previously generated Istanbul files get the same
 // verified timing correction; applying the correction again is a no-op.
 const fixed=await timing(pattern.file);
 progress(1,'done');
 return {file:fixed.file,report:{...pattern.report,...fixed.report,method:'istanbul'}};
}
