// 奇美拉嵌入版的入口（mission.html；hex-world chimera/ash/overlay）。任務票放在網址的 # 後面（JSON），
// 打完用 postMessage 把戰果傳給外層的奇美拉：{type:'chimera-result', ticketId, result:{win,dead,kills,total,turns}}。
// 語言要在任何 ASH 模組載入前定好（i18n 一載入就讀），所以這裡不用靜態 import。
try{if(!localStorage.getItem('ash-language'))localStorage.setItem('ash-language','zh-TW');}catch{}
const send=msg=>{try{(window.parent!==window?window.parent:window.opener)?.postMessage(msg,'*');}catch{}};
let ticket=null;
try{ticket=JSON.parse(decodeURIComponent(location.hash.slice(1)));}catch{}
if(!ticket?.squad?.length){document.body.classList.remove('booting');document.body.textContent='沒有任務票。';send({type:'chimera-error',error:'no ticket'});}
else{
 // 依序載入：ASH 的模組彼此循環引用，要先從 game.js 這一頭進去（和 Node 裡一樣），再載機器人
 const {MissionGame}=await import('./chimera-mission.js'),{installSquadBrain}=await import('../tools/chimera/squad.mjs');
 const game=new MissionGame(ticket);installSquadBrain(game);
 let sent=false;
 globalThis.ASH_EMBED={game,
  ready(){send({type:'chimera-ready',ticketId:ticket.id});},
  finish(g){if(sent)return;sent=true;setTimeout(()=>send({type:'chimera-result',ticketId:ticket.id,result:g.missionResult}),1200);}};
 await import('./main.js');
}
