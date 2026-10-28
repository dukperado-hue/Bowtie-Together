'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const backend=require('../server/collaboration');
const browserSource=fs.readFileSync(path.join(__dirname,'../public/merge.js'),'utf8');
const window={crypto:{getRandomValues:a=>require('node:crypto').webcrypto.getRandomValues(a)}};
vm.runInNewContext(browserSource,{window,globalThis:{crypto:window.crypto},Uint8Array,JSON,Object,Array,Set,Map,Error,console},{filename:'public/merge.js'});
const frontend=window.BowtieMerge;
const p={id:'p1',title:'Test',subtitle:'',owner:'',version:'1.0',riskBands:{low:4,medium:9,high:16},hazard:{title:'A',description:''},topEvent:{title:'B',description:''},threats:[],consequences:[{id:'c1',title:'Loss',description:'',barriers:[],risk:{initial:{likelihood:0,severity:''},residual:{likelihood:0,severity:''},rationale:''}}]};
test('browser and Node change engines stay compatible',()=>{
 const changed=structuredClone(p);changed.title='Edited';changed.consequences[0].risk.initial={likelihood:5,severity:'A'};
 changed.consequences[0].barriers.push({id:'b1',title:'Stop',description:'',owner:'Ops',status:'planned',escalationFactors:[]});
 const s=backend.diffProject(p,changed),c=frontend.diffProject(p,changed);
 assert.deepEqual(JSON.parse(JSON.stringify(c)),s);
 assert.deepEqual(JSON.parse(JSON.stringify(frontend.applyOps(p,c,{requirePreconditions:true}))),backend.applyOps(p,s,{requirePreconditions:true}));
});
test('browser engine detects same-field stale write',()=>{
 const changed=structuredClone(p);changed.topEvent.title='Someone else';const ours=structuredClone(p);ours.topEvent.title='Our change';
 assert.throws(()=>frontend.applyOps(changed,frontend.diffProject(p,ours),{requirePreconditions:true}),e=>e.status===409);
});
