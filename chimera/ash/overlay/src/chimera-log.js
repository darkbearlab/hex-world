// 奇美拉：戰鬥的行動紀錄（DESIGN.md 2026-10-09 方案 A：瀏覽器跑、伺服器同步驗證）。
// 戰鬥在瀏覽器裡跑；玩家的每個輸入記成一筆，送給伺服器，伺服器用同一個種子在自己的遊戲上重播，戰果以伺服器的為準。
// 一筆紀錄就是玩家（或測試用的機器人）對遊戲做的公開呼叫：
//   {a, arg, t}：game.target=t 之後 game.action(a,arg)
//   {perk}：game.choosePerk(id)　{ctl}：換人操作（隊員的 squadId）　{cycle:1}：換下一位
// 隊員機器人在行動「裡面」叫的 action 不記（重播時它們會自己再做一次），所以用 depth 只記最外層。
export function applyEntry(g,e){
 if(e.perk!==undefined)return g.choosePerk(e.perk);
 if(e.ctl!==undefined)return g.setControlled(g.members.find(m=>m.squadId===e.ctl));
 if(e.cycle)return g.cycleControlled();
 if(e.t!==undefined)g.target=e.t;
 return g.action(e.a,e.arg);
}
// 在這場遊戲上記錄最外層的公開呼叫；每記一筆叫 onEntry(紀錄, 呼叫的結果)
export function record(g,onEntry){
 let depth=0;
 const wrap=(name,toEntry)=>{const orig=g[name];if(typeof orig!=='function')return;
  Object.defineProperty(g,name,{configurable:true,writable:true,enumerable:false,value:function(...args){
   if(depth>0)return orig.apply(this,args);
   const entry=toEntry(...args);   // 呼叫之前記（例如鎖定的目標要是按下去那一刻的）
   depth++;let ok;try{ok=orig.apply(this,args);}finally{depth--;}
   onEntry(entry,ok);return ok;}});};
 wrap('action',(a,arg)=>({a,...(arg===undefined?{}:{arg}),t:g.target??null}));   // 沒給參數和給 null 不一樣（例如手電筒），沒給就不記
 wrap('choosePerk',id=>({perk:id}));
 wrap('setControlled',m=>({ctl:m?.squadId??null}));
 wrap('cycleControlled',()=>({cycle:1}));
}
// 狀態指紋：回合、狀態、亂數、每個人的位置與血量（兩邊對不上就是不同步）
export function fingerprint(g){
 const s=JSON.stringify([g.turn,g.status,g.floor,g.rng?.state?.(),g.player?.squadId,
  (g.members||[]).map(m=>[m.squadId,m.x,m.y,m.hp,m.plates||0]),(g.enemies||[]).map(e=>[e.id,e.x,e.y,e.hp])]);
 let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(36);
}
