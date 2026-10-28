'use strict';
/** Transactional single-instance SQLite persistence, with automatic legacy JSON room import. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {newCode,validCode,validProject,clone,applyOps}=require('./collaboration');
class RoomStore{
 constructor(dir){
  fs.mkdirSync(dir,{recursive:true});this.dir=dir;
  this.db=new DatabaseSync(path.join(dir,'bowtie-together.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, revision INTEGER NOT NULL, project TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(code TEXT NOT NULL, client_id TEXT NOT NULL, change_id TEXT NOT NULL, sha256 TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(code,client_id,change_id), FOREIGN KEY(code) REFERENCES rooms(code));
   CREATE TABLE IF NOT EXISTS history(code TEXT NOT NULL, revision INTEGER NOT NULL, project TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY(code,revision), FOREIGN KEY(code) REFERENCES rooms(code));`);
  this.readStmt=this.db.prepare('SELECT * FROM rooms WHERE code=?');
  this.insertStmt=this.db.prepare('INSERT INTO rooms(code,revision,project,updated_by,updated_at) VALUES(?,?,?,?,?)');
  this.updateStmt=this.db.prepare('UPDATE rooms SET revision=?,project=?,updated_by=?,updated_at=? WHERE code=?');
  this.historyStmt=this.db.prepare('INSERT INTO history(code,revision,project,changed_by,changed_at) VALUES(?,?,?,?,?)');
  this.receiptStmt=this.db.prepare('SELECT * FROM receipts WHERE code=? AND client_id=? AND change_id=?');
  this.receiptInsert=this.db.prepare('INSERT INTO receipts(code,client_id,change_id,sha256,revision) VALUES(?,?,?,?,?)');
  this.migrateLegacy();
 }
 fromRow(r){return r?{revision:r.revision,project:JSON.parse(r.project),updatedBy:r.updated_by,updatedAt:r.updated_at}:null;}
 get(code){return this.fromRow(this.readStmt.get(code));}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 create(project){if(!validProject(project))throw Error('Invalid BowTie project');return this.transaction(()=>{
  let code;do{code=newCode();}while(this.readStmt.get(code));
  const record={revision:1,project:clone(project),updatedBy:'creator',updatedAt:new Date().toISOString()},json=JSON.stringify(project);
  this.insertStmt.run(code,1,json,record.updatedBy,record.updatedAt);this.historyStmt.run(code,1,json,record.updatedBy,record.updatedAt);
  return {code,...record};
 });}
 change(code,{clientId,changeId,ops}){
  if(typeof clientId!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(clientId)||typeof changeId!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(changeId))throw Error('Invalid change identifier');
  if(!Array.isArray(ops)||ops.length===0||ops.length>500)throw Error('Invalid changes');
  return this.transaction(()=>{
   const old=this.get(code);if(!old)return null;
   const hash=crypto.createHash('sha256').update(JSON.stringify(ops)).digest('hex');
   const receipt=this.receiptStmt.get(code,clientId,changeId);
   if(receipt){if(receipt.sha256!==hash){const e=Error('Change identifier reused for different changes');e.status=409;throw e;}
    return {record:old,duplicate:true};
   }
   const next=applyOps(old.project,ops,{requirePreconditions:true});
   const record={revision:old.revision+1,project:next,updatedBy:clientId,updatedAt:new Date().toISOString()};
   const json=JSON.stringify(next);
   this.updateStmt.run(record.revision,json,clientId,record.updatedAt,code);
   this.historyStmt.run(code,record.revision,json,clientId,record.updatedAt);
   this.receiptInsert.run(code,clientId,changeId,hash,record.revision);
   return {record,duplicate:false};
  });
 }
 history(code,limit=30){return this.db.prepare('SELECT revision,changed_by AS updatedBy,changed_at AS updatedAt FROM history WHERE code=? ORDER BY revision DESC LIMIT ?').all(code,limit);}
 migrateLegacy(){
  for(const name of fs.readdirSync(this.dir)){
   if(!name.endsWith('.json'))continue;const code=name.slice(0,-5);if(!validCode(code)||this.readStmt.get(code))continue;
   try{const raw=JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));
    if(!validProject(raw.project))continue;
    const revision=Number.isSafeInteger(raw.revision)&&raw.revision>=1?raw.revision:1;
    const by=String(raw.updatedBy||'legacy').slice(0,120),at=String(raw.updatedAt||new Date().toISOString());
    this.transaction(()=>{this.insertStmt.run(code,revision,JSON.stringify(raw.project),by,at);this.historyStmt.run(code,revision,JSON.stringify(raw.project),by,at);});
    // Legacy file is intentionally retained for a separate manual backup/review.
   }catch(e){console.warn('Legacy room migration skipped:',name,e.message);}
  }
 }
 close(){this.db.close();}
}
module.exports={RoomStore};
