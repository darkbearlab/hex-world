// PVP 的瀏覽器端（pvp/DESIGN.md「介面改用 ASH 原本的戰鬥畫面」）：ASH 原本的戰鬥畫面，跑在 pvp/web/play.html 裡（pvp-boot.js 載入）。
// 戰鬥只在伺服器上跑（pvp-room.js 的 act／view）：這裡的遊戲只是「這一方看得到的」伺服器狀態的鏡像，每個會改狀態的動作都送到伺服器，
// 伺服器回傳這一步的動畫快照（照 ASH 原本的 Playback 播）和之後的狀態。照奇美拉 chimera-entry.js 的 startRemote 做，拿掉 PVP 用不到的部分。
// 頁面用的（globalThis.ASH_EMBED）：
//   loaded：載好時完成的 Promise；connect({side, token})：設定座位；startRemote(view)：用伺服器的畫面開始／換成新的局面
//   onView(view)：每次伺服器回傳之後叫（頁面更新資訊列：回合、還沒動的人、輪到誰）；show()／hide()
try{if(!localStorage.getItem('ash-language'))localStorage.setItem('ash-language','zh-TW');}catch{}
const E=globalThis.ASH_EMBED||(globalThis.ASH_EMBED={});
E.active=false;
let resolveLoaded;E.loaded=new Promise(r=>{resolveLoaded=r;});
const WARMUP={id:null,seed:1,faction:'rebel',enemy:{units:{}},squad:[{id:'-',cls:'soldier',st:{hp:100}}]};
// ASH 的模組彼此循環引用，要先從 game.js 這一頭進去
const {SquadGame}=await import('./chimera-squad.js');
const {barrierBetween,edgeBlocks}=await import('./barriers.js'),{MOVE_MS}=await import('./actor-visuals.js'),{setSize}=await import('./data.js');
let seat={side:'A',token:''};
Object.assign(E,{
 game:new SquadGame(WARMUP),
 ticket:()=>({id:'pvp'}),
 ready(){},
 finish(){E.onFinish?.();},
 connect(s){seat={...seat,...s};},
 show(){root().hidden=false;E.layout?.();E.renderer?.resize();E.setActive(true);},
 hide(){E.setActive(false);root().hidden=true;},
 abort(){E.onabort?.();},
});
const root=()=>document.getElementById('ash-root');
// JSON 會把同一個物件拆成好幾份：玩家、操作中的隊員、隊員清單裡的那一位要接回同一個
function relink(st){
 if(!st?.members)return st;const by=new Map(st.members.map(m=>[m.id,m]));
 if(st.player)st.player=by.get(st.player.id)||st.player;if(st.controlled)st.controlled=by.get(st.controlled.id)||st.controlled;
 return st;
}
const hydrate=st=>(st?.grid&&setSize(st.grid.length),Object.assign(Object.create(SquadGame.prototype),relink(st),{effects:[]}));
function apply(g,st){if(!st)return;relink(st);for(const k of Object.keys(g))if(!(k in st))delete g[k];Object.assign(g,st);g.effects=[];}
const revive=(k,v)=>v&&typeof v==='object'?(Array.isArray(v.$set)?new Set(v.$set):Array.isArray(v.$map)?new Map(v.$map):v):v;
const url=op=>`/api/${op}?side=${seat.side}`;
async function post(body){const r=await fetch(url('act'),{method:'POST',headers:{'content-type':'application/json','x-seat':seat.token},body:JSON.stringify(body)});const t=await r.text();let d=null;try{d=JSON.parse(t,revive);}catch{}if(!r.ok||!d)throw new Error(d?.error||t||`伺服器回應 ${r.status}`);return d;}
// 選單裡的動作（換人操作、預備道具）原本是同步的，這裡也同步問伺服器
function postSync(body){const x=new XMLHttpRequest();x.open('POST',url('act'),false);x.setRequestHeader('content-type','application/json');x.setRequestHeader('x-seat',seat.token);x.send(JSON.stringify(body));const d=JSON.parse(x.responseText||'null',revive);if(x.status>=400||!d)throw new Error(d?.error||`伺服器回應 ${x.status}`);return d;}
// 先播自己的移動（同奇美拉）：明確走得過去才猜，猜錯就套用伺服器的狀態
function predictMove(g,type,arg){
 if(type!=='move'||!Array.isArray(arg)||!E.renderer)return null;
 const p=g.player,from={x:p.x,y:p.y},to={x:p.x+arg[0],y:p.y+arg[1]};
 const someone=[...(g.enemies||[]),...(g.allies||[]),...(g.members||[])].some(a=>a!==p&&a.hp>0&&a.x===to.x&&a.y===to.y);
 if(someone||!g.passable?.(to.x,to.y,p)||edgeBlocks(barrierBetween(g.barriers||[],from,to)))return null;
 E.renderer.addEffects([{type:'move',actorId:'player',floor:g.floor,from,to,travel:MOVE_MS,delay:0}],0);
 let back=false,slid=false,finish;const done=new Promise(r=>finish=r);
 setTimeout(()=>{slid=true;if(!back){p.x=to.x;p.y=to.y;}finish();},MOVE_MS);
 return {from,to,done,arrived(){back=true;if(slid)finish();}};
}
function mirror(state){
 const g=hydrate(state),def=(k,f)=>Object.defineProperty(g,k,{configurable:true,writable:true,enumerable:false,value:f});
 for(const k of ['stash','brains'])def(k,new Map());
 const sync=body=>{try{const d=postSync({...body,target:g.target});apply(g,d.state);E.onView?.(d);return d;}catch(e){g.refusal={text:String(e.message||e)};return {success:false};}};
 def('action',(type,arg)=>sync({type,arg}).success);
 def('choosePerk',()=>false);
 def('setControlled',m=>sync({op:'control',id:m?.squadId}).success);
 def('cycleControlled',()=>sync({op:'cycle'}).success);
 return g;
}
// 用伺服器的畫面開始（或對方的階段結束、輪到你時換成新的局面）
E.startRemote=view=>{
 if(!view?.state)return;
 const g=mirror(JSON.parse(JSON.stringify(view.state),revive));E.game=g;E.load(g);
 E.remote=async(type,arg)=>{
  const guess=predictMove(g,type,arg);
  const d=await post({type,arg,target:g.target}).finally(()=>guess?.arrived());
  if(guess)await guess.done;
  apply(g,d.state);
  const steps=(d.steps||[]).map(s=>({before:hydrate(s.before),after:hydrate(s.after),effects:s.effects}));
  if(guess&&d.success)for(const s of steps){const p=s.before.player,q=s.after.player;if(p&&q&&p.x===guess.from.x&&p.y===guess.from.y&&q.x===guess.to.x&&q.y===guess.to.y){p.x=q.x;p.y=q.y;break;}}
  if(!d.success&&d.refusal)g.refusal=d.refusal;
  setTimeout(()=>E.onView?.(d),0);
  return {success:d.success,steps};
 };
 E.show();
};
// 頁面的按鈕（結束階段、投降）
E.op=async op=>{const d=await post({op});if(d.state&&E.game)apply(E.game,d.state);E.onView?.(d);return d;};
E.remote=null;
await import('./main.js');
const {renderer}=await import('./controller.js');
E.renderer=renderer;
const pause=renderer.isPaused;renderer.isPaused=()=>!E.active||pause?.();
const {installSquadUI}=await import('./chimera-squad-ui.js');installSquadUI();
const {installWide}=await import('./chimera-wide.js');installWide();
resolveLoaded(E);
