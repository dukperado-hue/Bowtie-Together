'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {URL}=require('node:url');
const {newCode,validCode,validProject,applyOps,clone}=require('./collaboration.js');
const PORT=Number(process.env.PORT||3000);
const DATA_DIR=path.resolve(process.env.BOWTIE_DATA_DIR||path.join(__dirname,'..','data'));
const PUBLIC_DIR=path.resolve(__dirname,'..','public');
const CORS_ORIGIN=process.env.ALLOWED_ORIGIN||'';
fs.mkdirSync(DATA_DIR,{recursive:true});
const clients=new Map();const ratelimit=new Map();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-site'};
function cors(req,res){const origin=req.headers.origin;
  if(origin && (origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`||origin===CORS_ORIGIN)){
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  }
  if(origin && !(origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`||origin===CORS_ORIGIN))return false;
  return true;
}
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(obj));}
function filename(code){return path.join(DATA_DIR,code+'.json');}
function getRoom(code){try{return JSON.parse(fs.readFileSync(filename(code),'utf8'));}catch{return null;}}
function writeRoom(code,record){const target=filename(code),tmp=target+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(record),{mode:0o600});fs.renameSync(tmp,target);}
function broadcastPresence(code){const set=clients.get(code);if(!set)return;const chunk=`event: presence\ndata: ${JSON.stringify({count:set.size})}\n\n`;for(const client of set)try{client.write(chunk);}catch{}}
function broadcast(code,record){const chunk=`id: ${record.revision}\nevent: snapshot\ndata: ${JSON.stringify({revision:record.revision,project:record.project,updatedBy:record.updatedBy})}\n\n`;
  for(const res of clients.get(code)||[]) {try{res.write(chunk);}catch{clients.get(code).delete(res);}}
}
function limited(req){const ip=String(req.socket.remoteAddress||'?'),now=Date.now();let e=ratelimit.get(ip);if(!e||now-e.time>60000){e={time:now,count:0};ratelimit.set(ip,e);}return ++e.count>180;}
async function body(req){return new Promise((resolve,reject)=>{let s='',size=0;req.on('data',x=>{size+=x.length;if(size>1024*1024){reject(Error('Payload too large'));req.destroy();return;}s+=x.toString('utf8');});req.on('end',()=>{try{resolve(JSON.parse(s));}catch{reject(Error('Invalid JSON'));}});req.on('error',reject);});}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  if(!cors(req,res)){return send(res,403,{error:'Origin not allowed'});}
  if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end();}
  if(limited(req))return send(res,429,{error:'Too many requests'});
  const pathname=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
  if(pathname==='/health')return send(res,200,{ok:true,service:'Bowtie Together',version:'1.0.0'});
  try{
    if(pathname==='/api/rooms' && req.method==='POST'){
      const input=await body(req);if(!validProject(input.project))return send(res,422,{error:'Invalid BowTie project'});
      if(JSON.stringify(input.project).length>900000)return send(res,413,{error:'Project too large'});
      let code;do{code=newCode();}while(fs.existsSync(filename(code)));
      const record={revision:1,project:input.project,updatedBy:'creator',updatedAt:new Date().toISOString()};writeRoom(code,record);
      return send(res,201,{code,...record});
    }
    const match=pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(changes|events))?$/);
    if(match){const code=match[1],suffix=match[2];
      if(!validCode(code))return send(res,400,{error:'Invalid room code'});
      const record=getRoom(code);if(!record)return send(res,404,{error:'Room not found'});
      if(!suffix && req.method==='GET')return send(res,200,{code,...record});
      if(suffix==='changes'&&req.method==='POST'){
        const input=await body(req),ops=input.ops;
        if(!Array.isArray(ops)||ops.length>500)return send(res,422,{error:'Invalid changes'});
        const next=applyOps(record.project,ops);
        record.project=next;record.revision++;record.updatedBy=String(input.clientId||'guest').slice(0,100);record.updatedAt=new Date().toISOString();writeRoom(code,record);broadcast(code,record);
        return send(res,200,{revision:record.revision,project:next,updatedBy:record.updatedBy});
      }
      if(suffix==='events' && req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','Referrer-Policy':'no-referrer'});
        res.write(': connected\n\n');let set=clients.get(code);if(!set){set=new Set();clients.set(code,set);}set.add(res);broadcastPresence(code);
        // The initial snapshot protects against events missed between GET and SSE connect.
        res.write(`id: ${record.revision}\nevent: snapshot\ndata: ${JSON.stringify({revision:record.revision,project:record.project,updatedBy:record.updatedBy})}\n\n`);
        const ping=setInterval(()=>{try{res.write(': keepalive\n\n');}catch{}},20000);
        res.on('close',()=>{clearInterval(ping);set.delete(res);if(set.size===0)clients.delete(code);else broadcastPresence(code);});
        return;
      }
      return send(res,405,{error:'Method not allowed'});
    }
    if(req.method!=='GET' && req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
    const urlPath=pathname==='/'?'/index.html':pathname;
    const filepath=path.resolve(PUBLIC_DIR,'.'+urlPath);
    if(!filepath.startsWith(PUBLIC_DIR+path.sep))return send(res,403,{error:'Forbidden'});
    let stat;try{stat=fs.statSync(filepath);}catch{return send(res,404,{error:'Not found'});}
    if(!stat.isFile())return send(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':types[path.extname(filepath)]||'application/octet-stream','Cache-Control':/\.(css|js)$/.test(filepath)?'no-cache':'no-store','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')return res.end();fs.createReadStream(filepath).pipe(res);
  }catch(error){console.error('Request failed:',error.message);if(!res.headersSent)send(res,400,{error:error.message||'Request failed'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Bowtie Together at http://localhost:${PORT}`));
module.exports=server;
