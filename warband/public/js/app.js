// 奇幻戰幫切片：畫面與操作
import {CLASSES, TRAITS, ORDERS, WEAPONS, TERRAIN} from './data.js';
import * as Wd from './world.js';
import * as B from './battle.js';

const $ = id => document.getElementById(id);
const SAVE = 'warband-slice-v1';
let G = {world: null, battle: null};

/* ───────────── 小工具 ───────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(text, ms = 2200) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
async function banner(text, ms = 700) { const b = $('banner'); b.textContent = text; b.classList.add('show'); await sleep(ms); b.classList.remove('show'); await sleep(150); }
function save() { try { localStorage.setItem(SAVE, JSON.stringify(G)); } catch {} }
function load() { try { const s = localStorage.getItem(SAVE); return s ? JSON.parse(s) : null; } catch { return null; } }
function wipe() { try { localStorage.removeItem(SAVE); } catch {} }
function show(id) { for (const s of ['title', 'world', 'battle']) $(s).hidden = s !== id; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const clsName = m => CLASSES[m.cls]?.name || m.cls;

/* ───────────── sprite ───────────── */
const SHEETS = {}; let ATLAS = {};
async function loadArt() {
  ATLAS = await (await fetch('art/atlas.json')).json();
  await Promise.all(['people', 'foes', 'props'].map(n => new Promise(ok => { const im = new Image(); im.onload = ok; im.onerror = ok; im.src = `art/${n}.png`; SHEETS[n] = im; })));
}
function sprite(ctx, ref, x, y, size, {flip = false, alpha = 1, gray = false} = {}) {
  if (!ref) return; const [sheet, name] = ref, p = ATLAS[sheet]?.[name], im = SHEETS[sheet]; if (!p || !im) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
  if (gray) ctx.filter = 'grayscale(1) brightness(.7)';
  if (flip) { ctx.translate(x + size, y); ctx.scale(-1, 1); ctx.drawImage(im, p[0], p[1], 64, 64, 0, 0, size, size); }
  else ctx.drawImage(im, p[0], p[1], 64, 64, x, y, size, size);
  ctx.restore();
}
function avatar(ref, size = 56, flip = false) { const c = document.createElement('canvas'); c.width = c.height = 64; sprite(c.getContext('2d'), ref, 0, 0, 64, {flip}); c.style.width = c.style.height = size + 'px'; return c; }
function fit(canvas) { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return {g, w: r.width, h: r.height}; }

/* ───────────── 抽屜 ───────────── */
let sheetOnClose = null;
function openSheet(html, onClose) { $('sheetContent').innerHTML = ''; if (typeof html === 'string') $('sheetContent').innerHTML = html; else $('sheetContent').append(html); $('sheet').hidden = false; sheetOnClose = onClose || null; $('sheetClose').hidden = !!(onClose && onClose.locked); }
function closeSheet() { $('sheet').hidden = true; const f = sheetOnClose; sheetOnClose = null; if (f) f(); }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target === $('sheet') && !(sheetOnClose && sheetOnClose.locked)) closeSheet(); });
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') e.onclick = v; else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };

/* ───────────── 人物卡 ───────────── */
function traitTags(m) { return (m.traits || []).map(t => el('span', {class: 'tag trait', onclick: () => toast(`${TRAITS[t].name}：${TRAITS[t].desc}`, 3500)}, TRAITS[t].name)); }
function memberCard(m, extra) {
  const hpPct = Math.round(m.hp / m.max * 100);
  return el('div', {class: 'card'}, avatar(m.sprite),
    el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, m.name), el('span', {class: 'muted'}, `${clsName(m)} Lv${m.lvl}${m.hero ? '・你' : ''}`)),
      el('div', {class: 'meter'}, el('i', {style: `width:${hpPct}%;background:${hpPct < 40 ? 'var(--enemy)' : hpPct < 70 ? 'var(--warn)' : 'var(--ok)'}`})),
      el('div', {class: 'stats'}, ...[['生命', `${Math.round(m.hp)}/${m.max}`], ['力量', m.str], ['技巧', m.skl], ['速度', m.spd], ['防禦', m.def]].map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
      el('div', {class: 'muted', style: 'font-size:12px'}, `${WEAPONS[m.weapon].name}・經驗 ${m.exp}/100${m.wage ? `・週薪 ${m.wage}` : ''}${m.deeds ? `・${m.deeds.battles} 戰 ${m.deeds.kills} 殺` : ''}`),
      m.hero ? null : el('div', {style: 'display:flex;gap:6px;align-items:center;font-size:12px'}, el('span', {class: 'muted'}, '忠誠'), el('div', {class: 'meter loy', style: 'flex:1'}, el('i', {style: `width:${Math.max(0, m.loyalty)}%`})), el('span', {}, Math.round(m.loyalty))),
      el('div', {}, ...traitTags(m)),
      extra || null));
}

/* ───────────── 標題 ───────────── */
function titleScreen() {
  show('title');
  const s = load(); $('continueRun').hidden = !(s && s.world && !s.world.over);
}
$('newRun').onclick = () => {
  const s = load(); if (s && s.world && !s.world.over && !confirm('會蓋掉目前的旅程，確定重新開始？')) return;
  const seed = (Math.random() * 2 ** 31) | 0;
  G = {world: Wd.newWorld(seed, $('heroName').value.trim() || '無名的騎士'), battle: null};
  save(); worldScreen();
};
$('continueRun').onclick = () => { G = load(); if (G.battle) battleScreen(); else worldScreen(); };

/* ═════════════ 大地圖 ═════════════ */
let wsel = null, mapGeo = null, traveling = false;
const HEXCOL = {plain: '#5d6b3b', forest: '#34502c', hills: '#7b6b45', mountain: '#6d6862', lake: '#2e5672'};
function worldScreen() { show('world'); wsel = null; renderWorld(); afterWorldAction(); }
function hexCenter(q, r) { const {s, ox, oy} = mapGeo; return [ox + Math.sqrt(3) * s * (q + 0.5 * (r & 1)), oy + 1.5 * s * r]; }
function hexPath(g, cx, cy, s) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); g.lineTo(cx + s * Math.cos(a), cy + s * Math.sin(a)); } g.closePath(); }
function renderWorld() {
  const w = G.world; if (!w) return;
  $('wTime').textContent = Wd.timeText(w);
  $('wGold').textContent = w.gold;
  const fd = Wd.daysOfFood(w); $('wFood').textContent = `${w.food.toFixed(0)}（${fd.toFixed(1)} 天）`; $('wFood').style.color = fd < 2 ? 'var(--enemy)' : '';
  const due = w.party.filter(m => !m.hero).reduce((s, m) => s + m.wage, 0); $('wWage').textContent = `發餉：第 ${w.nextWage} 天（${due}）`;
  const {g, w: cw, h: ch} = fit($('map'));
  const s = Math.min(cw / (Math.sqrt(3) * (Wd.MW + 0.5)), ch / (1.5 * (Wd.MH - 1) + 2)) * 0.98;
  mapGeo = {s, ox: (cw - Math.sqrt(3) * s * (Wd.MW + 0.5)) / 2 + Math.sqrt(3) * s / 2, oy: (ch - (1.5 * s * (Wd.MH - 1) + 2 * s)) / 2 + s};
  g.fillStyle = '#17130f'; g.fillRect(0, 0, cw, ch);
  for (let r = 0; r < Wd.MH; r++) for (let q = 0; q < Wd.MW; q++) {
    const [cx, cy] = hexCenter(q, r), t = w.tiles[r * Wd.MW + q];
    hexPath(g, cx, cy, s * 0.97); g.fillStyle = HEXCOL[t]; g.fill();
    if (t === 'forest') sprite(g, ['props', 'tree'], cx - s * 0.55, cy - s * 0.6, s * 1.1, {alpha: 0.85});
    if (t === 'hills') { g.strokeStyle = '#a8946488'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx - s * 0.25, cy + s * 0.2, s * 0.3, Math.PI, 0); g.arc(cx + s * 0.25, cy + s * 0.25, s * 0.25, Math.PI, 0); g.stroke(); }
    if (t === 'mountain') { g.fillStyle = '#9a948c'; g.beginPath(); g.moveTo(cx - s * 0.6, cy + s * 0.4); g.lineTo(cx - s * 0.05, cy - s * 0.55); g.lineTo(cx + s * 0.6, cy + s * 0.4); g.fill(); g.fillStyle = '#e8e4dc'; g.beginPath(); g.moveTo(cx - s * 0.2, cy - s * 0.3); g.lineTo(cx - s * 0.05, cy - s * 0.55); g.lineTo(cx + s * 0.12, cy - s * 0.3); g.fill(); }
  }
  // 路
  g.strokeStyle = '#c4a46a'; g.lineWidth = Math.max(2, s * 0.14); g.lineCap = 'round';
  for (let r = 0; r < Wd.MH; r++) for (let q = 0; q < Wd.MW; q++) if (w.road[r * Wd.MW + q]) for (const [nq, nr] of Wd.hexNeighbors(q, r)) if (w.road[nr * Wd.MW + nq] || Wd.siteAt(w, [nq, nr])?.kind === 'town') { const a = hexCenter(q, r), b = hexCenter(nq, nr); g.beginPath(); g.moveTo(...a); g.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); g.stroke(); }
  // 規劃中的路線
  if (wsel && wsel.path) { g.strokeStyle = '#f1d38a'; g.setLineDash([4, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(...hexCenter(...w.pos)); for (const p of wsel.path) g.lineTo(...hexCenter(...p)); g.stroke(); g.setLineDash([]); }
  // 據點
  const ICON = {town: ['props', 'tower'], village: ['props', 'cottage'], camp: ['props', 'banner'], den: ['foes', 'wolf']};
  for (const st of w.sites) {
    if ((st.kind === 'camp' || st.kind === 'den') && !st.alive) continue;
    const [cx, cy] = hexCenter(...st.pos), z = st.kind === 'town' ? s * 1.6 : s * 1.3;
    sprite(g, ICON[st.kind], cx - z / 2, cy - z * 0.62, z);
    g.font = `600 ${Math.max(10, s * 0.48)}px system-ui`; g.textAlign = 'center'; g.fillStyle = '#000a'; g.fillText(st.name, cx + 1, cy + s * 0.95 + 1); g.fillStyle = st.kind === 'camp' || st.kind === 'den' ? '#f3b2a6' : '#f4ead2'; g.fillText(st.name, cx, cy + s * 0.95);
  }
  // 遊蕩的隊伍
  for (const b of w.bands) { const [cx, cy] = hexCenter(...b.pos); g.fillStyle = '#d0533f55'; g.beginPath(); g.arc(cx, cy, s * 0.7, 0, 7); g.fill(); sprite(g, b.kind === 'wolves' ? ['foes', 'wolf'] : ['foes', 'bandit'], cx - s * 0.6, cy - s * 0.7, s * 1.2, {flip: true}); }
  // 玩家
  const [px, py] = hexCenter(...w.pos);
  g.strokeStyle = '#d9a441'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, s * 0.78, 0, 7); g.stroke();
  sprite(g, ['people', 'knight'], px - s * 0.65, py - s * 0.75, s * 1.3);
  if (wsel) { hexPath(g, ...hexCenter(...wsel.pos), s * 0.97); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
}
function pickHex(x, y) { let best = null, bd = Infinity; for (let r = 0; r < Wd.MH; r++) for (let q = 0; q < Wd.MW; q++) { const [cx, cy] = hexCenter(q, r), d = (cx - x) ** 2 + (cy - y) ** 2; if (d < bd) { bd = d; best = [q, r]; } } return bd < (mapGeo.s * 1.1) ** 2 ? best : null; }
$('map').addEventListener('click', e => {
  if (traveling) return; const r = $('map').getBoundingClientRect(), p = pickHex(e.clientX - r.left, e.clientY - r.top); if (!p) return;
  const w = G.world, here = p[0] === w.pos[0] && p[1] === w.pos[1];
  wsel = {pos: p, path: here ? null : Wd.findPath(w, w.pos, p)}; renderWorld(); hexInfo();
});
const strength = (foes) => { const r = Wd.partyPower(foes) / Math.max(1, Wd.partyPower(G.world.party)); return r < 0.5 ? ['弱', 'good'] : r < 0.85 ? ['稍弱', 'good'] : r < 1.15 ? ['相當', 'warn'] : r < 1.6 ? ['強', 'bad'] : ['很強', 'bad']; };
function foeSummary(foes) { const c = {}; for (const f of foes) c[clsName(f)] = (c[clsName(f)] || 0) + 1; return Object.entries(c).map(([k, n]) => `${k}×${n}`).join('、'); }
function hexInfo() {
  const w = G.world, box = $('hexInfo'); box.innerHTML = '';
  const p = wsel ? wsel.pos : w.pos, here = p[0] === w.pos[0] && p[1] === w.pos[1];
  const site = Wd.siteAt(w, p), band = Wd.bandAt(w, p), t = Wd.HEX[w.tiles[p[1] * Wd.MW + p[0]]];
  const title = el('div', {class: 'row'}, el('b', {}, site ? site.name : t.name), here ? el('span', {class: 'tag good'}, '你在這裡') : null, w.road[p[1] * Wd.MW + p[0]] ? el('span', {class: 'tag'}, '道路') : null);
  box.append(title);
  if (band) { const [lab, cls] = strength(band.foes); box.append(el('div', {}, `${band.name}：${foeSummary(band.foes)} `, el('span', {class: 'tag ' + cls}, '戰力' + lab))); }
  if (site?.kind === 'camp') { box.append(el('div', {class: 'muted'}, '山賊的據點。拔掉它能拿到賞金和寨裡的財物，但頭目和手下都在。')); }
  if (site?.kind === 'den') box.append(el('div', {class: 'muted'}, '狼群的巢穴，偶爾還有熊。'));
  if (site?.kind === 'village') box.append(el('div', {class: 'muted'}, `糧食 ${site.food} 份，每份 ${site.foodPrice} 金幣${site.raided > w.day ? '（剛被洗劫）' : ''}`));
  if (site?.kind === 'town') box.append(el('div', {class: 'muted'}, '市集、酒館、告示板、旅店都在這裡。'));
  const row = el('div', {class: 'rowbtn'});
  if (!here && wsel?.path) {
    const hrs = wsel.path.reduce((s, q) => s + Wd.hexHours(w, ...q), 0);
    box.append(el('div', {}, `路程約 ${hrs} 小時，吃掉 ${(w.party.length * hrs / 24).toFixed(1)} 份糧食`));
    row.append(el('button', {class: 'primary', onclick: () => travel(wsel.path)}, '前往'));
  } else if (!here) box.append(el('div', {class: 'muted'}, '走不到那裡。'));
  if (here && site) {
    if (site.kind === 'town') row.append(el('button', {class: 'primary', onclick: () => townSheet()}, '進城'));
    if (site.kind === 'village') row.append(el('button', {class: 'primary', onclick: () => villageSheet(site)}, '進村'));
    if (site.kind === 'camp' || site.kind === 'den') row.append(el('button', {class: 'danger', onclick: () => doWorld({type: 'assault', site: site.id})}, '進攻'));
  }
  box.append(row);
}
async function travel(path) {
  traveling = true; wsel = null;
  for (const p of path) {
    const out = doWorld({type: 'travel', to: p}, true); renderWorld(); await sleep(140);
    if (!out || out.encounter || G.world.pendingBattle || G.world.over || Wd.bandAt(G.world, G.world.pos)) break;
  }
  traveling = false; afterWorldAction();
}
function doWorld(a, quiet) {
  let out;
  try { out = Wd.worldAct(G.world, a); } catch (e) { toast(e.message); return null; }
  save(); for (const l of out.lines) toast(l, 2600);
  if (!quiet) afterWorldAction();
  return out;
}
function afterWorldAction() {
  const w = G.world;
  renderWorld(); hexInfo();
  if (w.over) return gameOver();
  if (w.pendingBattle) return startBattle(w.pendingBattle);
  const b = Wd.bandAt(w, w.pos); if (b) return encounterSheet(b);
}
function encounterSheet(b) {
  const [lab, cls] = strength(b.foes);
  const box = el('div', {}, el('h2', {}, b.kind === 'wolves' ? '狼群！' : `${b.name}擋住了去路`),
    el('p', {}, `${foeSummary(b.foes)}　`, el('span', {class: 'tag ' + cls}, '戰力' + lab)),
    el('p', {class: 'muted'}, b.kind === 'wolves' ? '牠們已經聞到你們的味道了。' : '「把錢留下，人就可以走。」'));
  const row = el('div', {class: 'rowbtn'},
    el('button', {class: 'primary', onclick: () => { closeSheet(); doWorld({type: 'engage', band: b.id}); }}, '迎戰'),
    el('button', {onclick: () => { closeSheet(); doWorld({type: 'evade', band: b.id}); }}, `試著避開`));
  if (b.kind === 'bandits') row.append(el('button', {onclick: () => { closeSheet(); doWorld({type: 'pay', band: b.id}); }}, `付過路費（約 ${Math.max(15, Math.round(G.world.gold * 0.3))}）`));
  box.append(row);
  const lock = () => {}; lock.locked = true; openSheet(box, lock);
}
function townSheet(tab = 'market') {
  const w = G.world, t = Wd.town(w), box = el('div', {});
  box.append(el('h2', {}, t.name));
  const tabs = el('div', {class: 'tabs'}); const tabsDef = [['market', '市集'], ['tavern', '酒館'], ['board', '告示板'], ['inn', '旅店']];
  for (const [k, n] of tabsDef) tabs.append(el('button', {class: k === tab ? 'on' : '', onclick: () => townSheet(k)}, n));
  box.append(tabs);
  const n = w.party.length;
  if (tab === 'market') {
    box.append(el('p', {}, `口糧每份 ${t.foodPrice} 金幣。隊伍 ${n} 人，一天吃 ${n} 份。現有 ${w.food.toFixed(0)} 份。`));
    box.append(el('div', {class: 'rowbtn'}, ...[1, 3, 7].map(d => el('button', {onclick: () => { doWorld({type: 'buyFood', n: n * d}); townSheet('market'); }}, `${d} 天份（${n * d * t.foodPrice}）`))));
  }
  if (tab === 'tavern') {
    box.append(el('p', {class: 'muted'}, `招募要先付兩週薪水當安家費。隊伍最多 6 人（現在 ${n} 人）。新面孔第 ${t.nextRecruit} 天會來。`));
    if (!t.recruits.length) box.append(el('p', {}, '今天酒館裡沒有想找差事的人。'));
    for (const r of t.recruits) box.append(memberCard(r, el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: () => { doWorld({type: 'hire', id: r.id}); townSheet('tavern'); }}, `雇用（${r.wage * 2}）`))));
  }
  if (tab === 'board') {
    const claim = w.contracts.filter(c => c.done && c.taken);
    if (claim.length) box.append(el('button', {class: 'primary', onclick: () => { doWorld({type: 'claim'}); townSheet('board'); }}, `領賞（${claim.reduce((s, c) => s + c.reward, 0)}）`));
    box.append(contractList());
  }
  if (tab === 'inn') {
    box.append(el('p', {}, `每人每晚 2 金幣，一天能養好一半的傷，大家的心情也會好一點。`));
    box.append(el('div', {class: 'rowbtn'}, ...[1, 3].map(d => el('button', {onclick: () => { doWorld({type: 'rest', days: d}); townSheet('inn'); }}, `住 ${d} 晚（${n * 2 * d}）`))));
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'rest', days: 1, inn: false}); townSheet('inn'); }}, '在城外紮營一天（免費）')));
  }
  openSheet(box);
}
function contractList() {
  const w = G.world, box = el('div', {});
  if (!w.contracts.length) box.append(el('p', {class: 'muted'}, '目前沒有委託。'));
  for (const c of w.contracts) {
    const site = c.site && w.sites.find(s => s.id === c.site);
    box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, c.title), el('span', {class: 'tag ' + (c.done ? 'good' : c.taken ? 'warn' : '')}, c.done ? '完成，待領賞' : c.taken ? '進行中' : `賞金 ${c.reward}`)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `${site ? '地點：' + site.name + '・' : ''}期限第 ${c.until} 天・賞金 ${c.reward}`),
      !c.taken && Wd.siteAt(w, w.pos)?.kind === 'town' ? el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'takeContract', id: c.id}); closeSheet(); townSheet('board'); }}, '接下')) : null)));
  }
  return box;
}
function villageSheet(v) {
  const w = G.world, n = w.party.length;
  const box = el('div', {}, el('h2', {}, v.name), el('p', {}, `村裡還有 ${v.food} 份糧食，每份 ${v.foodPrice} 金幣。${v.raided > w.day ? '前幾天才被山賊洗劫過，村民都很緊張。' : ''}`),
    el('div', {class: 'rowbtn'}, ...[1, 3, 7].map(d => el('button', {onclick: () => { doWorld({type: 'buyFood', n: Math.min(n * d, v.food)}); villageSheet(v); }}, `${d} 天份`))),
    el('div', {class: 'rowbtn'}, el('button', {onclick: () => { doWorld({type: 'rest', days: 1}); closeSheet(); }}, '在村邊紮營一天')));
  openSheet(box);
}
$('btnParty').onclick = () => { const w = G.world, box = el('div', {}, el('h2', {}, `隊伍（${w.party.length}/6）`)); for (const m of w.party) box.append(memberCard(m, m.hero ? null : el('div', {class: 'rowbtn'}, el('button', {class: 'danger', onclick: () => { if (confirm(`讓${m.name}離開隊伍？`)) { doWorld({type: 'dismiss', id: m.id}); closeSheet(); } }}, '遣散')))); if (w.fallen.length) { box.append(el('h3', {style: 'margin-top:12px'}, '倒下的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・第 ${f.day} 天・${f.how}`)); } openSheet(box); };
$('btnLog').onclick = () => { const box = el('div', {class: 'log'}, el('h2', {}, '日誌')); for (const l of G.world.log) box.append(el('p', {}, el('span', {class: 'd'}, `第 ${l.day} 天`), l.text)); openSheet(box); };
$('btnJobs').onclick = () => openSheet(el('div', {}, el('h2', {}, '委託'), el('p', {class: 'muted'}, '在鎮上的告示板接委託、領賞。'), contractList()));
$('btnRest').onclick = () => { if (confirm('原地紮營休息一天？（會吃掉一天的糧食）')) doWorld({type: 'rest', days: 1, inn: false}); };
addEventListener('resize', () => { if (!$('world').hidden) renderWorld(); });

/* ═════════════ 戰鬥 ═════════════ */
let bsel = null, disp = null, popups = [], animating = false, bubbles = [], picking = null, cell = 32, fo = {x: 0, y: 0};
function startBattle(setup) {
  const w = G.world;
  const st = B.createBattle({seed: setup.seed, biome: setup.biome, party: w.party, foes: setup.foes, order: w.lastOrder || {stance: 'follow', focus: null}});
  G.battle = {setup, st}; save(); battleScreen(true);
}
function battleScreen(fresh) {
  show('battle'); bsel = null; picking = null; syncDisp(); renderOrders(); bInfo();
  $('bTitle').textContent = G.battle.setup.title;
  if (fresh) banner('開戰');
  if (!battleScreen.loop) { battleScreen.loop = true; const loop = () => { if (!$('battle').hidden) drawField(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
}
function syncDisp() { const st = ST(); disp = {}; for (const u of st.units) disp[u.id] = {x: u.x, y: u.y, hp: u.hp, alpha: u.alive && !u.fled ? 1 : 0, ox: 0, oy: 0}; }
let lastSt = null;
const ST = () => (G.battle ? G.battle.st : lastSt);
const uById = id => ST().units.find(u => u.id === id);
function renderOrders() {
  const box = $('orders'); box.innerHTML = ''; const o = ST().order;
  for (const [k, v] of Object.entries(ORDERS)) box.append(el('button', {class: o.stance === k ? 'on' : '', onclick: () => setOrder(k)}, k === 'focus' && o.focus && o.stance === 'focus' ? `集火：${uById(o.focus)?.name || ''}` : v.name));
}
function setOrder(k) {
  if (animating) return;
  if (k === 'focus') { picking = 'focus'; toast('點一個敵人當集火目標'); return; }
  B.act(ST(), {type: 'order', stance: k}); G.world.lastOrder = ST().order; save(); renderOrders(); bInfo(); toast(`${ORDERS[k].name}：${ORDERS[k].desc}`);
}
// 版面
function layout() { const c = $('field').getBoundingClientRect(); cell = Math.floor(Math.min(c.width / B.W, c.height / B.H)); fo = {x: Math.floor((c.width - cell * B.W) / 2), y: Math.floor((c.height - cell * B.H) / 2)}; }
const TILECOL = {grass: '#4f6034', road: '#87744f', bush: '#4f6034', forest: '#3d5530', hill: '#7a6a45', rock: '#4f6034', water: '#2e5672', wall: '#4f6034', camp: '#6b5a3e'};
function drawField() {
  const st = ST(); if (!st) return; const {g, w: cw, h: ch} = fit($('field')); layout();
  g.fillStyle = '#17130f'; g.fillRect(0, 0, cw, ch);
  const X = x => fo.x + x * cell, Y = y => fo.y + y * cell;
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    const t = st.tiles[y * B.W + x]; g.fillStyle = TILECOL[t]; g.fillRect(X(x), Y(y), cell, cell);
    if ((x + y) % 2) { g.fillStyle = '#00000014'; g.fillRect(X(x), Y(y), cell, cell); }
    if (t === 'forest') sprite(g, ['props', 'tree'], X(x) + cell * 0.05, Y(y), cell * 0.9);
    if (t === 'bush') sprite(g, ['props', 'bush'], X(x) + cell * 0.15, Y(y) + cell * 0.2, cell * 0.7);
    if (t === 'hill') { g.strokeStyle = '#a8946488'; g.lineWidth = 2; g.beginPath(); g.arc(X(x) + cell / 2, Y(y) + cell * 0.75, cell * 0.35, Math.PI, 0); g.stroke(); }
    if (t === 'rock') { g.fillStyle = '#8b8780'; g.beginPath(); g.ellipse(X(x) + cell / 2, Y(y) + cell * 0.6, cell * 0.38, cell * 0.28, 0, 0, 7); g.fill(); g.fillStyle = '#a9a59c'; g.beginPath(); g.ellipse(X(x) + cell * 0.42, Y(y) + cell * 0.5, cell * 0.18, cell * 0.12, 0, 0, 7); g.fill(); }
    if (t === 'wall') { g.fillStyle = '#6b4f2e'; for (let i = 0; i < 4; i++) g.fillRect(X(x) + cell * (0.06 + i * 0.24), Y(y) + cell * 0.15, cell * 0.18, cell * 0.75); }
    if (t === 'water') { g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(X(x) + cell * 0.2, Y(y) + cell * 0.5); g.quadraticCurveTo(X(x) + cell * 0.5, Y(y) + cell * 0.35, X(x) + cell * 0.8, Y(y) + cell * 0.5); g.stroke(); }
  }
  // 危險範圍
  if ($('showDanger').checked && !animating) { const d = bsel?.danger || B.dangerTiles(st); if (bsel) bsel.danger = d; g.fillStyle = '#d0533f33'; for (const k of d) g.fillRect(X(k % B.W), Y((k / B.W) | 0), cell, cell); }
  // 主角可走範圍
  const h = B.hero(st);
  if (!animating && !st.result && h.alive) {
    const r = bsel?.reach || B.reach(st, h); if (bsel) bsel.reach = r; else bsel = {reach: r};
    g.fillStyle = '#5b9bd544'; for (const [x, y] of r.tiles) g.fillRect(X(x) + 1, Y(y) + 1, cell - 2, cell - 2);
    if (bsel.to) { g.strokeStyle = '#f1d38a'; g.lineWidth = 2; g.strokeRect(X(bsel.to[0]) + 2, Y(bsel.to[1]) + 2, cell - 4, cell - 4); }
    // 從預定位置打得到的敵人
    const from = bsel.to || [h.x, h.y];
    g.strokeStyle = '#ff6b55'; g.lineWidth = 2;
    for (const e of B.living(st, 'enemy')) { const d = Math.abs(e.x - from[0]) + Math.abs(e.y - from[1]), [lo, hi] = WEAPONS[h.weapon].range; if (d >= lo && d <= hi) g.strokeRect(X(e.x) + 3, Y(e.y) + 3, cell - 6, cell - 6); }
  }
  // 單位
  const units = st.units.slice().sort((a, b) => disp[a.id].y - disp[b.id].y);
  for (const u of units) {
    const d = disp[u.id]; if (d.alpha <= 0.01) continue;
    const ux = X(d.x) + d.ox * cell, uy = Y(d.y) + d.oy * cell;
    g.globalAlpha = d.alpha;
    g.fillStyle = u.side === 'ally' ? '#5b9bd5aa' : '#d0533faa'; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.36, cell * 0.12, 0, 0, 7); g.fill();
    if (u.hero) { g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.4, cell * 0.15, 0, 0, 7); g.stroke(); }
    if (bsel?.to && u.hero && !animating) sprite(g, u.sprite, X(bsel.to[0]) + cell * 0.04, Y(bsel.to[1]) - cell * 0.04, cell * 0.92, {alpha: 0.55});
    sprite(g, u.sprite, ux + cell * 0.04, uy - cell * 0.04, cell * 0.92, {flip: u.side === 'enemy', alpha: d.alpha});
    // 血條
    g.fillStyle = '#000a'; g.fillRect(ux + cell * 0.12, uy + cell * 0.92, cell * 0.76, 4);
    g.fillStyle = u.side === 'ally' ? '#7fbf6a' : '#e06a52'; g.fillRect(ux + cell * 0.12, uy + cell * 0.92, cell * 0.76 * Math.max(0, d.hp) / u.max, 4);
    if (u.leader) { g.fillStyle = '#d9a441'; g.font = `700 ${cell * 0.3}px system-ui`; g.textAlign = 'left'; g.fillText('★', ux + 2, uy + cell * 0.3); }
    if (ST().order.focus === u.id && ST().order.stance === 'focus') { g.strokeStyle = '#f1d38a'; g.setLineDash([3, 3]); g.strokeRect(ux + 1, uy + 1, cell - 2, cell - 2); g.setLineDash([]); }
    g.globalAlpha = 1;
  }
  // 同伴的打算
  if (!animating && !st.result && bsel?.plans) for (const p of bsel.plans) {
    const u = uById(p.id); if (!u) continue;
    const c = p.disobey || /膽小/.test(p.why) ? '#e0a03c' : '#8fd0ff';
    const a = [X(u.x) + cell / 2, Y(u.y) + cell / 2], b = p.to ? [X(p.to[0]) + cell / 2, Y(p.to[1]) + cell / 2] : a;
    if (p.to && (p.to[0] !== u.x || p.to[1] !== u.y)) arrow(g, a, b, c, 2);
    if (p.kind === 'attack' || p.kind === 'heal') { const t = uById(p.target); if (t) arrow(g, b, [X(t.x) + cell / 2, Y(t.y) + cell / 2], p.kind === 'heal' ? '#7fbf6a' : c, 3, true); }
    if (p.disobey) { g.fillStyle = '#e0a03c'; g.font = `700 ${cell * 0.4}px system-ui`; g.textAlign = 'center'; g.fillText('!', X(u.x) + cell * 0.85, Y(u.y) + cell * 0.35); }
  }
  // 敵人意圖
  if ($('showDanger').checked && !animating && !st.result) { const ep = bsel?.eplans || B.previewEnemies(st); if (bsel) bsel.eplans = ep; for (const p of ep) { if (p.kind !== 'attack') continue; const t = uById(p.target), u = uById(p.id); if (!t || !u) continue; arrow(g, [X(p.to[0]) + cell / 2, Y(p.to[1]) + cell / 2], [X(t.x) + cell / 2, Y(t.y) + cell / 2], '#ff6b55', 2, true); } }
  // 跳字與對話
  const now = performance.now();
  popups = popups.filter(p => now - p.t0 < 900);
  for (const p of popups) { const k = (now - p.t0) / 900; g.globalAlpha = 1 - k; g.font = `800 ${cell * 0.42}px system-ui`; g.textAlign = 'center'; g.fillStyle = '#000'; g.fillText(p.text, X(p.x) + cell / 2 + 1, Y(p.y) - k * cell * 0.6 + 1); g.fillStyle = p.color; g.fillText(p.text, X(p.x) + cell / 2, Y(p.y) - k * cell * 0.6); g.globalAlpha = 1; }
  bubbles = bubbles.filter(b => now - b.t0 < 1600);
  for (const b of bubbles) { const d = disp[b.id]; if (!d) continue; g.font = `600 ${Math.max(11, cell * 0.3)}px system-ui`; const tw = g.measureText(b.text).width + 12, bx = Math.min(cw - tw - 4, Math.max(4, X(d.x) + cell / 2 - tw / 2)), by = Y(d.y) - cell * 0.45; g.fillStyle = '#f4ead2'; g.fillRect(bx, by - 16, tw, 22); g.fillStyle = '#1b150d'; g.textAlign = 'left'; g.fillText(b.text, bx + 6, by); }
}
function arrow(g, a, b, color, w, head) {
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w; g.globalAlpha = 0.9;
  g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
  if (head) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 8; g.beginPath(); g.moveTo(...b); g.lineTo(b[0] - s * Math.cos(ang - 0.4), b[1] - s * Math.sin(ang - 0.4)); g.lineTo(b[0] - s * Math.cos(ang + 0.4), b[1] - s * Math.sin(ang + 0.4)); g.fill(); }
  g.globalAlpha = 1;
}
function refreshPlans() { if (!bsel) bsel = {}; const h = B.hero(ST()), to = bsel.to || [h.x, h.y]; bsel.plans = B.previewAllies(ST(), to[0], to[1]); bsel.eplans = null; bsel.danger = null; }
// 點戰場
$('field').addEventListener('click', e => {
  if (animating || ST().result) return;
  const r = $('field').getBoundingClientRect(), x = Math.floor((e.clientX - r.left - fo.x) / cell), y = Math.floor((e.clientY - r.top - fo.y) / cell);
  if (x < 0 || y < 0 || x >= B.W || y >= B.H) return;
  const st = ST(), h = B.hero(st), u = B.unitAt(st, x, y);
  if (!bsel) bsel = {};
  if (picking === 'focus') {
    if (u && u.side === 'enemy') { B.act(st, {type: 'order', stance: 'focus', focus: u.id}); G.world.lastOrder = st.order; picking = null; save(); renderOrders(); refreshPlans(); bInfo(); toast(`集火：${u.name}`); }
    else { picking = null; toast('取消集火'); }
    return;
  }
  const reachable = (bsel.reach || B.reach(st, h)).tiles.some(([a, b]) => a === x && b === y);
  if (u && u.side === 'enemy') {
    const from = bsel.to || [h.x, h.y], [lo, hi] = WEAPONS[h.weapon].range, inR = (fx, fy) => { const d = Math.abs(u.x - fx) + Math.abs(u.y - fy); return d >= lo && d <= hi; };
    if (!inR(...from)) {
      // 自動找一個打得到它的位置（命中最高、反擊最少）
      let best = null; for (const [tx, ty] of (bsel.reach || B.reach(st, h)).tiles) if (inR(tx, ty)) { const f = B.forecast(st, h, u, tx, ty), s = f.aHit * f.aDmg - f.dHit * f.dDmg * f.dCount; if (!best || s > best.s) best = {s, to: [tx, ty]}; }
      if (!best) { bsel.inspect = u.id; bsel.target = null; bInfo(); return; }
      bsel.to = best.to; refreshPlans();
    }
    bsel.target = u.id; bsel.inspect = null; bInfo(); return;
  }
  if (u && u !== h && !(reachable && u === h)) { bsel.inspect = u.id; bsel.target = null; bInfo(); return; }
  if (reachable) { bsel.to = (x === h.x && y === h.y) ? null : [x, y]; bsel.target = null; bsel.inspect = null; refreshPlans(); bInfo(); return; }
  bsel.to = null; bsel.target = null; bsel.inspect = null; refreshPlans(); bInfo();
});
function unitInfo(u) {
  const st = ST(), t = B.terrainAt(st, u.x, u.y), s = B.stats(st, u);
  const wrap = el('div', {}, el('div', {class: 'plan'}, el('b', {}, u.name), el('span', {class: 'muted'}, `${clsName(u)} Lv${u.lvl}・${WEAPONS[u.weapon].name}・${t.name}`)),
    el('div', {class: 'stats', style: 'margin:4px 0'}, ...[['生命', `${u.hp}/${u.max}`], ['攻擊', s.atk], ['命中', s.hit], ['迴避', s.avo], ['防禦', s.def]].map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
    el('div', {}, ...traitTags(u)));
  if (u.side === 'ally' && !u.hero) { const p = (bsel?.plans || []).find(p => p.id === u.id); wrap.append(el('div', {class: 'muted', style: 'font-size:13px;margin-top:4px'}, `忠誠 ${Math.round(u.loyalty)}・這回合${st.obey[u.id] === false ? '不聽令' : '聽令'}${p ? `・打算：${planText(p)}` : ''}`)); }
  return wrap;
}
function planText(p) { const t = p.target && uById(p.target); return p.kind === 'attack' ? `${p.why}→${t?.name}（命中 ${p.f?.aHit ?? '?'}%）` : p.kind === 'heal' ? `包紮 ${t?.name}` : p.why; }
function bInfo() {
  const st = ST(), box = $('bInfo'), acts = $('bActions'); box.innerHTML = ''; acts.innerHTML = '';
  $('bTurn').textContent = `第 ${st.turn} 回合・敵人 ${B.living(st, 'enemy').length}`;
  if (st.result) return;
  if (!bsel || !bsel.plans) refreshPlans();
  const h = B.hero(st);
  if (bsel.target) {
    const e = uById(bsel.target), from = bsel.to || [h.x, h.y], f = B.forecast(st, h, e, from[0], from[1]);
    const triTxt = f.tri > 0 ? '武器有利' : f.tri < 0 ? '武器不利' : '';
    box.append(el('div', {class: 'fc'},
      el('div', {}, el('b', {}, h.name)), el('div', {class: 'mid'}, triTxt || 'VS'), el('div', {class: 'r'}, el('b', {}, e.name)),
      el('div', {class: 'big'}, `${h.hp}`), el('div', {class: 'mid'}, '生命'), el('div', {class: 'big r'}, `${e.hp}`),
      el('div', {}, `${f.aDmg}${f.aCount > 1 ? ' ×2' : ''}`), el('div', {class: 'mid'}, '傷害'), el('div', {class: 'r'}, f.canCounter ? `${f.dDmg}${f.dCount > 1 ? ' ×2' : ''}` : '無法反擊'),
      el('div', {}, `${f.aHit}%`), el('div', {class: 'mid'}, '命中'), el('div', {class: 'r'}, f.canCounter ? `${f.dHit}%` : '—'),
      el('div', {}, `${f.aCrit}%`), el('div', {class: 'mid'}, '暴擊'), el('div', {class: 'r'}, f.canCounter ? `${f.dCrit}%` : '—')));
    acts.append(el('button', {class: 'primary', onclick: () => commit({type: 'hero', to: from, act: {kind: 'attack', target: e.id}})}, '攻擊'), el('button', {onclick: () => { bsel.target = null; bInfo(); }}, '取消'));
    return;
  }
  if (bsel.inspect) { box.append(unitInfo(uById(bsel.inspect))); }
  else {
    box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `命令：${ORDERS[st.order.stance].name}——${ORDERS[st.order.stance].desc}。點藍色格子移動，點敵人看預測。`));
    for (const p of bsel.plans) { const u = uById(p.id); box.append(el('div', {class: 'plan' + (p.disobey ? ' dis' : '')}, el('b', {}, u.name), el('span', {}, planText(p)))); }
  }
  const to = bsel.to || [h.x, h.y], edge = to[0] === 0 || to[1] === 0 || to[0] === B.W - 1 || to[1] === B.H - 1;
  acts.append(el('button', {class: 'primary', onclick: () => commit({type: 'hero', to, act: {kind: 'wait'}})}, bsel.to ? '移動並待命' : '待命'));
  if (edge) acts.append(el('button', {class: 'danger', onclick: () => { if (confirm('撤離戰場？還跟敵人貼身纏鬥的同伴會被丟下。')) commit({type: 'flee', to}); }}, '撤離'));
  if (bsel.to || bsel.inspect) acts.append(el('button', {onclick: () => { bsel = null; refreshPlans(); bInfo(); }}, '取消'));
}
$('showDanger').onchange = () => { if (bsel) { bsel.danger = null; bsel.eplans = null; } };
async function commit(action) {
  if (animating) return;
  const st = ST(); let ev;
  try { ev = B.act(st, action); } catch (e) { toast(e.message); return; }
  animating = true; $('bActions').innerHTML = ''; $('bInfo').innerHTML = '';
  save();
  await play(ev);
  animating = false; bsel = null; syncDisp();
  if (st.result) return battleOver();
  refreshPlans(); bInfo();
}
async function play(events) {
  for (const e of events) {
    const d = disp[e.id] || disp[e.a];
    if (e.t === 'move') { for (let i = 1; i < e.path.length; i++) { await tween(disp[e.id], e.path[i][0], e.path[i][1], 80); } }
    else if (e.t === 'strike') {
      const a = disp[e.a], t = disp[e.d], dx = Math.sign(t.x - a.x) * 0.25, dy = Math.sign(t.y - a.y) * 0.25;
      a.ox = dx; a.oy = dy; await sleep(110); a.ox = 0; a.oy = 0;
      popups.push({x: t.x, y: t.y, text: e.hit ? (e.crit ? `暴擊 ${e.dmg}` : `${e.dmg}`) : '未命中', color: e.hit ? (e.crit ? '#ffd166' : '#ffffff') : '#a8997d', t0: performance.now()});
      t.hp = e.hp; await sleep(330);
    }
    else if (e.t === 'die') { const u = disp[e.id]; for (let k = 0; k < 6; k++) { u.alpha -= 0.17; await sleep(50); } u.alpha = 0; const un = uById(e.id); if (un.side === 'ally') toast(`${un.name}倒下了`, 2500); }
    else if (e.t === 'heal') { const t = disp[e.d]; popups.push({x: t.x, y: t.y, text: `+${e.amt}`, color: '#7fbf6a', t0: performance.now()}); t.hp = e.hp; await sleep(400); }
    else if (e.t === 'flee' || e.t === 'captured') { const u = disp[e.id]; if (e.t === 'captured') popups.push({x: u.x, y: u.y, text: '被俘', color: '#e06a52', t0: performance.now()}); for (let k = 0; k < 5; k++) { u.alpha -= 0.2; await sleep(40); } u.alpha = 0; }
    else if (e.t === 'level') { const u = uById(e.id), gains = Object.keys(e.gains).map(k => ({hp: '生命', str: '力量', skl: '技巧', spd: '速度', def: '防禦'}[k] + '+1')).join(' '); toast(`${u.name} 升到 Lv${e.lvl}！${gains || '（什麼都沒長）'}`, 2600); await sleep(500); }
    else if (e.t === 'bark') { bubbles.push({id: e.id, text: e.text, t0: performance.now()}); }
    else if (e.t === 'phase') { await banner(e.side === 'ally' ? '同伴行動' : '敵人行動', 450); }
    else if (e.t === 'turn') { $('bTurn').textContent = `第 ${e.n} 回合`; await banner(`第 ${e.n} 回合`, 450); }
    void d;
  }
}
function tween(d, x, y, ms) { return new Promise(res => { const x0 = d.x, y0 = d.y, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); d.x = x0 + (x - x0) * k; d.y = y0 + (y - y0) * k; if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }); }
function battleOver() {
  const {setup, st} = G.battle, w = G.world; lastSt = st;
  const lvBefore = new Map(w.party.map(m => [m.id, m.lvl]));
  const out = Wd.applyBattle(w, setup, st);
  G.battle = null; save();
  if (w.over) return gameOver();
  const box = el('div', {}, el('h2', {}, st.result === 'win' ? '勝利' : st.result === 'retreat' ? '撤退' : '戰鬥結束'));
  for (const l of out.lines) box.append(el('p', {}, l));
  for (const m of w.party) { const u = st.units.find(x => x.id === m.id); if (!u) continue; const lv = m.lvl - (lvBefore.get(m.id) || m.lvl); box.append(el('div', {class: 'plan'}, el('b', {}, m.name), el('span', {class: 'muted'}, `生命 ${m.hp}/${m.max}・擊倒 ${u.kills}${lv ? `・升了 ${lv} 級` : ''}`))); }
  openSheet(box, () => worldScreen());
}
function gameOver() {
  const w = G.world; wipe();
  const h = {name: w.party.find(m => m.hero)?.name};
  const box = el('div', {}, el('h2', {}, '旅程結束'),
    el('p', {}, `你在第 ${w.day} 天倒在${w.over?.where || '路上'}。`),
    el('p', {class: 'muted'}, `打過 ${w.battles} 場仗，隊伍一共擊倒 ${w.kills} 個敵人。`));
  if (w.fallen.length) { box.append(el('h3', {}, '先你而去的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・第 ${f.day} 天・${f.how}`)); }
  const alive = w.party.filter(m => !m.hero); if (alive.length) { box.append(el('h3', {}, '活下來的人')); box.append(el('p', {class: 'muted'}, alive.map(m => m.name).join('、') + '——他們會各自散去。')); }
  box.append(el('button', {class: 'primary', onclick: () => { closeSheet(); G = {world: null, battle: null}; titleScreen(); }}, '重新開始'));
  void h; const lock = () => {}; lock.locked = true; openSheet(box, lock);
}
addEventListener('resize', () => { if (!$('battle').hidden) { bsel && (bsel.reach = null); } });

/* ───────────── 啟動 ───────────── */
loadArt().then(titleScreen);
