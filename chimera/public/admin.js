// Chimera 後台（Alan 2026-10-09：上帝視角）：讀 /api/admin/world（只有管理員的 Google 帳號），每 30 秒更新。只看不改。
import {authHeaders} from './link.js';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const num = (v, d = 0) => v == null || v === '' ? '' : Number(v).toLocaleString('zh-TW', {maximumFractionDigits: d});
const pct = v => Math.round((v || 0) * 100) + '%';
const day = h => `第 ${Math.floor(h / 24) + 1} 天 ${String(Math.floor(h % 24)).padStart(2, '0')} 時`;
const table = (cols, rows) => `<div class="wrap"><table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => { const v = c[1](r); return `<td class="${c[2] || ''}">${v ?? ''}</td>`; }).join('')}</tr>`).join('') || `<tr><td class="muted" colspan="${cols.length}">（沒有）</td></tr>`}</table></div>`;
let filter = '';
// 大戰役每一輪的雙方兵力（攻方橘、守方藍）
function spark(log) {
  if (!log?.length) return '';
  const W = 300, H = 70, n = log.length, x = i => 4 + (W - 8) * i / Math.max(1, n - 1), y = v => 6 + (H - 16) * (1 - v);
  const path = k => log.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><line x1="4" x2="${W - 4}" y1="${y(.25)}" y2="${y(.25)}" stroke="#3a332a" stroke-dasharray="3 3"/><text x="${W - 4}" y="${y(.25) - 2}" text-anchor="end">25%</text>
    <path d="${path('fa')}" fill="none" stroke="#eb6834" stroke-width="2"/><path d="${path('fd')}" fill="none" stroke="#6fa8dc" stroke-width="2"/></svg>`;
}
function render(d) {
  const N = d.now;
  $('now').textContent = `第 ${N.year} 年・已結算 ${N.season} 季・遊戲第 ${N.hour} 小時（${day(N.hour)}）・一季 ${N.seasonHours} 小時，下次結算在 ${N.seasonHours - N.hour % N.seasonHours} 小時後・世界 ${d.server?.world || ''}・更新於 ${new Date().toLocaleTimeString('zh-TW')}`;
  const fn = new Map(d.factions.map(f => [f.id, f]));
  let h = '';
  // 大戰役
  h += `<section id="camp"><h2>大戰役 <small>每 6 小時一輪；橘＝攻方、藍＝守方剩下的兵力</small></h2><div class="cards">` + (d.campaigns.map(c => `<div class="card">
    <div><b>${esc(c.name)}大戰役</b> <span class="tag ${c.done ? '' : 'war'}">${c.done ? `結束：${esc(fn.get(c.win)?.n || '')}勝` : `進行中・第 ${Math.floor(c.days) + 1} 天`}</span></div>
    <div class="muted">${esc(c.an)} 攻 ${esc(c.dn)}・第 ${c.round} 輪</div>
    <div>攻方 ${pct(c.fa)}（${num(c.FA)}）・行情 ×${c.mulA}・加成 +${pct(c.bonusA)}・被傭兵打倒 ${num(c.pmcKillA)}</div><div class="bar"><i style="width:${pct(c.fa)};background:#eb6834"></i></div>
    <div>守方 ${pct(c.fd)}（${num(c.FD)}）・行情 ×${c.mulD}・加成 +${pct(c.bonusD)}・被傭兵打倒 ${num(c.pmcKillD)}</div><div class="bar"><i style="width:${pct(c.fd)};background:#6fa8dc"></i></div>
    ${spark(c.log)}</div>`).join('') || '<div class="muted">目前沒有大戰役。</div>') + '</div></section>';
  // 勢力
  h += `<section id="fac"><h2>勢力 <small>${d.factions.length} 個</small></h2>` + table([
    ['勢力', f => `<span class="sw" style="background:${f.c}"></span>${esc(f.n)} <span class="tag">${f.kind}</span>`], ['首府', f => esc(f.cap)], ['人口', f => num(f.pop), 'n'], ['格', f => f.tiles, 'n'], ['市鎮', f => f.towns, 'n'],
    ['複製兵', f => num(f.clones), 'n'], ['培養槽', f => f.vats, 'n'], ['傭兵', f => num(f.merc), 'n'], ['車庫', f => Object.entries(f.veh).filter(([, n]) => n >= .5).map(([k, n]) => `${k} ${num(n)}`).join(' ')],
    ['熱量', f => num(f.stock.food), 'n'], ['淨水', f => num(f.stock.water), 'n'], ['彈藥', f => num(f.stock.ammo, 1), 'n'], ['燃料', f => num(f.stock.fuel, 1), 'n'], ['彈藥價', f => f.price?.ammo, 'n'], ['熱量價', f => f.price?.food, 'n'],
    ['戰功', f => f.aid || '', 'n'], ['疲憊', f => f.exhaust || '', 'n'], ['好戰', f => f.aggr, 'n']], d.factions) + '</section>';
  // 戰爭
  h += `<section id="war"><h2>戰爭 <small>${d.wars.length} 場</small></h2>` + table([['攻方', w => esc(w.att)], ['守方', w => esc(w.def)], ['目標', w => esc(w.goal)], ['圍城', w => esc(w.siege)], ['開戰', w => `第 ${w.since} 年`, 'n'], ['預定結束', w => `第 ${w.end} 年`, 'n'], ['戰績', w => w.score, 'n'], ['大戰役', w => w.camp ? '進行中' : '']], d.wars) + '</section>';
  // 公司
  if (d.companies) h += `<section id="co"><h2>公司 <small>${d.companies.length} 家</small></h2>` + table([
    ['公司', c => `${esc(c.name)} ${c.npc ? '<span class="tag npc">NPC</span>' : `<span class="tag">${esc(c.account)}</span>`}`], ['總部', c => esc(c.base)], ['現金', c => '$' + num(c.cash) + 'k', 'n'], ['帳面損失', c => num(c.lossBook), 'n'],
    ['名冊', c => Object.entries(c.status).map(([k, n]) => `${({home: '待命', away: '出勤', returning: '返回', kia: '陣亡'})[k] || k} ${n}`).join('・')], ['最高級', c => c.maxLv, 'n'], ['案件', c => c.cases, 'n'], ['培養中', c => c.building, 'n'], ['倉庫', c => c.store, 'n'],
    ['收支', c => Object.entries(c.ledger).filter(([, v]) => v).map(([k, v]) => `${k} ${num(v)}`).join('・'), 'wrapc'], ['最近', c => esc(c.log.at(-1)?.text || ''), 'wrapc']], d.companies) + '</section>';
  if (d.cases) h += `<section id="cases"><h2>案件 <small>進行中與最近三天結案的</small></h2>` + table([
    ['案件', c => `${esc(c.title)} <span class="tag">${c.kind}</span>`, 'wrapc'], ['地點', c => esc(c.tile)], ['期間', c => `${day(c.start)} → ${c.end > 1e6 ? '戰役結束' : day(c.end)}`], ['狀態', c => c.settled ? '已結案' : c.open ? '派單中' : '收尾'],
    ['小隊', c => c.squads.map(s => `${esc(s.player)}（${s.alive}${s.busy ? '・打' : ''}）`).join('、'), 'wrapc'], ['積分', c => Object.entries(c.score).map(([k, v]) => `${esc(k)} ${v}`).join('、'), 'wrapc'], ['服務單', c => `${c.tickets}（未完 ${c.open_tickets}）`, 'n']], d.cases) + '</section>';
  if (d.tickets) h += `<section id="tk"><h2>還沒打完的服務單 <small>${d.tickets.length} 張</small></h2>` + table([['服務單', t => esc(t.title), 'wrapc'], ['誰', t => esc(t.player)], ['敵人', t => t.enemies, 'n'], ['戰力', t => t.power, 'n'], ['波', t => t.wave || '', 'n'], ['期限', t => t.deadline >= 0 ? day(t.deadline) : '']], d.tickets) + '</section>';
  if (d.board) h += `<section id="board"><h2>委託板 <small>${d.board.length} 個</small></h2>` + table([['委託', e => `${esc(e.title)} <span class="tag">${e.kind}</span>${e.gone ? ' <span class="tag">已撤</span>' : ''}`, 'wrapc'], ['程度', e => '●'.repeat(e.lv)], ['地點', e => esc(e.tile)], ['公開', e => day(e.start)], ['截止', e => day(e.end)], ['案件', e => e.cases, 'n'], ['說明', e => esc(e.detail), 'wrapc']], d.board) + '</section>';
  h += `<section id="gang"><h2>幫派 <small>${d.gangs.length} 個</small></h2>` + table([['幫派', g => esc(g.name)], ['類型', g => `<span class="tag">${g.kind}</span>`], ['據點', g => esc(g.lair)], ['勢力', g => num(g.str), 'n'], ['匪患', g => g.bandit, 'n'], ['頭目', g => esc(g.chief)], ['頭目被打倒', g => g.bossDefeats || '', 'n']], d.gangs) + '</section>';
  h += `<section id="wp"><h2>遺產級 <small>${d.weapons.length} 件</small></h2>` + table([['名稱', x => esc(x.name)], ['類別', x => esc(x.kind)], ['加成', x => x.bonus, 'n'], ['在哪裡', x => esc(x.who), 'wrapc']], d.weapons) + '</section>';
  const ev = d.events.slice().reverse().filter(e => !filter || (e.text + e.tile + e.type).includes(filter));
  h += `<section id="ev"><h2>世界紀錄 <small>最近 300 則</small> <input type="search" id="q" placeholder="搜尋（地名、勢力、大戰役…）" value="${esc(filter)}"></h2>` + table([['年', e => e.y, 'n'], ['類', e => `<span class="tag">${esc(e.type)}</span>`], ['地點', e => esc(e.tile)], ['事情', e => esc(e.text), 'wrapc']], ev) + '</section>';
  $('out').innerHTML = h;
  const q = $('q'); q.oninput = () => { filter = q.value.trim(); const p = q.selectionStart; render(last); const r = $('q'); r.focus(); r.setSelectionRange(p, p); };
}
let last = null;
async function load() {
  try {
    const r = await fetch('/api/admin/world', {headers: authHeaders()}), d = await r.json();
    if (!r.ok) throw new Error(r.status === 403 ? '沒有權限：請先回遊戲，用管理員的 Google 帳號登入，再開這一頁。' : d.error || `讀取失敗（${r.status}）`);
    $('err').hidden = true; last = d; render(d);
  } catch (e) { $('err').hidden = false; $('err').textContent = e.message; }
}
// 快轉（Alan 2026-10-11：測試用）：世界照常一小時一小時推過去；一次算不完的，下一次讀取時補完
document.getElementById('ff').onclick = async e => {
  const b = e.target.closest('[data-ff]'); if (!b) return; const h = +b.dataset.ff;
  if (!confirm(`整個星球往後快轉 ${h} 小時？所有公司、NPC、案件都會跟著推進，不能倒回來。`)) return;
  const m = $('ffmsg'); m.textContent = '推進中…'; for (const x of document.querySelectorAll('[data-ff]')) x.disabled = true;
  try { const r = await fetch('/api/admin/world?forward=' + h, {method: 'POST', headers: authHeaders()}), d = await r.json(); if (!r.ok) throw new Error(d.error || r.status);
    m.textContent = d.behind > 0 ? `快轉 ${d.hours} 小時：推到第 ${d.hour} 小時，還差 ${d.behind} 小時，下一次讀取時會補完（可能要等一下）` : `快轉 ${d.hours} 小時完成：現在第 ${d.hour} 小時（累計快轉 ${d.forwarded} 小時）`;
  } catch (err) { m.textContent = '快轉失敗：' + err.message; }
  for (const x of document.querySelectorAll('[data-ff]')) x.disabled = false; load();
};
load(); setInterval(() => { if (!document.activeElement || document.activeElement.id !== 'q') load(); }, 30000);
