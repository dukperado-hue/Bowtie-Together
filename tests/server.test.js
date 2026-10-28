'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs'),{spawn}=require('node:child_process');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'btt-test-'));
const port=37000+Math.floor(Math.random()*2000),base=`http://127.0.0.1:${port}`;
let proc;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const project={id:'demo',title:'Live demo',subtitle:'',owner:'',version:'1.0',hazard:{title:'A',description:''},topEvent:{title:'B',description:''},threats:[],consequences:[]};
test.before(async()=>{
 proc=spawn(process.execPath,['server/index.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),BOWTIE_DATA_DIR:tmp},stdio:'pipe'});
 for(let n=0;n<100;n++){try{const res=await fetch(base+'/health');if(res.ok)break;}catch{}await sleep(50);}
});
test.after(()=>{proc?.kill();fs.rmSync(tmp,{recursive:true,force:true});});
test('create, join, merge edits, SSE and durable storage',async()=>{
 const create=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project})});
 assert.equal(create.status,201);const room=await create.json();assert.equal(room.code.length,16);
 const join=await (await fetch(`${base}/api/rooms/${room.code}`)).json();assert.equal(join.project.title,'Live demo');
 const eventRes=await fetch(`${base}/api/rooms/${room.code}/events`);assert.ok(eventRes.headers.get('content-type').includes('text/event-stream'));
 const changes=await fetch(`${base}/api/rooms/${room.code}/changes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ops:[{action:'set',level:'hazard',field:'title',before:'A',value:'Engine failure'}],clientId:'tester',changeId:'change-1'})});
 assert.equal(changes.status,200);const updated=await changes.json();assert.equal(updated.project.hazard.title,'Engine failure');
 const body=await (await fetch(`${base}/api/rooms/${room.code}`)).json();assert.equal(body.project.hazard.title,'Engine failure');
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(tmp,'bowtie-together.sqlite'));const saved=db.prepare('SELECT * FROM rooms WHERE code=?').get(room.code);assert.equal(JSON.parse(saved.project).hazard.title,'Engine failure');db.close();
 const reader=eventRes.body.getReader();let streamed='';
 for(let n=0;n<8&&!streamed.includes('Engine failure');n++){
  const result=await Promise.race([reader.read(),sleep(1500).then(()=>{throw Error('SSE update timed out');})]);
  streamed+=new TextDecoder().decode(result.value||new Uint8Array());
 }
 assert.ok(streamed.includes('event: snapshot') && streamed.includes('Engine failure'),'SSE must broadcast saved changes');
 await reader.cancel();
});
