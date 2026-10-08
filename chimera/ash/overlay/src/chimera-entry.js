// 奇美拉嵌入版的入口（mission.html；hex-world chimera/ash/overlay）。
// 頁面只載入一次：奇美拉一打開就在背景載好（沒有任務票時先放一場看不到的暖機戰鬥），之後每張任務票用
// postMessage {type:'chimera-ticket', ticket} 送進來，用控制器的 EMBED.load 換成新的戰鬥，不重新初始化。
// 網址 # 後面帶任務票（JSON）也可以直接開一場（測試用）。
// 打完回傳 {type:'chimera-result', ticketId, result:{win,dead,kills,total,turns}}；載好時送 {type:'chimera-ready'}。
// 語言要在任何 ASH 模組載入前定好（i18n 一載入就讀），所以這裡不用靜態 import。
try{if(!localStorage.getItem('ash-language'))localStorage.setItem('ash-language','zh-TW');}catch{}
const send=msg=>{try{(window.parent!==window?window.parent:window.opener)?.postMessage(msg,'*');}catch{}};
let ticket=null;
try{ticket=JSON.parse(decodeURIComponent(location.hash.slice(1)));}catch{}
const WARMUP={id:null,seed:1,faction:'rebel',enemy:{units:{}},squad:[{id:'-',cls:'soldier',st:{hp:100}}]};
// 依序載入：ASH 的模組彼此循環引用，要先從 game.js 這一頭進去（和 Node 裡一樣），再載機器人
const {SquadGame}=await import('./chimera-squad.js'),{installFullSquad}=await import('../tools/chimera/full-squad.mjs');
// 隊友是完整的玩家角色（chimera-squad.js），其他隊員由通關機器人操作；ticket.survivors 時改用階段 1 的倖存友軍版本
async function build(tk){
 if(tk.survivors){const {MissionGame}=await import('./chimera-mission.js'),{installSquadBrain}=await import('../tools/chimera/squad.mjs');const g=new MissionGame(tk);installSquadBrain(g);return g;}
 const g=new SquadGame(tk);installFullSquad(g);return g;
}
let current=ticket?.squad?.length?ticket:WARMUP,sent=false,loaded=false;
const queue=[];
globalThis.ASH_EMBED={game:await build(current),
 ready(){loaded=true;send({type:'chimera-ready'});for(const tk of queue.splice(0))start(tk);},
 finish(g){if(sent||!current.id)return;sent=true;const id=current.id;setTimeout(()=>send({type:'chimera-result',ticketId:id,result:g.missionResult}),1200);}};
async function start(tk){
 if(!loaded){queue.push(tk);return;}
 current=tk;sent=false;const g=await build(tk);ASH_EMBED.game=g;ASH_EMBED.load(g);
 send({type:'chimera-started',ticketId:tk.id});
}
window.addEventListener('message',e=>{if(e.data?.type==='chimera-ticket'&&e.data.ticket?.squad?.length)start(e.data.ticket);});
await import('./main.js');
const {installSquadUI}=await import('./chimera-squad-ui.js');installSquadUI();
