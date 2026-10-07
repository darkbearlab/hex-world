// 奇幻戰幫切片：畫面與操作
import {CLASSES, TRAITS, ORDERS, WEAPONS, TERRAIN, MALE_NAMES, FEMALE_NAMES, SURNAMES} from './data.js';
import * as Wd from './world.js';
import * as B from './battle.js';
import * as C from './cont.js';
// 共享世界：伺服器是唯一的真相；瀏覽器只留一份唯讀的沙盒鏡像來畫圖、查價格
const NET = {on: false, token: null, apMs: 20000, apAt: 0, T: 0, mirrorT: 0, others: [], battle: null, name: '', busy: false, me: '', chat: [], bubbles: {}, tnotes: [], unread: 0, ws: null};
const TOKEN_KEY = 'warband-mp-token';
async function api(path, body) {
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers: {'content-type': 'application/json', 'x-token': NET.token || ''}, body: body ? JSON.stringify(body) : undefined});
  const d = await r.json().catch(() => ({error: '伺服器沒有回應'})); if (!r.ok && !d.w) throw new Error(d.error || '連線失敗'); return d;
}
async function refreshMirror(force) {
  const d = await api('/api/world'); lostTrack(NET.others || [], d.others || []); NET.others = d.others || []; NET.T = d.T; clockFrom(d);
  if (G.world) { G.world.poiShared = d.poiState; if (d.caches) G.world.caches = d.caches; } if (d.tnotes) NET.tnotes = d.tnotes;
  if (force || d.T - NET.mirrorT >= 2) { const s = await (await fetch('/api/snapshot')).json(); C.loadState(s.state); NET.mirrorT = s.T; Wd.MODE.worldT = s.T; }
}
// 伺服器的時鐘：下一個時段什麼時候到、一個時段幾秒、是否暫停
function clockFrom(d) { if (d.nextTickAt !== undefined) NET.nextTickAt = d.nextTickAt; if (d.tickMs) NET.tickMs = d.tickMs; if (d.paused !== undefined) NET.paused = d.paused; }
const mmss = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function applyView(v) {
  const notes = G.world?.notes;
  G.world = v.w; G.world.pois = v.pois || G.world.pois; G.world.poiShared = v.poiState || {}; G.world.notes = v.notes ?? notes; G.world.caches = v.caches || [];
  clockFrom(v); NET.apMs = v.apMs || NET.apMs; NET.apAt = Date.now(); NET.battle = v.battle; NET.name = v.name || NET.name; NET.me = v.me || NET.me; Wd.MODE.worldT = v.T ?? Wd.MODE.worldT; if (v.T != null) NET.T = v.T;
  if (v.away && v.away.hours >= 24 && !noAway()) setTimeout(() => awaySheet(v.away), 300);
}
const noAway = () => { try { return localStorage.getItem('warband-no-away') === '1'; } catch { return false; } };
function awaySheet(a) {
  const box = el('div', {}, el('h2', {}, '你不在的時候'), el('p', {}, `大約過了 ${Math.round(a.hours / 24)} 天。${a.food ? `吃掉 ${Math.round(a.food)} 份糧，` : ''}花掉 ${a.gold} 金幣（餉發一半${G.world && Wd.siteAt(G.world, G.world.pos)?.kind === 'town' ? '、旅店錢' : ''}）。`));
  if (a.raids.length) { box.append(el('h3', {}, '夜裡的事')); for (const r of a.raids) box.append(el('p', {class: 'muted'}, r)); }
  else box.append(el('p', {class: 'muted'}, '一切平靜。'));
  box.append(el('label', {class: 'muted', style: 'display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px'}, el('input', {type: 'checkbox', onchange: e => { try { localStorage.setItem('warband-no-away', e.target.checked ? '1' : ''); } catch {} }}), '以後不要跳出來（日誌裡還是會記）'));
  openSheet(box);
}
const apNow = () => Math.min(Wd.AP_MAX, (G.world?.ap || 0) + (Date.now() - NET.apAt) / NET.apMs);

const $ = id => document.getElementById(id);
const SAVE = 'warband-v3';   // v2：世界換成大陸沙盒，沙盒狀態另存在 SAVE-sim
let G = {world: null, battle: null};

/* ───────────── 小工具 ───────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 交易成功的小卡片：買賣、存取、下單這類動作做完跳出來確認；點一下或過幾秒自己收起
function receipt(title, lines) {
  const r = $('receipt'), w = G.world; r.innerHTML = '';
  r.append(el('div', {class: 'rh'}, `✓ ${title}`), ...lines.map(l => el('p', {}, l)), el('div', {class: 'rs'}, `身上 ${w.gold} 金幣・載重 ${+Wd.load(w).toFixed(1)}/${Wd.capacity(w)} 包・點一下關閉`));
  r.hidden = false; r.onclick = () => { r.hidden = true; }; clearTimeout(receipt.t); receipt.t = setTimeout(() => { r.hidden = true; }, 3500);
}
const RECEIPT = {buy: '買進', sell: '賣出', buyItem: '買下', sellItem: '賣掉', trade: '交易完成', buyFood: '買了口糧', buyMule: '買了騾子', sellMule: '賣了騾子', buyHorse: '買了馬', sellHorse: '賣了馬', storePut: '存進倉庫', storeTake: '從倉庫拿出', order: '下單了', give: '接濟', handOver: '交給官府', claim: '領賞', thankPlea: '交差', hire: '雇用', payRansom: '付了贖金'};
function toast(text, ms = 2200) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms); }
async function banner(text, ms = 700) { const b = $('banner'); b.textContent = text; b.classList.add('show'); await sleep(ms); b.classList.remove('show'); await sleep(150); }
// 戰幫的狀態直接存；沙盒狀態（大地圖約 2–3 MB）用 gzip 壓縮後存成 base64
async function gz(str, dir) {
  const cs = dir ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const data = dir ? new TextEncoder().encode(str) : Uint8Array.from(atob(str), c => c.charCodeAt(0));
  const out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer());
  if (!dir) return new TextDecoder().decode(out);
  let b = ''; for (let i = 0; i < out.length; i += 0x8000) b += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000)); return btoa(b);
}
let simSaving = null, simDirty = false;
async function saveSimNow() {
  if (simSaving) { simDirty = true; return; }
  simSaving = (async () => { try { const json = JSON.stringify(C.saveState()); if (typeof CompressionStream === 'function') { localStorage.setItem(SAVE + '-simz', await gz(json, true)); localStorage.removeItem(SAVE + '-sim'); } else localStorage.setItem(SAVE + '-sim', json); } catch (e) { console.warn('沙盒存檔失敗', e); toast('存檔空間不夠，世界的進度可能沒存到'); } })();
  await simSaving; simSaving = null; if (simDirty) { simDirty = false; saveSimNow(); }
}
function save(sim = true) { if (NET.on) return; try { localStorage.setItem(SAVE, JSON.stringify(G)); } catch (e) { console.warn('存檔失敗', e); } if (sim && C.SIM) saveSimNow(); }
async function loadSim() { try { const z = localStorage.getItem(SAVE + '-simz'); if (z) return JSON.parse(await gz(z, false)); const s = localStorage.getItem(SAVE + '-sim'); return s ? JSON.parse(s) : null; } catch (e) { console.warn(e); return null; } }
function load() { try { const s = localStorage.getItem(SAVE); return s ? JSON.parse(s) : null; } catch { return null; } }
function wipe() { try { localStorage.removeItem(SAVE); localStorage.removeItem(SAVE + '-sim'); localStorage.removeItem(SAVE + '-simz'); } catch {} }
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
// 頭像庫：一張大圖（art/faces.webp）＋清單（art/faces.json：每張的性別、年紀、描述）
let FACES = null; const FACEIMG = new Image();
async function loadFaces() { try { FACES = await (await fetch('art/faces.json')).json(); await new Promise(ok => { FACEIMG.onload = ok; FACEIMG.onerror = ok; FACEIMG.src = 'art/faces.webp?v=' + FACES.size; }); } catch { FACES = null; } }
const strHash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const faceList = g => FACES ? FACES.faces.filter(f => f.g === g) : [];
// 戰場上的人：有臉譜的畫臉譜，沒有的畫人物圖（看身上的套裝）；手上的武器、盾牌用小圖示壓在角落
function drawUnit(g, u, x, y, alpha) {
  const f = faceOf(u), c = cell;
  if (f != null) { g.save(); g.globalAlpha = alpha; drawFace(g, f, x + c / 2, y + c * 0.46, c * 0.4, u.side === 'ally' ? (u.hero ? '#d9a441' : '#5b9bd5') : '#d0533f'); g.restore(); }
  else sprite(g, u.sprite, x + c * 0.04, y - c * 0.04, c * 0.92, {flip: u.side === 'enemy', alpha});
  g.save(); g.globalAlpha = alpha; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.max(10, c * 0.3)}px system-ui`;
  if (u.wpn?.icon) g.fillText(u.wpn.icon, x + c * 0.82, y + c * 0.7);
  if (u.shield) g.fillText(u.shield, x + c * 0.18, y + c * 0.7);
  if (u.mounted) { g.font = `${Math.max(9, c * 0.26)}px system-ui`; g.fillText('🐎', x + c * 0.18, y + c * 0.18); }
  g.restore();
}
function faceOf(m) {
  if (!FACES || !m || CLASSES[m.cls]?.beast) return null;
  if (m.face != null && FACES.faces[m.face]) return m.face;
  const L = faceList(m.g || Wd.genderOf(m.name || '')); if (!L.length) return null;
  return L[(m.fs ?? strHash(m.id || m.name)) % L.length].i;
}
// 頭像畫在 canvas 上、照螢幕的實際像素放大且不平滑：像素圖才不會糊（CSS 的 image-rendering 在部分手機上不可靠）
function faceEl(i, size) {
  const d = document.createElement('canvas'), S = FACES.size, c = FACES.cols, px = Math.round(size * (devicePixelRatio || 1));
  d.className = 'face'; d.width = px; d.height = px; d.style.width = size + 'px'; d.style.height = size + 'px';
  const g = d.getContext('2d'), draw = () => { g.imageSmoothingEnabled = false; g.clearRect(0, 0, px, px); g.drawImage(FACEIMG, (i % c) * S, Math.floor(i / c) * S, S, S, 0, 0, px, px); };
  if (FACEIMG.complete && FACEIMG.naturalWidth) draw(); else FACEIMG.addEventListener('load', draw, {once: true});
  return d;
}
// 人物的頭像：有頭像就用頭像，沒有（野獸、舊存檔）就用小人圖
const portrait = (m, size = 56) => { const f = faceOf(m); return f != null ? faceEl(f, size) : avatar(m.sprite, size); };
function drawFace(g, i, x, y, r, ring) {
  const S = FACES.size, c = FACES.cols;
  g.save(); g.beginPath(); g.arc(x, y, r, 0, 7); g.closePath(); g.fillStyle = '#1b150d'; g.fill(); g.clip();
  g.imageSmoothingEnabled = false; g.drawImage(FACEIMG, (i % c) * S, Math.floor(i / c) * S, S, S, x - r, y - r, r * 2, r * 2); g.restore();
  g.strokeStyle = ring; g.lineWidth = Math.max(2, r * 0.14); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
}
function avatar(ref, size = 56, flip = false) { const c = document.createElement('canvas'); c.width = c.height = 64; sprite(c.getContext('2d'), ref, 0, 0, 64, {flip}); c.style.width = c.style.height = size + 'px'; return c; }
function fit(canvas) { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); const g = canvas.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return {g, w: r.width, h: r.height}; }

/* ───────────── 抽屜 ───────────── */
let sheetOnClose = null;
function openSheet(html, onClose, full = false) { $('sheet').classList.toggle('full', !!full); $('sheetContent').innerHTML = ''; if (typeof html === 'string') $('sheetContent').innerHTML = html; else $('sheetContent').append(html); $('sheet').hidden = false; sheetOnClose = onClose || null; $('sheetClose').hidden = !!(onClose && onClose.locked); }
function closeSheet() { scrollTo(0, 0); document.scrollingElement && (document.scrollingElement.scrollLeft = 0); $('sheet').hidden = true; const f = sheetOnClose; sheetOnClose = null; if (f) f(); }
$('sheetClose').onclick = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target === $('sheet') && !(sheetOnClose && sheetOnClose.locked)) closeSheet(); });
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') e.onclick = v; else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };

/* ───────────── 人物卡 ───────────── */
function traitTags(m) { return (m.traits || []).map(t => el('span', {class: 'tag trait', onclick: async () => toast(`${TRAITS[t].name}：${TRAITS[t].desc}`, 3500)}, TRAITS[t].name)); }
function memberCard(m, extra) {
  const hpPct = Math.round(m.hp / m.max * 100);
  return el('div', {class: 'card'}, portrait(m),
    el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, m.name), el('span', {class: 'muted'}, `${m.tags?.length ? m.tags.join('・') + '・' : ''}${clsName(m)} Lv${m.lvl}${m.hero ? '・你' : ''}`)),
      el('div', {class: 'meter'}, el('i', {style: `width:${hpPct}%;background:${hpPct < 40 ? 'var(--enemy)' : hpPct < 70 ? 'var(--warn)' : 'var(--ok)'}`})),
      el('div', {class: 'stats'}, ...(() => { const ga = Wd.gearAdd(m), f = (v, d) => d ? `${v + d}` : `${v}`; return [['生命', `${Math.round(m.hp)}/${m.max}`], ['力量', f(m.str, ga.str)], ['技巧', f(m.skl, ga.skl)], ['速度', f(m.spd, ga.spd)], ['防禦', f(m.def, ga.def)]]; })().map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
      el('div', {class: 'muted', style: 'font-size:12px'}, `${m.famous ? '有名者・' : ''}擅長${(CLASSES[m.cls]?.skill || []).map(t => Wd.WTYPE_NAME[t]).join('、') || '雜兵器'}・經驗 ${m.exp}/100${m.wage ? `・週薪 ${m.wage}` : ''}${m.deeds ? `・${m.deeds.battles} 戰 ${m.deeds.kills} 殺` : ''}`),
      gearRow(m),
      m.hero ? null : el('div', {style: 'display:flex;gap:6px;align-items:center;font-size:12px'}, el('span', {class: 'muted'}, '忠誠'), el('div', {class: 'meter loy', style: 'flex:1'}, el('i', {style: `width:${Math.max(0, m.loyalty)}%`})), el('span', {}, Math.round(m.loyalty))),
      el('div', {}, ...traitTags(m)),
      extra || null));
}

// 裝備：四格。是自己隊伍的人，點一格就能換
function itemDesc(it) {
  const I = Wd.ITEMS[it.b], t = it.t || 0; if (!I) return '';
  if (I.k === 'w') return `${Wd.WTYPE_NAME[I.type]}・${I.h === 2 ? '雙手' : '單手'}・攻擊 ${I.mt + t}・命中 ${I.hit}${I.crit ? `・必殺 ${I.crit}` : ''}${I.range ? `・射程 ${I.range.join('–')}` : ''}`;
  if (I.k === 'a') return `防禦 +${I.def + t}${I.spd ? `・速度 ${I.spd}` : ''}`;
  if (I.k === 's') return `防禦 +${I.def + t}・擋箭 +${I.arrow}${I.spd ? `・速度 ${I.spd}` : ''}`;
  return [I.def ? `防禦 +${I.def}` : '', I.skl ? `技巧 +${I.skl}` : '', I.str ? `力量 +${I.str}` : ''].filter(Boolean).join('・');
}
function gearRow(m) {
  if (!m.eq) return null; const mine = G.world?.party.includes(m);
  const row = el('div', {class: 'gear'});
  for (const s of ['w', 'a', 's', 't']) { const it = m.eq[s], wo = s === 'w' && it ? Wd.weaponOf(m) : null;
    row.append(el('button', {class: 'slot' + (it ? '' : ' empty'), disabled: mine ? null : true, title: it ? itemDesc(it) : '', onclick: () => equipSheet(m, s)}, el('small', {}, Wd.SLOT_NAME[s]), it ? `${Wd.ITEMS[it.b].icon || ''}${Wd.itemName(it)}${wo?.unskilled ? '⚠' : ''}` : '—')); }
  return row;
}
function equipSheet(m, slot) {
  const w = G.world, cur = m.eq?.[slot], two = slot === 's' && m.eq?.w && Wd.ITEMS[m.eq.w.b].h === 2;
  const back = () => openSheet(memberCard(m, m.hero ? null : dismissRow(m)));
  const box = el('div', {}, el('h2', {}, `${m.name}的${Wd.SLOT_NAME[slot]}`));
  const act = async a => { await doWorld(a, true); renderLeft(); const mm = G.world.party.find(x => x.id === m.id); if (mm) equipSheet(mm, slot); };
  if (cur) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.itemName(cur)), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(cur)), el('button', {class: 'pin', onclick: () => act({type: 'unequip', mid: m.id, slot})}, '卸下')));
  if (two) box.append(el('p', {class: 'muted'}, `${Wd.itemName(m.eq.w)}要用雙手，不能配盾。`));
  const list = (w.pack || []).filter(it => Wd.ITEMS[it.b].k === slot);
  box.append(el('h3', {}, '行囊裡的'));
  if (!list.length) box.append(el('p', {class: 'muted'}, '沒有可以換的。到城裡的鐵匠鋪買，或從打倒的敵人身上撿。'));
  for (const it of list) { const I = Wd.ITEMS[it.b], bad = slot === 'w' && I.type !== 'other' && !(CLASSES[m.cls]?.skill || []).includes(I.type);
    box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, `${I.icon || ''}${Wd.itemName(it)}`), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it) + (bad ? '・不擅長（命中 −15）' : '') + (slot === 'w' && I.h === 2 && m.eq.s ? '・會卸下盾牌' : '')),
      el('button', {class: 'pin', disabled: two ? true : null, onclick: () => act({type: 'equip', mid: m.id, item: it.id})}, '換上'))); }
  box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: back}, '← 回到人物')));
  openSheet(box);
}

/* ───────────── 世界檔 ───────────── */
let PACK = null;
async function getPack() { if (!PACK) PACK = await (await fetch('data/genesis.json')).json(); return PACK; }

/* ───────────── 標題 ───────────── */
function titleScreen() {
  show('title'); setupLogin();
  // 單人模式先藏起來：接下來以線上（共享世界）為主。存檔與程式都還在，之後要再開放只要拿掉這行
  $('continueRun').hidden = true; $('newRun').hidden = true;
  maybeChangelog();
}
/* ───────────── 更新紀錄：當天第一次進來時跳出 ───────────── */
async function changelogSheet() {
  let log = []; try { log = await (await fetch('changelog.json', {cache: 'no-store'})).json(); } catch {}
  const box = el('div', {class: 'log'}, el('h2', {}, '更新紀錄'));
  for (const d of log) { box.append(el('h3', {style: 'margin-top:12px'}, d.date)); for (const it of d.items) box.append(el('p', {}, '・' + it)); }
  if (!log.length) box.append(el('p', {class: 'muted'}, '暫時沒有更新紀錄。'));
  openSheet(box);
}
function maybeChangelog() { const today = new Date().toLocaleDateString('sv'); let seen = ''; try { seen = localStorage.getItem('warband-changelog-day') || ''; } catch {} if (seen === today) return; try { localStorage.setItem('warband-changelog-day', today); } catch {} changelogSheet(); }
$('btnChangelog').onclick = () => changelogSheet();
$('newRun').onclick = async () => {
  const s = load(); if (s && s.world && !s.world.over && !confirm('會蓋掉目前的旅程，確定重新開始？')) return;
  createScreen('solo');
};
/* ───────────── 建立角色：名字、性別、出身、頭像 ───────────── */
function randomName(g) { const P = g === 'f' ? FEMALE_NAMES : MALE_NAMES; return `${P[Math.floor(Math.random() * P.length)]}・${SURNAMES[Math.floor(Math.random() * SURNAMES.length)]}`; }
async function suggestName(mode, g) { if (mode === 'mp') { try { const d = await (await fetch('/api/name?g=' + g)).json(); if (d.name) return d.name; } catch {} } return randomName(g); }
async function createScreen(mode, restart) {
  const st = {name: '', g: 'm', origin: 'knight', face: null, taken: false, ff: 'all'};
  const pickFace = () => { if (st.face != null) return; const L = faceList(st.g); if (L.length) st.face = L[Math.floor(Math.random() * L.length)].i; };
  st.name = await suggestName(mode, st.g); pickFace();
  const box = el('div', {class: 'create'});
  const draw = () => {
    box.innerHTML = '';
    box.append(el('h2', {}, '建立角色'), el('p', {class: 'muted', style: 'margin:0 0 6px'}, mode === 'mp' ? '這是你在共享世界裡的戰幫首領。名字不能和別人重複。' : '這次旅程的主角。'));
    const inp = el('input', {maxlength: 8, value: st.name, placeholder: '名字'});
    const warn = el('span', {class: 'muted', style: 'font-size:12px'}, st.taken ? '這個名字已經有人用了' : '');
    if (st.taken) warn.style.color = '#f08a74';
    let tm = 0; inp.addEventListener('input', () => { st.name = inp.value.trim(); st.taken = false; warn.textContent = ''; if (mode !== 'mp' || !st.name) return; clearTimeout(tm); tm = setTimeout(async () => { try { const d = await (await fetch('/api/name?check=' + encodeURIComponent(st.name))).json(); if (d.name === st.name) { st.taken = d.taken; warn.textContent = d.taken ? '這個名字已經有人用了' : '這個名字可以用'; warn.style.color = d.taken ? '#f08a74' : '#9fd18a'; } } catch {} }, 350); });
    box.append(el('div', {class: 'crow'}, el('label', {class: 'clab'}, '名字'), inp, el('button', {class: 'pin', title: '換一個', onclick: async () => { st.name = await suggestName(mode, st.g); st.taken = false; draw(); }}, '🎲')), warn);
    box.append(el('div', {class: 'crow'}, el('label', {class: 'clab'}, '性別'), ...[['m', '男'], ['f', '女']].map(([k, n]) => el('button', {class: st.g === k ? 'on' : '', onclick: async () => { if (st.g === k) return; const auto = !inp.value || [...MALE_NAMES, ...FEMALE_NAMES].includes(st.name.split('・')[0]); st.g = k; pickFace(); if (auto) st.name = await suggestName(mode, k); draw(); }}, n))));
    box.append(el('h3', {style: 'margin-top:10px'}, '出身'), el('p', {class: 'muted', style: 'font-size:12px;margin:0'}, '出身決定你一開始是什麼職業、帶著什麼人和多少錢，也會成為你身上的標籤。之後怎麼走都看你。'));
    const og = el('div', {class: 'origins'});
    for (const [k, O] of Object.entries(Wd.ORIGINS)) og.append(el('button', {class: 'origin' + (st.origin === k ? ' on' : ''), onclick: () => { st.origin = k; draw(); }},
      el('b', {}, O.n), el('span', {class: 'oc'}, `${CLASSES[O.cls].name}・${O.gold} 金・${O.mates.length} 個同伴`), el('span', {class: 'od'}, O.d)));
    box.append(og);
    box.append(el('div', {class: 'crow', style: 'margin-top:10px'}, el('h3', {style: 'margin:0;flex:1'}, '頭像'), ...[['all', '全部'], ['m', '偏男性'], ['f', '偏女性']].map(([k, n]) => el('button', {class: 'pin' + (st.ff === k ? ' on' : ''), onclick: () => { st.ff = k; draw(); }}, n))));
    const fg = el('div', {class: 'faces'});
    for (const f of (FACES ? FACES.faces : []).filter(f => st.ff === 'all' || f.g === st.ff)) { const d = faceEl(f.i, 56); d.classList.add('pick'); if (f.i === st.face) d.classList.add('on'); d.title = f.desc; d.onclick = () => { st.face = f.i; draw(); }; fg.append(d); }
    if (!FACES) fg.append(el('p', {class: 'muted'}, '頭像庫載入失敗，先用預設的小人圖。'));
    box.append(fg);
    const go = el('button', {class: 'primary', style: 'width:100%;margin-top:12px', onclick: async () => {
      const name = (inp.value || '').trim(); if (!name) return toast('取個名字吧');
      go.disabled = true; go.textContent = '世界展開中…';
      try {
        C.loadPack(await getPack());
        if (mode === 'solo') { G = {world: Wd.newWorld((Math.random() * 2 ** 31) | 0, name, {origin: st.origin, g: st.g, face: st.face}), battle: null}; cam = null; save(); closeSheet(); worldScreen(); return; }
        const v = await api('/api/join', {name, origin: st.origin, g: st.g, face: st.face, restart: !!restart}); applyView(v); closeSheet(); startShared();
      } catch (e) { toast(e.message, 3500); if (/名字/.test(e.message)) { st.taken = true; st.name = name; draw(); } go.disabled = false; go.textContent = '出發'; }
    }}, '出發');
    box.append(go);
  };
  draw(); openSheet(box, null, true);
}
// 帳號：用 Google 登入的話，伺服器發一個工作階段代碼，換裝置登入同一個帳號就是同一個角色；沒登入就用瀏覽器代碼當訪客
const ACCT_KEY = 'warband-mp-acct';
let AUTH = {clientId: '', guest: true, inited: false};
const acct = () => { try { return localStorage.getItem(ACCT_KEY) || ''; } catch { return ''; } };
async function setupLogin() {
  try { const d = await (await fetch('/api/world')).json(); AUTH.clientId = d.clientId || ''; AUTH.guest = d.guest !== false; } catch { return; }
  renderAcct();
  if (!AUTH.clientId || AUTH.inited) return;
  await new Promise(ok => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = ok; document.head.append(sc); });
  if (!window.google?.accounts?.id) return;
  google.accounts.id.initialize({client_id: AUTH.clientId, callback: onGoogle, ux_mode: 'popup'});
  AUTH.inited = true; renderAcct();
}
function renderAcct() {
  const box = $('acctBox'), note = $('acctNote'), email = acct();
  box.hidden = !AUTH.clientId; $('gsiBtn').innerHTML = '';
  if (email) {
    note.innerHTML = ''; note.append(`已用 ${email} 登入。`, el('a', {onclick: () => { try { localStorage.removeItem(ACCT_KEY); localStorage.removeItem(TOKEN_KEY); } catch {} renderAcct(); }}, '登出'), '・', el('a', {onclick: deleteAccount}, '刪除帳號'));
    fetch('/api/account', {headers: {'x-token': localStorage.getItem(TOKEN_KEY) || ''}}).then(r => r.json()).then(a => { if (!a.email) { try { localStorage.removeItem(ACCT_KEY); localStorage.removeItem(TOKEN_KEY); } catch {} toast('登入已失效（世界可能重開了），請重新登入', 3500); return renderAcct(); } NET.admin = !!a.admin; if (a.admin && !$('adminBtn')) note.append('・', el('a', {id: 'adminBtn', onclick: adminSheet}, '管理')); }).catch(() => {});
  }
  else {
    if (AUTH.inited) google.accounts.id.renderButton($('gsiBtn'), {theme: 'filled_black', text: 'signin_with', shape: 'pill', locale: 'zh-TW'});
    note.textContent = AUTH.guest ? '用 Google 登入，換手機或電腦都能接著玩同一支戰幫。也可以不登入，用這個瀏覽器當訪客。' : '共享世界要用 Google 帳號登入。';
  }
  $('mpRun').hidden = !email && !AUTH.guest;
  $('mpRun').textContent = email || !AUTH.clientId ? '進入共享世界' : '以訪客身分進入共享世界';
}
async function deleteAccount() {
  if (prompt('刪除帳號會一併刪掉你在共享世界裡的戰幫，而且救不回來。\n確定的話請輸入「刪除」') !== '刪除') return;
  try { NET.token = localStorage.getItem(TOKEN_KEY); await api('/api/me/delete', {what: 'account'}); localStorage.removeItem(ACCT_KEY); localStorage.removeItem(TOKEN_KEY); toast('帳號已刪除'); renderAcct(); } catch (e) { toast(e.message); }
}
async function adminSheet() {
  NET.token = localStorage.getItem(TOKEN_KEY);
  let d; try { d = await api('/api/admin/status'); } catch (e) { return toast(e.message); }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`; };
  const box = el('div', {}, el('h2', {}, '管理共享世界'),
    el('p', {class: 'muted'}, `世界版本 ${d.version}・${d.stamp}・第 ${d.T} 時段・${d.paused ? '暫停中' : `每 ${d.tickMs / 1000} 秒推進一個時段`}・從 ${new Date(d.startedAt).toLocaleString('zh-TW')} 開始`),
    el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await api('/api/admin/pause', {on: !d.paused}); adminSheet(); }}, d.paused ? '讓世界繼續走' : '暫停世界'),
      el('button', {class: 'danger', onclick: async () => { if (prompt('重開世界會清空所有東西：世界的進度、所有人的戰幫、帳號與登入。大家要重新登入、重新建角色。\n確定的話請輸入「重開」') !== '重開') return; try { await api('/api/admin/reset', {confirm: '重開'}); closeSheet(); localStorage.removeItem(ACCT_KEY); localStorage.removeItem(TOKEN_KEY); toast('世界重開了，請重新登入', 4000); NET.on = false; G = {world: null, battle: null}; titleScreen(); } catch (e) { toast(e.message); } }}, '重開世界')),
    el('h3', {style: 'margin-top:12px'}, '測試用：世界速度'),
    el('p', {class: 'muted', style: 'font-size:13px'}, `一個時段（遊戲裡 6 小時）現在是 ${d.tickMs / 1000} 秒${d.tickSec ? `（預設 ${d.defaultSec} 秒）` : '（預設）'}。行動點回復跟著一起變快。調快之前累積、還沒結算的時間，會照新的速度算。`),
    el('div', {class: 'rowbtn'}, ...[[0, '預設'], [30, '30 秒'], [15, '15 秒'], [10, '10 秒'], [5, '5 秒']].map(([sec, lab]) => el('button', {class: (d.tickSec || 0) === sec ? 'primary' : '', onclick: async () => { await api('/api/admin/speed', {sec}); if (NET.on) { const v = await api('/api/me'); if (!v.error) applyView(v); refreshMirror().catch(() => {}); } adminSheet(); }}, lab))),
    el('div', {class: 'rowbtn'}, ...[[1, '推進 1 個時段'], [4, '推進 1 天'], [28, '推進 1 週']].map(([n, lab]) => el('button', {onclick: async () => { const r = await api('/api/admin/tick', {n}); toast(`現在是 ${r.stamp}`); if (NET.on) { const v = await api('/api/me'); if (!v.error) applyView(v); await refreshMirror(true); renderWorld(); renderRails(); } adminSheet(); }}, lab))),
    el('h3', {style: 'margin-top:12px'}, `戰幫（${d.players.length}）`));
  for (const p of d.players) box.append(el('div', {class: 'plan'}, el('b', {}, p.name), el('span', {class: 'muted'}, `${p.size} 人・聲望 ${p.fame}・${p.google ? 'Google' : '訪客'}・${p.over ? '已散・' : ''}${ago(p.seen)}`),
    el('button', {class: 'pin', onclick: async () => { await api('/api/admin/mute', {id: p.id, on: !p.muted}); adminSheet(); }}, p.muted ? '解除禁言' : '禁言'),
    el('button', {class: 'pin', onclick: async () => { if (!confirm(`刪掉「${p.name}」的戰幫？`)) return; await api('/api/admin/kick', {id: p.id}); adminSheet(); }}, '刪除')));
  if (!d.players.length) box.append(el('p', {class: 'muted'}, '還沒有人。'));
  openSheet(box, null, true);
}
async function onGoogle(resp) {
  try {
    const legacy = acct() ? null : localStorage.getItem(TOKEN_KEY);
    const r = await fetch('/api/auth/google', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({credential: resp.credential, legacy})});
    const d = await r.json(); if (!r.ok) throw new Error(d.error || '登入失敗');
    localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(ACCT_KEY, d.email || 'Google 帳號');
    renderAcct(); toast(d.moved ? `登入了；這個瀏覽器原本的「${d.name}」已經綁到你的帳號上` : d.hasPlayer ? `歡迎回來，${d.name}` : '登入了，取個名字就能出發');
    enterShared();
  } catch (e) { toast(e.message, 3500); }
}
$('mpRun').onclick = () => enterShared();
async function enterShared() {
  NET.token = localStorage.getItem(TOKEN_KEY); if (!NET.token) { NET.token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(TOKEN_KEY, NET.token); }
  $('mpRun').disabled = true; const lab = $('mpRun').textContent; $('mpRun').textContent = '連線中…';
  try {
    C.loadPack(await getPack()); NET.on = true; Wd.MODE.shared = true;
    await refreshMirror(true);
    let v = null; try { v = await api('/api/me'); } catch (e) { if (!/還沒加入/.test(e.message)) throw e; }
    if (!v || v.w.over) return createScreen('mp', !!v);   // 這個帳號還沒有角色（或上一支戰幫已經散了）：建立角色
    applyView(v); startShared();
  } catch (e) { toast(e.message, 3500); NET.on = false; Wd.MODE.shared = false; } finally { $('mpRun').disabled = false; $('mpRun').textContent = lab; }
}
function startShared() {
  connectChat();
  cam = null; worldScreen(); if (NET.battle) startBattle(NET.battle.setup);
  if (!refreshMirror.timer) refreshMirror.timer = setInterval(() => { if (NET.on && !G.battle && !traveling) refreshMirror().then(() => { if (!$('world').hidden) renderWorld(); }).catch(() => {}); }, 30000);
}
$('continueRun').onclick = async () => {
  $('continueRun').disabled = true;
  try { C.loadPack(await getPack()); const st = await loadSim(); if (st) C.loadState(st); } finally { $('continueRun').disabled = false; }
  G = load(); cam = null; if (G.battle) battleScreen(); else worldScreen();
};

/* ═════════════ 大地圖（大陸） ═════════════ */
let wsel = null, traveling = false, cam = null, mapSize = {w: 1, h: 1};
const SQ3 = Math.sqrt(3);
function worldScreen() { show('world'); wsel = G.world ? {pos: G.world.pos, path: null} : null; campOpen = false; renderWorld(); afterWorldAction(); }
// 鏡頭：世界座標以「六角半徑 = 1」為單位，cam.s 是半徑的像素數
const wxy = i => { const q = C.col(i), r = C.row(i); return [SQ3 * (q + 0.5 * (r & 1)), 1.5 * r]; };
function ensureCam() {
  if (cam) return;
  const [x, y] = wxy(G.world.pos); cam = {x, y, s: Math.max(18, Math.min(30, mapSize.w / 15))};
}
const scr = i => { const [x, y] = wxy(i); return [(x - cam.x) * cam.s + mapSize.w / 2, (y - cam.y) * cam.s + mapSize.h / 2]; };
function clampCam() {
  const minS = Math.min(mapSize.w / (SQ3 * (Wd.W + 0.5)), mapSize.h / (1.5 * Wd.H + 0.5));
  cam.s = Math.max(minS, Math.min(56, cam.s));
  cam.x = Math.max(0, Math.min(SQ3 * (Wd.W + 0.5), cam.x)); cam.y = Math.max(0, Math.min(1.5 * Wd.H, cam.y));
}
function followParty() { const [px, py] = scr(G.world.pos), m = Math.min(mapSize.w, mapSize.h) * 0.18; if (px < m || py < m || px > mapSize.w - m || py > mapSize.h - m) { const [x, y] = wxy(G.world.pos); cam.x = x; cam.y = y; } }
function hexPath(g, cx, cy, s) { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); g.lineTo(cx + s * Math.cos(a), cy + s * Math.sin(a)); } g.closePath(); }
function renderStatus() {
  const w = G.world;
  $('wTime').textContent = nowText(w);
  const ci = Wd.campInfo(w); $('wCampTag').hidden = !ci; if (ci) $('wCampTag').textContent = `⛺ ${ci.ready ? '營地紮穩了' : `紮營中（再 ${(w.kit ? 6 : 12) - ci.age} 小時紮穩）`}${ci.stake ? '・木柵' : ''}${ci.watch ? '・哨' : ''}${ci.fire ? '・營火' : ''}`;
  $('wAP').hidden = !NET.on; if (NET.on) $('wAPv').textContent = `${Math.floor(apNow())}/${Wd.AP_MAX}`;
  $('wAdmin').hidden = !(NET.on && NET.admin);
  if (NET.on) { const ap = apNow(), nextAp = ap >= Wd.AP_MAX ? null : (1 - (ap % 1)) * NET.apMs;
    $('wClock').textContent = `${nextAp == null ? '行動點滿了' : `+1 ${mmss(nextAp)}`}・${NET.paused ? '世界暫停中' : NET.nextTickAt ? `下個時段 ${mmss(NET.nextTickAt - Date.now())}` : ''}`; }
}
// 每秒更新倒數；時段到了就跟伺服器同步一次
setInterval(() => {
  if (!NET.on || !G.world || $('world').hidden) return; renderStatus();
  if (NET.nextTickAt && Date.now() > NET.nextTickAt + 1500 && !NET.syncing && !traveling && !NET.busy) { NET.syncing = true;
    api('/api/me').then(d => { if (!d.error) { applyView(d); renderRails(); } return refreshMirror(); }).then(() => renderWorld()).catch(() => {}).finally(() => { NET.syncing = false; }); }
}, 1000);
$('wAdmin').onclick = () => adminSheet();
let showDanger = false;
const RISKCOL = r => r < 0.15 ? '#9fd18a' : r < 0.4 ? '#f1c45c' : '#f0705a';
// 地圖的大小一變就重畫（避免舊畫面被拉伸變形）
new ResizeObserver(() => { if (!$('world').hidden && G.world) renderWorld(); }).observe($('mapWrap'));
function renderWorld() {
  const w = G.world; if (!w) return;
  renderStatus();
  const {g, w: cw, h: ch} = fit($('map')); mapSize = {w: cw, h: ch}; ensureCam(); clampCam();
  const k = C.K(), s = cam.s, SEEN = i => Wd.seen(w, i);
  g.fillStyle = '#10243a'; g.fillRect(0, 0, cw, ch);
  const vis = [];
  for (let i = 0; i < Wd.N; i++) { const [x, y] = scr(i); if (x < -s * 2 || y < -s * 2 || x > cw + s * 2 || y > ch + s * 2) continue; vis.push([i, x, y]); }
  const winter = k.season === 3;
  // 地形與國土（沒去過的地方是一片空白）
  for (const [i, x, y] of vis) {
    if (!SEEN(i)) { hexPath(g, x, y, s * 1.01); g.fillStyle = '#1d1813'; g.fill(); hexPath(g, x, y, s * 0.96); g.strokeStyle = '#2a231b'; g.lineWidth = 1; g.stroke(); continue; }
    const b = k.biome[i]; hexPath(g, x, y, s * 1.01); g.fillStyle = Wd.BIOMES[b].c; g.fill();
    const o = k.owner[i]; if (o >= 0) { g.fillStyle = k.fac[o].c + '40'; g.fill(); }
    if (winter && Wd.coldAt(i) && C.land(i)) { g.fillStyle = '#ffffff38'; g.fill(); }
    if (showDanger && C.land(i)) { const r = Wd.tileRisk(i, k); if (r > 0.12) { hexPath(g, x, y, s * 0.98); g.fillStyle = `rgba(208,60,40,${Math.min(0.55, r * 0.6)})`; g.fill(); } }
    if (s >= 16) {
      if (b === 6) sprite(g, ['props', 'tree'], x - s * 0.5, y - s * 0.6, s, {alpha: 0.75});
      if (b === 3 || b === 2) { g.fillStyle = b === 2 ? '#f4f6f7' : '#9a948c'; g.beginPath(); g.moveTo(x - s * 0.55, y + s * 0.35); g.lineTo(x - s * 0.05, y - s * 0.5); g.lineTo(x + s * 0.5, y + s * 0.35); g.fill(); }
      if (b === 4) { g.strokeStyle = '#6e6a4588'; g.lineWidth = 1.5; g.beginPath(); g.arc(x - s * 0.2, y + s * 0.2, s * 0.28, Math.PI, 0); g.arc(x + s * 0.25, y + s * 0.25, s * 0.22, Math.PI, 0); g.stroke(); }
    }
    if (C.river(i) && C.land(i)) { g.fillStyle = k.season === 0 ? '#7fb8ee' : '#5a96d2'; g.beginPath(); g.arc(x, y, s * (k.season === 0 ? 0.18 : 0.13), 0, 7); g.fill(); }
  }
  // 國界；交戰國之間的邊界畫成紅色的戰線
  const edge = (x, y, n, col, wd) => { const [nx, ny] = scr(n), a = Math.atan2(ny - y, nx - x); g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); g.moveTo(x + s * Math.cos(a - Math.PI / 6), y + s * Math.sin(a - Math.PI / 6)); g.lineTo(x + s * Math.cos(a + Math.PI / 6), y + s * Math.sin(a + Math.PI / 6)); g.stroke(); };
  for (const [i, x, y] of vis) { const o = k.owner[i]; if (o < 0 || !SEEN(i)) continue;
    for (const n of Wd.NBR[i]) { const e = k.owner[n]; if (e === o) continue;
      const atWar = e >= 0 && k.war[Math.min(e, o)][Math.max(e, o)];
      edge(x, y, n, atWar ? '#e0402a' : '#140f0bcc', atWar ? Math.max(2.5, s * 0.16) : Math.max(1.5, s * 0.09)); } }
  // 商路
  g.strokeStyle = '#d8bf86'; g.lineWidth = Math.max(1.5, s * 0.1); g.lineCap = 'round';
  for (const [i, x, y] of vis) if (SEEN(i) && k.routeTiles.has(i)) for (const n of Wd.NBR[i]) if (n > i && SEEN(n) && k.routeTiles.has(n)) { const [nx, ny] = scr(n); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke(); }
  // 規劃中的路線：每一段依危險上色
  if (wsel && wsel.path) { let prev = scr(w.pos); g.lineWidth = Math.max(3, s * 0.16); g.setLineDash([6, 4]);
    for (const p of wsel.path) { const q = scr(p); g.strokeStyle = SEEN(p) ? RISKCOL(Wd.tileRisk(p, k)) : '#cfc4b0'; g.beginPath(); g.moveTo(...prev); g.lineTo(...q); g.stroke(); prev = q; } g.setLineDash([]); }
  // 村莊、城鎮、山寨
  const label = (text, x, y, color, size) => { g.font = `600 ${size}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000b'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y); };
  for (const [i, x, y] of vis) {
    if (!SEEN(i)) continue;
    if (Wd.isTown(i, k)) { const z = s * 1.35, fc = k.fac[k.owner[i]].c, cap = k.fac[k.owner[i]].cap === i;
      g.fillStyle = fc; g.strokeStyle = '#140f0b'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y + s * 0.18, s * 0.62, s * 0.3, 0, 0, 7); g.fill(); g.stroke();
      sprite(g, ['props', 'tower'], x - z / 2, y - z * 0.7, z);
      g.fillStyle = fc; g.beginPath(); g.moveTo(x + s * 0.1, y - z * 0.72); g.lineTo(x + s * 0.1, y - z * 0.98); g.lineTo(x + s * 0.5, y - z * 0.88); g.lineTo(x + s * 0.1, y - z * 0.8); g.fill(); g.strokeStyle = '#140f0b'; g.lineWidth = 1; g.stroke();
      label((cap ? '★' : '') + nm(i), x, y + s * 0.95, fc, Math.max(10, s * 0.46));
      if (w.intel[i]) { g.fillStyle = '#d9a441'; g.beginPath(); g.arc(x + s * 0.55, y - s * 0.55, Math.max(2.5, s * 0.12), 0, 7); g.fill(); }
      if (k.markets[i].ratio?.food < 0.8) label('饑荒', x, y - s * 0.75, '#ff8a6e', Math.max(9, s * 0.38)); }
    else if (s >= 24 && k.owner[i] >= 0 && k.pop[i] >= 8) sprite(g, ['props', 'cottage'], x - s * 0.28, y - s * 0.3, s * 0.56, {alpha: 0.6});
    const gg = Wd.gangAt(i, k); if (gg) { const z = s * 1.1; sprite(g, ['props', 'banner'], x - z / 2, y - z * 0.65, z); if (s >= 16) label(gg.name + '寨', x, y + s * 0.95, '#f3b2a6', Math.max(9, s * 0.4)); }
  }
  // 興趣點：看得到的才畫；探索過的變暗
  for (const p of Wd.pois(w)) { if (!SEEN(p.tile)) continue; const [x, y] = scr(p.tile); if (x < -s || y < -s || x > cw + s || y > ch + s) continue;
    const T = Wd.POI_TYPES[p.type], done = Wd.poiDone(w, p), r = Math.max(7, s * 0.3);
    g.globalAlpha = done ? 0.45 : 1; g.fillStyle = '#140f0bdd'; g.beginPath(); g.arc(x - s * 0.42, y - s * 0.38, r, 0, 7); g.fill(); g.strokeStyle = T.c; g.lineWidth = 2; g.stroke();
    g.fillStyle = T.c; g.font = `700 ${Math.max(8, r * 1.05)}px system-ui`; g.textAlign = 'center'; g.fillText(T.icon, x - s * 0.42, y - s * 0.38 + r * 0.38); g.globalAlpha = 1; }
  // 地上的貨：視野內才看得到
  for (const c of w.caches || []) { if (Wd.cacheTotal(c) <= 0 || !SEEN(c.tile) || Wd.hdist(c.tile, w.pos) > Wd.viewRadius(w)) continue; const [x, y] = scr(c.tile); if (x < -s || y < -s || x > cw + s || y > ch + s) continue;
    sprite(g, ['props', 'crate'], x + s * 0.05, y - s * 0.05, s * 0.55); }
  // 視野：視野外壓暗，視野邊緣那一圈（看得到但看不清楚）壓一半
  { const R = Wd.viewRadius(w); for (const [i, x, y] of vis) { if (!SEEN(i)) continue; const d = Wd.hdist(i, w.pos); if (d < R) continue; hexPath(g, x, y, s * 1.02); g.fillStyle = d === R ? '#0b080538' : '#0b080570'; g.fill(); } }
  // 委託地點、傳聞、聽說的事
  const mark = (i, text, col) => { const [x, y] = scr(i); g.fillStyle = col; g.beginPath(); g.arc(x + s * 0.5, y + s * 0.45, Math.max(6, s * 0.26), 0, 7); g.fill(); g.strokeStyle = '#000a'; g.lineWidth = 1.5; g.stroke(); g.fillStyle = '#1b150d'; g.font = `800 ${Math.max(8, s * 0.3)}px system-ui`; g.textAlign = 'center'; g.fillText(text, x + s * 0.5, y + s * 0.45 + Math.max(3, s * 0.11)); };
  for (const p of w.pins || []) if (w.day - p.day < 12) mark(p.tile, '!', '#e9dcbf');
  for (const c of w.contracts) { const t = Wd.contractSite(w, c); if (t >= 0 && (c.taken || c.kind === 'deliver') && !c.done) mark(t, Wd.KIND_NAME[c.kind][0], '#f1c45c'); if (c.done) mark(c.town, '賞', '#9fd18a'); }
  for (const L of w.leads || []) mark(L.center, '?', '#b6e3a8');
  // 視野內的商隊、運貨車、軍隊、巡邏隊
  const R = Wd.viewRadius(w);
  const UNIT = {caravan: ['people', 'merchant'], cart: ['props', 'cart'], patrol: ['people', 'spearman'], army: ['people', 'knight']};
  const stack = {};
  for (const u of Wd.unitsInView(w)) {
    const n = stack[u.pos] = (stack[u.pos] || 0) + 1; if (n > 3) continue;
    const [x0, y0] = scr(u.pos), x = x0 + (n - 2) * s * 0.42, y = y0 - s * 0.05, fc = k.fac[u.fac]?.c || '#aaa', z = u.kind === 'army' ? s * 0.95 : s * 0.7;
    g.fillStyle = fc + 'cc'; g.beginPath(); g.arc(x, y + z * 0.28, z * 0.42, 0, 7); g.fill(); g.strokeStyle = '#140f0b'; g.lineWidth = 1.5; g.stroke();
    sprite(g, UNIT[u.kind], x - z / 2, y - z * 0.45, z, {alpha: u.kind === 'cart' ? 0.85 : 1});
    if (u.n > 1 && s >= 14) { g.fillStyle = '#140f0b'; g.beginPath(); g.arc(x + z * 0.38, y - z * 0.3, Math.max(6, s * 0.2), 0, 7); g.fill(); g.fillStyle = '#f6ecd4'; g.font = `700 ${Math.max(8, s * 0.24)}px system-ui`; g.textAlign = 'center'; g.fillText(u.n, x + z * 0.38, y - z * 0.3 + Math.max(3, s * 0.08)); }
    if (u.kind === 'army') { g.fillStyle = fc; g.fillRect(x + z * 0.25, y - z * 0.7, z * 0.32, z * 0.2); g.strokeStyle = '#140f0b'; g.lineWidth = 1; g.strokeRect(x + z * 0.25, y - z * 0.7, z * 0.32, z * 0.2); }
  }
  // 遊蕩的隊伍：視野內才看得到；在追你的會標出來
  for (const b of w.bands) { if (b.pos < 0 || (!b.hunting && Wd.hdist(b.pos, w.pos) > R)) continue; const [x, y] = scr(b.pos); g.fillStyle = b.hunting ? '#e0402a99' : '#d0533f66'; g.beginPath(); g.arc(x, y, s * 0.62, 0, 7); g.fill(); sprite(g, b.kind === 'wolves' ? ['foes', 'wolf'] : ['foes', 'bandit'], x - s * 0.55, y - s * 0.65, s * 1.1, {flip: true});
    if (b.hunting) { label('追兵', x, y - s * 0.7, '#ff8a6e', Math.max(9, s * 0.36)); const [px, py] = scr(w.pos); g.strokeStyle = '#e0402a88'; g.setLineDash([3, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.stroke(); g.setLineDash([]); } }
  // 其他玩家的戰幫（多人）
  if (NET.on) for (const o of NET.others) { if (o.id === NET.me || (o.name === NET.name && o.pos === w.pos)) continue; if (!SEEN(o.pos)) continue; const [x, y] = scr(o.pos); if (o.camp) drawCamp(g, x + s * 0.3, y + s * 0.25, s * 0.8, o.camp);
    const ring = o.banner != null && k.fac[o.banner] ? k.fac[o.banner].c : '#8fd0ff', of = FACES && o.face != null && FACES.faces[o.face] ? o.face : FACES ? (faceList(o.g || 'm')[strHash(o.id) % Math.max(1, faceList(o.g || 'm').length)]?.i ?? null) : null;
    if (of != null) drawFace(g, of, x + s * 0.3, y + s * 0.25, Math.max(8, s * 0.42), ring);
    else { g.strokeStyle = ring; g.lineWidth = 2; g.beginPath(); g.arc(x + s * 0.3, y + s * 0.25, s * 0.42, 0, 7); g.stroke(); sprite(g, ['people', 'squire'], x + s * 0.3 - s * 0.38, y + s * 0.25 - s * 0.45, s * 0.76); } if (s >= 16) label(o.name, x + s * 0.3, y - s * 0.35, '#bfe6ff', Math.max(9, s * 0.34)); bubble(g, o.id, x + s * 0.3, y - s * 0.6); }
  // 玩家
  const [px, py] = (() => { const [x, y] = partyXY(); return [(x - cam.x) * cam.s + mapSize.w / 2, (y - cam.y) * cam.s + mapSize.h / 2]; })();
  const ci = !anim && Wd.campInfo(w);
  if (ci) drawCamp(g, px, py, s, ci);
  const hf = faceOf(w.party.find(m => m.hero));
  if (hf != null) drawFace(g, hf, px, py - s * 0.05, Math.max(10, s * 0.62), w.escort ? '#9fd18a' : '#d9a441');
  else { g.strokeStyle = w.escort ? '#9fd18a' : '#d9a441'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, s * 0.72, 0, 7); g.stroke(); sprite(g, ['people', 'knight'], px - s * 0.6, py - s * 0.7, s * 1.2); }
  if (w.escort && s >= 16) label('護送中', px, py + s * 0.98, '#bfe3b0', Math.max(9, s * 0.36));
  else if (w.guard && s >= 16) label('巡邏同行', px, py + s * 0.98, '#bfe3b0', Math.max(9, s * 0.36));
  if (NET.on) bubble(g, NET.me, px, py - s * 0.8);
  for (const c of (NET.tnotes || [])) if (SEEN(c.tile) && Wd.hdist(c.tile, w.pos) <= Wd.viewRadius(w)) { const [x, y] = scr(c.tile); g.fillStyle = '#f4ead2'; g.font = `${Math.max(10, s * 0.4)}px system-ui`; g.textAlign = 'center'; g.fillText('📜', x - s * 0.45, y + s * 0.55); }
  if (wsel) { hexPath(g, ...scr(wsel.pos), s * 0.97); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
  placePop();
}
const nm = i => C.nm(i);
// 對話泡泡：地圖上說話的人頭上冒出最近一句，8 秒後消失
function bubble(g, id, x, y) {
  const b = NET.bubbles[id]; if (!b || Date.now() - b.at > 8000) return;
  const t = b.text.length > 16 ? b.text.slice(0, 15) + '…' : b.text; g.font = '600 12px system-ui'; const tw = g.measureText(t).width + 12;
  g.fillStyle = '#f4ead2ee'; g.strokeStyle = '#1b150d'; g.lineWidth = 1; g.beginPath(); g.roundRect ? g.roundRect(x - tw / 2, y - 22, tw, 20, 6) : g.rect(x - tw / 2, y - 22, tw, 20); g.fill(); g.stroke();
  g.fillStyle = '#1b150d'; g.textAlign = 'center'; g.fillText(t, x, y - 8);
  setTimeout(() => { if (!$('world').hidden) renderWorld(); }, 8100 - (Date.now() - b.at));
}
// 日期：共享世界一律換算成世界的日期（戰幫自己的日曆不給玩家看，免得誤會）；單人就是第幾天
const SEASONS = ['春', '夏', '秋', '冬'];
function worldDate(T) { const k = C.K(), y0 = +(k.stamp.match(/^(\d+)/)?.[1] || 0), y = y0 - (Math.floor(k.T / 112) - Math.floor(T / 112)), p = ((T % 112) + 112) % 112; return `${y}年${SEASONS[Math.floor(p / 28)]}${Math.floor((p % 28) / 4) + 1}日`; }
function dayText(d) { const w = G.world; if (!NET.on || w?.clockOff == null) return `第 ${d} 天`; return worldDate(Math.floor((d * 24 + 12 + w.clockOff) / 6)); }
// 畫面上的「現在」：共享世界一律是世界的時間（戰幫手上的行動點是還沒用掉的過去）；單人是戰幫自己的時間
function nowText(w) { if (!NET.on) return Wd.timeText(w); const m = C.K().stamp.match(/^(\d+) 年 (\S+) 第(\d+)日\s*(\S*)/); return m ? `${m[1]}年${m[2]}${m[3]}日・${m[4]}` : C.K().stamp; }
// 營地：帳篷、木柵一圈、營火
function drawCamp(g, x, y, s, ci) {
  if (ci.stake) { g.strokeStyle = '#8a6a3e'; g.lineWidth = Math.max(2, s * 0.08); for (let a = 0; a < 12; a++) { const t = a / 12 * Math.PI * 2; g.beginPath(); g.moveTo(x + Math.cos(t) * s * 0.9, y + Math.sin(t) * s * 0.75); g.lineTo(x + Math.cos(t) * s * 0.9, y + Math.sin(t) * s * 0.75 - s * 0.22); g.stroke(); } }
  g.fillStyle = '#c9b48a'; g.strokeStyle = '#3b2e1e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - s * 0.95, y + s * 0.15); g.lineTo(x - s * 0.62, y - s * 0.45); g.lineTo(x - s * 0.3, y + s * 0.15); g.closePath(); g.fill(); g.stroke();
  if (ci.fire) sprite(g, ['props', 'campfire'], x + s * 0.35, y - s * 0.05, s * 0.55);
}
function pickHex(x, y) { let best = null, bd = Infinity; for (let i = 0; i < Wd.N; i++) { const [cx, cy] = scr(i), d = (cx - x) ** 2 + (cy - y) ** 2; if (d < bd) { bd = d; best = i; } } return bd < (cam.s * 1.05) ** 2 ? best : null; }
// 拖曳平移、雙指縮放、滾輪縮放；沒有拖動就當成點擊
{
  const ptrs = new Map(); let moved = 0, pinch = null, raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderWorld(); }); };
  const map = $('map');
  map.addEventListener('pointerdown', e => { if (!wide()) { setRail('l', false); setRail('r', false); } map.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = ptrs.size > 1 ? 99 : 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = {d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: cam.s}; } });
  map.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !cam) return; const [ox, oy] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { moved += Math.abs(e.clientX - ox) + Math.abs(e.clientY - oy); if (moved > 6) { cam.x -= (e.clientX - ox) / cam.s; cam.y -= (e.clientY - oy) / cam.s; redraw(); } }
    else if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; cam.s = pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d; redraw(); }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && moved <= 6 && !traveling && cam) { const r = map.getBoundingClientRect(), p = pickHex(e.clientX - r.left, e.clientY - r.top); if (p != null) selectHex(p); }
  };
  map.addEventListener('pointerup', up); map.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch = null; moved = 99; });
  map.addEventListener('wheel', e => { e.preventDefault(); if (!cam) return; cam.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; redraw(); }, {passive: false});
}
function selectHex(p) {
  const w = G.world, here = p === w.pos;
  wsel = {pos: p, path: here ? null : Wd.findPath(w, w.pos, p)}; renderWorld(); hexInfo();
}
const strength = (foes) => { const r = Wd.partyPower(foes) / Math.max(1, Wd.partyPower(G.world.party)); return r < 0.5 ? ['弱', 'good'] : r < 0.85 ? ['稍弱', 'good'] : r < 1.15 ? ['相當', 'warn'] : r < 1.6 ? ['強', 'bad'] : ['很強', 'bad']; };
function foeSummary(foes) { const c = {}; for (const f of foes) c[clsName(f)] = (c[clsName(f)] || 0) + 1; return Object.entries(c).map(([k, n]) => `${k}×${n}`).join('、'); }
const powerTag = pw => { const r = pw / Math.max(1, Wd.partyPower(G.world.party)), [lab, cls] = r < 0.5 ? ['弱', 'good'] : r < 0.85 ? ['稍弱', 'good'] : r < 1.15 ? ['相當', 'warn'] : r < 1.6 ? ['強', 'bad'] : ['很強', 'bad']; return el('span', {class: 'tag ' + cls}, '戰力' + lab); };
const gangWord = str => str > 260 ? '人多勢眾' : str > 160 ? '有一定規模' : '人不多';
let infoFolded = false;
$('hexInfo').addEventListener('click', e => { if (e.target.closest('.row') && !e.target.closest('button')) { infoFolded = !infoFolded; $('hexInfo').classList.toggle('folded', infoFolded); const f = $('hexInfo').querySelector('.fold'); if (f) f.textContent = infoFolded ? '▸' : '▾'; } });
// 格子資訊：第一層是貼在格子旁邊的小卡（地名、國家、能做的事）；「詳細」才是完整的資訊
function hexInfo() {
  const box = $('hexInfo'); box.innerHTML = ''; box.classList.remove('folded');
  if (campOpen) { box.hidden = false; campInfoPanel(box); } else box.hidden = true;
  renderPop();
}
function hexDetail() {
  if (!wsel) return; const box = el('div', {class: 'hexdetail'});
  hexDetailInto(box); openSheet(box);
  box.addEventListener('click', e => { if (e.target.closest('button')) closeSheet(); }, true);   // 按了裡面的任何行動就收起來
}
const closePop = () => { wsel = null; renderWorld(); renderPop(); };
function popActions(p) {
  const w = G.world, k = C.K(), here = p === w.pos, out = [];
  const add = (label, fn, cls) => out.push(el('button', {class: cls || '', onclick: async () => { await fn(); }}, label));
  if (!here) {
    if (wsel?.path) { const hrs = Wd.pathHoursW(w, wsel.path); add(NET.on ? `前往（${hrs} 行動點${hrs > apNow() ? '，不夠' : ''}）` : `前往（${hrs} 小時）`, () => travel(wsel.path), 'primary'); add(w.march ? '急行軍：開' : '急行軍：關', async () => { await doWorld({type: 'march', on: !w.march}, true); wsel = {pos: p, path: Wd.findPath(G.world, G.world.pos, p)}; renderWorld(); renderPop(); renderLeft(); }, w.march ? 'danger' : ''); }
    return out;
  }
  add('此地…', () => { wsel = null; renderWorld(); renderPop(); hubOpen = true; renderHub(); }, 'primary');   // 自己這格的事都收在中間的按鈕
  return out;
}
function renderPop() {
  const pop = $('hexPop'), w = G.world; if (!w || !wsel || campOpen || traveling) { pop.hidden = true; return; }
  const p = wsel.pos, k = C.K(), here = p === w.pos, seen = Wd.seen(w, p); pop.innerHTML = '';
  pop.append(el('div', {class: 'phead'}, el('b', {}, seen ? nm(p) : '未知之地'), el('button', {class: 'px', 'aria-label': '取消選取', onclick: closePop}, '✕')));
  if (seen) {
    const o = k.owner[p];
    pop.append(el('div', {class: 'pline'}, o >= 0 ? Wd.facName(o) : '無主之地', el('span', {class: 'muted'}, `・${Wd.BIOMES[k.biome[p]].n}`)));
    if (here) pop.append(el('div', {class: 'pline good'}, '你在這裡'));
    const band = Wd.bandAt(w, p); if (band) { const [lab, cls] = strength(band.foes); pop.append(el('div', {class: 'pline'}, band.name, ' ', el('span', {class: 'tag ' + cls}, lab))); }
    if (k.bandit[p] > 40) pop.append(el('div', {class: 'pline bad'}, '盜匪出沒'));
    const others = NET.on ? NET.others.filter(x => x.pos === p && x.id !== NET.me).length : 0; if (others) pop.append(el('div', {class: 'pline'}, `${others} 支別人的戰幫`));
  } else pop.append(el('div', {class: 'pline muted'}, '沒去過，也沒人說過'));
  if (!here) { if (wsel.path) { const hrs = Wd.pathHoursW(w, wsel.path); pop.append(el('div', {class: 'pline'}, `${wsel.path.length} 格・約 ${hrs < 30 ? hrs + ' 小時' : (hrs / 24).toFixed(1) + ' 天'}`)); } else pop.append(el('div', {class: 'pline muted'}, '走不到那裡')); }
  for (const b of popActions(p)) pop.append(b);
  if (seen) pop.append(el('button', {class: 'pmore', onclick: hexDetail}, '詳細…'));
  pop.hidden = false; placePop();
}
function placePop() {
  const pop = $('hexPop'); if (pop.hidden || !wsel || !cam) return;
  const [x, y] = scr(wsel.pos), pw = pop.offsetWidth, ph = pop.offsetHeight, s = cam.s, rightRoom = mapSize.w - x, safeR = wide() ? 8 : 44;
  let left = rightRoom - safeR > x ? x + s * 0.95 : x - s * 0.95 - pw;
  left = Math.max(8, Math.min(mapSize.w - pw - safeR, left));
  const top = Math.max(8, Math.min(mapSize.h - ph - 96, y - 24));
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}
function hexDetailInto(box) {
  const w = G.world, k = C.K();
  const p = wsel ? wsel.pos : w.pos, here = p === w.pos;
  if (!Wd.seen(w, p)) {
    box.append(el('div', {class: 'row'}, el('span', {class: 'fold'}, infoFolded ? '▸' : '▾'), el('b', {}, '未知之地'), el('span', {class: 'tag'}, '沒去過，也沒人說過')));
    const row = el('div', {class: 'rowbtn'});
    if (wsel?.path) { const hrs = Wd.pathHoursW(w, wsel.path); box.append(el('div', {class: 'muted'}, `${wsel.path.length} 格，粗估 ${(hrs / 24).toFixed(1)} 天。路上的情況不清楚。`)); row.append(el('button', {class: 'primary', onclick: async () => travel(wsel.path)}, '前往')); }
    else box.append(el('div', {class: 'muted'}, '看起來走不過去。'));
    box.append(row); return;
  }
  const site = Wd.siteAt(w, p), band = Wd.bandAt(w, p), o = k.owner[p];
  const title = el('div', {class: 'row'}, el('span', {class: 'fold'}, infoFolded ? '▸' : '▾'), el('b', {}, nm(p)), el('span', {class: 'tag'}, Wd.BIOMES[k.biome[p]].n),
    o >= 0 ? el('span', {class: 'tag'}, Wd.facName(o)) : el('span', {class: 'tag warn'}, '無主之地'),
    here ? el('span', {class: 'tag good'}, '你在這裡') : null, k.routeTiles.has(p) ? el('span', {class: 'tag'}, '商路') : null,
    k.bandit[p] > 40 ? el('span', {class: 'tag bad'}, '盜匪出沒') : k.bandit[p] > 15 ? el('span', {class: 'tag warn'}, '不太平') : null);
  box.append(title);
  if (band) { const [lab, cls] = strength(band.foes); box.append(el('div', {}, `${band.name}：${foeSummary(band.foes)} `, el('span', {class: 'tag ' + cls}, '戰力' + lab))); }
  const poi = Wd.poiAt(w, p);
  if (poi) { const T = Wd.POI_TYPES[poi.type], done = Wd.poiDone(w, poi); box.append(el('div', {}, el('span', {class: 'tag good'}, T.n), ' ', el('span', {class: 'muted'}, done ? `${done.T != null ? worldDate(done.T) : dayText(done.day)}${done.by ? '被' + done.by + '的戰幫' : ''}探索過，暫時沒什麼可找的。` : T.d))); }
  const piles = Wd.hdist(p, w.pos) <= Wd.viewRadius(w) ? Wd.cachesAt(w, p) : [];
  for (const c of piles) box.append(el('div', {}, el('span', {class: 'tag warn'}, '地上的貨'), ` ${[...Object.entries(c.goods).filter(([, n]) => n >= 1).map(([g, n]) => `${Wd.GN[g]} ${Math.floor(n)} 包`), ...(c.items || []).map(Wd.itemName)].join('、')}`, el('span', {class: 'muted'}, `（${c.why || '不知誰留下的'}）`)));
  const players = NET.on ? NET.others.filter(o => o.pos === p && o.id !== NET.me && Wd.seen(w, p)) : [];
  for (const o of players) box.append(el('div', {}, el('span', {class: 'tag'}, '戰幫'), ` ${o.name}・${o.size} 人・${o.banner != null ? Wd.facName(o.banner) + '的旗' : '中立'}${o.camp ? (o.camp.stake ? '・紮了木柵營' : '・紮營中') : ''}${o.wantedMax >= 2 ? '・通緝犯' : ''}${o.town ? '・在城裡' : ''} `, powerTag(o.power)));
  const units = Wd.unitsInView(w).filter(u => u.pos === p);
  for (const u of units.slice(0, 6)) box.append(el('div', {}, el('span', {class: 'tag'}, {caravan: '商隊', cart: '運貨車', patrol: '巡邏', army: '軍隊'}[u.kind]), ` ${u.label}・`, el('span', {class: 'muted'}, u.detail)));
  if (units.length > 6) box.append(el('div', {class: 'muted'}, `還有 ${units.length - 6} 組……`));
  if (o >= 0 && Wd.wantedBy(w, o) >= 1) box.append(el('div', {}, el('span', {class: 'tag bad'}, '通緝'), ` ${Wd.facName(o)}正在通緝你們${Wd.wantedBy(w, o) >= 3 ? '：城裡的人不會跟你們打交道' : ''}`));
  if (Wd.hdist(p, w.pos) > Wd.viewRadius(w)) box.append(el('div', {class: 'muted', style: 'font-size:12px'}, '在你的視野外：那裡現在有誰經過，你看不到。'));
  for (const pin of (w.pins || []).filter(x => x.tile === p && w.day - x.day < 12)) box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `${dayText(pin.day)}聽說：${pin.text}`));
  if (site?.kind === 'town') { const wars = Wd.atWarWith(site.fac); box.append(el('div', {class: 'muted'}, `市鎮。市集、酒館、告示板、旅店。${k.fac[site.fac].hardy ? `${Wd.facName(site.fac)}是北地之國，耐寒。` : ''}${wars.length ? `${Wd.facName(site.fac)}正與${wars.join('、')}交戰。` : ''}`)); const it = w.intel[p]; if (it && !here) box.append(intelLine(p)); }
  if (site?.kind === 'village') box.append(el('div', {class: 'muted'}, `村莊。可以買到 ${Wd.villageFood(w, p)} 份口糧，每份約 ${Wd.rationPrice(w, p).toFixed(1)} 金幣。`));
  if (site?.kind === 'camp') { const g = k.gangs.find(x => x.id === site.gang); box.append(el('div', {class: 'muted'}, `盜匪${g.name}的山寨，${gangWord(g.str)}。拔掉它能拿到寨裡的財物；告示板上可能有人出賞金。`)); }
  for (const c of w.contracts) if (Wd.contractSite(w, c) === p && (c.taken || c.kind === 'deliver')) box.append(el('div', {}, el('span', {class: 'tag warn'}, Wd.KIND_NAME[c.kind]), ' ', c.title));
  for (const L of w.leads || []) if (Wd.hdist(L.center, p) <= 1) box.append(el('div', {}, el('span', {class: 'tag good'}, '傳聞'), ` 「${L.name}」可能在這一帶${(L.searched || []).includes(p) ? '（這格找過了）' : ''}`));
  const row = el('div', {class: 'rowbtn'});
  if (!here && wsel?.path) {
    const hrs = Wd.pathHoursW(w, wsel.path), risks = wsel.path.filter(i => Wd.seen(w, i)).map(i => Wd.tileRisk(i, k)), bad = risks.filter(r => r >= 0.4).length, mid = risks.filter(r => r >= 0.15 && r < 0.4).length;
    const need = Wd.eaters(w) * hrs / 24;
    box.append(el('div', {}, `${wsel.path.length} 格，約 ${hrs < 30 ? hrs + ' 小時' : (hrs / 24).toFixed(1) + ' 天'}，吃掉 ${need.toFixed(0)} 份糧食`, need > w.food ? el('span', {class: 'tag bad'}, '糧食不夠') : null));
    box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `沿路：${bad ? `危險 ${bad} 格・` : ''}${mid ? `不太平 ${mid} 格・` : ''}${!bad && !mid ? '看起來還算太平・' : ''}${wsel.path.some(i => !Wd.seen(w, i)) ? '有些路段沒走過・' : ''}${Wd.SEASON_NOTE[k.season] || '天氣不錯'}`));
    row.append(el('button', {class: 'primary', onclick: async () => travel(wsel.path)}, NET.on ? `前往（${hrs} 行動點）` : '前往'));
    row.append(el('button', {class: w.march ? 'danger' : '', onclick: async () => { await doWorld({type: 'march', on: !w.march}, true); wsel = {pos: wsel.pos, path: Wd.findPath(G.world, G.world.pos, wsel.pos)}; renderWorld(); hexInfo(); renderLeft(); }}, w.march ? '急行軍：開' : '急行軍：關'));
    if (Wd.loadMul(w) > 1) box.append(el('div', {class: 'muted', style: 'font-size:12px'}, `貨太重：每格多花 ${Math.round((Wd.loadMul(w) - 1) * 100)}% 的時間。丟掉一些貨（行囊）可以走快一點。`));
    if (w.march) box.append(el('div', {style: 'font-size:12px;color:#f1cf8a'}, `急行軍：同一段路少花三成${NET.on ? '行動點' : '時間'}，代價是每小時全隊扣血、傭兵心浮氣躁、騾子可能倒下。疲憊時打仗防禦 −1、命中 −10。`));
  } else if (!here) box.append(el('div', {class: 'muted'}, '走不到那裡。'));
  if (here) row.append(el('button', {class: 'primary', onclick: () => { hubOpen = true; renderHub(); }}, '此地…'));
  box.append(row);
}
let anim = null;   // {from, to, t0, dur}：隊伍從哪格滑到哪格
const partyXY = () => { if (!anim) return wxy(G.world.pos); const k = Math.min(1, (performance.now() - anim.t0) / anim.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, [x0, y0] = wxy(anim.from), [x1, y1] = wxy(anim.to); return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e]; };
function slide(from, to, dur) {
  return new Promise(res => { anim = {from, to, t0: performance.now(), dur};
    const step = () => { const [x, y] = partyXY(); cam.x = x; cam.y = y; renderWorld(); if (performance.now() - anim.t0 < dur) requestAnimationFrame(step); else { anim = null; res(); } };
    requestAnimationFrame(step); });
}
async function travel(path) {
  traveling = true; wsel = null; campOpen = false; hubOpen = false; renderCamp(); renderPop();
  { const [x, y] = wxy(G.world.pos); cam.x = x; cam.y = y; }
  for (const p of path) {
    const from = G.world.pos, out = await doWorld({type: 'travel', to: p}, true, true);
    if (out && G.world.pos !== from) await slide(from, G.world.pos, 420 + Math.min(380, Wd.legHours(G.world, G.world.pos) * 12)); else renderWorld();
    if (!out || out.encounter || G.world.pendingBattle || G.world.over || Wd.bandAt(G.world, G.world.pos)) break;
  }
  traveling = false; wsel = {pos: G.world.pos, path: null}; save(); afterWorldAction(); renderHub();
}
async function doWorld(a, quiet, noSave) {
  if (NET.on) {
    if (NET.busy) return null; NET.busy = true;
    try {
      const head = G.world?.log?.[0]; const d = await api('/api/act', {action: a}); applyView(d);
      if (d.error) { toast(d.error); return null; }
      if (RECEIPT[a.type]) { const fresh = []; for (const l of G.world.log || []) { if (head && l.text === head.text && l.day === head.day) break; fresh.push(l.text); if (fresh.length >= 4) break; } receipt(RECEIPT[a.type], fresh.length ? fresh.reverse() : d.out.lines); }
      if (d.mk && C.K().markets[G.world.pos]) C.K().markets[G.world.pos] = d.mk;
      for (const l of d.out.lines) toast(l, 2600);
      if (!quiet) afterWorldAction();
      return d.out;
    } catch (e) { toast(e.message); return null; } finally { NET.busy = false; }
  }
  let out; const head = G.world?.log?.[0];
  try { out = Wd.worldAct(G.world, a); } catch (e) { toast(e.message); return null; }
  if (RECEIPT[a.type]) { const fresh = []; for (const l of G.world.log || []) { if (l === head) break; fresh.push(l.text); if (fresh.length >= 4) break; } receipt(RECEIPT[a.type], fresh.length ? fresh.reverse() : out.lines); }
  if (!noSave) save(); for (const l of out.lines) toast(l, 2600);
  if (!quiet) afterWorldAction();
  return out;
}
function afterWorldAction() {
  const w = G.world;
  if (NET.on && NET.chatTile !== w.pos) { NET.chatTile = w.pos; NET.chat = NET.chat.filter(m => m.tile === w.pos); }
  renderWorld(); hexInfo(); renderRails(); renderCamp();
  if (w.over) return gameOver();
  if (w.pendingBattle) return startBattle(w.pendingBattle);
  if (w.captive) return captiveSheet();
  const b = Wd.bandAt(w, w.pos); if (b) return encounterSheet(b);
}
// 被俘：付贖金、用人情、逃跑，或等對方放人
function captiveSheet() {
  const w = G.world, c = w.captive; if (!c) return closeSheet();
  const fav = Wd.favorAt(w, w.pos), left = Wd.CAPTIVE_DAYS[c.soldier ? 'soldier' : 'bandit'] - (w.day - c.day);
  const box = el('div', {}, el('h2', {}, `被${c.by}關著`),
    el('p', {}, c.soldier ? `關在牢裡。再過約 ${Math.max(0, left)} 天會放人，通緝也會減半。` : `綁在寨子裡。他們要 ${c.ransom} 金幣；約 ${Math.max(0, left)} 天後榨不出錢，就會把你們丟到荒野。`),
    el('p', {class: 'muted', style: 'font-size:13px'}, `身上還有 ${w.gold} 金幣。${w.party.length > 1 ? `外面還有 ${w.party.length - 1} 個同伴，逃跑時會接應。` : ''}這一帶欠你們的人情：${fav.toFixed(1)}。`));
  const act = async a => { const out = await doWorld(a, true); if (out) afterWorldAction(); if (!G.world.captive) closeSheet(); };
  box.append(el('div', {class: 'rowbtn'},
    el('button', {class: 'primary', disabled: w.gold < c.ransom ? true : null, onclick: () => act({type: 'payRansom'})}, `付贖金（${c.ransom}）`),
    el('button', {disabled: fav < Wd.FAVOR.ransom ? true : null, onclick: () => act({type: 'favorRansom'})}, `請這一帶的人贖人（人情 ${Wd.FAVOR.ransom}）`),
    el('button', {disabled: c.lastTry === w.day ? true : null, onclick: () => act({type: 'escape'})}, `試著逃跑（約 ${Math.round(Wd.escapeOdds(w) * 100)}%，半天）`),
    el('button', {onclick: () => act({type: 'waitCaptive'})}, '等一天')));
  const lock = () => {}; lock.locked = true; openSheet(box, lock);
}
function encounterSheet(b) {
  const [lab, cls] = strength(b.foes), w = G.world, toll = Wd.tollOf(w);
  if (b.kind === 'soldiers') {
    const fine = Wd.fineOf(w, b.fac), foe = Wd.hostileBanner(w, b.fac), box = el('div', {}, el('h2', {}, `${b.name}攔下了你們`), el('p', {}, `${foeSummary(b.foes)}　`, el('span', {class: 'tag ' + cls}, '戰力' + lab)),
      el('p', {class: 'muted'}, foe ? `「${Wd.facName(w.banner)}的狗！」——你們打著敵國的旗子，他們不會放人。` : '「你們就是通緝告示上那夥人吧。跟我們走一趟，或者把罰金繳了。」'));
    box.append(el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: async () => { closeSheet(); await doWorld({type: 'engage', band: b.id}); }}, foe ? '迎戰' : '迎戰（通緝更緊）'),
      el('button', {onclick: async () => { closeSheet(); await doWorld({type: 'evade', band: b.id}); }}, '試著甩開'),
      foe ? null : el('button', {onclick: async () => { closeSheet(); await doWorld({type: 'bribe', band: b.id}); }}, `繳罰金（${fine}）`),
      Wd.canHide(w) != null ? el('button', {onclick: async () => { closeSheet(); await doWorld({type: 'hide', band: b.id}); }}, `請${nm(Wd.canHide(w))}的村民藏人（人情 ${Wd.FAVOR.hide}）`) : null));
    const lock = () => {}; lock.locked = true; return openSheet(box, lock);
  }
  const camped = Wd.campInfo(w);
  const box = el('div', {}, el('h2', {}, b.kind === 'wolves' ? '狼群！' : camped ? `${b.name}摸上了營地` : `${b.name}擋住了去路`),
    el('p', {}, `${foeSummary(b.foes)}　`, el('span', {class: 'tag ' + cls}, '戰力' + lab)),
    camped ? el('p', {class: 'muted', style: 'font-size:13px'}, `在營地裡迎戰：營地格比較好守${camped.stake ? '，木柵只留缺口' : ''}${camped.watch ? '，哨兵讓他們只能從遠處衝過來' : ''}${camped.ready ? '，大家站穩了（防禦 +1）' : ''}。撤退的話照順序損失：貨、錢、營地、人。`) : null,
    el('p', {class: 'muted'}, b.kind === 'wolves' ? '牠們已經聞到你們的味道了。' : toll.escort ? '「商隊的貨留下，你們可以走。」' : toll.cargo ? '「騾子背上的東西留一半下來，人就可以走。」' : '「把錢留下，人就可以走。」'));
  const row = el('div', {class: 'rowbtn'},
    el('button', {class: 'primary', onclick: async () => { closeSheet(); await doWorld({type: 'engage', band: b.id}); }}, '迎戰'),
    el('button', {onclick: async () => { closeSheet(); await doWorld({type: 'evade', band: b.id}); }}, w.mules ? `試著避開（帶著騾子不好跑）` : '試著避開'));
  if (b.kind === 'bandits') row.append(el('button', {onclick: async () => { closeSheet(); await doWorld({type: 'pay', band: b.id}); }}, toll.escort ? '交出商隊的貨（護送失敗）' : toll.cargo ? '交出一半的貨' : `付過路費（${toll.gold}）`));
  if (b.kind === 'bandits') { const d = Wd.duelTarget(w), odds = Wd.duelOdds(w, b.foes);
    row.append(el('button', {disabled: d?.asked ? true : null, onclick: async () => { if (!confirm(`向${d.leader.name}下戰帖？\n一對一，只有主角上場。贏了他們散去；倒下就是認輸，照規矩交出過路費。\n他們${odds > 0.7 ? '多半會接' : odds > 0.4 ? '可能會接' : '多半不理你'}；不接的話會直接圍上來。`)) return; closeSheet(); await doWorld({type: 'duel'}); }}, d?.asked ? '下戰帖（被拒絕了）' : `向${d?.leader.name || '頭目'}下戰帖`)); }
  box.append(row);
  const lock = () => {}; lock.locked = true; openSheet(box, lock);
}

/* ───────────── 城鎮 ───────────── */
const fmtDays = d => d <= 0 ? '今天' : `${d} 天前`;
function intelLine(i) { const it = G.world.intel[i]; return el('div', {class: 'muted', style: 'font-size:13px'}, `${it.src === 'seen' ? '上次來' : '聽說'}（${fmtDays(G.world.day - it.day)}）：` + Wd.GOODS.map(g => `${Wd.GN[g]} ${it.p[g]}`).join('・')); }
function townSheet(tab = 'market') {
  const w = G.world, t = w.pos, k = C.K(), box = el('div', {});
  box.append(el('h2', {}, nm(t)), el('p', {class: 'muted', style: 'margin:-4px 0 4px'}, `${Wd.facName(k.owner[t])}的市鎮・人口約 ${Math.round(k.markets[t].pop * 10)}`));
  const tabs = el('div', {class: 'tabs'});
  for (const [key, n] of [['market', '市集'], ['smith', '鐵匠'], ['store', '倉庫'], ['tavern', '酒館'], ['board', '告示'], ['inn', '旅店']]) tabs.append(el('button', {class: key === tab ? 'on' : '', onclick: async () => townSheet(key)}, n));
  box.append(tabs);
  const n = w.party.length, again = () => townSheet(tab);
  if (tab === 'market') {
    const pr = Wd.rationPrice(w, t), eat = Math.ceil(Wd.eaters(w));
    box.append(el('h3', {}, '口糧'), el('p', {class: 'muted'}, `每份約 ${pr.toFixed(1)} 金幣。一天吃 ${eat} 份（騾子也要吃），現有 ${w.food.toFixed(0)} 份。`));
    box.append(el('div', {class: 'rowbtn'}, ...[3, 7, 14].map(d => el('button', {onclick: async () => { await doWorld({type: 'buyFood', n: eat * d}); again(); }}, `${d} 天份（${Math.ceil(eat * d * pr)}）`))));
    box.append(el('h3', {style: 'margin-top:10px'}, '貨物'), el('p', {class: 'muted'}, `載重 ${+Wd.load(w).toFixed(1)}/${Wd.capacity(w)} 包：每人扛 ${Wd.CARRY_MAN} 包、每頭騾子 ${Wd.MULE_CAP} 包。買得越多越貴、賣得越多越便宜；換季後行情會重新變動。`));
    box.append(goodsTable(t, again));
    box.append(el('div', {class: 'rowbtn'},
      el('button', {onclick: async () => { await doWorld({type: 'buyMule'}); again(); }}, `買騾子（${Wd.MULE_PRICE}）・有 ${w.mules} 頭`),
      el('button', {onclick: async () => { await doWorld({type: 'buyMap'}); again(); }}, `買附近的地圖（${Wd.MAP_PRICE}）`)));
    box.append(el('h3', {style: 'margin-top:10px'}, '馬'), el('p', {class: 'muted'}, `人人有馬才走得快（平地快三成五，林地山地快一成五），也比較甩得掉追兵。一匹馬一天吃 ${Wd.HORSE_FEED} 份糧。現在有 ${w.horses || 0} 匹，隊伍 ${n} 人${Wd.mounted(w) ? '，全員騎馬' : ''}。`));
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'buyHorse'}); again(); }}, `買馬（${Wd.HORSE_PRICE}）`),
      w.horses ? el('button', {onclick: async () => { await doWorld({type: 'sellHorse'}); again(); }}, `賣馬（${Math.round(Wd.HORSE_PRICE / 2)}）`) : null,
      w.mules ? el('button', {onclick: async () => { await doWorld({type: 'sellMule'}); again(); }}, `賣騾子（${Math.round(Wd.MULE_PRICE / 2)}）`) : null,
      w.cargo.food > 0 ? el('button', {onclick: async () => { await doWorld({type: 'eat'}); again(); }}, `拆一包糧當口糧`) : null));
    if (w.relics.length) {
      box.append(el('h3', {style: 'margin-top:10px'}, '寶物'));
      for (const r of w.relics) box.append(el('div', {class: 'card'}, el('div', {class: 'body'}, el('div', {class: 'top'}, el('b', {}, `「${r.name}」`), el('span', {class: 'muted'}, r.kind)),
        el('div', {class: 'muted', style: 'font-size:13px'}, `傳奇武器・換過 ${r.owners} 個主人・打贏過 ${r.wins} 場`),
        el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { if (confirm(`把「${r.name}」賣給${nm(t)}？`)) { await doWorld({type: 'sellRelic', id: r.id}); again(); } }}, `賣給這裡的權貴（${Wd.relicPrice(w, r)}）`)))));
    }
  }
  if (tab === 'smith') {
    const iron = Wd.stockBales(t, 'iron'), room = Wd.capacity(w) - Wd.load(w), S = Wd.smithInfo(t), qd = Wd.smithQueue(w, t);
    box.append(el('div', {class: 'card'}, el('div', {class: 'body'}, el('div', {class: 'top'}, el('b', {}, S.name), el('span', {class: 'tag ' + (S.skill >= 4 ? 'good' : S.skill <= 1 ? 'warn' : '')}, `${S.word}（手藝 ${S.skill}）`)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `現在下單要先排大約 ${qd < 1 ? '不到一天' : `${qd.toFixed(1)} 天`}。打好的東西會放進這座城的倉庫，可以自己回來拿，或派人來取。手藝越好，越常打出精良、名匠、大師級；手藝不夠的鐵匠改良不到高等級。`))));
    const mine = (w.orders || []).filter(o => o.town === t);
    if (mine.length) { box.append(el('h3', {}, '你在這裡的訂單')); for (const o of mine) box.append(el('div', {class: 'plan'}, el('b', {}, o.kind === 'make' ? `打一件${Wd.ITEMS[o.b].n}` : `改良${Wd.itemName(o.item)}`), el('span', {class: 'muted'}, `還要約 ${Math.max(0, Math.ceil((o.readyAt - Wd.worldHourOf(w)) / 24 * 10) / 10)} 天`))); }
    box.append(el('h3', {}, '訂做'));
    for (const b of Object.keys(Wd.ITEMS)) { const I = Wd.ITEMS[b]; if (I.rare) continue; const q = Wd.orderQuote(w, t, b, 'make'); const days = Math.ceil((q.queue * 24 + q.hours) / 24);
      box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, `${I.icon || ''}${I.n}`), el('span', {class: 'muted', style: 'flex:1'}, `${itemDesc({b, t: 0})}・約 ${days} 天${q.iron ? `・要 ${q.iron} 包鐵（自己帶比較便宜）` : ''}`),
        (() => { const noIron = q.iron && (w.cargo.iron || 0) + iron < q.iron; return el('button', {class: 'pin', disabled: q.cost > w.gold || noIron ? true : null, onclick: async () => { await doWorld({type: 'order', kind: 'make', b}); again(); }}, noIron ? '缺鐵' : `${q.cost}${q.iron && !(w.cargo.iron > 0) ? '＋鐵' : ''}`); })())); }
    box.append(el('p', {class: 'muted'}, `價錢跟著這座城的鐵價走；改良一級要用掉幾包鐵（鐵匠手上還有 ${iron} 包）。貨每週換一批。行囊還放得下 ${+room.toFixed(1)} 包。`));
    box.append(el('h3', {}, '買'));
    for (const o of Wd.smithStock(w, t)) { const it = {b: o.b, t: o.t}, p = Wd.itemPrice(w, t, it);
      box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, `${Wd.ITEMS[o.b].icon || ''}${Wd.itemName(it)}`), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it)),
        el('button', {class: 'pin', disabled: p > w.gold || room < Wd.itemWeight(it) ? true : null, onclick: async () => { await doWorld({type: 'buyItem', b: o.b, t: o.t}); again(); }}, `${p}`))); }
    if (w.pack?.length) { box.append(el('h3', {style: 'margin-top:10px'}, '賣（行囊裡的）'));
      for (const it of w.pack) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.itemName(it)), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it)),
        el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'sellItem', item: it.id}); again(); }}, `賣 ${Wd.sellPrice(w, t, it)}`))); }
    box.append(el('h3', {style: 'margin-top:10px'}, '改良（交給鐵匠，做好放進倉庫）'));
    const ups = [...w.party.flatMap(m => ['w', 'a', 's'].filter(sl => m.eq?.[sl]).map(sl => ({m, sl, it: m.eq[sl]}))), ...w.pack.filter(it => Wd.ITEMS[it.b].k !== 't').map(it => ({it}))];
    for (const u of ups) { const q = Wd.orderQuote(w, t, u.it.b, 'upgrade', u.it), can = (u.it.t || 0) < q.cap, days = Math.ceil((q.queue * 24 + q.hours) / 24);
      box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('span', {}, u.m ? `${u.m.name}：` : '行囊：', el('b', {}, Wd.itemName(u.it))), el('span', {class: 'muted', style: 'flex:1'}, can ? `→ ${Wd.itemName({b: u.it.b, t: (u.it.t || 0) + 1})}・約 ${days} 天・交出去之後要回來拿` : (u.it.t || 0) >= 3 ? '已經是最好的了' : '這位鐵匠的手藝改不到更好'),
        can ? el('button', {class: 'pin', disabled: q.cost > w.gold || (q.iron && (w.cargo.iron || 0) + iron < q.iron) ? true : null, onclick: async () => { if (!confirm(`把${Wd.itemName(u.it)}交給鐵匠改良？大約 ${days} 天後放進${nm(t)}的倉庫。`)) return; await doWorld({type: 'order', kind: 'upgrade', mid: u.m?.id, slot: u.sl, item: u.m ? null : u.it.id}); again(); }}, `${q.cost}`) : null)); }
  }
  if (tab === 'tavern') {
    const ts = Wd.townState(w, t);
    const fam = Wd.famousHere(w, t);
    if (fam.length) {
      box.append(el('h3', {}, '有名者'), el('p', {class: 'muted'}, `沙盒裡真實存在的人。雇了他，他就從原本的國家消失；他戰死，歷史會記下來。你的戰幫：${Wd.fameWord(w.fame || 0)}。`));
      for (const h of fam) { const o = Wd.famousOffer(w, h), need = h.legend ? 3 : h.famed ? 1 : 0;
        box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
          el('div', {class: 'top'}, el('b', {}, h.epithet ? `「${h.epithet}」${h.name}` : h.name), el('span', {class: 'muted'}, `${CLASSES[o.cls].name} Lv${o.lvl}`)),
          el('div', {class: 'muted', style: 'font-size:13px'}, `${Wd.facName(h.f)}的人・打過 ${h.battles || 0} 場、贏 ${h.wins} 場${h.famed ? '・事蹟傳遍各地' : ''}${o.relic ? `・帶著傳奇武器「${o.relic}」` : ''}・週薪 ${o.wage}`),
          el('div', {class: 'rowbtn'}, el('button', {class: 'primary', disabled: (w.fame || 0) < need || null, onclick: async () => { await doWorld({type: 'hireFamous', id: h.id}); again(); }}, (w.fame || 0) < need ? '他看不上你們（名聲不夠）' : `請他加入（${o.fee}）`)))));
      }
    }
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'rumor'}); again(); }}, '請一輪酒，打聽各地行情（3）')));
    box.append(el('p', {class: 'muted'}, `招募要先付兩週薪水當安家費。隊伍最多 ${Wd.MAX_PARTY} 人（現在 ${n} 人）。新面孔${dayText(ts.nextRecruit)}會來。`));
    if (!ts.recruits.length) box.append(el('p', {}, '今天酒館裡沒有想找差事的人。'));
    for (const r of ts.recruits) box.append(memberCard(r, el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: async () => { await doWorld({type: 'hire', id: r.id}); again(); }}, `雇用（${Wd.hireFee(w, r)}）`))));
  }
  if (tab === 'board') {
    const claim = w.contracts.filter(c => Wd.canClaimHere(w, c));
    if (claim.length) box.append(el('button', {class: 'primary', onclick: async () => { await doWorld({type: 'claim'}); again(); }}, `領賞（${claim.reduce((s, c) => s + c.reward, 0)}）`));
    box.append(contractList(t));
  }
  if (tab === 'store') {
    const st = Wd.storeAt(w, t), room = Wd.capacity(w) - Wd.load(w);
    box.append(el('p', {class: 'muted'}, `${nm(t)}的倉庫：東西放著不會壞也不會被偷，鐵匠做好的東西也送到這裡。行囊還放得下 ${+room.toFixed(1)} 包。`));
    box.append(el('h3', {}, '倉庫裡的'));
    const has = Object.entries(st.goods).filter(([, n]) => n > 0);
    if (!has.length && !st.items.length) box.append(el('p', {class: 'muted'}, '空的。'));
    for (const [g, n] of has) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.GN[g]), el('span', {style: 'flex:1'}, `${n} 包`), el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'storeTake', g, q: n}); again(); }}, '全拿')));
    for (const it of st.items) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, `${Wd.ITEMS[it.b].icon || ''}${Wd.itemName(it)}`), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it)), el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'storeTake', item: it.id}); again(); }}, '拿')));
    box.append(el('h3', {style: 'margin-top:10px'}, '存進去'));
    const cg = Wd.TRADE.filter(g => w.cargo[g] > 0);
    for (const g of cg) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.GN[g]), el('span', {style: 'flex:1'}, `身上 ${w.cargo[g]} 包`), el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'storePut', g, q: w.cargo[g]}); again(); }}, '全存')));
    for (const it of w.pack) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.itemName(it)), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it)), el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'storePut', item: it.id}); again(); }}, '存')));
    if (!cg.length && !w.pack.length) box.append(el('p', {class: 'muted'}, '身上沒有貨或備用的裝備。'));
  }
  if (tab === 'inn') {
    box.append(el('p', {}, `每人每晚 2 金幣，一天能養好一半的傷，大家的心情也會好一點。`));
    box.append(el('div', {class: 'rowbtn'}, ...[1, 3].map(d => el('button', {onclick: async () => { await doWorld({type: 'rest', days: d}); again(); }}, `住 ${d} 晚（${n * 2 * d}）`))));
    box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'rest', days: 1, inn: false}); again(); }}, '在城外紮營一天（免費）')));
    const pay = Math.round(n * (2.5 + Math.min(3, k.markets[t].pop / 200)));
    box.append(el('h3', {style: 'margin-top:10px'}, '打零工'), el('p', {class: 'muted'}, `碼頭搬貨、倉庫理貨、幫忙收成。全隊一天大約能賺 ${pay} 金幣（城越大工越多），伙食自理，同伴拿到工錢心情會好一點。`),
      el('div', {class: 'rowbtn'}, ...[1, 3].map(d => el('button', {onclick: async () => { await doWorld({type: 'work', days: d}); again(); }}, `做 ${d} 天（約 ${pay * d}）`))));
    box.append(el('h3', {style: 'margin-top:10px'}, '紮營工具'), el('p', {class: 'muted'}, `斧頭、繩索、帳篷。營地紮穩只要 6 小時（平常 12），木柵少用一包木材、砍樹快一倍。${w.kit ? '你們已經有一套了。' : ''}`));
    if (!w.kit) box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'buyKit'}); again(); }}, `買一套（${Wd.KIT_PRICE}）`)));
    const f = k.owner[t];
    box.append(el('h3', {style: 'margin-top:10px'}, '旗子'), el('p', {class: 'muted'}, `掛上${Wd.facName(f)}的旗：在這國招人便宜兩成、替它打仗的賞金多兩成五；但在跟它交戰的國家境內，巡邏隊會追著你們打，別的戰幫打你們也不算犯法。${Wd.atWarWith(f).length ? `（${Wd.facName(f)}正與${Wd.atWarWith(f).join('、')}交戰）` : ''}`));
    box.append(el('div', {class: 'rowbtn'}, w.banner === f ? el('button', {disabled: true}, `已經掛著${Wd.facName(f)}的旗`) : el('button', {onclick: async () => { await doWorld({type: 'banner', fac: f}); again(); }}, `掛上${Wd.facName(f)}的旗`),
      w.banner != null ? el('button', {onclick: async () => { await doWorld({type: 'banner', fac: null}); again(); }}, '收起旗子（中立）') : null));
  }
  if (tab === 'tavern' && w.captives?.length) {
    box.append(el('h3', {style: 'margin-top:10px'}, '被抓走的人'), el('p', {class: 'muted'}, '酒館裡有人能幫你們傳話、付贖金。'));
    w.captives.forEach((c, i) => box.append(el('div', {class: 'rowbtn'}, el('span', {style: 'flex:2;align-self:center'}, `${c.m.name}（${dayText(c.day)}被${c.by}抓走）`), el('button', {onclick: async () => { await doWorld({type: 'ransom', i}); again(); }}, `贖回（${c.price}）`))));
  }
  openSheet(box, null, true);
}
function goodsTable(t, again) {
  const w = G.world, wrap = el('div', {class: 'goods'});
  const prod = Wd.producers(t);
  wrap.append(el('div', {class: 'muted', style: 'font-size:13px'}, prod.length ? `這裡的特產：${prod.map(g => Wd.GN[g]).join('、')}。特產只有產地買得到，離產地越遠賣得越貴；沙盒的商隊不跑這些。` : '這裡沒有特產可買；特產只在產地買得到，但這裡收。'));
  for (const g of Wd.TRADE) {
    if (Wd.SPEC[g] && !prod.includes(g) && !w.cargo[g]) { wrap.append(el('div', {class: 'goodrow spec'}, el('div', {class: 'gname'}, el('b', {}, Wd.GN[g]), el('span', {class: 'muted'}, '不產・只收')), el('div', {class: 'gprice'}, el('span', {}, '賣 ', el('b', {}, Wd.quote(w, t, g, 'sell', 1)))))); continue; }
    const stock = Wd.stockBales(t, g, w), have = w.cargo[g] || 0, room = Wd.capacity(w) - Wd.load(w);
    const b1 = stock > 0 ? Wd.quote(w, t, g, 'buy', 1) : null, s1 = Wd.quote(w, t, g, 'sell', 1);
    const bq = Math.min(5, stock, room), sq = have;
    wrap.append(el('div', {class: 'goodrow'},
      el('div', {class: 'gname'}, el('b', {}, Wd.GN[g]), el('span', {class: 'muted'}, `存貨 ${stock > 999 ? '999+' : stock}・你有 ${have}`)),
      el('div', {class: 'gprice'}, el('span', {}, '買 ', el('b', {}, b1 ?? '—')), el('span', {}, '賣 ', el('b', {}, s1))),
      el('div', {class: 'gbtn'},
        el('button', {disabled: !(bq >= 1) || null, onclick: async () => { await doWorld({type: 'buy', g, q: 1}); again(); }}, '買 1'),
        el('button', {disabled: !(bq >= 2) || null, onclick: async () => { await doWorld({type: 'buy', g, q: bq}); again(); }}, bq >= 2 ? `買 ${bq}（${Wd.quote(w, t, g, 'buy', bq)}）` : '買 5'),
        el('button', {disabled: !have || null, onclick: async () => { await doWorld({type: 'sell', g, q: 1}); again(); }}, '賣 1'),
        el('button', {disabled: !(sq >= 2) || null, onclick: async () => { await doWorld({type: 'sell', g, q: sq}); again(); }}, sq >= 2 ? `全賣（${Wd.quote(w, t, g, 'sell', sq)}）` : '全賣'))));
  }
  return wrap;
}
function contractList(t, pins) {
  const w = G.world, box = el('div', {}), k = C.K();
  const list = w.contracts.filter(c => t == null ? (c.taken || c.kind === 'deliver') : (c.town === t || c.taken || (c.kind === 'deliver' && Wd.hdist(c.at, t) <= 8)));
  if (!list.length) box.append(el('p', {class: 'muted'}, t == null ? '手上沒有委託。在城鎮的告示板接委託、領賞。' : '告示板上沒有委託。'));
  for (const c of list) {
    const site = Wd.contractSite(w, c), dist = site >= 0 ? Wd.hdist(site, w.pos) : -1;
    let info = '', status = c.done ? (Wd.canClaimHere(w, c) ? '完成，可以領賞' : '完成，待領賞') : c.taken ? '進行中' : c.kind === 'deliver' ? `每包 ${c.pay}` : c.kind === 'letter' ? `酬勞 ${c.reward}` : `賞金 ${c.reward}`;
    if (c.kind === 'gang') info = site >= 0 ? `山寨在${nm(site)}（離你 ${dist} 格）` : c.done ? '' : '山寨已經不在了';
    if (c.kind === 'escort') info = `貨：${Wd.GN[c.g]} ${c.q} 包。送到${nm(c.to)}（離你 ${dist} 格），到了當場付錢。帶著商隊更容易被盜匪盯上；付過路費或撤退，貨就沒了。`;
    if (c.kind === 'deliver') info = `把${Wd.GN[c.g]}送到${nm(c.at)}（離你 ${dist} 格）的官倉，還收 ${c.left} 包。不用接，到了在告示板交貨。`;
    if (c.kind === 'merc') info = `${c.desc}目標：${nm(c.target)}（離你 ${dist} 格）。`;
    if (c.kind === 'wolves') info = `狼窩在${nm(c.target)}（離你 ${dist} 格）。`;
    if (c.kind === 'letter') info = `送到${nm(c.to)}（離你 ${dist} 格），到了當場付錢。${c.secret ? '密信：收下之後會有人來截，被搶走就失敗。' : '一封信，不佔載重。'}`;
    const btns = el('div', {class: 'rowbtn'});
    if (!c.taken && t != null && c.kind !== 'deliver') btns.append(el('button', {onclick: async () => { await doWorld({type: 'takeContract', id: c.id}); townSheet('board'); }}, c.kind === 'escort' ? '接下，帶商隊出發' : '接下'));
    if (c.kind === 'deliver' && c.at === w.pos && w.cargo[c.g] > 0) btns.append(el('button', {class: 'primary', onclick: async () => { await doWorld({type: 'deliver', id: c.id}); townSheet('board'); }}, `交貨（${Math.min(c.left, w.cargo[c.g])} 包，${Math.min(c.left, w.cargo[c.g]) * c.pay}）`));
    if (site >= 0 && site !== w.pos) btns.append(el('button', {onclick: async () => { closeSheet(); if (!wide()) setRail('r', false); showOnMap(site); }}, '在地圖上看'));
    if (pins) btns.append(pinBtn(`${Wd.KIND_NAME[c.kind]}「${c.title}」${info ? '：' + info.split('。')[0] : ''}・期限${dayText(c.until)}`, site >= 0 ? site : c.town, `委託`));
    if (c.done && !Wd.canClaimHere(w, c)) btns.append(el('button', {class: 'primary', onclick: async () => { closeSheet(); showOnMap(c.town); }}, `回${nm(c.town)}領賞（${Wd.hdist(c.town, w.pos)} 格）`));
    box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, el('span', {class: 'tag'}, Wd.KIND_NAME[c.kind]), ' ', c.title), el('span', {class: 'tag ' + (c.done ? 'good' : c.taken ? 'warn' : '')}, status)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `${nm(c.town)}的告示（${Wd.facName(k.owner[c.town]) || '已亡國'}）・${info ? info + '・' : ''}期限${dayText(c.until)}${c.kind !== 'deliver' ? `・賞金 ${c.reward}` : ''}`),
      btns)));
  }
  if (t == null && w.leads?.length) {
    box.append(el('h3', {style: 'margin-top:12px'}, '傳聞'));
    for (const L of w.leads) box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
      el('div', {class: 'top'}, el('b', {}, `「${L.name}」的下落`), el('span', {class: 'muted'}, `${dayText(L.day)}聽說`)),
      el('div', {class: 'muted', style: 'font-size:13px'}, `據說在${nm(L.center)}一帶（離你 ${Wd.hdist(L.center, w.pos)} 格）。到那一帶（含周圍一格）每找一次花一天${L.searched?.length ? `；已經找過：${L.searched.map(nm).join('、')}` : ''}。`),
      el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { closeSheet(); if (!wide()) setRail('r', false); showOnMap(L.center); }}, '在地圖上看'), pins ? pinBtn(`傳聞「${L.name}」在這一帶`, L.center, `第${L.day}天`) : null,
        Wd.hdist(L.center, w.pos) <= 1 ? el('button', {class: 'primary', onclick: async () => { closeSheet(); await doWorld({type: 'search', id: L.id}); }}, `在${nm(w.pos)}搜尋一天`) : null))));
  }
  return box;
}
function showOnMap(i) { const [x, y] = wxy(i); cam.x = x; cam.y = y; selectHex(i); }
function gatherSheet() {
  const w = G.world, k = C.K(), owned = k.owner[w.pos] >= 0;
  const box = el('div', {}, el('h2', {}, `在${nm(w.pos)}採集`), el('p', {class: 'muted'}, `${owned ? `這是${Wd.facName(k.owner[w.pos])}的地：在這裡採算盜伐、盜獵，被巡守撞見會被記上一筆、東西被沒收一半。` : '無主之地，沒人管。'}採到的貨受載重限制（${Wd.load(w)}/${Wd.capacity(w)}）。`));
  for (const o of Wd.gatherOptions(w)) box.append(el('div', {class: 'card'}, el('div', {class: 'body'},
    el('div', {class: 'top'}, el('b', {}, `${o.icon} ${o.n}`), el('span', {class: 'muted'}, `${o.hours} 小時・${o.est}`)), el('div', {class: 'muted', style: 'font-size:13px'}, o.d),
    el('div', {class: 'rowbtn'}, el('button', {class: 'primary', disabled: o.ok ? null : true, onclick: async () => { closeSheet(); await doWorld({type: 'gather', kind: o.key}); }}, o.ok ? o.n : o.why)))));
  openSheet(box);
}
function villageSheet(v) {
  const w = G.world, eat = Math.ceil(w.party.length + w.mules * Wd.MULE_FEED), pr = Wd.rationPrice(w, v), have = Wd.villageFood(w, v);
  const box = el('div', {}, el('h2', {}, nm(v)), el('p', {}, `村裡能匀出 ${have} 份口糧，每份約 ${pr.toFixed(1)} 金幣，比城裡便宜。`),
    el('div', {class: 'rowbtn'}, ...[1, 3, 7].map(d => el('button', {disabled: !have || null, onclick: async () => { await doWorld({type: 'buyFood', n: Math.min(eat * d, have)}); villageSheet(v); }}, `${d} 天份`))),
    el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'rest', days: 1}); closeSheet(); }}, '在村邊紮營一天')));
  const fav = Wd.favorAt(w, v), again = () => villageSheet(v);
  box.append(el('h3', {style: 'margin-top:12px'}, '人情'), el('p', {class: 'muted', style: 'font-size:13px'}, `${nm(Wd.regionOf(v))}一帶欠你們的人情：${fav.toFixed(1)}。幫這一帶的人做事會累積，放著會慢慢淡掉。`),
    el('div', {class: 'rowbtn'},
      el('button', {disabled: fav < Wd.FAVOR.lodge ? true : null, onclick: async () => { await doWorld({type: 'lodge'}); again(); }}, Wd.hidden(w) ? `再借宿一晚（人情 ${Wd.FAVOR.lodge}）` : `借宿・藏起來（人情 ${Wd.FAVOR.lodge}）`),
      el('button', {disabled: fav < Wd.FAVOR.ask ? true : null, onclick: async () => { await doWorld({type: 'askLocal'}); again(); }}, `打聽附近的消息（人情 ${Wd.FAVOR.ask}）`)),
    el('p', {class: 'muted', style: 'font-size:12px'}, `借宿就是藏在村民家：巡邏隊、盜匪${NET.on ? '、別的戰幫' : ''}都找不到你們${NET.on ? '，地圖上也看不到；下線時村民會照顧你們（不吃自己的糧、不會被夜襲）' : ''}。照世界的時間用掉人情，藏第一天約 1 點、第二天 2 點……越藏越貴${Math.max(0, ...Object.values(w.wanted || {})) >= 1 ? '；你們被通緝，村民要的更多' : ''}。一離開村子就不算了。`));
  const gift = el('div', {class: 'rowbtn'}), give = async (what, q) => { await doWorld({type: 'give', what, q}); again(); };
  for (const q of [10, 30]) if (w.food >= q) gift.append(el('button', {onclick: () => give('ration', q)}, `口糧 ${q} 份`));
  for (const q of [20, 50]) if (w.gold >= q) gift.append(el('button', {onclick: () => give('gold', q)}, `${q} 金幣`));
  for (const g of Wd.TRADE) if (w.cargo[g] > 0) gift.append(el('button', {onclick: () => give(g, w.cargo[g])}, `${Wd.GN[g]} ${w.cargo[g]} 包`));
  const need = Wd.foodNeed(v);
  box.append(el('h3', {style: 'margin-top:12px'}, '接濟村民'), el('p', {class: 'muted', style: 'font-size:13px'}, `把東西分給村民換人情。${need > 1.3 ? '這一帶正缺糧，送糧特別受感激。' : ''}這一帶欠你們越多，再送換到的越少。`), gift.childElementCount ? gift : el('p', {class: 'muted'}, '身上沒什麼可以分的。'));
  const pleas = Wd.villagePleas(w, v), done = w.contracts.filter(c => c.vill === v && c.done);
  box.append(el('h3', {style: 'margin-top:12px'}, '村民的請託'));
  if (done.length) box.append(el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: async () => { await doWorld({type: 'thankPlea'}); again(); }}, `交差：${done.map(c => Wd.PLEA_NAME[c.kind] || c.kind).join('、')}`)));
  const open = pleas.filter(c => !c.done);
  if (!open.length && !done.length) box.append(el('p', {class: 'muted'}, '村裡最近沒什麼事要麻煩外人。'));
  for (const c of open) box.append(el('div', {class: 'card'}, el('div', {class: 'body'}, el('div', {class: 'top'}, el('span', {class: 'tag warn'}, Wd.PLEA_NAME[c.kind]), ' ', el('b', {}, c.title)),
    el('div', {class: 'muted', style: 'font-size:13px'}, `謝禮 ${c.reward} 金幣・人情 ${c.favor}・${c.until - w.day} 天內`),
    c.taken ? el('div', {class: 'muted'}, '已經答應了。') : el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'takePlea', id: c.id}); again(); }}, '答應')))));
  openSheet(box, null, true);
}
// 行情表：去過或聽說過的市集
function intelTable(ids, goods, pins) {
  const w = G.world, lo = {}, hi = {};
  for (const g of goods) { const v = ids.map(i => w.intel[i].p[g]).filter(x => x != null); lo[g] = Math.min(...v); hi[g] = Math.max(...v); }
  const tb = el('table', {class: 'intel'}, el('tr', {}, el('th', {}, '市集'), ...goods.map(g => el('th', {}, Wd.GN[g])), pins ? el('th', {}, '') : null));
  for (const i of ids) {
    const it = w.intel[i];
    tb.append(el('tr', {onclick: () => { closeSheet(); if (!wide()) setRail('r', false); showOnMap(i); }}, el('td', {}, el('b', {}, nm(i)), el('div', {class: 'muted'}, `${Wd.hdist(i, w.pos)} 格・${fmtDays(w.day - it.day)}${it.src === 'seen' ? '' : '・聽說'}`)),
      ...goods.map(g => { const p = it.p[g]; if (p == null) return el('td', {class: 'none'}, '?'); const none = it.s && it.s[g] === 0; return el('td', {class: none ? 'none' : p === lo[g] ? 'lo' : p === hi[g] ? 'hi' : ''}, none ? `${p}*` : p); }),
      pins ? el('td', {}, pinBtn(goods.map(g => `${Wd.GN[g]}${it.p[g] ?? '?'}`).join(' '), i, `第${it.day}天的行情`)) : null));
  }
  return tb;
}
function partySheet() {
  const w = G.world, due = w.party.filter(m => !m.hero).reduce((s, m) => s + m.wage, 0);
  const box = el('div', {}, el('h2', {}, `隊伍（${w.party.length}/${Wd.MAX_PARTY}）`),
    el('p', {class: 'muted'}, `下次發餉：${dayText(w.nextWage)}，共 ${due} 金幣。騾子 ${w.mules} 頭。`),
    el('p', {}, `身上的貨：${Wd.TRADE.filter(g => w.cargo[g]).map(g => `${Wd.GN[g]} ${w.cargo[g]} 包`).join('、') || '沒有'}（${Wd.load(w)}/${Wd.capacity(w)}）`));
  const wl = Object.entries(w.wanted || {}).filter(([, v]) => v >= 0.5);
  if (wl.length) box.append(el('p', {}, el('span', {class: 'tag bad'}, '通緝'), ' ', wl.map(([f, v]) => `${Wd.facName(+f)}（${v >= 3 ? '重犯' : v >= 2 ? '巡邏隊會抓人' : '小心'}）`).join('、')));
  box.append(el('p', {class: 'muted'}, `名聲：${Wd.fameWord(w.fame || 0)}。馬 ${w.horses || 0} 匹${Wd.mounted(w) ? '（全員騎馬）' : ''}。${w.kit ? '有一套紮營工具。' : ''}旗子：${w.banner != null ? Wd.facName(w.banner) : '中立'}。`));
  const fl = Wd.favorList(w); if (fl.length) box.append(el('p', {}, el('span', {class: 'tag good'}, '人情'), ' ', fl.map(x => `${nm(x.r)}一帶 ${x.v.toFixed(1)}`).join('、')));
  for (const r of w.relics) { const who = w.party.find(m => m.id === r.equip);
    box.append(el('div', {class: 'rowbtn'}, el('span', {style: 'flex:2;align-self:center'}, `「${r.name}」${r.kind}：${who ? who.name + '佩帶（力量 +2）' : '收在行囊裡'}`), el('button', {onclick: async () => { await doWorld({type: 'equipRelic', id: r.id}); partySheet(); }}, who ? '換人' : '交給人佩帶'))); }
  for (const m of w.party) box.append(memberCard(m, m.hero ? null : dismissRow(m)));
  if (w.fallen.length) { box.append(el('h3', {style: 'margin-top:12px'}, '倒下的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・${dayText(f.day)}・${f.how}`)); }
  box.append(el('div', {class: 'rowbtn', style: 'margin-top:16px'}, el('button', {class: 'danger', onclick: async () => {
    if (prompt(`解散${NET.on ? '戰幫' : '這趟旅程'}，刪掉這個角色，回到標題重新建立。救不回來。\n確定的話請輸入「解散」`) !== '解散') return;
    if (NET.on) { try { await api('/api/me/delete', {what: 'char'}); } catch (e) { return toast(e.message); } NET.on = false; Wd.MODE.shared = false; } else wipe();
    closeSheet(); G = {world: null, battle: null}; titleScreen();
  }}, NET.on ? '解散戰幫（刪除角色）' : '放棄這趟旅程')));
  openSheet(box);
}
const dismissRow = m => el('div', {class: 'rowbtn'}, el('button', {class: 'danger', onclick: async () => { if (confirm(`讓${m.name}離開隊伍？`)) { await doWorld({type: 'dismiss', id: m.id}); closeSheet(); } }}, '遣散'));
function cargoSheet() {
  const w = G.world, box = el('div', {}, el('h2', {}, '行囊'), el('p', {class: 'muted'}, `載重 ${+Wd.load(w).toFixed(1)}/${Wd.capacity(w)} 包：每人扛 ${Wd.CARRY_MAN} 包、每頭騾子 ${Wd.MULE_CAP} 包。口糧 ${w.food.toFixed(0)} 份，一天吃 ${Wd.eaters(w).toFixed(1)} 份（騾子、馬也要吃），夠 ${Wd.daysOfFood(w).toFixed(1)} 天。`));
  const goods = Wd.TRADE.filter(g => w.cargo[g]);
  if (!goods.length) box.append(el('p', {}, '身上沒有貨。'));
  for (const g of goods) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, Wd.GN[g]), el('span', {}, `${w.cargo[g]} 包`), el('span', {class: 'muted', style: 'flex:1'}, `一包約值 ${Math.round(Wd.unitValue(g))}`),
    el('button', {class: 'pin', onclick: async () => { await doWorld({type: 'drop', g, q: 1}); cargoSheet(); }}, '丟 1'), el('button', {class: 'pin', onclick: async () => { if (confirm(`把${Wd.GN[g]} ${w.cargo[g]} 包全丟在這裡？丟下的貨會留在地上，誰經過都能撿。`)) { await doWorld({type: 'drop', g, q: w.cargo[g]}); cargoSheet(); } }}, '全丟')));
  if (w.pack?.length) { box.append(el('h3', {style: 'margin-top:10px'}, `備用的裝備（${Wd.packWeight(w)} 包）`));
    for (const it of w.pack) box.append(el('div', {class: 'plan', style: 'align-items:center'}, el('b', {}, `${Wd.ITEMS[it.b].icon || ''}${Wd.itemName(it)}`), el('span', {class: 'muted', style: 'flex:1'}, itemDesc(it)),
      el('button', {class: 'pin', onclick: async () => { if (confirm(`把${Wd.itemName(it)}丟在這裡？`)) { await doWorld({type: 'dropItem', item: it.id}); cargoSheet(); } }}, '丟'))); }
  if (Wd.loadMul(w) > 1) box.append(el('p', {style: 'font-size:13px;color:#f1cf8a'}, `貨太重了：每格多花 ${Math.round((Wd.loadMul(w) - 1) * 100)}% 的時間（裝到七成五以上就開始變慢）。`));
  box.append(el('p', {class: 'muted', style: 'margin-top:8px'}, `騾子 ${w.mules} 頭・馬 ${w.horses || 0} 匹${Wd.mounted(w) ? '（全員騎馬，走得快）' : ''}。${w.kit ? '有紮營工具。' : ''}`));
  if (w.cargo.food > 0) box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: async () => { await doWorld({type: 'eat'}); cargoSheet(); }}, '拆一包糧當口糧')));
  openSheet(box);
}

/* ───────────── 此地：地圖中央的紅色圓鈕，和所在這格互動的入口 ───────────── */
let campOpen = false, hubOpen = false;
const hubClick = () => { if (traveling) return; if (campOpen) { campOpen = false; hubOpen = false; } else hubOpen = !hubOpen; if (hubOpen && wsel) { wsel = null; renderWorld(); } renderCamp(); hexInfo(); };
$('btnCamp').onclick = hubClick;
const closeHub = () => { hubOpen = false; renderHub(); };
const UNIT_ICON = {caravan: '🐫', cart: '🛒', patrol: '🛡', army: '⚑'};
// 追丟了：剛剛還在視野裡的戰幫忽然從名單上消失（躲起來了）
function lostTrack(before, after) {
  const w = G.world; if (!w || !NET.on) return; const now = new Set(after.map(o => o.id));
  for (const o of before) if (o.id !== NET.me && !now.has(o.id) && Wd.hdist(o.pos, w.pos) <= Wd.viewRadius(w) && Wd.seen(w, o.pos)) toast(`${o.name}的戰幫在${nm(o.pos)}一帶不見了蹤影。`, 3500);
}
// 這格上的人：盜匪、路過的車隊、巡邏隊、別人的戰幫
function hereFolks() {
  const w = G.world, out = [], b = Wd.bandAt(w, w.pos);
  if (b) out.push({icon: b.kind === 'wolves' ? '🐺' : '⚔', label: b.name, fn: () => encounterSheet(b), cls: 'danger'});
  for (const u of Wd.unitsInView(w).filter(u => u.pos === w.pos && u.kind !== 'army')) out.push({icon: UNIT_ICON[u.kind], label: u.label, fn: () => unitSheet(u)});
  if (NET.on) for (const o of NET.others.filter(o => o.pos === w.pos && o.id !== NET.me && !(o.detach && o.id.startsWith(NET.me + '#')))) out.push({icon: '🚩', label: o.detach ? o.name : `${o.name}的戰幫`, face: o.face, fn: () => playerSheet(o)});
  return out;
}
// 這格能做的事
function hereDoes() {
  const w = G.world, p = w.pos, out = [], site = Wd.siteAt(w, p), poi = Wd.poiAt(w, p), add = (icon, label, fn, cls) => out.push({icon, label, fn, cls});
  if (site?.kind === 'town') add('🏰', '進城', () => townSheet(), 'primary');
  if (site?.kind === 'village') add('🏘', '進村', () => villageSheet(p), 'primary');
  if (site?.kind === 'camp') add('⚔', '進攻山寨', async () => { if (confirm('進攻山寨？')) await doWorld({type: 'assault'}); }, 'danger');
  if (site?.kind === 'camp') { const d = Wd.duelTarget(w); if (d?.gang && !d.asked) add('🤺', `向頭目${d.gang.name}下戰帖`, async () => { if (confirm(`向頭目${d.gang.name}下戰帖？\n一對一，只有主角上場。贏了山寨就散了（搜到的東西少一些），還能把頭目綁走；倒下就是認輸。\n沒什麼名聲的話，他多半不理你。`)) await doWorld({type: 'duel'}); }); }
  if (site?.kind === 'town' && w.bound) add('⛓', `把${w.bound.name}交給官府`, () => doWorld({type: 'handOver'}), 'primary');
  if (site && site.kind !== 'camp' && Wd.favorAt(w, p) >= Wd.FAVOR.ask) add('👂', `打聽附近的消息（人情 ${Wd.FAVOR.ask}）`, () => doWorld({type: 'askLocal'}));
  if (poi && !Wd.poiDone(w, poi)) add('🔍', `探索${Wd.POI_TYPES[poi.type].n}（半天）`, () => doWorld({type: 'explore'}));
  if (Wd.cachesAt(w, p).length) add('📦', '撿起地上的貨（2 小時）', () => doWorld({type: 'pick'}));
  if (poi && Wd.HIDE_POI.has(poi.type) && w.den !== p) add('🕳', `躲進${Wd.POI_TYPES[poi.type].n}`, () => doWorld({type: 'hideIn'}));
  if (NET.on && site?.kind !== 'town') add('🔎', '搜索這一格（半天）', () => doWorld({type: 'searchTile'}));
  if (Wd.gatherOptions(w).length) add('🪓', '採集…', () => gatherSheet());
  for (const L of w.leads || []) if (Wd.hdist(L.center, p) <= 1) add('🗺', `搜尋「${L.name}」（一天）`, () => doWorld({type: 'search', id: L.id}));
  if (NET.on && w.party.some(m => !m.hero)) add('🏇', '派人出去辦事…', () => detachSheet());
  for (const d of w.detach || []) if (d.pos === p) add('↩', `把${d.name}叫回來`, () => doWorld({type: 'recall', id: d.id}));
  const ci = Wd.campInfo(w);
  add(site?.kind === 'town' ? '🛏' : '⛺', site?.kind === 'town' ? '過夜…' : ci ? '營地…' : '紮營…', () => { hubOpen = false; campOpen = true; renderCamp(); hexInfo(); });
  return out;
}
function hubIcon() { const w = G.world, s = Wd.siteAt(w, w.pos); return Wd.campInfo(w) ? '⛺' : s?.kind === 'town' ? '🏰' : s?.kind === 'village' ? '🏘' : '🔥'; }
function renderHub() {
  const w = G.world, box = $('hubStack'); if (!w) return;
  if (w.captive) { hubOpen = false; box.classList.remove('open'); $('btnCamp').textContent = '⛓'; $('btnCamp').onclick = captiveSheet; return; }
  $('btnCamp').onclick = hubClick;
  const btn = $('btnCamp'), n = hereFolks().length; btn.textContent = campOpen ? '✕' : hubIcon(); btn.dataset.n = n && !campOpen ? n : '';
  box.innerHTML = ''; box.classList.toggle('open', hubOpen && !traveling);
  if (!hubOpen || traveling) return;
  const item = (it) => el('button', {class: it.cls || '', onclick: async () => { if (it.cls !== 'keep') hubOpen = false; renderHub(); await it.fn(); }}, it.face != null && FACES?.faces[it.face] ? faceEl(it.face, 22) : el('span', {class: 'hi'}, it.icon), el('span', {}, it.label));
  const folks = hereFolks();
  if (folks.length) { const sec = el('div', {class: 'hsec'}, el('div', {class: 'hlab'}, '這裡的人')); for (const it of folks) sec.append(item(it)); box.append(sec); }
  const sec = el('div', {class: 'hsec'}, el('div', {class: 'hlab'}, nm(w.pos))); for (const it of hereDoes()) sec.append(item(it)); box.append(sec);
}
document.addEventListener('pointerdown', e => { if (hubOpen && !e.target.closest('#hubStack') && !e.target.closest('#btnCamp')) closeHub(); });
// 派人出去：挑人、交代差事、給錢糧和貨。他們是另一支小戰幫，照世界的時間走，辦完回來找你
function detachSheet(pre = {}) {
  const w = G.world, k = C.K(), st = {ids: new Set(pre.ids || []), task: pre.task || 'intel', target: pre.target ?? null, gold: 0, food: 0, g: 'iron', q: 5, mules: 0, horses: 0, cargo: {}};
  const towns = Object.keys(k.markets).map(Number).filter(t => Wd.isTown(t, k) && Wd.seen(w, t) && t !== w.pos).sort((a, b) => Wd.hdist(a, w.pos) - Wd.hdist(b, w.pos)).slice(0, 16);
  const draw = () => {
    const box = el('div', {}, el('h2', {}, '派人出去辦事'), el('p', {class: 'muted', style: 'font-size:13px'}, `分出去的人是另一支小戰幫，照世界的時間走（不花你的行動點），路上可能被搶、受傷，貪財又不忠的人可能捲款跑掉。辦完會回來找你。最多同時派 ${Wd.MAX_DETACH} 支。`));
    if ((w.detach || []).length >= Wd.MAX_DETACH) box.append(el('p', {class: 'bad'}, '已經派出去兩支了，等他們回來。'));
    box.append(el('h3', {}, '派誰'));
    for (const m of w.party.filter(m => !m.hero)) { const c = el('input', {type: 'checkbox'}); c.checked = st.ids.has(m.id); c.onchange = () => { c.checked ? st.ids.add(m.id) : st.ids.delete(m.id); };
      box.append(el('label', {class: 'plan', style: 'align-items:center;gap:8px'}, c, portrait(m, 28), el('b', {}, m.name), el('span', {class: 'muted'}, `${clsName(m)} Lv${m.lvl}・忠誠 ${Math.round(m.loyalty)}${m.traits.includes('greedy') ? '・貪財' : ''}`))); }
    box.append(el('h3', {}, '差事'));
    const sel = el('select', {}); for (const [k2, n] of Object.entries(Wd.TASKS)) { const o = el('option', {value: k2}, n); if (k2 === st.task) o.selected = true; sel.append(o); } sel.onchange = () => { st.task = sel.value; draw(); };
    box.append(sel);
    const tsel = el('select', {});
    const opts = st.task === 'scout' ? [...(pre.scout != null ? [pre.scout] : []), ...towns] : st.task === 'pickup' ? Wd.storeList(w).map(x => x.t) : towns.concat(Wd.isTown(w.pos, k) && st.task === 'store' ? [] : []);
    if (st.target == null || !opts.includes(st.target)) st.target = opts[0] ?? null;
    for (const t of opts) { const o = el('option', {value: t}, `${nm(t)}（${Wd.hdist(t, w.pos)} 格）`); if (t === st.target) o.selected = true; tsel.append(o); }
    tsel.onchange = () => { st.target = +tsel.value; };
    box.append(el('div', {style: 'margin:6px 0'}, '去：', opts.length ? tsel : el('span', {class: 'muted'}, st.task === 'pickup' ? '你在各城的倉庫都是空的。' : '還不知道其他城在哪裡。')));
    if (st.task === 'buy') { const gs = el('select', {}); for (const g of Wd.TRADE) { const o = el('option', {value: g}, Wd.GN[g]); if (g === st.g) o.selected = true; gs.append(o); } gs.onchange = () => { st.g = gs.value; };
      const qi = el('input', {type: 'number', min: 1, value: st.q, style: 'width:70px'}); qi.oninput = () => { st.q = +qi.value; }; box.append(el('div', {}, '買：', gs, ' ', qi, ' 包（錢不夠就少買）')); }
    const num = (lab, key, max) => { const i = el('input', {type: 'number', min: 0, max, value: st[key], style: 'width:80px'}); i.oninput = () => { st[key] = +i.value; }; return el('label', {style: 'margin-right:10px'}, `${lab} `, i, el('small', {class: 'muted'}, ` /${max}`)); };
    box.append(el('h3', {}, '帶什麼'), el('div', {}, num('金幣', 'gold', w.gold), num('口糧', 'food', Math.floor(w.food)), num('騾子', 'mules', w.mules), num('馬', 'horses', w.horses || 0)));
    if (st.task === 'sell' || st.task === 'store') for (const g of Wd.TRADE.filter(g => w.cargo[g] > 0)) { const i = el('input', {type: 'number', min: 0, max: w.cargo[g], value: st.cargo[g] || 0, style: 'width:70px'}); i.oninput = () => { st.cargo[g] = +i.value; }; box.append(el('label', {style: 'margin-right:10px'}, `${Wd.GN[g]} `, i, el('small', {class: 'muted'}, ` /${w.cargo[g]}`))); }
    box.append(el('p', {class: 'muted', style: 'font-size:12px'}, `一個人扛 ${Wd.CARRY_MAN} 包、一頭騾子 ${Wd.MULE_CAP} 包；全員騎馬走得快。路上一天每人吃 1 份口糧。`));
    box.append(el('div', {class: 'rowbtn'}, el('button', {class: 'primary', disabled: (w.detach || []).length >= Wd.MAX_DETACH || st.target == null ? true : null, onclick: async () => {
      if (!st.ids.size) return toast('先挑人');
      const out = await doWorld({type: 'detach', ids: [...st.ids], task: st.task, target: st.target, gold: st.gold, food: st.food, mules: st.mules, horses: st.horses, cargo: st.cargo, g: st.g, q: st.q}); if (out) { closeSheet(); renderRails(); renderWorld(); } }}, '出發')));
    openSheet(box);
  };
  draw();
}
// 跟路上的人打交道
const priceTag = n => `${n} 金幣`;
function unitSheet(u0) {
  const w = G.world, u = Wd.unitsInView(w).find(x => x.pos === w.pos && x.kind === u0.kind && x.to === u0.to && x.g === u0.g && x.id === u0.id);
  if (!u) { closeSheet(); return toast('他們已經走遠了'); }
  const box = el('div', {}), again = () => unitSheet(u);
  const act = async (a, msg) => { if (msg && !confirm(msg)) return; const out = await doWorld(a, true); if (out) { if (NET.on && a.type === 'trade') Wd.mirrorTrade(G.world, a); afterWorldAction(); if (!G.world.pendingBattle && !NET.battle) again(); } };
  box.append(el('h2', {}, `${UNIT_ICON[u.kind]} ${u.label}`), el('p', {class: 'muted'}, u.detail, u.fac >= 0 ? `・${Wd.facName(u.fac)}` : ''));
  const qBtns = (max, mk, labels = [1, 5, 10]) => { const r = el('span', {class: 'qb'}); for (const q of labels) if (q <= max) r.append(el('button', {class: 'pin', onclick: () => act(mk(q))}, `${q}`)); if (max > 0 && !labels.includes(max)) r.append(el('button', {class: 'pin', onclick: () => act(mk(max))}, `全部 ${max}`)); return r; };
  const room = Math.max(0, Wd.capacity(w) - Wd.load(w));
  if (u.kind === 'caravan') {
    const d = Wd.caravanDeal(w, u);
    if (!d) { closeSheet(); return toast('他們已經走遠了'); }
    if (d.no) box.append(el('p', {class: 'bad'}, `不肯跟你們做生意：${d.no}。`));
    else {
      const G2 = Wd.GN[d.g], mine = w.cargo[d.g] || 0;
      box.append(el('div', {class: 'trow'}, el('b', {}, `買${G2}`), el('span', {}, `一包 ${priceTag(d.buy)}・車上 ${d.have} 包`), qBtns(Math.min(d.have, room, Math.floor(w.gold / d.buy)), q => ({type: 'trade', what: 'caravan', to: u.to, g: u.g, side: 'buy', q}))));
      box.append(el('div', {class: 'trow'}, el('b', {}, `賣${G2}`), el('span', {}, `一包 ${priceTag(d.sell)}・你有 ${mine} 包・他們還裝得下 ${d.room} 包`), qBtns(Math.min(mine, d.room), q => ({type: 'trade', what: 'caravan', to: u.to, g: u.g, side: 'sell', q}))));
      box.append(el('p', {class: 'muted', style: 'font-size:12px'}, `${d.prog < 0.4 ? '才剛出發，貨多又急著出清，賣得便宜。' : d.prog > 0.7 ? '快到了，不太想收貨。' : '走到半路。'}${d.scared ? '你們人多，他們有點緊張，價錢開得硬。' : ''}一次交易一小時。`));
      box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: () => act({type: 'ask', to: u.to, g: u.g})}, `打聽${nm(u.from)}的行情（1 小時）`)));
    }
  } else if (u.kind === 'cart') {
    const d = Wd.cartDeal(w, u);
    if (!d) { closeSheet(); return toast('他們已經走遠了'); }
    if (d.no) box.append(el('p', {class: 'bad'}, `不肯跟你們做生意：${d.no}。`));
    else {
      if (d.rations) box.append(el('div', {class: 'trow'}, el('b', {}, '口糧'), el('span', {}, `一份 ${d.ration} 金幣・車上約 ${d.rations} 份`), qBtns(Math.min(d.rations, Math.floor(w.gold / d.ration)), q => ({type: 'trade', what: 'cart', to: u.to, g: 'ration', q}), [5, 15, 30])));
      for (const [g, o] of Object.entries(d.goods)) box.append(el('div', {class: 'trow'}, el('b', {}, Wd.GN[g]), el('span', {}, `一包 ${priceTag(o.buy)}・${o.have} 包`), qBtns(Math.min(o.have, room, Math.floor(w.gold / o.buy)), q => ({type: 'trade', what: 'cart', to: u.to, g, q}))));
      box.append(el('p', {class: 'muted', style: 'font-size:12px'}, `村裡的收成，照${nm(u.to)}的價錢打個折。一次交易一小時。`));
    }
  } else if (u.kind === 'patrol') {
    const p = (w.patrols || []).find(x => x.id === u.id), d = p && Wd.patrolHire(w, p);
    if (w.guard) box.append(el('p', {}, `${w.guard.name}正跟著你們。`));
    else if (d?.no) box.append(el('p', {class: 'bad'}, `不肯跟你們走：${d.no}。`));
    else if (d) {
      box.append(el('p', {}, `請他們同行一段：被埋伏的機會小很多，真打起來他們也會出手。只在${Wd.facName(u.fac)}境內；時間到了（你們走滿那麼久，或世界過了那麼久，先到先算）就回去。`));
      const r = el('div', {class: 'rowbtn'}); for (const o of d.opts) r.append(el('button', {class: 'primary', disabled: o.cost > w.gold ? true : null, onclick: () => act({type: 'hirePatrol', id: u.id, h: o.h})}, `${o.h} 小時・${o.cost} 金幣`)); box.append(r);
    }
  }
  const rob = el('div', {class: 'rowbtn'});
  if (u.kind === 'caravan' || u.kind === 'cart') rob.append(el('button', {class: 'danger', onclick: async () => { closeSheet(); await act({type: 'raid', what: u.kind, to: u.to}, `劫${u.label}？\n要先打贏護衛。有人逃回去報信，或你們打到一半撤退，${Wd.facName(u.fac)}就會通緝你們。`); }}, `劫${u.kind === 'caravan' ? '商隊' : '運貨車'}`));
  if (u.kind === 'patrol' && !(w.guard && w.guard.fac === u.fac)) rob.append(el('button', {class: 'danger', onclick: async () => { closeSheet(); await act({type: 'attackPatrol', id: u.id}, `攻擊${u.label}？\n有人逃回去報信，或你們打到一半撤退，${Wd.facName(u.fac)}就會通緝你們。`); }}, '攻擊巡邏隊'));
  box.append(rob); openSheet(box);
}
function playerSheet(o) {
  const w = G.world, box = el('div', {});
  const f = FACES && o.face != null && FACES.faces[o.face] ? o.face : null;
  if (o.detach) { box.append(el('h2', {}, f != null ? faceEl(f, 36) : null, ` ${o.name}`), el('p', {class: 'muted'}, `${o.owner}的戰幫派出來辦事的人，${o.size} 人。`), el('div', {class: 'rowbtn'}, el('button', {class: 'primary', onclick: () => { closeSheet(); rtab = 'here'; setRail('r', true); renderRight(); }}, '說話'))); return openSheet(box); }
  box.append(el('h2', {}, f != null ? faceEl(f, 36) : null, ` ${o.name}的戰幫`));
  box.append(el('p', {class: 'muted'}, `${o.size} 人・${o.banner != null ? Wd.facName(o.banner) + '的旗' : '中立'}${o.camp ? (o.camp.stake ? '・紮了木柵營' : '・紮營中') : ''}${o.wantedMax >= 2 ? '・通緝犯' : ''}${o.town ? '・在城裡' : ''}・${Date.now() - o.seen < 5 * 60e3 ? '在線上' : '不在線上'} `, powerTag(o.power)));
  const r = el('div', {class: 'rowbtn'});
  r.append(el('button', {class: 'primary', onclick: () => { closeSheet(); rtab = 'here'; setRail('r', true); renderRight(); }}, '說話'));
  r.append(el('button', {disabled: true}, '交易（之後開放）'));
  const lg = Wd.raidLegality(w, o), why = o.town ? '城裡不能動手' : o.busy ? '正在交戰' : (o.shieldT || 0) > NET.T ? '剛被洗劫過' : w.guard ? '巡邏隊跟著你們' : '';
  r.append(el('button', {class: 'danger', disabled: why ? true : null, onclick: async () => { if (confirm(`襲擊${o.name}的戰幫？（6 行動點）\n${lg.note}。\n他們由 AI 防守${o.camp ? '，營地地形對他們有利' : ''}；打贏了照順序搶：貨、錢、營地、人。`)) { closeSheet(); const out = await doWorld({type: 'attackPlayer', target: o.id}); if (out && NET.battle) startBattle(NET.battle.setup); } }}, why ? `襲擊（${why}）` : '襲擊'));
  box.append(r); openSheet(box);
}
const untilDawn = w => ((30 - Math.floor(w.hour)) % 24) || 24;
function campChoices() {
  const w = G.world, L = [], R = [], town = Wd.siteAt(w, w.pos)?.kind === 'town', ci = Wd.campInfo(w);
  if (town) {
    L.push({label: '🛏 住旅店', sub: `一晚 ${w.party.length * 2}`, act: {type: 'rest', days: 1}});
    R.push({label: '⛺ 城外紮營', sub: '一天・免費', act: {type: 'rest', days: 1, inn: false}});
    return [L, R];
  }
  const opts = Object.fromEntries(Wd.campOptions(w).map(o => [o.key, o]));
  const opt = o => ({label: `${o.icon} ${o.n}`, sub: o.ok ? o.cost : o.why, act: {type: 'camp', opt: o.key}, disabled: !o.ok, done: o.on});
  if (!ci) { L.push(opt(opts.watch), opt(opts.basic)); R.push(opt(opts.stake), opt(opts.fire)); }
  else {
    const dawn = untilDawn(w);
    L.push({label: '🌙 休息到天亮', sub: `${dawn} 小時`, act: {type: 'rest', hours: dawn, days: 1, inn: false}}, {label: '☀ 休息一天', sub: '24 小時', act: {type: 'rest', days: 1, inn: false}});
    for (const k of ['stake', 'watch', 'fire']) if (!opts[k].on) R.push(opt(opts[k]));
    R.push({label: '拔營', sub: '收拾上路', act: {type: 'breakCamp'}});
  }
  return [L, R];
}
function renderCamp() {
  const w = G.world, dock = $('campDock'); if (!w) return;
  $('campL').innerHTML = ''; $('campR').innerHTML = '';
  $('btnCamp').classList.toggle('on', !!Wd.campInfo(w));
  dock.classList.toggle('open', campOpen); renderHub();
  if (!campOpen) return;
  const [L, R] = campChoices();
  const btn = c => el('button', {class: c.done ? 'done' : '', disabled: c.disabled ? true : null, onclick: async () => { await doWorld(c.act); }}, el('span', {}, c.label), el('small', {}, c.sub));
  for (const c of L) $('campL').append(btn(c)); for (const c of R) $('campR').append(btn(c));
}
function campInfoPanel(box) {
  const w = G.world, ci = Wd.campInfo(w), town = Wd.siteAt(w, w.pos)?.kind === 'town';
  box.append(el('div', {class: 'row'}, el('b', {}, town ? `在${nm(w.pos)}過夜` : ci ? `營地・${nm(w.pos)}` : `在${nm(w.pos)}紮營？`), ci ? el('span', {class: 'tag ' + (ci.ready ? 'good' : 'warn')}, ci.ready ? '紮穩了' : `再 ${(w.kit ? 6 : 12) - ci.age} 小時紮穩`) : null));
  if (town) { box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `旅店一人一晚 2 金幣，一天養好一半的傷。${NET.on ? '要離線很久的話，待在城裡最安全：城裡不能動手，離線時付旅店錢、不吃糧。' : ''}`)); return; }
  if (!ci) box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `紮了營，再移動之前：被盜匪${NET.on ? '或其他戰幫' : ''}襲擊時在營地裡迎戰，比較好守。選項會依手上的東西和這裡的環境改變。${NET.on ? '離線時待在野外，紮得越好越不容易被夜襲得手。' : ''}`));
  for (const o of Wd.campOptions(w)) box.append(el('div', {style: 'font-size:13px'}, el('b', {}, `${o.icon} ${o.n}`), el('span', {class: 'muted'}, `　${o.d}`), o.on ? el('span', {class: 'tag good'}, '已有') : null));
  const cold = C.K().season === 3 || Wd.coldAt(w.pos);
  if (cold && !(ci && ci.fire)) box.append(el('div', {style: 'font-size:13px;color:#f1cf8a'}, '天冷：不生火的話傷好得很慢，冬天在北地還要多吃糧。'));
}

/* ───────────── 左右側欄 ───────────── */
const wide = () => matchMedia('(min-width:900px)').matches;
const RT = [['here', '此地'], ['log', '日誌'], ['heard', '聽說'], ['market', '行情'], ['jobs', '委託'], ['notes', '筆記']];
let rtab = 'here', rOpen = false, lOpen = false;
function setRail(side, v) {
  if (side === 'l') { lOpen = v; if (v && !wide()) { rOpen = false; $('rrail').classList.remove('open'); } $('lrail').classList.toggle('open', v); }
  else { rOpen = v; if (v && !wide()) { lOpen = false; $('lrail').classList.remove('open'); } $('rrail').classList.toggle('open', v); if (!v) renderTabs(); }
}
$('lToggle').onclick = () => setRail('l', true);
function renderRails() { renderLeft(); renderRight(); }
const hpCol = p => p < 40 ? 'var(--enemy)' : p < 70 ? 'var(--warn)' : 'var(--ok)';
const closeRow = side => wide() ? null : el('div', {style: 'display:flex;justify-content:flex-end;margin-bottom:4px'}, el('button', {class: 'pin', onclick: () => setRail(side, false)}, side === 'l' ? '◂ 收起' : '收起 ▸'));
let leftSig = '';
function hideHelp(w) {
  const cv = Wd.concealment(w), tail = NET.on ? '別的戰幫看不到你們，名單上也沒有；但他們可以在這一格花半天搜索。' : '';
  if (cv === 'village') return `藏在村民家：巡邏隊、盜匪都找不到你們。${tail}照世界的時間用掉人情，藏得越久每天要得越多${Math.max(0, ...Object.values(w.wanted || {})) >= 1 ? '（被通緝，村民要的更多）' : ''}。這一帶的人情還有 ${Wd.favorAt(w, w.pos).toFixed(1)}。`;
  if (cv === 'den') return `躲在洞裡：外面的人找不到你們。${tail}裡面可能有東西，隨時會找上門${Wd.poiDone(w, Wd.poiAt(w, w.pos) || {}) ? '；這裡被人探索過，大家都知道這個地方，追兵會先來這裡找' : ''}。一離開就不算了。`;
  return `${cv === 'deep' ? '躲在深林裡，很難被找到' : '躲在林子裡（林子邊緣，比深林容易被找到）'}。${tail}條件：三人以內、不帶騾馬、不生火；打劫、單挑之後半天內藏不住。`;
}
function renderLeft() {
  const w = G.world; if (!w) return; const box = $('lbody');
  const sig = JSON.stringify([(w.detach || []).map(d => d.pos + d.phase), Wd.concealment(w), Math.round(Wd.favorAt(w, w.pos) * 10), !!w.captive, w.bound?.name, w.guard?.men.length, w.gold, Math.round(w.food), w.fame, w.march, Math.ceil(w.fatigue || 0), w.banner, w.mules, w.horses, Wd.load(w), NET.on ? Math.floor(apNow()) : 0, w.wanted, w.party.map(m => [m.id, Math.round(m.hp), m.lvl, m.exp, Math.round(m.loyalty / 10), m.face]), (w.captives || []).length, wide()]);
  if (sig === leftSig && box.childElementCount) return; leftSig = sig; box.innerHTML = '';
  const h = w.party.find(m => m.hero) || w.party[0]; if (!h) return;
  const hp = Math.round(h.hp / h.max * 100), fd = Wd.daysOfFood(w), wanted = Math.max(0, ...Object.values(w.wanted || {}));
  const t = $('lToggle'); t.innerHTML = '';
  t.append(portrait(h, 34), el('div', {}, el('b', {}, h.name), el('div', {class: 'meter'}, el('i', {style: `width:${hp}%;background:${hpCol(hp)}`})), el('span', {class: 'muted l2'}, `💰 ${w.gold}`), el('span', {class: 'muted l2', style: fd < 2 ? 'color:#f08a74' : ''}, `🍞 ${fd.toFixed(1)} 天`)));
  box.append(closeRow('l') || '');
  const chip = (txt, val, on, bad) => el('span', {class: 'chip' + (bad ? ' bad' : ''), onclick: e => { e.stopPropagation(); on(); }}, txt + ' ', el('b', {}, val));
  box.append(el('div', {class: 'hero', onclick: () => openSheet(memberCard(h))},
    el('div', {class: 'hrow'}, portrait(h, 56), el('div', {style: 'flex:1;min-width:0'},
      el('div', {class: 'nm'}, h.name), el('div', {class: 'muted', style: 'font-size:12px'}, `${h.tags?.length ? h.tags.join('・') + '・' : ''}${clsName(h)} Lv${h.lvl}・${Wd.fameWord(w.fame || 0)}`),
      el('div', {class: 'meter'}, el('i', {style: `width:${hp}%;background:${hpCol(hp)}`})), el('div', {class: 'muted', style: 'font-size:11px'}, `生命 ${Math.round(h.hp)}/${h.max}・經驗 ${h.exp}/100`))),
    el('div', {class: 'chips'},
      chip('💰', w.gold, partySheet), chip('⭐', `聲望 ${(w.fame || 0).toFixed(1)}`, partySheet),
      chip('🍞', `${fd.toFixed(1)} 天`, cargoSheet, fd < 2), chip('📦', `${Wd.load(w)}/${Wd.capacity(w)}`, cargoSheet),
      chip('🐴', `${w.mules} 騾・${w.horses || 0} 馬`, cargoSheet),
      NET.on ? chip('⏳', `${Math.floor(apNow())}/${Wd.AP_MAX}`, () => toast('行動點：1 點 = 1 小時，隨現實時間回復。滿了以後的時間算離線：糧吃三分之一、餉發一半。', 4000)) : null,
      chip('🚩', w.banner != null ? (Wd.facName(w.banner) || '—') : '中立', () => toast(w.banner != null ? `掛著${Wd.facName(w.banner)}的旗：在跟它交戰的國家境內，你們就是敵人。` : '沒有掛旗：誰也不靠。到城裡的旅店可以掛上那一國的旗。', 3500)),
      wanted >= 0.5 ? chip('⚠', '通緝', partySheet, true) : null,
      w.captive ? chip('⛓', '被俘', captiveSheet, true) : null,
      Wd.concealment(w) ? chip('🫥', Wd.HIDE_NAME[Wd.concealment(w)], () => toast(hideHelp(w), 5000)) : null,
      w.bound ? chip('🪢', w.bound.name, () => { if (confirm(`押著${w.bound.name}：進城交給官府可以換 ${w.bound.value} 金幣以上。路上多吃一份糧，他也可能逃掉。\n要放了他嗎？`)) doWorld({type: 'release'}); }) : null,
      w.guard ? chip('🛡', `${w.guard.name} ${w.guard.men.length} 人`, () => toast(`${w.guard.name}跟著你們（只在${Wd.facName(w.guard.fac)}境內）：被埋伏的機會小很多，打起來會出手。約好的時間：${Math.max(0, Math.round(w.guard.untilP - (w.day * 24 + w.hour)))} 小時。`, 4000)) : null,
      w.march ? chip('🏃', '急行軍', () => toast('急行軍中：走得快，但人和牲口都在硬撐。在路線資訊裡可以關掉。', 3500), true) : null,
      Wd.tired(w) ? chip('😮‍💨', `疲憊 ${Math.ceil(w.fatigue)}`, () => toast('疲憊：打仗時防禦 −1、命中 −10。紮營或住店休息就會消（每小時 −2）。', 3500), true) : null)));
  const mates = w.party.filter(m => !m.hero);
  box.append(el('div', {class: 'rsec'}, `同伴 ${mates.length}/${Wd.MAX_PARTY - 1}`));
  if (!mates.length) box.append(el('p', {class: 'muted', style: 'font-size:13px'}, '還沒有同伴。到城裡的酒館招人。'));
  for (const m of mates) { const p = Math.round(m.hp / m.max * 100);
    box.append(el('div', {class: 'mate', onclick: () => openSheet(memberCard(m, dismissRow(m)))}, portrait(m, 32),
      el('div', {class: 'mn'}, el('div', {}, el('b', {}, m.name), el('span', {class: 'muted'}, ` ${clsName(m)} Lv${m.lvl}`)), el('div', {class: 'meter'}, el('i', {style: `width:${p}%;background:${hpCol(p)}`}))),
      el('span', {class: 'muted', style: 'font-size:11px'}, m.loyalty < 30 ? '😠' : ''))); }
  if (w.detach?.length) { box.append(el('div', {class: 'rsec'}, '派出去的人'));
    for (const d of w.detach) box.append(el('div', {class: 'mate', onclick: () => { closeSheet(); showOnMap(d.pos); }}, portrait(d.members[0], 32), el('div', {class: 'mn'}, el('div', {}, el('b', {}, d.name), el('span', {class: 'muted'}, ` ${d.members.length} 人`)), el('div', {class: 'muted', style: 'font-size:11px'}, `${d.phase === 'go' ? `去${nm(d.task.target)}${Wd.TASKS[d.task.kind]}` : '回程中'}・現在在${nm(d.pos)}`)))); }
  if (w.captives?.length) { box.append(el('div', {class: 'rsec'}, '被抓走的人')); for (const c of w.captives) box.append(el('div', {class: 'mate'}, portrait(c.m, 32), el('div', {class: 'mn'}, el('div', {}, c.m.name), el('div', {class: 'muted', style: 'font-size:11px'}, `在${c.by}手上・到城裡酒館贖回（${c.price}）`)))); }
  box.append(el('div', {class: 'rowbtn'}, el('button', {onclick: partySheet}, '隊伍詳情'), el('button', {onclick: cargoSheet}, '行囊')));
}
function renderTabs() {
  const tabs = $('rtabs'); tabs.innerHTML = '';
  for (const [k, n] of RT) tabs.append(el('button', {class: ((rOpen || wide()) && k === rtab ? 'on' : '') + (k === 'here' && NET.unread ? ' unread' : ''), onclick: () => { if (!wide() && rOpen && rtab === k) return setRail('r', false); rtab = k; setRail('r', true); renderRight(); }}, n));
}
function renderRight() {
  renderTabs(); if (!G.world) return;
  const box = $('rbody');
  if ((rtab === 'notes' || rtab === 'here') && document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;   // 正在打字就不要重畫
  box.innerHTML = ''; box.append(closeRow('r') || '');
  ({here: rHere, log: rLog, heard: rHeard, market: rMarket, jobs: rJobs, notes: rNotes})[rtab](box);
  if (rtab === 'here') { NET.unread = 0; }
}
// 抄進筆記：帶上時間和地點；記下地名對應的格子，之後在筆記裡點地名就能找到
function addNote(text, tile, when) {
  const w = G.world, place = tile != null && tile >= 0 ? nm(tile) : null;
  if (place) (w.noteTiles ||= {})[place] = tile;
  const stamp = `【${when || nowText(w)}${place ? '・' + place : ''}】`;
  w.notes = (w.notes ? w.notes.replace(/\s*$/, '') + '\n' : '') + stamp + text;
  saveNotes(); toast('抄進筆記了'); if (rtab === 'notes') renderRight();
}
let noteT = 0;
function saveNotes() { clearTimeout(noteT); noteT = setTimeout(() => NET.on ? api('/api/notes', {notes: G.world.notes || ''}).catch(() => {}) : save(false), 600); }
const pinBtn = (text, tile, when) => el('button', {class: 'pin', title: '抄進筆記', onclick: e => { e.stopPropagation(); addNote(text, tile, when); }}, '＋筆記');
/* ───────────── 此地：同一格的人、對話、留言 ───────────── */
function chatLine(m) {
  const me = m.id === NET.me, f = FACES && m.face != null && FACES.faces[m.face] ? m.face : null;
  return el('div', {class: 'chat' + (me ? ' me' : '')}, f != null ? faceEl(f, 28) : el('span', {class: 'cdot'}), el('div', {class: 'tx'}, el('span', {class: 'd'}, `${m.from}・${new Date(m.at).toLocaleTimeString('zh-TW', {hour: '2-digit', minute: '2-digit'})}`), m.text));
}
function rHere(box) {
  const w = G.world;
  if (!NET.on) { box.append(el('p', {class: 'muted'}, '只有共享世界才有別人。')); return; }
  const others = NET.others.filter(o => o.pos === w.pos && o.id !== NET.me);
  box.append(el('div', {class: 'rsec', style: 'margin-top:0'}, `${nm(w.pos)}・這一格的人`));
  if (!others.length) box.append(el('p', {class: 'muted', style: 'font-size:13px;margin:2px 0'}, '這一格現在只有你們。'));
  for (const o of others) { const f = FACES && o.face != null && FACES.faces[o.face] ? o.face : null; box.append(el('div', {class: 'mate'}, f != null ? faceEl(f, 32) : el('span', {class: 'cdot'}), el('div', {class: 'mn'}, el('div', {}, el('b', {}, o.name), el('span', {class: 'muted'}, ` ${o.size} 人${o.banner != null ? '・' + Wd.facName(o.banner) + '的旗' : ''}`)), el('div', {class: 'muted', style: 'font-size:11px'}, Date.now() - o.seen < 5 * 60e3 ? '在線上' : '不在線上')))); }
  box.append(el('div', {class: 'rsec'}, '對話（只有此刻在這一格、在線上的人聽得到；講一句花 0.25 行動點，不留紀錄）'));
  const logEl = el('div', {id: 'hereLog', class: 'chatlog'}); for (const m of NET.chat.filter(m => m.tile === w.pos)) logEl.append(chatLine(m));
  if (!logEl.childElementCount) logEl.append(el('p', {class: 'muted', style: 'font-size:12px;margin:2px 0'}, '還沒有人說話。'));
  box.append(logEl);
  const inp = el('input', {maxlength: 140, placeholder: NET.ws?.readyState === 1 ? '說點什麼…' : '連線中…', class: 'chatin'});
  const say = () => { const t = inp.value.trim(); if (!t) return; if (NET.ws?.readyState !== 1) return toast('對話還沒連上'); NET.ws.send(JSON.stringify({t: 'say', text: t})); inp.value = ''; inp.focus(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) say(); });
  box.append(el('div', {class: 'crow chatrow'}, inp, el('button', {class: 'primary', onclick: say}, '說')));
  box.append(el('div', {class: 'rsec'}, '留言（留在這一格三天，之後路過的人看得到；1 行動點）'));
  const notes = (NET.tnotes || []).filter(n => n.tile === w.pos);
  if (!notes.length) box.append(el('p', {class: 'muted', style: 'font-size:12px;margin:2px 0'}, '這裡沒有人留下什麼。'));
  for (const n of notes.slice().reverse()) box.append(chatLine({from: n.by, id: n.pid, face: n.face, at: n.at, text: n.text}));
  const ninp = el('input', {maxlength: 140, placeholder: '在這裡留一句話…', class: 'chatin'});
  box.append(el('div', {class: 'crow chatrow'}, ninp, el('button', {onclick: async () => { const t = ninp.value.trim(); if (!t) return; try { const d = await api('/api/tilenote', {text: t}); NET.tnotes = d.tnotes; applyView(d); ninp.value = ''; renderRight(); renderLeft(); } catch (e) { toast(e.message); } }}, '留言')));
}
function connectChat() {
  if (!NET.on || !NET.token || (NET.ws && NET.ws.readyState <= 1)) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?token=${encodeURIComponent(NET.token)}`); NET.ws = ws;
  ws.onopen = () => { NET.wsTry = 0; if (rtab === 'here') renderRight(); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'err') return toast(m.text, 3000);
    if (m.t === 'ap') { if (G.world) { G.world.ap = m.ap; NET.apAt = Date.now(); renderStatus(); } return; }
    if (m.t !== 'chat') return;
    NET.chat.push(m); if (NET.chat.length > 200) NET.chat.splice(0, NET.chat.length - 200);
    NET.bubbles[m.id] = {text: m.text, at: Date.now()}; if (!$('world').hidden) renderWorld();
    const logEl = $('hereLog');
    if (rtab === 'here' && logEl && (rOpen || wide())) { if (logEl.querySelector('p.muted')) logEl.innerHTML = ''; logEl.append(chatLine(m)); logEl.scrollTop = logEl.scrollHeight; }
    else if (m.id !== NET.me) { NET.unread = (NET.unread || 0) + 1; renderTabs(); }
  };
  ws.onclose = () => { if (!NET.on) return; NET.wsTry = (NET.wsTry || 0) + 1; setTimeout(connectChat, Math.min(30000, 1000 * 2 ** NET.wsTry)); };
}
function rLog(box) {
  const w = G.world;
  for (const l of w.log) box.append(el('div', {class: 'entry'}, el('div', {class: 'tx'}, el('span', {class: 'd'}, dayText(l.day)), l.text), pinBtn(l.text, null, dayText(l.day).replace(/ /g, ''))));
  if (!w.log.length) box.append(el('p', {class: 'muted'}, '還沒有發生什麼事。'));
}
function rHeard(box) {
  const w = G.world, list = w.heard || (w.pins || []).slice().reverse();
  box.append(el('p', {class: 'muted', style: 'font-size:12px;margin:0 0 4px'}, '附近發生的事會傳到耳裡（傳奇的事傳得更遠）。點一條在地圖上找到它。'));
  if (!list.length) box.append(el('p', {class: 'muted'}, '最近沒聽說什麼。'));
  for (const e of list) box.append(el('div', {class: 'entry loc'}, el('div', {class: 'tx', onclick: () => { if (!wide()) setRail('r', false); showOnMap(e.tile); }}, el('span', {class: 'd'}, `${dayText(e.day)}・${nm(e.tile)}（離你 ${Wd.hdist(e.tile, w.pos)} 格）`), e.text), pinBtn(e.text, e.tile, `${dayText(e.day).replace(/ /g, '')}聽說`)));
}
function rMarket(box) {
  const w = G.world, ids = Object.keys(w.intel).map(Number).sort((a, b) => Wd.hdist(a, w.pos) - Wd.hdist(b, w.pos));
  box.append(el('p', {class: 'muted', style: 'font-size:12px;margin:0 0 4px'}, '親眼看過或在酒館聽來的一包買價，越久越不準。金色最便宜、紅色最貴。點一列在地圖上找到它。'));
  if (!ids.length) { box.append(el('p', {}, '還沒有任何市集的消息。')); return; }
  box.append(intelTable(ids, Wd.GOODS, true), el('h3', {style: 'margin-top:10px'}, '特產'), intelTable(ids, Wd.SPECS, true));
}
function rJobs(box) { const w = G.world, town = Wd.siteAt(w, w.pos)?.kind === 'town'; if (town) box.append(el('div', {class: 'rsec'}, `${nm(w.pos)}的告示板與手上的委託`)); box.append(contractList(town ? w.pos : null, true)); }
function rNotes(box) {
  const w = G.world, ta = el('textarea', {placeholder: '隨手記：哪裡的鐵便宜、誰在追你、下一步要去哪……其他分頁每一條旁邊的「＋筆記」會帶著時間地點抄進來。'});
  ta.value = w.notes || '';
  ta.addEventListener('input', () => { w.notes = ta.value; saveNotes(); });
  ta.addEventListener('blur', () => renderPlaces());
  const places = el('div', {class: 'places'});
  const renderPlaces = () => { places.innerHTML = ''; const seenN = new Set();
    for (const m of (w.notes || '').matchAll(/【[^】]*?・([^】・]+)】/g)) { const n = m[1]; if (seenN.has(n)) continue; seenN.add(n); const t = w.noteTiles?.[n] ?? findPlace(n); if (t == null) continue;
      places.append(el('button', {class: 'pin', onclick: () => { if (!wide()) setRail('r', false); showOnMap(t); }}, '📍' + n)); }
    if (!places.childElementCount) places.append(el('span', {class: 'muted', style: 'font-size:12px'}, '筆記裡提到的地點會出現在這裡，點一下就到地圖上。')); };
  renderPlaces();
  box.append(el('div', {class: 'notesWrap'}, el('div', {class: 'rowbtn', style: 'margin:0'}, el('button', {onclick: () => { const line = `\n【${nowText(w)}・${nm(w.pos)}】`; (w.noteTiles ||= {})[nm(w.pos)] = w.pos; ta.setRangeText(line, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); renderPlaces(); }}, '插入時間與地點')), ta, places));
}
function findPlace(n) { const w = G.world, k = C.K(); let best = null; for (let i = 0; i < Wd.N; i++) if (nm(i) === n && Wd.seen(w, i)) { if (k.markets[i]) return i; if (best == null) best = i; } return best; }
$('btnDanger').onclick = () => { showDanger = !showDanger; $('btnDanger').classList.toggle('on', showDanger); renderWorld(); };
$('btnHome').onclick = () => { const [x, y] = wxy(G.world.pos); cam.x = x; cam.y = y; renderWorld(); };
addEventListener('resize', () => { if (!$('world').hidden) { renderWorld(); renderRails(); } });
addEventListener('scroll', () => { if (scrollX || scrollY) scrollTo(0, 0); }, {passive: true});

/* ═════════════ 戰鬥 ═════════════ */
let bsel = null, disp = null, popups = [], animating = false, bubbles = [], picking = null, cell = 32, fo = {x: 0, y: 0};
function startBattle(setup) {
  const w = G.world, mp = NET.on && NET.battle;
  // 共享世界：戰鬥狀態在伺服器上，這裡拿到的是拿掉亂數的副本；單人照舊在本機算
  const st = mp ? JSON.parse(JSON.stringify(NET.battle.st)) : B.createBattle({seed: setup.seed, biome: setup.biome, layout: setup.layout, party: Wd.battleParty(w, setup), foes: setup.foes, order: w.lastOrder || {stance: 'follow', focus: null}, camp: setup.camp});
  G.battle = {setup, st, log: []}; bcam = null; save(false); battleScreen(true);
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
// 戰鬥中的每一步都記下來；多人時打完送給伺服器重播
const bAct = (st, a) => { const ev = B.act(st, a); if (G.battle) (G.battle.log ||= []).push(a); return ev; };
// 共享世界的一步：送給伺服器擲骰，拿回這一步的事件和新的狀態
async function serverAct(a) { const d = await api('/api/battle/act', {action: a}); if (d.error) throw new Error(d.error); return d; }
const uById = id => ST().units.find(u => u.id === id);
// 命令收在一顆選單裡：點開才列出各種命令和「危險範圍」
let ordersOpen = false;
function renderOrders() {
  const box = $('orders'); box.innerHTML = ''; const o = ST().order, cur = o.stance === 'focus' && o.focus ? `集火：${uById(o.focus)?.name || ''}` : ORDERS[o.stance].name;
  box.append(el('button', {class: 'omenu', onclick: () => { ordersOpen = !ordersOpen; renderOrders(); }}, `命令：${cur} ${ordersOpen ? '▴' : '▾'}`),
    el('button', {class: 'pin', title: '看全場', onclick: () => { bcam = null; }}, '全場'), el('button', {class: 'pin', title: '回到主角', onclick: () => focusHero()}, '主角'));
  if (!ordersOpen) return;
  const menu = el('div', {class: 'odrop'});
  for (const [k, v] of Object.entries(ORDERS)) menu.append(el('button', {class: o.stance === k ? 'on' : '', onclick: async () => { ordersOpen = false; await setOrder(k); }}, el('b', {}, v.name), el('small', {}, v.desc)));
  menu.append(el('label', {class: 'toggle'}, (() => { const c = el('input', {type: 'checkbox'}); c.checked = $('showDanger').checked; c.onchange = () => { $('showDanger').checked = c.checked; $('showDanger').onchange(); }; return c; })(), ' 顯示危險範圍與敵人意圖'));
  box.append(menu);
}
async function setOrder(k, focus) {
  if (animating) return;
  if (k === 'focus' && !focus) { picking = 'focus'; renderOrders(); toast('點一個敵人當集火目標'); return; }
  const a = {type: 'order', stance: k, focus};
  if (NET.on) { try { await serverAct(a); } catch (e) { return toast(e.message); } }
  bAct(ST(), a); G.world.lastOrder = ST().order; save(false); renderOrders(); refreshPlans(); bInfo(); toast(focus ? `集火：${uById(focus)?.name}` : `${ORDERS[k].name}：${ORDERS[k].desc}`);
}
// 版面
// 戰場鏡頭：一開始縮到看得見全場（格子太小就以主角為中心）；可以拖曳、雙指或滾輪縮放
let bcam = null;
function layout() {
  const c = $('field').getBoundingClientRect(), st = ST(), W = st.W ?? 10, H = st.H ?? 12, fitS = Math.min(c.width / W, c.height / H);
  if (!bcam) { bcam = {s: Math.max(fitS, 22), x: W / 2, y: H / 2}; if (bcam.s > fitS + 0.5) { const h = B.hero(st); if (h) { bcam.x = h.x + 0.5; bcam.y = h.y + 0.5; } } }
  bcam.s = Math.max(Math.min(fitS, 18), Math.min(72, bcam.s)); cell = bcam.s;
  bcam.x = Math.max(Math.min(W / 2, c.width / cell / 2), Math.min(W - Math.min(W / 2, c.width / cell / 2), bcam.x));
  bcam.y = Math.max(Math.min(H / 2, c.height / cell / 2), Math.min(H - Math.min(H / 2, c.height / cell / 2), bcam.y));
  fo = {x: c.width / 2 - bcam.x * cell, y: c.height / 2 - bcam.y * cell};
}
function focusHero() { const h = B.hero(ST()); if (!h) return; const c = $('field').getBoundingClientRect(); bcam = {s: Math.max(cell, Math.min(40, c.width / 9)), x: h.x + 0.5, y: h.y + 0.5}; }
{ // 拖曳與縮放（沒有拖動就當成點擊）
  const f = $('field'), ptrs = new Map(); let moved = 0, pinch = null;
  f.addEventListener('pointerdown', e => { f.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = ptrs.size > 1 ? 99 : 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = {d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: cell}; } });
  f.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId) || !bcam) return; const [ox, oy] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { moved += Math.abs(e.clientX - ox) + Math.abs(e.clientY - oy); if (moved > 6) { bcam.x -= (e.clientX - ox) / cell; bcam.y -= (e.clientY - oy) / cell; } }
    else if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()]; bcam.s = pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d; } });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
  f.addEventListener('pointerup', up); f.addEventListener('pointercancel', e => { up(e); moved = 99; });
  f.addEventListener('click', e => { if (moved > 6) { e.stopImmediatePropagation(); moved = 0; } }, true);
  f.addEventListener('wheel', e => { e.preventDefault(); if (!bcam) return; bcam.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; }, {passive: false});
}
const TILECOL = {grass: '#4f6034', road: '#87744f', bush: '#4f6034', forest: '#3d5530', hill: '#7a6a45', rock: '#4f6034', water: '#2e5672', wall: '#4f6034', camp: '#6b5a3e', cart: '#87744f', crowd: '#3a3026'};
function drawField() {
  const st = ST(); if (!st) return; const {g, w: cw, h: ch} = fit($('field')); layout();
  g.fillStyle = '#17130f'; g.fillRect(0, 0, cw, ch);
  const X = x => fo.x + x * cell, Y = y => fo.y + y * cell;
  const SW = st.W ?? 10, SH = st.H ?? 12;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    if (X(x) > cw || Y(y) > ch || X(x) + cell < 0 || Y(y) + cell < 0) continue;
    const t = st.tiles[y * SW + x]; g.fillStyle = TILECOL[t]; g.fillRect(X(x), Y(y), cell, cell);
    if (t === 'cart') sprite(g, ['props', 'cart'], X(x) + cell * 0.05, Y(y) + cell * 0.05, cell * 0.9);
    if (t === 'crowd') { g.fillStyle = '#8a7a5e'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(X(x) + cell * (0.25 + i * 0.25), Y(y) + cell * (0.4 + (i % 2) * 0.2), cell * 0.1, 0, 7); g.fill(); } }
    if (!st.result && B.exitAt(st, x, y) && (x === 0 || y === 0 || x === SW - 1 || y === SH - 1)) { g.fillStyle = '#9fd18a22'; g.fillRect(X(x), Y(y), cell, cell); }
    if ((x + y) % 2) { g.fillStyle = '#00000014'; g.fillRect(X(x), Y(y), cell, cell); }
    if (t === 'forest') sprite(g, ['props', 'tree'], X(x) + cell * 0.05, Y(y), cell * 0.9);
    if (t === 'bush') sprite(g, ['props', 'bush'], X(x) + cell * 0.15, Y(y) + cell * 0.2, cell * 0.7);
    if (t === 'hill') { g.strokeStyle = '#a8946488'; g.lineWidth = 2; g.beginPath(); g.arc(X(x) + cell / 2, Y(y) + cell * 0.75, cell * 0.35, Math.PI, 0); g.stroke(); }
    if (t === 'rock') { g.fillStyle = '#8b8780'; g.beginPath(); g.ellipse(X(x) + cell / 2, Y(y) + cell * 0.6, cell * 0.38, cell * 0.28, 0, 0, 7); g.fill(); g.fillStyle = '#a9a59c'; g.beginPath(); g.ellipse(X(x) + cell * 0.42, Y(y) + cell * 0.5, cell * 0.18, cell * 0.12, 0, 0, 7); g.fill(); }
    if (t === 'wall') { g.fillStyle = '#6b4f2e'; for (let i = 0; i < 4; i++) g.fillRect(X(x) + cell * (0.06 + i * 0.24), Y(y) + cell * 0.15, cell * 0.18, cell * 0.75); }
    if (t === 'water') { g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(X(x) + cell * 0.2, Y(y) + cell * 0.5); g.quadraticCurveTo(X(x) + cell * 0.5, Y(y) + cell * 0.35, X(x) + cell * 0.8, Y(y) + cell * 0.5); g.stroke(); }
  }
  // 危險範圍
  if ($('showDanger').checked && !animating) { const d = bsel?.danger || B.dangerTiles(st); if (bsel) bsel.danger = d; g.fillStyle = '#d0533f33'; for (const k of d) g.fillRect(X(k % SW), Y((k / SW) | 0), cell, cell); }
  // 主角可走範圍
  const h = B.hero(st);
  if (!animating && !st.result && h.alive) {
    const r = bsel?.reach || B.reach(st, h); if (bsel) bsel.reach = r; else bsel = {reach: r};
    g.fillStyle = '#5b9bd544'; for (const [x, y] of r.tiles) g.fillRect(X(x) + 1, Y(y) + 1, cell - 2, cell - 2);
    if (bsel.to) { g.strokeStyle = '#f1d38a'; g.lineWidth = 2; g.strokeRect(X(bsel.to[0]) + 2, Y(bsel.to[1]) + 2, cell - 4, cell - 4); }
    // 從預定位置打得到的敵人
    const from = bsel.to || [h.x, h.y];
    g.strokeStyle = '#ff6b55'; g.lineWidth = 2;
    for (const e of B.living(st, 'enemy')) { const d = Math.abs(e.x - from[0]) + Math.abs(e.y - from[1]), [lo, hi] = B.weaponOfUnit(h).range; if (d >= lo && d <= hi) g.strokeRect(X(e.x) + 3, Y(e.y) + 3, cell - 6, cell - 6); }
  }
  // 單位
  const units = st.units.slice().sort((a, b) => disp[a.id].y - disp[b.id].y);
  for (const u of units) {
    const d = disp[u.id]; if (d.alpha <= 0.01) continue;
    const ux = X(d.x) + d.ox * cell, uy = Y(d.y) + d.oy * cell;
    g.globalAlpha = d.alpha;
    g.fillStyle = u.side === 'ally' ? '#5b9bd5aa' : '#d0533faa'; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.36, cell * 0.12, 0, 0, 7); g.fill();
    if (u.hero) { g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.beginPath(); g.ellipse(ux + cell / 2, uy + cell * 0.86, cell * 0.4, cell * 0.15, 0, 0, 7); g.stroke(); }
    if (bsel?.to && u.hero && !animating) drawUnit(g, u, X(bsel.to[0]), Y(bsel.to[1]), 0.55);
    drawUnit(g, u, ux, uy, d.alpha);
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
    if (p.hidden) { g.fillStyle = '#e0a03c'; g.font = `800 ${cell * 0.45}px system-ui`; g.textAlign = 'center'; g.fillText('?', X(u.x) + cell * 0.85, Y(u.y) + cell * 0.38); continue; }
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
  if (x < 0 || y < 0 || x >= (ST().W ?? 10) || y >= (ST().H ?? 12)) return;
  const st = ST(), h = B.hero(st), u = B.unitAt(st, x, y);
  if (!bsel) bsel = {};
  if (picking === 'focus') {
    if (u && u.side === 'enemy') { picking = null; setOrder('focus', u.id); }
    else { picking = null; toast('取消集火'); }
    return;
  }
  const reachable = (bsel.reach || B.reach(st, h)).tiles.some(([a, b]) => a === x && b === y);
  if (u && u.side === 'enemy') {
    const from = bsel.to || [h.x, h.y], [lo, hi] = B.weaponOfUnit(h).range, inR = (fx, fy) => { const d = Math.abs(u.x - fx) + Math.abs(u.y - fy); return d >= lo && d <= hi; };
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
  const wrap = el('div', {}, el('div', {class: 'plan'}, el('b', {}, u.name), el('span', {class: 'muted'}, `${clsName(u)} Lv${u.lvl}・${B.weaponOfUnit(u).name}${B.weaponOfUnit(u).unskilled ? '（不擅長）' : ''}・${t.name}`)),
    el('div', {class: 'stats', style: 'margin:4px 0'}, ...[['生命', `${u.hp}/${u.max}`], ['攻擊', s.atk], ['命中', s.hit], ['迴避', s.avo], ['防禦', s.def]].map(([k, v]) => el('span', {}, k + ' ', el('b', {}, v)))),
    el('div', {}, ...traitTags(u)));
  if (u.side === 'ally' && !u.hero) { const p = (bsel?.plans || []).find(p => p.id === u.id); wrap.append(el('div', {class: 'muted', style: 'font-size:13px;margin-top:4px'}, `忠誠 ${Math.round(u.loyalty)}・這回合${st.obey[u.id] === false ? '不聽令' : '聽令'}${p ? `・打算：${planText(p)}` : ''}`)); }
  return wrap;
}
function planText(p) { if (p.hidden) return '不聽令——看不出他在打算什麼'; const t = p.target && uById(p.target); return p.kind === 'attack' ? `${p.why}→${t?.name}（命中 ${p.f?.aHit ?? '?'}%）` : p.kind === 'heal' ? `包紮 ${t?.name}` : p.why; }
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
    acts.append(el('button', {class: 'primary', onclick: async () => commit({type: 'hero', to: from, act: {kind: 'attack', target: e.id}})}, '攻擊'), el('button', {onclick: async () => { bsel.target = null; bInfo(); }}, '取消'));
    return;
  }
  if (bsel.inspect) { box.append(unitInfo(uById(bsel.inspect))); }
  else {
    box.append(el('div', {class: 'muted', style: 'font-size:13px'}, `命令：${ORDERS[st.order.stance].name}——${ORDERS[st.order.stance].desc}。點藍色格子移動，點敵人看預測。`));
    for (const p of bsel.plans) { const u = uById(p.id); box.append(el('div', {class: 'plan' + (p.disobey ? ' dis' : '')}, el('b', {}, u.name), el('span', {}, planText(p)))); }
  }
  const to = bsel.to || [h.x, h.y], edge = B.exitAt(st, to[0], to[1]);
  acts.append(el('button', {class: 'primary', onclick: async () => commit({type: 'hero', to, act: {kind: 'wait'}})}, bsel.to ? '移動並待命' : '待命'));
  if (edge) acts.append(el('button', {class: 'danger', onclick: async () => { if (confirm('撤離戰場？還跟敵人貼身纏鬥的同伴會被丟下。')) commit({type: 'flee', to}); }}, '撤離'));
  if (bsel.to || bsel.inspect) acts.append(el('button', {onclick: async () => { bsel = null; refreshPlans(); bInfo(); }}, '取消'));
}
$('showDanger').onchange = () => { if (bsel) { bsel.danger = null; bsel.eplans = null; } };
async function commit(action) {
  if (animating) return;
  let st = ST(), ev, done = null;
  animating = true; $('bActions').innerHTML = ''; $('bInfo').innerHTML = '';
  if (NET.on) { try { const d = await serverAct(action); ev = d.ev; st = d.st; if (d.out) done = d; } catch (e) { animating = false; toast(e.message); bInfo(); return; } }
  else { try { ev = bAct(st, action); } catch (e) { animating = false; toast(e.message); bInfo(); return; } save(false); }
  await play(ev);
  if (NET.on) G.battle.st = st;
  animating = false; bsel = null; syncDisp();
  if (st.result) return battleOver(done);
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
async function battleOver(done) {
  const {setup, st} = G.battle; lastSt = st;
  const lvBefore = new Map(G.world.party.map(m => [m.id, m.lvl]));
  let out;
  if (NET.on) { if (done) { applyView(done); out = done.out; } else out = {lines: ['戰果之後會再同步。']}; refreshMirror(true).catch(() => {}); }
  else out = Wd.applyBattle(G.world, setup, st);
  const w = G.world;
  G.battle = null; save();
  if (w.over) return gameOver();
  const box = el('div', {}, el('h2', {}, st.result === 'win' ? '勝利' : st.result === 'retreat' ? '撤退' : '戰鬥結束'));
  for (const l of out.lines) box.append(el('p', {}, l));
  for (const m of w.party) { const u = st.units.find(x => x.id === m.id); if (!u) continue; const lv = m.lvl - (lvBefore.get(m.id) || m.lvl); box.append(el('div', {class: 'plan'}, el('b', {}, m.name), el('span', {class: 'muted'}, `生命 ${m.hp}/${m.max}・擊倒 ${u.kills}${lv ? `・升了 ${lv} 級` : ''}`))); }
  openSheet(box, () => worldScreen());
}
function gameOver() {
  const w = G.world; if (!NET.on) wipe();
  const h = {name: w.party.find(m => m.hero)?.name};
  const box = el('div', {}, el('h2', {}, '旅程結束'),
    el('p', {}, `你在${dayText(w.day)}倒在${w.over?.where || '路上'}。`),
    el('p', {class: 'muted'}, `打過 ${w.battles} 場仗，隊伍一共擊倒 ${w.kills} 個敵人。`));
  if (w.fallen.length) { box.append(el('h3', {}, '先你而去的人')); for (const f of w.fallen) box.append(el('p', {class: 'muted'}, `${f.name}（${CLASSES[f.cls].name}）・${dayText(f.day)}・${f.how}`)); }
  const alive = w.party.filter(m => !m.hero); if (alive.length) { box.append(el('h3', {}, '活下來的人')); box.append(el('p', {class: 'muted'}, alive.map(m => m.name).join('、') + '——他們會各自散去。')); }
  box.append(el('button', {class: 'primary', onclick: async () => { closeSheet(); G = {world: null, battle: null}; titleScreen(); }}, '重新開始'));
  void h; const lock = () => {}; lock.locked = true; openSheet(box, lock);
}
addEventListener('resize', () => { if (!$('battle').hidden) { bsel && (bsel.reach = null); } });

/* ───────────── 啟動 ───────────── */
// 舊版存檔（小地圖）已不相容，清掉省空間
try { for (const k of ['warband-slice-v1', 'warband-v2', 'warband-v2-sim']) localStorage.removeItem(k); } catch {}
setInterval(() => { if (NET.on && G.world && !$('world').hidden) { renderStatus(); renderLeft(); } }, 5000);
Promise.all([loadArt(), loadFaces()]).then(titleScreen);
