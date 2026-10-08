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
// 隊友是完整的玩家角色（chimera-squad.js），其他隊員由通關機器人操作；ticket.survivors 時改用階段 1 的倖存友軍版本
async function build(tk){
 if(tk.survivors){const {MissionGame}=await import('./chimera-mission.js'),{installSquadBrain}=await import('../tools/chimera/squad.mjs');const g=new MissionGame(tk);installSquadBrain(g);return g;}
 const g=new SquadGame(tk);installFullSquad(g);return g;
}
let current=WARMUP,sent=false;
const root=()=>document.getElementById('ash-root');
Object.assign(E,{
 game:await build(current),
 ticket:()=>current,
 ready(){},   // 控制器載好時叫；畫面的外掛（小隊、寬螢幕）裝好之後才算載好，見檔尾
 finish(g){if(sent||!current.id)return;sent=true;const id=current.id;setTimeout(()=>{E.hide();E.onresult?.(id,g.missionResult);},1200);},
 async start(tk){current=tk;sent=false;const g=await build(tk);E.game=g;E.load(g);E.show();},
 // 顯示：先排好版面、讓繪圖器量到新的大小，再恢復繪圖；畫布還是 0 寬時畫第一格會出錯，整個繪圖迴圈就停了
 show(){root().hidden=false;E.layout?.();E.renderer?.resize();E.setActive(true);},
 hide(){E.setActive(false);root().hidden=true;},
 abort(){const id=current.id;E.hide();E.onabort?.(id);},
});
await import('./main.js');
const {renderer}=await import('./controller.js');
E.renderer=renderer;
const pause=renderer.isPaused;renderer.isPaused=()=>!E.active||pause?.();
const {installSquadUI}=await import('./chimera-squad-ui.js');installSquadUI();
const {installWide}=await import('./chimera-wide.js');installWide();
resolveLoaded(E);
