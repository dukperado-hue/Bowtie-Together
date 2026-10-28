'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {diffProject,applyOps,ConflictError}=require('../server/collaboration');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'btt-concurrent-'));
const port=40500+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
const template={id:'demo',title:'Testing',subtitle:'',owner:'',version:'1.0',hazard:{title:'Original',description:''},topEvent:{title:'Top',description:''},threats:[],consequences:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let proc;
async function start(){proc=spawn(process.execPath,['server/index.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),BOWTIE_DATA_DIR:temp},stdio:'pipe'});for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}await sleep(40);}throw Error('Server did not start');}
async function stop(){if(!proc)return;const p=proc;proc=null;await new Promise(resolve=>{p.once('exit',resolve);p.kill();setTimeout(resolve,1500).unref();});}
async function create(project=template){const r=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project})});assert.equal(r.status,201);return r.json();}
async function change(code,ops,clientId,changeId){const r=await fetch(`${base}/api/rooms/${code}/changes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,changeId,ops})});return {status:r.status,data:await r.json()};}
async function get(code){return(await(await fetch(`${base}/api/rooms/${code}`)).json());}
test.before(start);test.after(async()=>{await stop();fs.rmSync(temp,{recursive:true,force:true});});
test('simultaneous independent edits commit as two distinct SQLite revisions',async()=>{
 const {code}=await create();const a=structuredClone(template),b=structuredClone(template);a.hazard.title='Hazard by A';b.topEvent.title='Top by B';
 const [ra,rb]=await Promise.all([change(code,diffProject(template,a),'alice','a1'),change(code,diffProject(template,b),'bob','b1')]);
 assert.equal(ra.status,200);assert.equal(rb.status,200);
 const final=await get(code);assert.equal(final.revision,3);assert.equal(final.project.hazard.title,'Hazard by A');assert.equal(final.project.topEvent.title,'Top by B');
 const history=await (await fetch(`${base}/api/rooms/${code}/history`)).json();assert.equal(history.revisions.length,3);
});
test('stale writes to the same field return 409 and preserve committed edit',async()=>{
 const {code}=await create();const alice=structuredClone(template),bob=structuredClone(template);alice.hazard.title='From Alice';bob.hazard.title='From Bob';
 const opA=diffProject(template,alice),opB=diffProject(template,bob);
 assert.equal((await change(code,opA,'alice','a2')).status,200);
 const stale=await change(code,opB,'bob','b2');assert.equal(stale.status,409);assert.equal(stale.data.project.hazard.title,'From Alice');assert.equal(stale.data.conflicts[0].field,'title');
 assert.equal((await get(code)).revision,2);
 const chosen=diffProject(stale.data.project,bob),res=await change(code,chosen,'bob','b3');assert.equal(res.status,200);assert.equal(res.data.project.hazard.title,'From Bob');
});
test('retrying identical change IDs is idempotent, including after restart',async()=>{
 const {code}=await create();const alice=structuredClone(template);alice.title='Once';const ops=diffProject(template,alice);
 const one=await change(code,ops,'alice','same-id');assert.equal(one.status,200);assert.equal(one.data.revision,2);
 const two=await change(code,ops,'alice','same-id');assert.equal(two.status,200);assert.equal(two.data.revision,2);
 const mismatch=await change(code,[{...ops[0],value:'Changed'}],'alice','same-id');assert.equal(mismatch.status,409);
 await stop();await start();const three=await change(code,ops,'alice','same-id');assert.equal(three.status,200);assert.equal(three.data.revision,2);
 assert.equal((await get(code)).project.title,'Once');
});
test('concurrent edits to initial and residual risk do not overwrite each other',async()=>{
 const p=structuredClone(template);p.consequences=[{id:'c1',title:'Damage',description:'',risk:{initial:{likelihood:0,severity:''},residual:{likelihood:0,severity:''},rationale:''},barriers:[]}];
 const {code}=await create(p),a=structuredClone(p),b=structuredClone(p);
 a.consequences[0].risk.initial={likelihood:5,severity:'A'};b.consequences[0].risk.residual={likelihood:2,severity:'C'};
 const [ra,rb]=await Promise.all([change(code,diffProject(p,a),'alice','r1'),change(code,diffProject(p,b),'bob','r2')]);
 assert.equal(ra.status,200);assert.equal(rb.status,200);
 const final=(await get(code)).project.consequences[0].risk;
 assert.deepEqual(final.initial,{likelihood:5,severity:'A'});assert.deepEqual(final.residual,{likelihood:2,severity:'C'});
});
test('deleting an element changed by another editor requires explicit review',async()=>{
 const p=structuredClone(template);p.threats=[{id:'t1',title:'Weather',description:'',barriers:[]}];const {code}=await create(p);
 const edit=structuredClone(p),gone=structuredClone(p);edit.threats[0].title='New Weather';gone.threats=[];
 assert.equal((await change(code,diffProject(p,edit),'alice','edit-1')).status,200);
 const res=await change(code,diffProject(p,gone),'bob','delete-1');assert.equal(res.status,409);assert.equal((await get(code)).project.threats.length,1);
});
test('origin and invalid operation validation protect the write API',async()=>{
 const {code}=await create();const invalid=await change(code,[{action:'set',level:'hazard',field:'title',value:'Sneaky'}],'attacker','m1');assert.equal(invalid.status,422);
 const cross=await fetch(base+`/api/rooms/${code}`,{headers:{Origin:'https://untrusted.invalid'}});assert.equal(cross.status,403);
 const final=await get(code);assert.equal(final.revision,1);
});
test('room file v1.0.0 migrates to SQLite and retains its original revision',async()=>{
 const legacyCode='ABCDEFGHJKLMNPQR';assert.equal(legacyCode.length,16);
 fs.writeFileSync(path.join(temp,legacyCode+'.json'),JSON.stringify({revision:7,project:template,updatedBy:'legacy',updatedAt:'2026-10-01T00:00:00.000Z'}));
 await stop();await start();const restored=await get(legacyCode);assert.equal(restored.revision,7);assert.equal(restored.project.id,template.id);
});
test('same-field preconditions and additions are validated by merge engine',()=>{
 const p=structuredClone(template),a=structuredClone(p);a.hazard.title='Update';const ops=diffProject(p,a);
 assert.equal(applyOps(p,ops,{requirePreconditions:true}).hazard.title,'Update');
 const changed=structuredClone(p);changed.hazard.title='Other';assert.throws(()=>applyOps(changed,ops,{requirePreconditions:true}),ConflictError);
});
