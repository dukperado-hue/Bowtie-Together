/* Bowtie Together · collaboration client (vanilla JavaScript; EventSource + HTTP) */
(function(root){
'use strict';
const $=id=>document.getElementById(id), clone=root.BowtieMerge.clone;
const diffProject=root.BowtieMerge.diffProject,applyOps=root.BowtieMerge.applyOps;
const KEY='bowtie-together-room-map-v1';
const CLIENT_ID=root.crypto?.randomUUID?.()||('btt-'+Date.now()+'-'+Math.random());
const CODE_RE=/^[A-HJ-NP-Z2-9]{16}$/;
const i18n={en:{
 title:'Work together on this BowTie',sub:'Share an invitation code with your team. Everyone can edit the same analysis in real time.',
 join:'Join room',create:'Create live room',code:'Room access code',codeHint:'16 characters · anyone with this code can edit',
 paste:'Enter invitation code',connected:'Live • Connected',connecting:'Connecting…',offline:'Offline · Reconnecting',local:'Private · On this device',people:'people connected',link:'Copy invitation link',copyCode:'Copy code',copied:'Copied',leave:'Leave live room',leaveConfirm:'Keep a local copy and leave this shared room on this device?',close:'Close',error:'Unable to connect. Check the server URL or room code.',createFailed:'Could not create a live room.',joined:'Joined shared BowTie',created:'Live room created',codeError:'Enter the complete 16-character code.',share:'Collaborate',room:'Room',security:'Room codes grant full editing access. Do not share publicly. Use HTTPS for deployment.',localCopy:'Save private copy',localCopyDone:'Private copy created',netlify:'On Netlify, configure the API URL in config.js and deploy the Node server separately.'},
th:{title:'ร่วมวิเคราะห์ BowTie แบบเรียลไทม์',sub:'แชร์รหัสเชิญให้ทีมแก้ไข BowTie เดียวกันได้ทันที',join:'เข้าร่วมห้อง',create:'สร้างห้องร่วมงาน',code:'รหัสเข้าถึงห้อง',codeHint:'16 ตัวอักษร · ผู้ที่มีรหัสสามารถแก้ไขได้',paste:'ใส่รหัสเชิญ',connected:'เชื่อมต่อ • เรียลไทม์',connecting:'กำลังเชื่อมต่อ…',offline:'ออฟไลน์ · กำลังเชื่อมต่อใหม่',local:'ส่วนตัว · บันทึกบนอุปกรณ์',people:'คนกำลังเชื่อมต่อ',link:'คัดลอกลิงก์เชิญ',copyCode:'คัดลอกรหัส',copied:'คัดลอกแล้ว',leave:'ออกจากห้องร่วมงาน',leaveConfirm:'เก็บสำเนาไว้ในเครื่องและออกจากห้องร่วมงานบนอุปกรณ์นี้หรือไม่?',close:'ปิด',error:'เชื่อมต่อไม่ได้ โปรดตรวจสอบเซิร์ฟเวอร์หรือรหัสห้อง',createFailed:'สร้างห้องร่วมงานไม่สำเร็จ',joined:'เข้าร่วม BowTie แล้ว',created:'สร้างห้องร่วมงานแล้ว',codeError:'กรอกรหัส 16 ตัวอักษรให้ครบ',share:'ทำงานร่วมกัน',room:'ห้อง',security:'ทุกคนที่มีรหัสสามารถแก้ไขได้ ห้ามเผยแพร่สาธารณะ และควรใช้ HTTPS',localCopy:'สร้างสำเนาส่วนตัว',localCopyDone:'สร้างสำเนาส่วนตัวแล้ว',netlify:'หากใช้ Netlify ต้องตั้งค่า API ใน config.js และเผยแพร่ Node server แยกต่างหาก'}};
function makeClient(api){
 let code=null,roomProjectId=null,source=null,server=null,queue=[],running=false,localBase=null,presence=0,status='local',startup=false;
 const mapping=(()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}})();
 const base=String(root.BOWTIE_TOGETHER_API||'').replace(/\/$/,'');
 const tx=x=>i18n[api.lang()=== 'th'?'th':'en'][x]||x;
 const persistMap=()=>{try{localStorage.setItem(KEY,JSON.stringify(mapping));}catch{}};
 const notify=s=>{status=s;syncStatus();};
 function syncStatus(){const b=$('liveStatus'),share=$('liveShareButton');if(!b)return;
   b.textContent=status==='local'?tx('local'):status==='connected'?`${tx('connected')} · ${presence} ${tx('people')}`:tx(status);
   b.dataset.status=status;
   if(share)share.textContent=code?`◉ ${tx('room')}: ${code.slice(0,4)}…`:`✣ ${tx('share')}`;
   const badge=$('liveRoomBadge');if(badge){badge.hidden=!code;badge.textContent=code||'';}
   const meta=document.querySelector('[data-i18n="projectWorkspace"]');if(meta)meta.textContent=code?(api.lang()==='th'?'พื้นที่ทำงานร่วมกัน':'Shared workspace'):(api.lang()==='th'?'พื้นที่ทำงานส่วนตัว':'Private workspace');
   const caption=document.querySelector('[data-i18n="projectAutoSave"]');if(caption)caption.textContent=code?(api.lang()==='th'?'ซิงก์กับทีมผ่านเซิร์ฟเวอร์':'Changes synchronised with your team'):(api.lang()==='th'?'บันทึกบนอุปกรณ์นี้':'Changes saved on this device');
   const modal=$('liveModal');if(modal?.classList.contains('show'))fillModal();
 }
 function saveSnapshot(){api.saveLocal();api.render();syncStatus();}
 function resetConnection(){if(source){source.close();source=null;}code=null;roomProjectId=null;server=null;queue=[];localBase=null;running=false;presence=0;notify('local');}
 function optimistic(){if(!server)return null;let p=clone(server.project);for(const q of queue){try{p=applyOps(p,q.ops);}catch(e){console.warn('Failed to replay pending change',e);}}return p;}
 function incoming(data){if(!code||!data?.project)return;if(server&&data.revision<server.revision)return;
   server={revision:data.revision,project:data.project};const p=optimistic();if(!p)return;
   const previous=api.getProject();if(previous?.id===roomProjectId){api.replaceProject(p);localBase=clone(p);saveSnapshot();}
 }
 async function request(route,options={}){
   const res=await fetch(base+route,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
   let data;try{data=await res.json();}catch{data={error:`HTTP ${res.status}`};}
   if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data;
 }
 function connection(roomCode,project,revision){
   resetConnection();code=roomCode;roomProjectId=project.id;server={project:clone(project),revision};localBase=clone(project);notify('connecting');
   source=new EventSource(base+`/api/rooms/${encodeURIComponent(code)}/events`);
   source.addEventListener('snapshot',event=>{try{incoming(JSON.parse(event.data));notify('connected');}catch(e){console.error(e);}});
   source.addEventListener('presence',event=>{try{presence=JSON.parse(event.data).count||0;syncStatus();}catch{}});
   source.onopen=()=>notify('connected');source.onerror=()=>notify('offline');
 }
 async function openExisting(roomCode,remember=true){const data=await request('/api/rooms/'+roomCode);
   api.upsertProject(clone(data.project));if(remember){mapping[data.project.id]=roomCode;persistMap();}
   connection(roomCode,data.project,data.revision);api.render();syncStatus();return data;
 }
 async function createRoom(){const btn=$('liveCreate');btn.disabled=true;try{
   const p=api.getProject();const data=await request('/api/rooms',{method:'POST',body:JSON.stringify({project:p})});
   mapping[p.id]=data.code;persistMap();connection(data.code,data.project,data.revision);hideModal();showModal();
 }catch(e){alert(tx('createFailed')+'\n'+e.message);}finally{btn.disabled=false;}}
 async function joinRoom(roomCode){roomCode=String(roomCode||'').toUpperCase().replace(/[\s-]/g,'');if(!CODE_RE.test(roomCode)){alert(tx('codeError'));return;}
   const button=$('liveJoin');button.disabled=true;try{await openExisting(roomCode);hideModal();showModal();}
   catch(e){alert(tx('error')+'\n'+e.message);}finally{button.disabled=false;}}
 function onLocalChange(){if(!code || api.getProject()?.id!==roomProjectId || !localBase)return;
   const current=api.getProject(),ops=diffProject(localBase,current);if(!ops.length)return;
   localBase=clone(current);queue.push({ops,id:root.crypto?.randomUUID?.()||String(Math.random())});pump();
 }
 async function pump(){if(running||!queue.length||!code)return;running=true;const activeCode=code;
   try{while(queue.length && code===activeCode){const change=queue[0];const data=await request(`/api/rooms/${activeCode}/changes`,{method:'POST',body:JSON.stringify({clientId:CLIENT_ID,changeId:change.id,ops:change.ops})});
     queue.shift();incoming(data);notify('connected');}}
   catch(e){notify('offline');console.warn('Live edit queued:',e);setTimeout(()=>{if(code===activeCode){running=false;pump();}},2500);return;}
   running=false;
 }
 // keep local operation queue intact across temporary network loss, and merge remote edits by item ID.
 async function onRender(){syncStatus();const p=api.getProject();if(!p)return;
   const target=mapping[p.id];if(code && roomProjectId!==p.id){resetConnection();}
   if(target && (!code||code!==target)&&!startup){startup=true;try{await openExisting(target,false);}catch{notify('offline');}finally{startup=false;}}
 }
 async function fromHash(){const match=(location.hash||'').match(/(?:^#|&)room=([A-Z2-9-]+)/i);if(!match)return;
   const value=match[1].toUpperCase().replace(/-/g,'');history.replaceState(null,'',location.pathname+location.search);
   await joinRoom(value);
 }
 async function copy(text){try{await navigator.clipboard.writeText(text);}catch{const field=document.createElement('textarea');field.value=text;document.body.append(field);field.select();document.execCommand('copy');field.remove();} $('copyFeedback').textContent=tx('copied');}
 function fillModal(){const room=!!code;
   $('liveHeading').textContent=tx('title');$('liveSubtitle').textContent=tx('sub');
   $('liveRoomPanel').hidden=!room;$('liveJoinPanel').hidden=room;
   $('liveCreate').textContent=tx('create');$('liveJoin').textContent=tx('join');
   $('liveCodeLabel').textContent=tx('code');$('liveCodeHint').textContent=tx('codeHint');
   $('liveCopyLink').textContent=tx('link');$('liveCopyCode').textContent=tx('copyCode');
   $('liveExit').textContent=tx('leave');$('liveCopyLocal').textContent=tx('localCopy');
   $('liveSecurity').textContent=tx('security');$('liveCancel').textContent=tx('close');
   $('liveAccessInput').placeholder=tx('paste');$('liveRoomCode').textContent=code||'';
 }
 function showModal(){fillModal();$('liveModal').classList.add('show');$('liveModal').setAttribute('aria-hidden','false');}
 function hideModal(){$('liveModal').classList.remove('show');$('liveModal').setAttribute('aria-hidden','true');}
 function leaveRoom(){if(!code||!confirm(tx('leaveConfirm')))return;delete mapping[roomProjectId];persistMap();resetConnection();saveSnapshot();hideModal();}
 function privateCopy(){const p=api.getProject(),copy=clone(p);copy.id=root.crypto?.randomUUID?.()||String(Date.now());copy.title=p.title+' ('+(api.lang()==='th'?'ส่วนตัว':'Private copy')+')';api.upsertProject(copy);hideModal();alert(tx('localCopyDone'));}
 function init(){const share=$('liveShareButton');share.addEventListener('click',showModal);
   $('liveCancel').addEventListener('click',hideModal);$('liveBackdrop').addEventListener('click',hideModal);
   $('liveCreate').addEventListener('click',createRoom);$('liveJoin').addEventListener('click',()=>joinRoom($('liveAccessInput').value));
   $('liveAccessInput').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom(e.target.value);});
   $('liveCopyLink').addEventListener('click',()=>copy(location.origin+location.pathname+'#room='+code));
   $('liveCopyCode').addEventListener('click',()=>copy(code));$('liveExit').addEventListener('click',leaveRoom);
   $('liveCopyLocal').addEventListener('click',privateCopy);
   document.addEventListener('keydown',e=>{if(e.key==='Escape')hideModal();});
   syncStatus();setTimeout(fromHash,0);
 }
 return {init,onRender,onLocalChange,syncStatus};
}
root.BowtieTogether=createClientFactory;
function createClientFactory(api){return makeClient(api);}
})(window);
