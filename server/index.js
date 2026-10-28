'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {URL}=require('node:url');
const {validCode,validProject,ConflictError}=require('./collaboration');
const {RoomStore}=require('./store');
const PORT=Number(process.env.PORT||3000);
const DATA_DIR=path.resolve(process.env.BOWTIE_DATA_DIR||path.join(__dirname,'..','data'));
const PUBLIC_DIR=path.resolve(__dirname,'..','public');
const ALLOWED_ORIGIN=String(process.env.ALLOWED_ORIGIN||'').replace(/\/$/,'');
const store=new RoomStore(DATA_DIR);
const clients=new Map(),ratelimit=new Map();
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-site','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function originAllowed(req){const origin=req.headers.origin;if(!origin)return true;
 // Cross-origin API requests require an explicit allowlist; an Origin header is not an authentication mechanism.
 const host=req.headers.host;
 return origin===ALLOWED_ORIGIN||origin===`http://${host}`||origin===`https://${host}`;
}
function cors(req,res){const origin=req.headers.origin;if(!originAllowed(req))return false;
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Max-Age','300');}
 return true;}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
function presence(code){const set=clients.get(code)||new Map(),members=[...set.values()].map(v=>({id:v.id,name:v.name}));
 const chunk=`event: presence\ndata: ${JSON.stringify({count:members.length,members})}\n\n`;
 for(const [res] of set){try{res.write(chunk);}catch{set.delete(res);}}
}
function broadcast(code,record){const chunk=`id: ${record.revision}\nevent: snapshot\ndata: ${JSON.stringify(record)}\n\n`,set=clients.get(code);
 for(const [res] of set||[]){try{res.write(chunk);}catch{set.delete(res);}}
}
function limited(req){const key=String(req.socket.remoteAddress||'?'),now=Date.now();let e=ratelimit.get(key);
 if(!e||now-e.time>=60000){e={time:now,count:0};ratelimit.set(key,e);}if(ratelimit.size>10000)for(const [k,v] of ratelimit)if(now-v.time>=60000)ratelimit.delete(k);
 return ++e.count>180;
}
function body(req){return new Promise((resolve,reject)=>{
 let chunks=[],size=0,failed=false;req.on('data',chunk=>{
  size+=chunk.length;if(size>1024*1024){if(!failed){failed=true;const e=Error('Payload too large');e.status=413;reject(e);}return;}
  chunks.push(chunk);
 });req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{const e=Error('Invalid JSON');e.status=400;reject(e);}});req.on('error',reject);
 });}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 if(!cors(req,res))return send(res,403,{error:'Origin not allowed'});
 if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end();}
 if(limited(req))return send(res,429,{error:'Too many requests'});
 const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
 if(pathname==='/health')return send(res,200,{ok:true,service:'Bowtie Together',version:'1.1.0',persistence:'sqlite'});
 try{
  if(pathname.startsWith('/api/')&&req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return send(res,415,{error:'Content-Type must be application/json'});
  if(pathname==='/api/rooms'&&req.method==='POST'){
   const input=await body(req);if(!validProject(input.project))return send(res,422,{error:'Invalid BowTie project'});
   return send(res,201,store.create(input.project));
  }
  const match=pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(changes|events|history))?$/);
  if(match){const code=match[1],suffix=match[2];if(!validCode(code))return send(res,400,{error:'Invalid room code'});
   if(suffix==='changes'&&req.method==='POST'){
    // Parse the request before reading the authoritative room. This prevents stale-read concurrent writes.
    const input=await body(req);
    const changed=store.change(code,input);
    if(!changed)return send(res,404,{error:'Room not found'});
    if(!changed.duplicate)broadcast(code,changed.record);
    return send(res,200,changed.record);
   }
   const record=store.get(code);if(!record)return send(res,404,{error:'Room not found'});
   if(!suffix&&req.method==='GET')return send(res,200,{code,...record});
   if(suffix==='history'&&req.method==='GET')return send(res,200,{code,revisions:store.history(code)});
   if(suffix==='events'&&req.method==='GET'){
    const id=String(url.searchParams.get('client')||'guest').slice(0,120).replace(/[^\w-]/g,'');
    const name=String(url.searchParams.get('name')||'Guest').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,40)||'Guest';
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive',...headers,'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    res.write(': connected\n\n');let set=clients.get(code);if(!set){set=new Map();clients.set(code,set);}
    set.set(res,{id,name});presence(code);
    // Fetch after registering the subscriber to cover the read/subscribe gap.
    const latest=store.get(code);res.write(`id: ${latest.revision}\nevent: snapshot\ndata: ${JSON.stringify(latest)}\n\n`);
    const ping=setInterval(()=>{try{res.write(': keepalive\n\n');}catch{}},20000);
    res.on('close',()=>{clearInterval(ping);set.delete(res);if(!set.size)clients.delete(code);else presence(code);});return;
   }
   return send(res,405,{error:'Method not allowed'});
  }
  if(pathname.startsWith('/api/'))return send(res,404,{error:'Not found'});
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
  const target=path.resolve(PUBLIC_DIR,'.'+(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(PUBLIC_DIR+path.sep))return send(res,403,{error:'Forbidden'});
  let stat;try{stat=fs.statSync(target);}catch{return send(res,404,{error:'Not found'});}if(!stat.isFile())return send(res,404,{error:'Not found'});
  res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':/\.(css|js)$/.test(target)?'no-cache':'no-store',...headers});
  if(req.method==='HEAD')return res.end();fs.createReadStream(target).pipe(res);
 }catch(error){
  if(error instanceof ConflictError){const current=store.get(pathname.split('/')[3]);return send(res,409,{error:error.message,conflicts:error.conflicts,...current});}
  if(error.status===409)return send(res,409,{error:error.message});
  console.error('Request failed:',error.message);
  if(!res.headersSent)send(res,error.status||(/^Invalid|^Missing/.test(error.message)?422:500),{error:error.status>=500?'Server failed to save changes':error.message});
 }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Bowtie Together at http://localhost:${PORT}`));
module.exports=server;
