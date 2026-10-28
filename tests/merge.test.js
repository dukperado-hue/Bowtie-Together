'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyOps,diffProject,newCode,validCode}=require('../server/collaboration');
const make=()=>({id:'project1',title:'Test',subtitle:'',owner:'',version:'1.0',hazard:{title:'A',description:''},topEvent:{title:'B',description:''},threats:[],consequences:[]});
test('16-character unguessable room code format',()=>{const values=Array.from({length:100},newCode);assert.equal(new Set(values).size,100);for(const c of values)assert.ok(validCode(c));});
test('merges simultaneous edits on different paths',()=>{
 const old=make(),alice=structuredClone(old),bob=structuredClone(old);
 alice.threats.push({id:'t1',title:'Threat',description:'',barriers:[]});
 bob.consequences.push({id:'c1',title:'Damage',description:'',risk:{initial:{likelihood:5,severity:'A'},residual:{likelihood:2,severity:'C'},rationale:''},barriers:[]});
 const combined=applyOps(applyOps(old,diffProject(old,alice)),diffProject(old,bob));
 assert.equal(combined.threats[0].title,'Threat');assert.equal(combined.consequences[0].title,'Damage');
});
test('merges parallel barrier additions to one path',()=>{
 const original=make();original.threats=[{id:'t1',title:'Weather',description:'',barriers:[]}];
 const a=structuredClone(original),b=structuredClone(original);const barrier=n=>({id:n,title:n,status:'planned',owner:'',description:'',escalationFactors:[]});
 a.threats[0].barriers.push(barrier('pb1'));b.threats[0].barriers.push(barrier('pb2'));
 const result=applyOps(applyOps(original,diffProject(original,a)),diffProject(original,b));
 assert.deepEqual(result.threats[0].barriers.map(v=>v.id),['pb1','pb2']);
});
test('independent edits to title and status of same barrier remain',()=>{
 const original=make();original.threats=[{id:'t1',title:'Threat',description:'',barriers:[{id:'b1',title:'Old',description:'',owner:'',status:'planned',escalationFactors:[]}]}];
 const a=structuredClone(original),b=structuredClone(original);a.threats[0].barriers[0].title='New';b.threats[0].barriers[0].status='effective';
 const c=applyOps(applyOps(original,diffProject(original,a)),diffProject(original,b));
 assert.equal(c.threats[0].barriers[0].title,'New');assert.equal(c.threats[0].barriers[0].status,'effective');
});
test('delete and escalation controls work',()=>{
 const p=make();p.consequences=[{id:'c1',title:'Damage',description:'',barriers:[{id:'rb1',title:'Recovery',description:'',owner:'',status:'planned',escalationFactors:[]}]}];
 const a=structuredClone(p);a.consequences[0].barriers[0].escalationFactors.push({id:'ef1',title:'Escalation',description:'',controls:[{id:'ec1',title:'Control',description:'',owner:'',status:'planned'}]});
 const b=applyOps(p,diffProject(p,a));assert.equal(b.consequences[0].barriers[0].escalationFactors[0].controls[0].title,'Control');
 const c=structuredClone(b);c.consequences=[];assert.equal(applyOps(b,diffProject(b,c)).consequences.length,0);
});
test('unknown fields are rejected',()=>{const p=make();assert.throws(()=>applyOps(p,[{action:'set',level:'project',field:'__proto__',value:{polluted:true}}]));});
