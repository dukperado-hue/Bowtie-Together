'use strict';
(function(root){
const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, n = 4000) => String(value ?? '').slice(0, n);
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 120 && !['__proto__','constructor','prototype'].includes(v);
const validProject = p => p && typeof p === 'object' && !Array.isArray(p) &&
  validId(p.id) && Array.isArray(p.threats) && Array.isArray(p.consequences) &&
  p.hazard && p.topEvent && p.threats.length <= 80 && p.consequences.length <= 80;
const allowed = {
  project: new Set(['title','subtitle','owner','version','riskBands']),
  hazard: new Set(['title','description']),
  topEvent: new Set(['title','description']),
  path: new Set(['title','description','risk']),
  barrier: new Set(['title','description','owner','status']),
  factor: new Set(['title','description']),
  control: new Set(['title','description','owner','status'])
};
function collection(project, op){
  const kind=op.kind;
  const list = kind === 'threat' ? project.threats : kind === 'consequence' ? project.consequences : null;
  if(!list)return null;
  if(op.level==='path')return list;
  const path=list.find(v=>v.id===op.pathId);
  if(!path)return null;
  if(op.level==='barrier')return path.barriers;
  const barrier=path.barriers?.find(v=>v.id===op.barrierId);
  if(!barrier)return null;
  if(op.level==='factor')return barrier.escalationFactors;
  const factor=barrier.escalationFactors?.find(v=>v.id===op.factorId);
  if(!factor)return null;
  if(op.level==='control')return factor.controls;
  return null;
}
const safeString = obj => JSON.stringify(obj).length <= 900000;
function applyOps(project, ops){
  if(!Array.isArray(ops)||ops.length>500)throw new Error('Invalid changes');
  const output=clone(project);
  for(const op of ops){
    if(!op||typeof op!=='object')continue;
    if(op.action==='set' && ['project','hazard','topEvent'].includes(op.level)){
      const target=op.level==='project'?output:output[op.level];
      if(allowed[op.level].has(op.field))target[op.field]=clone(op.value);
      continue;
    }
    if(!['threat','consequence'].includes(op.kind) || !['path','barrier','factor','control'].includes(op.level))continue;
    const arr=collection(output,op);if(!Array.isArray(arr)||!validId(op.id))continue;
    const idx=arr.findIndex(v=>v.id===op.id);
    if(op.action==='delete'){
      if(idx>=0)arr.splice(idx,1);
    }else if(op.action==='add'){
      if(idx<0 && op.value && op.value.id===op.id && safeString(op.value))arr.push(clone(op.value));
    }else if(op.action==='set'){
      const fields=allowed[op.level];
      if(idx>=0 && fields.has(op.field) && safeString(op.value))arr[idx][op.field]=clone(op.value);
    }
  }
  if(!validProject(output)||!safeString(output))throw new Error('Project exceeds allowed size');
  return output;
}
function diffProject(oldProject,newProject){
  const ops=[];
  const top=(level,oldItem,newItem)=>{
    for(const field of allowed[level])if(JSON.stringify(oldItem?.[field])!==JSON.stringify(newItem?.[field]))ops.push({action:'set',level,field,value:clone(newItem?.[field]??null)});
  };
  top('project',oldProject,newProject);top('hazard',oldProject.hazard,newProject.hazard);top('topEvent',oldProject.topEvent,newProject.topEvent);
  for(const [kind,key] of [['threat','threats'],['consequence','consequences']]){
    const walk=(level,oldList,newList,location)=>{
      const oldMap=new Map((oldList||[]).map(x=>[x.id,x]));const newMap=new Map((newList||[]).map(x=>[x.id,x]));
      for(const oldObj of oldList||[])if(!newMap.has(oldObj.id))ops.push({action:'delete',kind,level,...location,id:oldObj.id});
      for(const newObj of newList||[]){
        const oldObj=oldMap.get(newObj.id);
        if(!oldObj){ops.push({action:'add',kind,level,...location,id:newObj.id,value:clone(newObj)});continue;}
        for(const field of allowed[level])if(JSON.stringify(oldObj[field])!==JSON.stringify(newObj[field]))ops.push({action:'set',kind,level,...location,id:newObj.id,field,value:clone(newObj[field]??null)});
        if(level==='path')walk('barrier',oldObj.barriers,newObj.barriers,{pathId:newObj.id});
        if(level==='barrier')walk('factor',oldObj.escalationFactors,newObj.escalationFactors,{...location,barrierId:newObj.id});
        if(level==='factor')walk('control',oldObj.controls,newObj.controls,{...location,factorId:newObj.id});
      }
    };
    walk('path',oldProject[key],newProject[key],{});
  }
  return ops;
}
root.BowtieMerge={clone,applyOps,diffProject};
})(window);
