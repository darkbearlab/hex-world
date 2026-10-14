// 高強度測試第一層（Alan 2026-10-12）：在本機、不開伺服器，拿線上存檔（或任何 core.save()）跑很多天，
// 世界裡除了 NPC 公司，再加幾家「亂玩的機器人公司」：什麼指令都試（接案、親自打的假戰果、撤軍、長約、駐軍、Rover、倉庫、培養槽……）。
// 每個遊戲小時檢查一次「不該發生的事」，每隔幾天把存檔寫出去、讀回一個全新的核心（像伺服器重開），指紋要一樣。
// node chimera/stats/soak.mjs --save 存檔.json [--days 30] [--bots 6] [--seed 1] [--roundtrip 5] [--rich 2000] [--quiet]
// 存檔可以是 admin/save 的回應（{seed, save}）或 core.save() 本身（要加 --world 種子）。結果有問題時 exit 1。
import fs from 'fs';
import {Core} from '../core.js';
import * as G from '../company.js';
import {nextNodes as OPN} from '../ops.js';
import {createChecks, diff} from './lib/checks.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; }, flag = k => args.includes('--' + k);
const days = +opt('days', 30), nBots = +opt('bots', 6), seed0 = +opt('seed', 1), every = +opt('roundtrip', 5), rich = +opt('rich', 2000), quiet = flag('quiet');
const watch = opt('watch', '');   // --watch 公司:uid：每小時印出這個人的狀態有沒有變（追問題用）
const file = opt('save'); if (!file) { console.log('要給 --save 存檔.json（線上的用 admin/save 抓）'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8')), worldSeed = raw.save ? raw.seed : opt('world', '奇美拉-1'), save0 = raw.save || raw;

// 機器人的亂數：每家公司自己一條（同一個 --seed 每次跑都一樣，問題才重現得出來）
const rng = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.floor(r() * a.length)];

let c = new Core(() => {}); c.load(worldSeed, save0); c.enableNpcs();
const h0 = c.game.h, K = c.sim.peek();

// ───── 問題紀錄 ─────
const issues = new Map();   // 同一種問題只記第一次的細節，之後只數次數
// 問題跟某家機器人公司有關時，附上它最近下的指令（重現用）
const recentOf = name => { const bot = bots.find(x => x.name === name); return bot ? '\n    最近的指令：\n      ' + bot.recent.join('\n      ') : ''; };
function issue(kind, text, h, co) { if (co) text += recentOf(co); const e = issues.get(kind); if (e) { e.n++; return; } issues.set(kind, {n: 1, h, text}); if (!quiet) console.log(`  ⚠ 第 ${((h - h0) / 24).toFixed(1)} 天 ${kind}：${text}`); }
const refusals = {}, used = {};

// ───── 機器人公司 ─────
const towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
const taken = new Set(Object.values(c.game.cos).map(g => g.base));
const bots = [];
for (let i = 0; i < nBots; i++) {
  const r = rng(seed0 * 1000 + i), name = `測試機器人${i + 1}`;
  if (!c.game.cos[name]) { const free = towns.filter(t => !taken.has(t)), base = pick(r, free.length ? free : towns); const err = c.found(base, name); if (err) { console.log(name, '開不了公司：', err); continue; } taken.add(base); c.co(name).cash += rich; }
  bots.push({name, r, recent: [], style: ['busy', 'fighter', 'rover', 'contract', 'chaos', 'merchant'][i % 6]});
}
const cmd = (bot, m) => {
  used[m.type] = (used[m.type] || 0) + 1;
  bot.recent.push(`${c.game.h - h0}h ${JSON.stringify(m).slice(0, 120)}`); if (bot.recent.length > 10) bot.recent.shift();
  let err; try { err = c.command(m, bot.name); } catch (e) { issue('指令丟出例外：' + m.type, `${bot.name} ${JSON.stringify(m).slice(0, 160)}\n    ${e.stack?.split('\n').slice(0, 4).join('\n    ')}`, c.game.h); return 'exception'; }
  if (err) { const k = `${m.type}：${String(err).replace(/\d+/g, '#')}`; refusals[k] = (refusals[k] || 0) + 1; }
  return err;
};

// 親自打的假戰果：輸贏、陣亡、撿到的東西都隨機（伺服器上的戰鬥會交一樣格式的 result）
function fakeResult(bot, tk) {
  const sq = c.game.book.squads[tk.squad], alive = sq.clones.filter(x => x.alive).slice(0, 4), r = bot.r, win = r() < .7;
  const dead = alive.filter(() => r() < (win ? .08 : .35)).map(x => x.id);
  const progress = Object.fromEntries(alive.map(x => [x.id, {lv: x.lv || 1, xp: 0, picks: x.picks || [], skills: x.skills || [], prep: x.prep || null, perkPicks: x.perkPicks || 0, classPerkMisses: x.classPerkMisses || 0, legacyPerkPicks: x.legacyPerkPicks || 0}]));
  const loot = win && r() < .5 ? {ammo: Math.floor(r() * 40), guns: r() < .5 ? [{base: pick(r, Object.keys(G.GUNS))}] : [], kits: r() < .5 ? {[pick(r, Object.keys(G.KITS))]: 1 + Math.floor(r() * 4)} : {}, melee: r() < .2 ? [pick(r, Object.keys(G.MELEES))] : []} : null;
  return {win, dead, progress, kills: Math.floor(r() * 12), ...(loot ? {loot} : {}), ...(tk.enemy?.boss && win && r() < .5 ? {boss: r() < .5 ? 'dead' : 'retreat', legacy: alive[0]?.id} : {})};
}

function botHour(bot, h) {
  const g = c.co(bot.name), b = c.game.book, r = bot.r, home = () => g.roster.filter(x => x.alive && x.status === 'home' && !x.keep);
  // 培養槽與素材
  for (const [i, q] of g.queue.entries()) if (q.ready) cmd(bot, {type: 'claim', slot: q.slot ?? i});
  if (g.roster.filter(x => x.alive).length + g.queue.length < 14 && r() < .3) {
    for (const m of ['food', 'water', 'implant', 'neural']) if ((g.mats[m] || 0) < 60) cmd(bot, {type: 'buy', mat: m, qty: 100});
    cmd(bot, {type: 'build', recipe: {food: 40 + Math.floor(r() * 40), water: 40 + Math.floor(r() * 40), implant: 40 + Math.floor(r() * 40), neural: 40 + Math.floor(r() * 40)}});
  }
  for (const x of g.roster.filter(x => x.status === 'recovered')) if (r() < .2) cmd(bot, r() < .7 ? {type: 'revive', uid: x.uid} : {type: 'sellbody', uid: x.uid});
  if (r() < .05) for (const s of G.cleanSites(g, b, c.w)) if (s.ok) cmd(bot, {type: 'clean', tile: s.tile});
  // 服務單：fighter 大多親自打（假戰果），其他大多自動結算；有時候放著不管（看逾期怎麼處理）
  for (const tk of b.tickets.filter(t => t.player === bot.name && !t.done && t.squad)) {
    const x = r(); if (x < .15) continue;
    if (bot.style === 'fighter' ? x < .8 : x < .3) { if (!cmd(bot, {type: 'fight', ticket: tk.id})) cmd(bot, {type: 'submit', ticket: tk.id, result: fakeResult(bot, tk)}); }
    else cmd(bot, {type: 'resolve', ticket: tk.id});
  }
  // 行動（2026-10-13，ops.js）：亂出發、亂選點、假戰果、偶爾中途撤回
  if (!g.op && r() < .03) { const pk = home().slice(0, 1 + Math.floor(r() * 4)); if (pk.length) { g.mats.food = Math.max(g.mats.food || 0, 40); g.mats.water = Math.max(g.mats.water || 0, 40); cmd(bot, {type: 'opStart', def: 'trial', uids: pk.map(x => x.uid)}); } }
  if (g.op && r() < .3) {
    if (g.op.fight) { const alive = g.op.uids.map(u => g.roster.find(x => x.uid === u)).filter(x => x?.alive), win = r() < .7;
      cmd(bot, {type: 'fight', ticket: g.op.fight.ticket});
      cmd(bot, {type: 'submit', ticket: g.op.fight.ticket, result: {win, dead: alive.filter(() => r() < (win ? .1 : .4)).map(x => x.id), kills: 5, progress: Object.fromEntries(alive.map(x => [x.id, {hp: 20 + Math.floor(r() * 80), maxHp: 110, plates: 10, picks: [...(g.op.picks[x.uid] || []), 'health'], skills: x.skills || [], prep: x.prep || null}]))}}); }
    else if (r() < .1) cmd(bot, {type: 'opLeave'});
    else if (r() < .15) cmd(bot, {type: 'opResupply'});
    else { const nx = OPN(g.op); if (nx.length) cmd(bot, {type: 'opGo', node: pick(r, nx).id}); }
  }
  // 接案
  const open = g.cases.map(id => b.cases.find(k => k.id === id)).filter(k => k && !k.settled).length;
  if (open < (bot.style === 'chaos' ? 5 : 3) && home().length >= 2 && r() < .25) {
    const board = c.boardView(bot.name).filter(e => !e.joined && h >= e.start && h < e.closeAt && !e.gone && !['drill', 'hunting', 'security'].includes(e.kind));
    const e = board.length && pick(r, board.some(x => x.here) && r() < .5 ? board.filter(x => x.here) : board);
    if (e) { const side = e.kind === 'front' || e.kind === 'camp' ? pick(r, ['att', 'def']) : (e.kind === 'tense' || e.kind === 'outpost') ? pick(r, ['a', 'b']) : '';
      cmd(bot, {type: 'accept', kind: e.kind, tile: e.tile, side, uids: home().slice(0, e.here ? 2 + Math.floor(r() * 7) : 2 + Math.floor(r() * 4)).map(x => x.uid)}); }
  }
  // 撤軍、增援、整補
  const mySq = Object.values(b.squads).filter(sq => sq.player === bot.name);
  if (r() < (bot.style === 'chaos' ? .04 : .01)) { const sq = mySq.filter(s => s.caseId).length && pick(r, mySq.filter(s => s.caseId)); if (sq) cmd(bot, {type: 'recall', squad: sq.id}); }
  if (r() < .03 && home().length) { const sq = mySq.filter(s => s.caseId).length && pick(r, mySq.filter(s => s.caseId)); if (sq) cmd(bot, {type: 'reinforce', squad: sq.id, uids: home().slice(0, 2).map(x => x.uid)}); }
  if (r() < .05) { const sq = mySq.find(s => s.pack?.length); if (sq) { const m = sq.clones.find(x => x.alive); if (m) cmd(bot, {type: 'fieldEquip', squad: sq.id, uid: m.uid, slot: pick(r, G.SLOTS), item: pick(r, sq.pack).id}); } }
  // 長約與駐軍
  if (bot.style === 'contract' || bot.style === 'chaos' || r() < .2) {
    for (const k of (b.contracts || []).filter(k => !k.done && h < k.signUntil && !k.signers.some(s => s.co === bot.name))) if (r() < .05) cmd(bot, {type: 'sign', id: k.id});
    for (const k of (b.contracts || []).filter(k => !k.done && k.signers.some(s => s.co === bot.name && !s.void))) {
      const gar = mySq.filter(sq => sq.garrison === k.site);
      if (!gar.length && home().length >= 2 && r() < .1) cmd(bot, {type: 'garrison', site: k.site, uids: home().slice(0, 4).map(x => x.uid)});
      if (gar.length && r() < .005) cmd(bot, {type: 'ungarrison', squad: gar[0].id});
      for (const q of (k.calls || []).filter(q => q.co === bot.name && q.state === 'open')) { const y = r(); if (y < .1) cmd(bot, {type: 'answer', call: q.id, uids: home().slice(0, 4).map(x => x.uid)}); else if (y < .15 && gar.length) cmd(bot, {type: 'answer', call: q.id, squad: gar[0].id}); }
    }
  }
  // 移動基地（2026-10-12）：開到城、遠征點、突發事件、搶購的城；到了就搜索、接小事、升級、買車、換登記、搶購、留言
  if (bot.style === 'rover' || bot.style === 'chaos' || r() < .05) {
    const V = c.view(bot.name).data, v = V.hq, W = V.world;
    if (v.parked && !v.block) {
      if (v.site && !v.site.taken && r() < .7) cmd(bot, {type: 'baseSearch'});
      if (v.inTown) { if (v.jobsHere.length && r() < .3) cmd(bot, {type: 'baseJob', id: pick(r, v.jobsHere).id});
        const u = v.up.find(u => u.here && u.cost); if (u && r() < .3) cmd(bot, {type: 'baseUpgrade', kind: u.kind});
        if (r() < .05) cmd(bot, {type: 'buyVan'}); if (r() < .02) cmd(bot, {type: 'register'});
        for (const d of W.deals.filter(d => d.tile === v.tile && !d.mine)) cmd(bot, {type: 'deal', id: d.id}); }
      if (r() < .05) cmd(bot, {type: r() < .5 ? 'note' : 'say', text: `機器人 ${bot.name} 到此一遊 ${h}`});
      if (r() < .15) { const y = r(), tgt = y < .3 && W.events.length ? pick(r, W.events).tile : y < .5 && W.sites.length ? pick(r, W.sites).tile : y < .7 && W.deals.length ? pick(r, W.deals).tile : pick(r, towns); cmd(bot, {type: 'baseGo', tile: tgt}); }
    }
    if (!v.parked && r() < .01) cmd(bot, {type: 'baseStop'});
  }
  // 倉庫、市場
  if (bot.style === 'merchant' || bot.style === 'chaos' || r() < .05) {
    if (r() < .1) { const kind = pick(r, ['gun', 'kit', 'armor', 'melee']); const T = {gun: G.GUNS, kit: G.KITS, armor: G.ARMORS, melee: G.MELEES}[kind]; if (T) cmd(bot, {type: 'shop', kind, base: pick(r, Object.keys(T))}); }
    const st = g.store || [];
    if (st.length && r() < .1) { const x = home().length && pick(r, home()); if (x) cmd(bot, {type: 'equip', uid: x.uid, slot: pick(r, G.SLOTS), item: pick(r, st).id}); }
    if (st.length > 8 && r() < .1) cmd(bot, {type: 'sell', item: pick(r, st).id});
    if (r() < .02 && home().length >= 2) { const [a, x] = home(); cmd(bot, {type: 'merge', keep: a.uid, feed: x.uid}); }
    if (r() < .02) cmd(bot, {type: 'cover', uid: pick(r, g.roster)?.uid});
  }
  if (r() < .01) cmd(bot, {type: 'readReport', id: 'all'});
  // 成長（2026-10-13）：亂選性格技能（也會亂丟不合法的等級、選項）
  if (r() < .05 && g.roster.length) { const x = pick(r, g.roster); cmd(bot, {type: 'talent', uid: x.uid, row: pick(r, [4, 6, 8, 10, 5]), k: pick(r, [0, 1, 2, 3])}); }
}

// ───── 每小時檢查（stats/lib/checks.mjs） ─────
const checks = createChecks(issue, h0);

let watchLast = '';
function watchOne() {
  const [co, u] = watch.split(':'), g = c.co(co), x = g?.roster.find(y => y.uid === +u); if (!x) return;
  const b = c.game.book, sqs = Object.values(b.squads).filter(sq => sq.clones.includes(x)).map(sq => `${sq.name}[${sq.id} case=${sq.caseId} gar=${sq.garrison} home=${sq.headedHome}${sq.rover ? ' rover' : ''}]`);
  const now = `${x.status} ${sqs.join(' ')} 最後紀錄 ${JSON.stringify((x.record || []).at(-1))}`;
  if (now !== watchLast) { console.log(`  👁 ${c.game.h - h0}h ${x.id}: ${now}`); const bot = bots.find(y => y.name === co); if (bot) console.log('     ' + bot.recent.slice(-3).join('\n     ')); watchLast = now; }
}
// ───── 存檔、讀回（像伺服器重開） ─────
function roundtrip() {
  const fa = c.fingerprint(), s = JSON.stringify(c.save()), d = new Core(() => {});
  d.load(worldSeed, JSON.parse(s)); d.enableNpcs(); const fb = d.fingerprint();
  if (fa !== fb) issue('存檔讀回後狀態不一樣', `讀回前 ${fa}，讀回後 ${fb}（讀檔的修補 relink 改到了東西，或有東西沒存到）\n    ${diff(JSON.parse(JSON.stringify(c.game)), JSON.parse(JSON.stringify(d.game))).slice(0, 6).join('\n    ')}`, c.game.h);
  // 讀回後不見的小隊（讀檔修補拆掉的）：列出隊員的狀態與最後幾筆紀錄
  if (fa !== fb) for (const [id, sq] of Object.entries(c.game.book.squads)) if (!d.game.book.squads[id]) issue('讀檔時拆掉了小隊', `${sq.name}（${id} 駐地 ${sq.garrison} 案件 ${sq.caseId}）\n    ${sq.clones.map(x => `${x.id} ${x.alive ? x.status : '死'} ${JSON.stringify((x.record || []).slice(-3))}`).join('\n    ')}`, c.game.h, sq.player);
  c = d; return s.length;
}

checks.seen(c);   // 存檔裡以前就違約的不算

// ───── 跑 ─────
console.log(`種子 ${worldSeed}，從第 ${h0} 小時（沙盒第 ${c.year} 年）開始跑 ${days} 天；公司 ${Object.keys(c.game.cos).length} 家（機器人 ${bots.length}）`);
const t0 = Date.now(); let size = 0;
for (let d = 1; d <= days; d++) {
  for (let i = 0; i < 24; i++) {
    const h = c.game.h + 1;
    checks.before(c);
    try { c.advanceTo(h); } catch (e) { issue('推進時間丟出例外', e.stack?.split('\n').slice(0, 5).join('\n    '), h); c.game.h = h; }
    for (const bot of bots) try { botHour(bot, h); } catch (e) { issue('機器人自己出錯（測試腳本的問題）', e.stack?.split('\n').slice(0, 3).join('\n    '), h); }
    checks.check(c); if (watch) watchOne();
  }
  if (every && d % every === 0) size = roundtrip();
  if (!quiet && d % 5 === 0) console.log(`  第 ${d} 天（${((Date.now() - t0) / 1000).toFixed(0)} 秒）沙盒第 ${c.year} 年`);
}

// ───── 報告 ─────
const b = c.game.book;
console.log(`\n跑完 ${days} 天，${((Date.now() - t0) / 1000).toFixed(0)} 秒；存檔 ${Math.round(size / 1024)} KB`);
console.table(Object.fromEntries([...bots.map(x => x.name), 'DarkBearLab'].filter(n => c.co(n)).map(n => { const g = c.co(n); return [n, {風格: bots.find(x => x.name === n)?.style || '玩家', 現金: Math.round(g.cash), 活著: g.roster.filter(x => x.alive).length, 陣亡: g.roster.filter(x => !x.alive).length, 結案: b.cases.filter(k => k.settled && g.cases.includes(k.id)).length, 車: `${G.vansUsed(g, b)}/${G.vanCap(g)}`, 基地: c.w.names[g.base] || g.base}]; })));
{ const why = {}; for (const bot of bots) for (const x of c.co(bot.name)?.roster || []) { if (x.alive) continue; const e = (x.record || []).findLast(e => e.t === 'down' || e.t === 'kia'); const k = e?.t === 'down' ? (e.title || '').replace(/：.*/, '') : e ? '陣亡' : '其他'; why[k] = (why[k] || 0) + 1; }
  console.log('機器人公司的人怎麼倒下的：', Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join('、')); }
{ const S = Object.values(b.squads); console.log(`帳本裡的小隊 ${S.length} 支，其中已經在回程（headedHome）的 ${S.filter(s => s.headedHome != null).length} 支、佔存檔 ${Math.round(JSON.stringify(b.squads).length / 1024)} KB`); }
console.log('指令用了幾次：', Object.entries(used).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、'));
console.log('最常被拒絕的：'); for (const [k, v] of Object.entries(refusals).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v}×  ${k}`);
if (!issues.size) { console.log('\n沒有發現問題'); process.exit(0); }
console.log(`\n發現 ${issues.size} 種問題：`);
for (const [k, e] of issues) console.log(`- ${k}（${e.n} 次，第一次在第 ${((e.h - h0) / 24).toFixed(1)} 天）\n    ${e.text}`);
process.exit(1);
