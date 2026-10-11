// 奇美拉：完整玩家角色小隊的畫面（chimera-squad.js）。不改 ASH 的檔案：
//   - 繪圖：包住 Renderer.prototype.drawActors，畫完 ASH 原本的東西後，用玩家的畫法補畫其他隊員，頭上標代號；
//     正在操作的那位標金色。
//   - 小隊列：畫面上方一排按鈕（代號、職業、生命），點一下切換操作，⟳ 依序切換（鍵盤 X 也可以）。
import {Renderer} from './renderer.js';
import {update} from './controller-hud.js';
import {CHARACTERS} from './characters.js';

const CLS={soldier:'士兵',recon:'偵察兵',bulwark:'重裝兵',berserker:'狂戰士',engineer:'工兵'};

// 只裝一次；現在的戰鬥每次從 globalThis.ASH_EMBED.game 讀（同一個頁面會換好幾場）
export function installSquadUI(){
 const cur=()=>globalThis.ASH_EMBED?.game;
 const draw=Renderer.prototype.drawActors;
 Renderer.prototype.drawActors=function(time){
  const hidden=draw.call(this,time),g=this.game;
  if(!g.members)return hidden;
  // 「YOU」只標正在操作的那位（Alan 2026-10-11）：畫其他隊員時把 ASH 的 YOU 字樣略掉
  const text=this.text;
  for(const m of g.members){
   if(!g.seen[m.y]?.[m.x]||m===g.player)continue;
   const a=this.projectActor(m);
   if(m.hp<=0){const k=this.chimeraUnit;this.chimeraUnit=m;try{this.corpse(a,'player',m.character);}finally{this.chimeraUnit=k;}}
   else{this.text=function(s,...r){if(s==='YOU')return;return text.call(this,s,...r);};try{this.actor(a,'player',time,m);}finally{this.text=text;}}
  }
  return hidden;
 };
 // 代號最後才標（Alan 2026-10-11：下面那位的名字被上面的隊友蓋住）：疊在所有東西上面
 const overlays=Renderer.prototype.drawOverlays;
 Renderer.prototype.drawOverlays=function(...args){
  const r=overlays.apply(this,args),g=this.game;
  if(g?.members)for(const m of g.members){if(m.hp<=0||!g.seen[m.y]?.[m.x])continue;const a=this.projectActor(m),s=m.callName||m.squadId,y=a.y-this.tile*.62,c=this.ctx;
   c.save();c.font='9px monospace';const w=c.measureText(s).width+6;c.fillStyle='rgba(8,12,10,.72)';c.fillRect(Math.round(a.x-w/2),Math.round(y-7),Math.round(w),12);c.restore();   // 底下墊一塊暗底，疊在隊友身上也看得清楚
   this.text(s,a.x,y,m===g.player?'#ffd27a':'#9fe8d5',9);}
  return r;
 };

 const bar=document.createElement('div');bar.id='chimera-squad';
 bar.style.cssText='position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:30;display:flex;gap:4px;font:12px/1.2 system-ui,sans-serif;pointer-events:auto';
 (document.getElementById('ash-root')||document.body).appendChild(bar);   // 奇美拉的頁面裡：放在戰鬥畫面那一層
 const label=m=>`${m.callName&&m.callName!==m.squadId?m.callName+' ':''}${m.squadId} ${CLS[m.character]||CHARACTERS[m.character]?.name||m.character}<br>${Math.max(0,m.hp)}/${m.maxHp}`;
 let last='';
 const render=()=>{
  if(globalThis.ASH_EMBED&&!globalThis.ASH_EMBED.active)return;
  bar.style.display=document.getElementById('ash-root')?.classList.contains('wide')===false?'none':'flex';   // 手機（直向）改用生命護甲旁的 ⟳ 和隊員列（Alan 2026-10-11）
  const game=cur();if(!game?.members||game.members.length<2){if(last!==''){bar.innerHTML='';last='';}return;}
  const key=game.members.map(m=>`${m.squadId}:${m.hp}:${m===game.player}`).join('|')+game.status;
  if(key===last)return;last=key;
  bar.innerHTML=game.members.map((m,i)=>`<button data-m="${i}" ${m.hp<=0?'disabled':''} style="padding:3px 7px;border-radius:4px;border:1px solid ${m===game.player?'#e8b36e':'#4a5a55'};background:${m===game.player?'#3a2e1a':'#1b211f'};color:${m.hp<=0?'#666':'#e8e2d0'};text-align:center">${label(m)}</button>`).join('')+
   `<button data-cycle style="padding:3px 9px;border-radius:4px;border:1px solid #4a5a55;background:#1b211f;color:#e8e2d0" title="切換（X）">⟳</button>`;
 };
 // 手機（Alan 2026-10-11）：上方那排隊員按鈕太佔空間，改成生命護甲右邊一顆 ⟳，其他隊員的生命、護甲小小的列在下面（點一下切換）
 let mates=null,cyc=null,lastM='';
 const renderMates=()=>{
  const game=cur(),host=document.querySelector('#ash-root .vitals-bar .mobile-health');
  if(!host||!game?.members||game.members.length<2){if(mates){mates.innerHTML='';lastM='';}if(cyc)cyc.hidden=true;return;}
  if(!cyc||!cyc.isConnected){cyc=document.createElement('button');cyc.id='chimera-cycle';cyc.textContent='⟳';cyc.title='切換（X）';host.appendChild(cyc);}
  if(!mates||!mates.isConnected){mates=document.createElement('div');mates.id='chimera-mates';host.after(mates);}
  cyc.hidden=false;const capOf=m=>CHARACTERS[m.character]?.plateCapacity??game.plateCapacity??0;
  const key=game.members.map(m=>`${m.squadId}:${m.hp}:${m.plates||0}:${m===game.player}`).join('|');if(key===lastM)return;lastM=key;
  mates.innerHTML=game.members.map((m,i)=>m===game.player?'':`<button data-m="${i}" class="${m.hp<=0?'down':''}"${m.hp<=0?' disabled':''}><b>${m.callName||m.squadId}</b> ${Math.max(0,m.hp)}/${m.maxHp}${capOf(m)?` · ${m.plates||0}/${capOf(m)}`:''}</button>`).join('');
 };
 const switched=ok=>{if(ok){last='';lastM='';render();renderMates();update();}};
 document.addEventListener('click',e=>{const game=cur();if(!game?.members)return;
  if(e.target.closest('#chimera-cycle')){e.preventDefault();switched(game.cycleControlled());return;}
  const r=e.target.closest('#chimera-mates [data-m]');if(r){const m=game.members[+r.dataset.m];if(m&&m.hp>0)switched(game.setControlled(m));}});
 bar.addEventListener('click',e=>{const b=e.target.closest('button'),game=cur();if(!b||!game?.members)return;
  if(b.dataset.cycle!==undefined)switched(game.cycleControlled());else switched(game.setControlled(game.members[+b.dataset.m]));});
 // X：ASH 的 Tab 已經是「切換目標」，數字鍵留給橫向提案的換武器（docs/LANDSCAPE_UI.md）
 window.addEventListener('keydown',e=>{if((e.key==='x'||e.key==='X')&&globalThis.ASH_EMBED?.active!==false&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest?.('input,textarea,dialog')){e.preventDefault();const game=cur();if(game?.members)switched(game.cycleControlled());}});
 const tick=()=>{render();if(!globalThis.ASH_EMBED||globalThis.ASH_EMBED.active)renderMates();requestAnimationFrame(tick);};tick();
}
