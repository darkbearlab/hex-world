// 奇美拉：戰鬥的收尾與選單（Alan 2026-10-10）
// 1. 選單裡會跑回 ASH 本身流程的項目全部拿掉（放棄這一輪、重新部署、紀錄檔案、存檔備份與還原、重設進度、操作紀錄播放、訓練場⋯）。
//    畫面上藏起來，點擊也在最前面攔下（ASH 的 data-modal 動作）。簡報、音效、血量、快捷鍵、語言之類的設定照留。
// 2. 打完不再直接跳走：先跑登記的演出鉤子（E.outcomeHooks，依序 await），再出勝利／失敗的提示，玩家按「回到任務管制」才關掉、把戰果交回奇美拉。
//    鉤子：E.outcomeHooks.push(async (game, outcome) => { ... })；outcome = {kind:'won'|'wiped'|'lost', title, sub, result}
//    也會發 window 事件 'chimera:outcome'（detail 同上），給只想聽不想擋的人。
const BLOCK = ['abandon', 'abandonConfirm', 'restart', 'deploy', 'redeploySame', 'journal', 'killhouse', 'khTutorial', 'khArcade', 'khRetry', 'khMenu', 'khSkip',
  'deployNormal', 'deployOperator', 'deployDaily', 'deployQuick', 'deployQuickStart', 'deployDifficulty', 'deployBackOperator', 'new',
  'backupExport', 'backupImport', 'backupPrevious', 'backupConfirm', 'backupCancel', 'resetProgress', 'resetConfirm', 'replayLoad', 'replayFast', 'runLog', 'export', 'import'];
export function installGuard(E) {
  const css = document.createElement('style');
  css.textContent = BLOCK.map(k => `#modal [data-modal="${k}"]`).join(',') + '{display:none!important}' +
    // 存檔區的說明文字也一起藏（只剩按鈕被藏掉的空段落）
    '#modal .modal-row:empty{display:none}';
  document.head.appendChild(css);
  // 整段都是被擋的按鈕（存檔、危險、紀錄、測試）：連標題和說明一起藏
  const tidy = () => { const M = document.getElementById('modal'); if (!M || !E.active) return;
    for (const h of M.querySelectorAll('.settings-section')) { const part = []; for (let n = h.nextElementSibling; n && !n.classList.contains('settings-section'); n = n.nextElementSibling) { if (n.matches('.modal-footer, .settings-tabs, [role=tablist]') || n.querySelector('[role=tab]')) break; part.push(n); }
      const btns = part.flatMap(n => [...(n.matches('[data-modal]') ? [n] : []), ...n.querySelectorAll('[data-modal]')]);
      if (btns.length && btns.every(b => BLOCK.includes(b.dataset.modal))) for (const n of [h, ...part]) n.style.display = 'none'; } };
  const watch = () => { const M = document.getElementById('modal'); if (!M) return setTimeout(watch, 500); new MutationObserver(tidy).observe(M, {childList: true, subtree: true}); tidy(); };
  watch();
  // 「放棄這一輪」換成「撤出戰場」：選單的本局分頁（有「任務簡介」那一頁）加一顆，按了確認、關選單，下 chimeraRetreat 行動
  const addRetreat = () => { const M = document.getElementById('modal'); if (!M || !E.active || M.querySelector('#chimera-retreat')) return; const brief = M.querySelector('[data-modal="mission"]'); if (!brief || !E.game || E.game.status !== 'playing') return;
    const b = document.createElement('button'); b.id = 'chimera-retreat'; b.type = 'button'; b.className = 'modal-button secondary'; b.textContent = '撤出戰場（算敗北）';
    b.onclick = async () => { if (!confirm('撤出戰場？\n\n這一場算敗北、沒有積分；撤的當下，附近的敵人會追擊一下，可能有人倒下。活著的人撤出後還留在合約上。')) return;
      M.close?.(); const ok = E.game.action('chimeraRetreat'); if (ok) { try { (await import('./controller-hud.js')).update(); } catch {} } };
    brief.parentElement.insertBefore(b, brief.nextSibling); };
  new MutationObserver(addRetreat).observe(document.body, {childList: true, subtree: true});
  // 狩獵場的電梯口（Alan 2026-10-11）：往下一層，還是帶著收穫撤離
  setInterval(() => { const g = E.game; if (!E.active || !g?.chimeraAtExit || g.status !== 'playing' || document.getElementById('chimera-deeper')) return;
    const box = document.createElement('div'); box.id = 'chimera-deeper'; box.className = 'chimera-outcome';
    box.innerHTML = `<div class="co-card"><div class="co-eyebrow">ELEVATOR</div><h2>第 ${g.floor} 層的電梯口</h2><div class="co-sub">往下更兇，撐不住的話倒在下面的人很難帶回來；狀態不會恢復。</div>
      <div class="modal-row"><button class="modal-button" type="button" data-c="deeper">往下一層</button> <button class="modal-button secondary" type="button" data-c="leave">帶著收穫撤離</button> <button class="modal-button secondary" type="button" data-c="stay">再想想</button></div></div>`;
    (document.getElementById('ash-root') || document.body).appendChild(box);
    box.onclick = async e => { const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return; box.remove(); if (c === 'stay') { g.chimeraAtExit = false; return; }
      const ok = g.action(c === 'deeper' ? 'chimeraDeeper' : 'chimeraLeave'); if (ok) { try { (await import('./controller-hud.js')).update(); } catch {} } };
  }, 400);
  document.addEventListener('click', e => { const b = e.target instanceof Element && e.target.closest('[data-modal]'); if (b && E.active && BLOCK.includes(b.dataset.modal)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
export function outcomeOf(g, ticket) {
  const r = g.missionResult || {win: g.status === 'won', dead: [], kills: 0, total: 0, turns: g.turn};
  const members = g.members || [g.player], alive = members.filter(m => m.hp > 0);
  const kind = r.win ? 'won' : g.status === 'retreated' && alive.length ? 'retreat' : alive.length ? 'lost' : 'wiped';
  const names = id => { const m = members.find(x => x.squadId === id); return m?.callName || id; };
  return {kind, result: r, title: {won: '任務完成', lost: '任務失敗', wiped: '小隊全滅', retreat: '撤出戰場'}[kind], sub: ticket?.title || '',
    lines: [`回合 ${r.turns}`, `打倒 ${r.kills}／${r.total}`, r.dead.length ? `倒下：${r.dead.map(names).join('、')}` : '沒有人倒下'].concat(r.boss ? [`頭目：${{retreat: '負傷撤退', dead: '戰死', taken: '戰死，遺產級到手'}[r.boss] || r.boss}`] : [])};
}
// 勝利／失敗的提示：疊在戰場上，按「回到任務管制」才結束
export function showOutcome(o) {
  return new Promise(done => {
    const box = document.createElement('div'); box.className = `chimera-outcome ${o.kind}`;
    box.innerHTML = `<div class="co-card"><div class="co-eyebrow">${o.kind === 'won' ? 'MISSION COMPLETE' : o.kind === 'wiped' ? 'SQUAD LOST' : o.kind === 'retreat' ? 'WITHDRAWN' : 'MISSION FAILED'}</div>
      <h2>${o.title}</h2>${o.sub ? `<div class="co-sub">${esc(o.sub)}</div>` : ''}<ul>${o.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <button class="modal-button" type="button">回到任務管制</button></div>`;
    (document.getElementById('ash-root') || document.body).appendChild(box);
    const b = box.querySelector('button'); b.focus?.();
    b.onclick = () => { box.remove(); done(); };
  });
}
export async function runOutcome(E, g, ticket) {
  const o = outcomeOf(g, ticket);
  try { window.dispatchEvent(new CustomEvent('chimera:outcome', {detail: o})); } catch {}
  for (const h of E.outcomeHooks || []) { try { await h(g, o); } catch (e) { console.warn('outcome hook', e); } }
  await showOutcome(o);
  return o;
}
// 樣式（ASH 的頁面裡）
const style = document.createElement('style');
style.textContent = `.chimera-outcome{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#000a,#000d);animation:coIn .5s ease both}
.chimera-outcome .co-card{min-width:min(420px,92vw);padding:22px 26px 20px;background:#0f0e0bf2;border:1px solid #6a5a3a;border-top:3px solid #e0a64a;border-radius:10px;color:#eadfca;font-family:inherit;box-shadow:0 18px 60px #000c;animation:coPop .45s .1s cubic-bezier(.2,1.4,.4,1) both}
.chimera-outcome.lost .co-card,.chimera-outcome.wiped .co-card,.chimera-outcome.retreat .co-card{border-top-color:#d0503a}
.chimera-outcome .co-eyebrow{font-size:11px;letter-spacing:.28em;color:#a3977f}
.chimera-outcome h2{margin:4px 0 2px;font-size:30px;color:#ffd27a}.chimera-outcome.lost h2,.chimera-outcome.wiped h2{color:#ff8a70}
.chimera-outcome .co-sub{color:#a3977f;font-size:13px;margin-bottom:8px}
.chimera-outcome ul{margin:10px 0 16px;padding:0;list-style:none;display:grid;gap:4px}.chimera-outcome li{padding:3px 10px;border-left:2px solid #6a5a3a;background:linear-gradient(90deg,#0008,#0000)}
.chimera-outcome .modal-button{width:100%;background:#e0a64a!important;color:#1b140a!important;border-color:#e0a64a!important;font-weight:700}.chimera-outcome.lost .modal-button,.chimera-outcome.wiped .modal-button{background:#c8553e!important;border-color:#c8553e!important;color:#fff!important}
@keyframes coIn{from{opacity:0}to{opacity:1}}@keyframes coPop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}`;
document.head.appendChild(style);
