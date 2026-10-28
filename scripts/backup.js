'use strict';
// Online-consistent SQLite backup: npm run backup [-- destination.sqlite]
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const dir=path.resolve(process.env.BOWTIE_DATA_DIR||path.join(__dirname,'..','data'));
const source=path.join(dir,'bowtie-together.sqlite');
const destination=path.resolve(process.argv[2]||path.join(dir,'backups',`bowtie-together-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`));
async function run(){if(!fs.existsSync(source))throw Error('Database does not exist: '+source);
 if(source===destination)throw Error('Backup path must differ from database path');
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,destination);console.log('SQLite backup written:',destination);}finally{db.close();}
}
run().catch(e=>{console.error('Backup failed:',e.message);process.exitCode=1;});
