// 奇美拉嵌入版的入口（hex-world chimera/ash/overlay）。ASH 直接跑在奇美拉的頁面裡（不用 iframe）：
// chimera-boot.js 先把 ASH 的畫面元素放進 #ash-root（平常藏著）、載入改寫成只作用在 #ash-root 的樣式，再載入這裡。
// 頁面只載入一次；每張任務票用 ASH_EMBED.start(ticket) 換成新的戰鬥（控制器的 EMBED.load），不重新初始化。
// 奇美拉這邊用的介面（都在 globalThis.ASH_EMBED 上）：
//   loaded：載好時完成的 Promise
//   start(ticket)：開一場並顯示；onresult(ticketId, {win,dead,kills,total,turns})：打完；onabort(ticketId)：按了「先不打」
//   show()／hide()：顯示、藏起戰鬥畫面（藏起時 ASH 的鍵盤、音樂、繪圖都停）
// 語言要在任何 ASH 模組載入前定好（i18n 一載入就讀），所以這裡不用靜態 import。
try{if(!localStorage.getItem('ash-language'))localStorage.setItem('ash-language','zh-TW');}catch{}
const E=globalThis.ASH_EMBED||(globalThis.ASH_EMBED={});
E.active=false;
let resolveLoaded;E.loaded=new Promise(r=>{resolveLoaded=r;});
const WARMUP={id:null,seed:1,faction:'rebel',enemy:{units:{}},squad:[{id:'-',cls:'soldier',st:{hp:100}}]};
// 依序載入：ASH 的模組彼此循環引用，要先從 game.js 這一頭進去（和 Node 裡一樣），再載機器人
const {SquadGame}=await import('./chimera-squad.js'),{installFullSquad}=await import('../tools/chimera/full-squad.mjs');
// 隊友是完整的玩家角色（chimera-squad.js），其他隊員由通關機器人操作
async function build(tk){
 const g=new SquadGame(tk);installFullSquad(g);return g;
}
let current=WARMUP,sent=false;
const root=()=>document.getElementById('ash-root');
Object.assign(E,{
 game:await build(current),
 ticket:()=>current,
 ready(){},   // 控制器載好時叫；畫面的外掛（小隊、寬螢幕）裝好之後才算載好，見檔尾
 // 打完：本機算的把戰果交給奇美拉；伺服器上的戰鬥由伺服器自己結算，這裡只通知畫面去更新
 finish(g){if(sent||!current.id)return;sent=true;const id=current.id,server=Boolean(E.remote);setTimeout(()=>{E.hide();E.onresult?.(id,server?{server:true}:g.missionResult);},1200);},
 async start(tk){current=tk;sent=false;E.remote=null;const g=await build(tk);E.game=g;E.load(g);E.show();},
 // 開戰時的狀態是經星球轉來的，Set／Map 的標記還在，先還原
 startRemote(tk,state){current=tk;sent=false;const g=mirror(JSON.parse(JSON.stringify(state),revive));E.game=g;E.load(g);
  E.remote=async(type,arg)=>{
   const t0=performance.now(),guess=predictMove(g,type,arg);
   const d=await post('act',{type,arg,target:g.target}).finally(()=>guess?.arrived());
   if(guess)await guess.done;   // 先播的那一步走完再接伺服器的結果
   E.lastTiming={type,total:Math.round(performance.now()-t0),server:d.ms,...d.prof,predicted:!!guess};console.info('[戰鬥延遲]',E.lastTiming);
   apply(g,d.state);
   const steps=(d.steps||[]).map(s=>({before:hydrate(s.before),after:hydrate(s.after),effects:s.effects}));
   // 伺服器也走到同一格：它回來的動畫裡就不要再走一次（第一個有這一步的快照，起點改成已經走到的格子）
   if(guess&&d.success)for(const s of steps){const p=s.before.player,q=s.after.player;if(p&&q&&p.x===guess.from.x&&p.y===guess.from.y&&q.x===guess.to.x&&q.y===guess.to.y){p.x=q.x;p.y=q.y;break;}}
   return {success:d.success,steps};
  };
  E.show();},
 // 顯示：先排好版面、讓繪圖器量到新的大小，再恢復繪圖；畫布還是 0 寬時畫第一格會出錯，整個繪圖迴圈就停了
 show(){root().hidden=false;E.layout?.();E.renderer?.resize();E.setActive(true);},
 hide(){E.setActive(false);root().hidden=true;},
 abort(){const id=current.id;E.hide();E.onabort?.(id);},
});
// ---- 戰鬥在伺服器上跑（伺服器化 S2）：這裡的遊戲只是伺服器狀態的鏡像，所有會改狀態的事都送到伺服器 ----
const TOKEN=()=>{try{return localStorage.getItem('chimera-token')||'';}catch{return '';}};
// 身分標頭：奇美拉的 link.js 決定（Google 工作階段或訪客代碼）
const AUTH=()=>window.chimeraAuth?.()||{'x-chimera-token':TOKEN()};
const {barrierBetween,edgeBlocks}=await import('./barriers.js'),{MOVE_MS}=await import('./actor-visuals.js');
// JSON 會把同一個物件拆成好幾份：玩家、操作中的隊員、隊員清單裡的那一位要接回同一個
function relink(st){
 if(!st?.members)return st;const by=new Map(st.members.map(m=>[m.id,m]));
 if(st.player)st.player=by.get(st.player.id)||st.player;if(st.controlled)st.controlled=by.get(st.controlled.id)||st.controlled;
 if(st.chimera?.units)for(const k of Object.keys(st.chimera.units)){const u=st.chimera.units[k];if(u&&typeof u==='object')st.chimera.units[k]=by.get(u.id)||u;}
 return st;
}
const hydrate=st=>Object.assign(Object.create(SquadGame.prototype),relink(st),{effects:[]});
function apply(g,st){relink(st);for(const k of Object.keys(g))if(!(k in st))delete g[k];Object.assign(g,st);g.effects=[];}
// 伺服器把 Set、Map 標記成 {$set}、{$map}（JSON 本身存不了）
const revive=(k,v)=>v&&typeof v==='object'?(Array.isArray(v.$set)?new Set(v.$set):Array.isArray(v.$map)?new Map(v.$map):v):v;
const battleUrl=op=>`/api/battle/${encodeURIComponent(current.id)}/${op}`;
async function post(op,body){const r=await fetch(battleUrl(op),{method:'POST',headers:{'content-type':'application/json',...AUTH()},body:JSON.stringify(body)});const d=await r.text().then(t=>JSON.parse(t,revive)).catch(()=>null);if(!r.ok)throw new Error(d?.error||`伺服器回應 ${r.status}`);return d;}
// 選單裡的動作（預備道具、選近戰武器、學技能、選升級、換人操作）原本是同步的，這裡也同步問伺服器（很少按，等一下下沒關係）
function postSync(op,body){const x=new XMLHttpRequest();x.open('POST',battleUrl(op),false);x.setRequestHeader('content-type','application/json');for(const[k,v]of Object.entries(AUTH()))x.setRequestHeader(k,v);x.send(JSON.stringify(body));const d=JSON.parse(x.responseText||'null',revive);if(x.status>=400)throw new Error(d?.error||`伺服器回應 ${x.status}`);return d;}
// 先播自己的移動（DESIGN.md 2026-10-09 提案 1）：按下去就滑過去（ASH 走一格的動畫 120 毫秒，比網路往返短），伺服器的結果晚一點到再接著播。
// 只猜明確走得過去的情況：格子是地板、中間沒有關著的門或隔板、上面沒有看得到的人；其他（開門、撞敵人、和隊員換位）照舊等伺服器。
// 猜錯（伺服器拒絕，例如撞到看不見的敵人）就套用伺服器的狀態，人回到原地。
function predictMove(g,type,arg){
 if(type!=='move'||!Array.isArray(arg)||!E.renderer||g.shadowSteps>0)return null;
 const p=g.player,from={x:p.x,y:p.y},to={x:p.x+arg[0],y:p.y+arg[1]};
 const someone=[...(g.enemies||[]),...(g.allies||[]),...(g.members||[])].some(a=>a!==p&&a.hp>0&&a.x===to.x&&a.y===to.y);
 if(someone||!g.passable?.(to.x,to.y,p)||edgeBlocks(barrierBetween(g.barriers||[],from,to)))return null;
 E.renderer.addEffects([{type:'move',actorId:'player',floor:g.floor,from,to,travel:MOVE_MS,delay:0}],0);
 let back=false,slid=false,finish;const done=new Promise(r=>finish=r);
 // 滑完時伺服器還沒回來：人先停在新的格子上（只改鏡像，伺服器的狀態一到就整個蓋過去）
 setTimeout(()=>{slid=true;if(!back){p.x=to.x;p.y=to.y;}finish();},MOVE_MS);
 return {from,to,done,arrived(){back=true;if(slid)finish();}};
}
function mirror(state){
 const g=hydrate(state),def=(k,f)=>Object.defineProperty(g,k,{configurable:true,writable:true,enumerable:false,value:f});
 for(const k of ['stash','brains'])def(k,new Map());
 const sync=body=>{try{const d=postSync('act',{...body,target:g.target});apply(g,d.state);return d;}catch(e){g.refusal={text:String(e.message||e)};return {success:false};}};
 def('action',(type,arg)=>sync({type,arg}).success);
 def('choosePerk',id=>sync({op:'perk',id}).success);
 def('setControlled',m=>sync({op:'control',id:m?.squadId}).success);
 def('cycleControlled',()=>sync({op:'cycle'}).success);
 return g;
}
E.remote=null;
await import('./main.js');
const {renderer}=await import('./controller.js');
E.renderer=renderer;
const pause=renderer.isPaused;renderer.isPaused=()=>!E.active||pause?.();
const {installSquadUI}=await import('./chimera-squad-ui.js');installSquadUI();
const {installWide}=await import('./chimera-wide.js');installWide();
resolveLoaded(E);
