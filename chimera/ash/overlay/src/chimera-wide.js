// 奇美拉的寬螢幕戰鬥畫面（ASH docs/LANDSCAPE_UI.md 的 P1 橫向骨架；樣式在 chimera-wide.css）。
// P3 鍵盤：1～4 換成背包裡第幾把武器（ASH 沒有用到數字鍵）。
// P2 滑鼠（寬螢幕時）：游標停在看得到的敵人上顯示命中率小卡；右鍵點敵人直接鎖定並開火；滾輪縮放。
// 寬度 900 以上且寬比高大時，#ash-root 加上 wide：戰場滿版，右側欄放任務名稱與「先不打」、鎖定目標（ASH 的目標卡
// 搬進來，不再浮在戰場上）、視野內的敵人（點選鎖定）、紀錄。手機直向照 ASH 原本的版面，只多一顆「先不打」。
import {Renderer} from './renderer.js';
import {update} from './controller-hud.js';
import {enemyName} from './game.js';
import {distance} from './world.js';
import {HOTKEY_RUN} from './controller-aim.js';
import {act} from './controller.js';

const WIDE=matchMedia('(min-width: 900px) and (min-aspect-ratio: 4/3)');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function installWide(){
 const E=globalThis.ASH_EMBED,root=document.getElementById('ash-root');
 const side=document.createElement('aside');side.id='chimera-side';
 side.innerHTML=`<header class="mhead"><b data-title></b><button data-abort>先不打（關掉，票還在）</button><small>走到電梯撤離＝勝・全員倒下＝敗・X 或左上切換操作的隊員</small></header>
  <section class="target-slot"><h4>LOCKED TARGET<span>Tab 下一個</span></h4><p class="empty">點敵人或右邊清單鎖定</p></section>
  <section class="inview"><h4>IN VIEW <b data-count>0</b><span>點選鎖定</span></h4><ul class="foes"></ul></section>
  <section class="log"><h4>LOG</h4><div data-log></div></section>`;
 root.appendChild(side);
 side.querySelector('[data-abort]').onclick=()=>E.abort();
 const card=root.querySelector('#target-card'),slot=side.querySelector('.target-slot'),home=card.parentElement,anchor=card.nextSibling;
 const layout=()=>{
  const wide=WIDE.matches;if(root.classList.contains('wide')!==wide||!root.dataset.laid){root.classList.toggle('wide',wide);root.dataset.laid='1';
   if(wide)slot.appendChild(card);else home.insertBefore(card,anchor);
   if(E.active){E.renderer?.resize();window.dispatchEvent(new Event('resize'));}}
 };
 E.layout=layout;WIDE.addEventListener('change',layout);layout();

 // 寬螢幕：目標卡固定在右側欄，不算浮動位置、不畫連線
 const place=Renderer.prototype.placeTargetCard;
 Renderer.prototype.placeTargetCard=function(){
  if(!root.classList.contains('wide'))return place.call(this);
  const ui=this.targetUI;if(!ui)return;const target=this.game.targeted;
  ui.card.style.transform='';ui.card.style.visibility=target&&!ui.card.hidden?'visible':'hidden';ui.link.setAttribute('hidden','');ui.frame=null;
  slot.querySelector('.empty').hidden=Boolean(target&&!ui.card.hidden);
 };

 const foes=side.querySelector('.foes'),count=side.querySelector('[data-count]'),log=side.querySelector('[data-log]'),title=side.querySelector('[data-title]');
 foes.addEventListener('click',e=>{const li=e.target.closest('li[data-id]'),g=E.game;if(!li||!g)return;g.target=li.dataset.id;update();});
 let last='';
 const tick=()=>{
  requestAnimationFrame(tick);
  const g=E.game;if(!E.active||!g)return;
  const seen=g.visibleEnemies||[],p=g.player;
  const key=[E.ticket?.()?.id,g.turn,g.target,p.x,p.y,g.logs?.[0]?.text,...seen.map(e=>`${e.id}:${e.hp}`)].join('|');
  if(key===last)return;last=key;
  title.textContent=E.ticket?.()?.title||'';
  count.textContent=seen.length;
  foes.innerHTML=seen.map(e=>`<li data-id="${esc(e.id)}" class="${e.id===g.target?'on':''}"><span>${esc(enemyName(e))}</span><span class="bar"><i style="width:${Math.round(100*Math.max(0,e.hp)/(e.maxHp||e.hp||1))}%"></i></span><small>${distance(p,e)}</small></li>`).join('');
  log.innerHTML=(g.logs||[]).slice(0,12).map(l=>`<p class="${l.danger?'danger':''}">${esc(l.text)}</p>`).join('');
 };
 tick();

 // ---- P2 滑鼠 ----
 const canvas=root.querySelector('#battle'),hover=document.createElement('div');hover.id='chimera-hover';hover.hidden=true;root.appendChild(hover);
 const wide=()=>E.active&&root.classList.contains('wide');
 const foeAt=ev=>{const g=E.game,r=canvas.getBoundingClientRect(),R=E.renderer;if(!g||!R)return null;const t=R.unproject(ev.clientX-r.left,ev.clientY-r.top);return (g.visibleEnemies||[]).find(e=>e.x===t.x&&e.y===t.y)||null;};
 canvas.addEventListener('mousemove',ev=>{
  if(!wide()){hover.hidden=true;return;}
  const e=foeAt(ev),g=E.game;if(!e){hover.hidden=true;return;}
  let chance='—';try{chance=Math.round(g.accuracy(g.player,e).chance)+'%';}catch{}
  const d=distance(g.player,e),range=g.weapon?.range??0,cover=g.protectingCover?.(e,g.player)?.length?'有掩護':'無掩護';
  hover.innerHTML=`<b>${esc(enemyName(e))}</b><span>${Math.max(0,e.hp)}/${e.maxHp||e.hp}</span><small>距離 ${d}${d>range?'（射程外）':''} · 命中 ${chance} · ${cover}</small><small>左鍵 鎖定　右鍵 直接開火</small>`;
  hover.style.left=`${ev.clientX+16}px`;hover.style.top=`${ev.clientY+14}px`;hover.hidden=false;
 });
 canvas.addEventListener('mouseleave',()=>{hover.hidden=true;});
 canvas.addEventListener('contextmenu',ev=>{
  if(!wide())return;ev.preventDefault();const e=foeAt(ev);if(!e)return;
  E.game.target=e.id;update();HOTKEY_RUN.fire?.();hover.hidden=true;
 });
 canvas.addEventListener('wheel',ev=>{if(!wide())return;ev.preventDefault();(ev.deltaY<0?HOTKEY_RUN.zoomIn:HOTKEY_RUN.zoomOut)?.();},{passive:false});
 // ---- P3 鍵盤：數字鍵換武器 ----
 window.addEventListener('keydown',ev=>{
  if(!E.active||ev.ctrlKey||ev.metaKey||ev.altKey||!/^[1-4]$/.test(ev.key)||ev.target.closest?.('input,textarea')||document.getElementById('modal')?.open)return;
  const g=E.game,slot=g?.player?.owned?.[Number(ev.key)-1];if(slot===undefined)return;
  ev.preventDefault();if(slot!==g.player.weapon)act('weapon',slot);
 });
}
