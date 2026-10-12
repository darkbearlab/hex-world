// 高強度測試第二層（Alan 2026-10-12）：本機的伺服器（wrangler dev，launch.json 的 chimera-dev）＋好幾個機器人玩家同時用 HTTP 玩，
// 中間有人一直快轉時間（admin/forward）。測的是第一層測不到的：同時下指令、每個指令都存檔、快轉跟指令搶著跑、回應時間、伺服器錯誤。
// 每隔幾輪抓整顆星球的存檔回來（admin/save），在本機用 stats/lib/checks.mjs 檢查，並且讀回一次比對指紋。
// node chimera/stats/server-soak.mjs [--url http://localhost:8787] [--import 存檔.json] [--bots 8] [--rounds 60] [--forward 4] [--check 10] [--seed 1]
// --import：先把存檔放進本機的伺服器（新世界還沒建好時用 admin/import；已經有世界就用 DEV 的 dev/import 蓋掉）。不要對線上的網址跑。
import fs from 'fs';
import os from 'os';
import {Core} from '../core.js';
import {createChecks, diff} from './lib/checks.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const serial = args.includes('--serial');
const URL0 = opt('url', 'http://localhost:8787'), nBots = +opt('bots', 8), rounds = +opt('rounds', 60), fwd = +opt('forward', 4), every = +opt('check', 10), seed0 = +opt('seed', 1);
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(URL0)) { console.log('只對本機的伺服器跑（--url 要是 localhost）'); process.exit(2); }
const TOKEN = fs.readFileSync(os.homedir() + '/.chimera-admin-token', 'utf8').trim();

const rng = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, a) => a[Math.floor(r() * a.length)];

// ───── HTTP ─────
const lat = {}, http = {ok: 0, refused: 0, err4: 0, err5: 0, fail: 0}, errors = {};
async function call(path, body = {}, headers = {}) {
  const t = performance.now(), key = path === 'cmd' ? 'cmd:' + body.type : path;
  try {
    // 跟遊戲畫面（public/link.js）一樣：讀取用 GET、不帶內容。用 POST 帶內容叫 view 的話，伺服器沒讀內容就回應，同一條連線的下一個請求會斷掉
    const get = ['view', 'hello'].includes(path);
    const r = await fetch(`${URL0}/api/${path}`, get ? {headers} : {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
    const ms = performance.now() - t; (lat[key] ||= []).push(ms);
    const txt = await r.text(); let d; try { d = JSON.parse(txt); } catch { d = {error: txt.slice(0, 200)}; }
    if (r.status >= 500) { http.err5++; const k = `${r.status} ${key}：${String(d.error || '').slice(0, 100)}`; errors[k] = (errors[k] || 0) + 1; }
    else if (r.status >= 400) { http.err4++; const k = `${r.status} ${key}：${String(d.error || '').replace(/\d+/g, '#').slice(0, 80)}`; errors[k] = (errors[k] || 0) + 1; }
    else if (d.view?.err) http.refused++; else http.ok++;
    return {status: r.status, d};
  } catch (e) { http.fail++; const k = `連不上 ${key}：${e.message}`; errors[k] = (errors[k] || 0) + 1; return {status: 0, d: {}}; }
}
const admin = (path, body) => call(path, body, {'x-admin-token': TOKEN});

// ───── 問題紀錄 ─────
const issues = new Map();
function issue(kind, text, h) { const e = issues.get(kind); if (e) { e.n++; return; } issues.set(kind, {n: 1, h, text}); console.log(`  ⚠ ${kind}：${text}`); }

// ───── 準備世界 ─────
const imp = opt('import');
let worldSeed = '奇美拉-1';
if (imp) {
  const raw = JSON.parse(fs.readFileSync(imp, 'utf8')), save = raw.save || raw; worldSeed = raw.seed || worldSeed;
  // 新世界還沒建好（hello 回 503）才能用 admin/import；已經有世界就用 dev/import（兩個都試的話，前一個被拒絕時伺服器沒讀完請求，連線會壞掉）
  const pending = (await call('hello')).status === 503;
  const r = pending ? await admin('admin/import', {seed: worldSeed, save}) : await call('dev/import', {seed: worldSeed, save}, {'x-chimera-token': 'server-soak-importer-0000'});
  console.log('匯入存檔：', r.status, JSON.stringify(r.d).slice(0, 120));
  if (r.status !== 200) process.exit(1);
}
const s0 = await admin('admin/save'); if (s0.status !== 200) { console.log('抓不到存檔（伺服器有開嗎？admin token 對嗎？）', s0.status, s0.d); process.exit(1); }
worldSeed = s0.d.seed;
let local = new Core(() => {}); local.load(worldSeed, s0.d.save);
const h0 = local.game.h, checks = createChecks(issue, h0); checks.seen(local);
const K = local.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);

// ───── 機器人玩家 ─────
const bots = [];
for (let i = 0; i < nBots; i++) {
  const r = rng(seed0 * 7777 + i), tok = `server-soak-${seed0}-${i}-` + 'x'.repeat(8), name = `伺服器機器人${seed0}-${i + 1}`;
  const bot = {name, r, h: {'x-chimera-token': tok}, style: ['busy', 'contract', 'rover', 'chaos'][i % 4]};
  const v = await call('view', {}, bot.h);
  if (!v.d.view) { const base = pick(r, towns), f = await call('found', {base, name}, bot.h); if (f.status !== 200) { console.log(name, '開不了公司', base, String(f.d.error).slice(0, 80)); continue; } }
  bots.push(bot);
}
console.log(`伺服器 ${URL0}，種子 ${worldSeed}，從第 ${h0} 小時開始；機器人 ${bots.length} 個，跑 ${rounds} 輪（每輪快轉 ${fwd} 小時）`);

// 一個機器人一輪：看畫面（view）→ 照畫面上看得到的東西下幾個指令（跟玩家一樣，只能用 view 裡的資料）
async function turn(bot) {
  const r = bot.r, send = m => call('cmd', m, bot.h);
  let {d} = await call('view', {}, bot.h); let v = d.view; if (!v) return;
  const D = v.data, h = D.h, home = () => D.roster.filter(x => x.alive && x.status === 'home' && !x.keep);
  for (const q of D.queue) if (q.ready) await send({type: 'claim', slot: q.slot});
  if (D.roster.filter(x => x.alive).length + D.queue.length < 12 && r() < .4) {
    for (const m of ['food', 'water', 'implant', 'neural']) if ((D.mats[m] || 0) < 60) await send({type: 'buy', mat: m, qty: 100});
    await send({type: 'build', recipe: {food: 50, water: 50, implant: 50, neural: 50}});
  }
  for (const x of D.roster.filter(x => x.status === 'recovered' && !x.reviving)) if (r() < .3) await send(r() < .7 ? {type: 'revive', uid: x.uid} : {type: 'sellbody', uid: x.uid});
  for (const tk of D.tickets) if (r() < .8) await send({type: 'resolve', ticket: tk.id});
  const open = D.cases.filter(k => !k.settled).length;
  if (open < 3 && home().length >= 2 && r() < .5) {
    const B = v.board.filter(e => !e.joined && h >= e.start && h < e.closeAt && !e.gone && !['drill', 'hunting', 'security'].includes(e.kind));
    // 同一個委託大家搶著接（測同時接案）：一半的機會挑板上的第一個
    const e = B.length && (r() < .5 ? B[0] : pick(r, B));
    if (e) await send({type: 'accept', kind: e.kind, tile: e.tile, side: e.kind === 'front' || e.kind === 'camp' ? pick(r, ['att', 'def']) : (e.kind === 'tense' || e.kind === 'outpost') ? pick(r, ['a', 'b']) : '', uids: home().slice(0, e.here ? 8 : 4).map(x => x.uid)});
  }
  const sqs = D.cases.filter(k => !k.settled).flatMap(k => k.squads);
  if (r() < (bot.style === 'chaos' ? .15 : .03) && sqs.length) await send({type: 'recall', squad: pick(r, sqs).id});
  if (r() < .05 && sqs.length && home().length >= 2) await send({type: 'reinforce', squad: pick(r, sqs).id, uids: home().slice(0, 2).map(x => x.uid)});
  // 長約、駐軍、應召
  const ret = D.retainer || {};
  if (bot.style === 'contract' || bot.style === 'chaos') {
    for (const o of ret.offers || []) if (r() < .3) await send({type: 'sign', id: o.id});
    for (const k of ret.mine || []) { if (k.done || k.void) continue;
      if (!(k.garrison || []).length && home().length >= 2 && r() < .3) await send({type: 'garrison', site: k.site, uids: home().slice(0, 4).map(x => x.uid)});
      for (const q of k.calls || []) if (q.state === 'open' && r() < .4) await send({type: 'answer', call: q.id, uids: home().slice(0, 4).map(x => x.uid)}); }
  }
  // 移動基地（2026-10-12）
  const R = D.hq, W = D.world || {};
  if ((bot.style === 'rover' || bot.style === 'chaos') && R) {
    if (R.parked && !R.block) {
      if (R.site && !R.site.taken && r() < .6) await send({type: 'baseSearch'});
      if (R.inTown) { if (R.jobsHere.length && r() < .3) await send({type: 'baseJob', id: R.jobsHere[0].id}); for (const d of (W.deals || []).filter(d => d.tile === R.tile && !d.mine)) await send({type: 'deal', id: d.id}); if (r() < .05) await send({type: 'buyVan'}); }
      if (r() < .1) await send({type: r() < .5 ? 'note' : 'say', text: `${bot.name} 經過 ${h}`});
      if (r() < .3) { const y = r(), t = y < .3 && W.events?.length ? pick(r, W.events).tile : y < .5 && W.sites?.length ? pick(r, W.sites).tile : pick(r, towns); await send({type: 'baseGo', tile: t}); }
    }
  }
  // 倉庫、整補
  if (r() < .15) await send({type: 'shop', kind: 'kit', base: pick(r, ['meds', 'grenades', 'smoke'])});
  if (D.store.length && r() < .15 && home().length) await send({type: 'equip', uid: pick(r, home()).uid, slot: pick(r, ['gun1', 'kit0', 'kit1', 'armor']), item: pick(r, D.store).id});
  const pk = Object.entries(D.packs || {}).find(([, p]) => p.items.length && !p.lock); if (pk && r() < .2) await send({type: 'fieldEquip', squad: pk[0], uid: pk[1].uids[0], slot: 'kit0', item: pk[1].items[0].id});
  if (r() < .1) await send({type: 'readReport', id: 'all'});
}

// 抓存檔回來檢查：不該發生的事、讀回的指紋
async function inspect() {
  const s = await admin('admin/save'); if (s.status !== 200) { issue('抓不到存檔', String(s.status)); return; }
  local = new Core(() => {}); local.load(worldSeed, s.d.save);
  try { checks.check(local); } catch (e) { issue('檢查本身出錯', e.stack?.split('\n').slice(0, 3).join(' | ')); }
  const fa = local.fingerprint(), d = new Core(() => {}); d.load(worldSeed, JSON.parse(JSON.stringify(local.save()))); const fb = d.fingerprint();
  if (fa !== fb) issue('存檔讀回後狀態不一樣', diff(JSON.parse(JSON.stringify(local.game)), JSON.parse(JSON.stringify(d.game))).slice(0, 5).join('\n    '), local.game.h);
  return {h: local.game.h, kb: Math.round(JSON.stringify(s.d.save).length / 1024)};
}

const t0 = Date.now(); let last = null;
for (let i = 1; i <= rounds; i++) {
  // 機器人們同時玩；快轉也同時送（跟指令搶著跑）
  const oops = e => issue('機器人自己出錯（測試腳本的問題）', e.stack?.split('\n').slice(0, 3).join(' | '));
  if (serial) { for (const b of bots) await turn(b).catch(oops); if (fwd) await admin('admin/forward', {hours: fwd}); }   // --serial：一個一個來（對照組：分辨是不是同時請求才出的問題）
  else await Promise.all([...bots.map(b => turn(b).catch(oops)), fwd ? admin('admin/forward', {hours: fwd}) : null]);
  if (every && i % every === 0) { last = await inspect(); console.log(`  第 ${i} 輪（${((Date.now() - t0) / 1000).toFixed(0)} 秒）遊戲第 ${last?.h} 小時（+${((last?.h - h0) / 24).toFixed(1)} 天），存檔 ${last?.kb} KB`); }
}
last = await inspect();

// ───── 報告 ─────
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`\n跑完 ${rounds} 輪，${((Date.now() - t0) / 1000).toFixed(0)} 秒；遊戲推進 ${((last.h - h0) / 24).toFixed(1)} 天；存檔 ${last.kb} KB`);
console.log(`請求：成功 ${http.ok}、被拒絕（遊戲規則）${http.refused}、4xx ${http.err4}、5xx ${http.err5}、連不上 ${http.fail}`);
console.table(Object.fromEntries(Object.entries(lat).sort((a, b) => q(b[1], .95) - q(a[1], .95)).slice(0, 14).map(([k, a]) => [k, {次數: a.length, 中位數ms: Math.round(q(a, .5)), p95ms: Math.round(q(a, .95)), 最慢ms: Math.round(Math.max(...a))}])));
if (Object.keys(errors).length) { console.log('伺服器回的錯誤：'); for (const [k, v] of Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v}×  ${k}`); }
if (http.err5 || http.fail) issue('伺服器錯誤', `5xx ${http.err5} 次、連不上 ${http.fail} 次`);
if (!issues.size) { console.log('\n沒有發現問題'); process.exit(0); }
console.log(`\n發現 ${issues.size} 種問題：`); for (const [k, e] of issues) console.log(`- ${k}（${e.n} 次）\n    ${e.text}`);
process.exit(1);
