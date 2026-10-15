// 高強度測試第三層（Alan 2026-10-12）：遊戲實際開出的服務單（從存檔往後推，各種類型、地形、頭目、夜戰、設施、大地圖）大量自動對戰，
// 每一場都走伺服器驗證的路：瀏覽器那邊記下輸入（chimera-log 的 record）→ 經過 JSON → 伺服器一批批照順序重播（applyEntry，打完之後到的照收不播），
// 每一筆的指紋都要對得上；另外模擬伺服器中途重開（從頭重播到一半再接著播）。打完把伺服器那邊的戰果交回核心結算。
// 找的是：重播對不上（desync）、打不完卡住、戰果交不回去、結算後狀態不對。卡住或對不上的那場，任務存到 --out 資料夾，可以重現。
// 在 hex-world 根目錄跑（.work 是 build.mjs 套好補丁的 ASH）：
// node chimera/ash/.work/tools/chimera/battle-soak.mjs --save 存檔.json [--battles 40] [--seed 1] [--cap 3000] [--out 資料夾]
import '../clear-bot/lang-default.mjs';
import fs from 'fs';
import {Core} from '../../../../core.js';
import * as G from '../../../../company.js';
import {createChecks} from '../../../../stats/lib/checks.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {ClearBot} from '../clear-bot/bot.mjs';
import {applyEntry, record, fingerprint} from '../../src/chimera-log.js';
import {buildView} from '../clear-bot/perception.mjs';
import {route} from '../clear-bot/nav.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const nBattles = +opt('battles', 40), seed0 = +opt('seed', 1), CAP = +opt('cap', 2000), out = opt('out', ''), BATCH = 300;
const file = opt('save'); if (!file) { console.log('要給 --save 存檔.json'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8')), worldSeed = raw.save ? raw.seed : opt('world', '奇美拉-1');
const rng = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r = rng(seed0);

let mission = null;
const c = new Core(m => { if (m.type === 'mission') mission = m.data; }); c.load(worldSeed, raw.save || raw); c.enableNpcs();
const issues = new Map(); function issue(kind, text) { const e = issues.get(kind); if (e) { e.n++; return; } issues.set(kind, {n: 1, text}); console.log(`  ⚠ ${kind}：${text}`); }
const checks = createChecks((k, t) => issue(k, t), c.game.h); checks.seen(c);

// 測試用的公司：名冊從存檔裡最大的一家公司複製（等級、技能、裝備都是真的玩家會有的樣子），錢給夠
const K = c.sim.peek(), towns = Object.keys(K.markets).map(Number).filter(t => K.owner[t] >= 0);
const NAME = '戰鬥測試'; c.found(towns[Math.floor(r() * towns.length)], NAME); const co = c.co(NAME); co.cash += 5000;
const donor = Object.values(c.game.cos).filter(g => g.name !== NAME).sort((a, b) => b.roster.filter(x => x.alive).length - a.roster.filter(x => x.alive).length)[0];
for (const x of donor.roster.filter(x => x.alive).slice(0, 24)) { const y = JSON.parse(JSON.stringify(x)); y.uid = c.game.book.cloneSeq++; y.status = 'home'; y.keep = false; y.record = [{h: c.game.h, t: 'born', co: NAME, tile: co.base}];
  for (const s of G.SLOTS) { const it = y.gear && (s.startsWith('gun') ? y.gear.guns[+s[3]] : s.startsWith('kit') ? y.gear.kits[+s[3]] : y.gear[s]); if (it) it.id = 'I' + (co.itemSeq = (co.itemSeq || 0) + 1); }
  co.roster.push(y); }
console.log(`種子 ${worldSeed}，第 ${c.game.h} 小時；測試公司 ${co.roster.filter(x => x.alive).length} 人（照「${donor.name}」的名冊複製）；目標 ${nBattles} 場`);

// 接案：每種委託輪流接，讓服務單的類型分散
const kindsDone = {};
function acceptSome() {
  const home = () => co.roster.filter(x => x.alive && x.status === 'home' && !x.keep), h = c.game.h;
  const board = c.boardView(NAME).filter(e => !e.joined && h >= e.start && h < e.closeAt && !e.gone && e.kind !== 'drill');
  board.sort((a, b) => (kindsDone[a.kind] || 0) - (kindsDone[b.kind] || 0) || r() - .5);
  for (const e of board.slice(0, 3)) { if (home().length < 2) return;
    const side = e.kind === 'front' || e.kind === 'camp' ? (r() < .5 ? 'att' : 'def') : e.kind === 'tense' ? (r() < .5 ? 'a' : 'b') : '';
    if (!c.command({type: 'accept', kind: e.kind, tile: e.tile, side, uids: home().slice(0, 4).map(x => x.uid)}, NAME)) kindsDone[e.kind] = (kindsDone[e.kind] || 0) + 1; }
  for (const x of co.roster.filter(x => x.status === 'recovered')) c.command({type: 'revive', uid: x.uid}, NAME);
  for (const [i, q] of co.queue.entries()) if (q.ready) c.command({type: 'claim', slot: q.slot ?? i}, NAME);
}

// 通關機器人只懂 ASH 原本的目標：奇美拉的目標點（拆路障、排炸彈、破壞、奪點）它不會去站，狩獵場電梯口的選擇它也不會按。
// 看不到敵人、還有沒推完的點，就走到最近的點上站著（點上每回合推進一格）；其他時候照通關機器人
function pointStep(g, bot) {
  // 狩獵場的電梯口（畫面上跳出的選擇，按下去是 chimeraDeeper／chimeraLeave 行動）：隊伍還有七成血就往下，不然撤離
  if (g.chimeraAtExit && !g.pendingPerks) { const M = (g.members || [g.player]).filter(x => x.hp > 0), hp = M.reduce((t, x) => t + x.hp / (x.maxHp || 100), 0) / Math.max(1, M.length); return g.action(hp > .7 ? 'chimeraDeeper' : 'chimeraLeave'), true; }
  const S = g.survival, o = g.chimeraOutdoor; if (!S || !o || !['plant', 'take'].includes(o.mode) || g.pendingPerks) return false;
  const left = S.points.filter(p => p.hp > 0); if (!left.length) return false;
  if (g.enemies.some(e => e.hp > 0 && g.teamVisible(e))) return false;
  const me = g.player; if (left.some(p => p.x === me.x && p.y === me.y)) return g.action('wait'), true;
  const r = route(buildView(g, bot.memory, bot.options), q => left.some(p => p.x === q.x && p.y === q.y), {maxCost: 600});
  return r ? (g.action('move', r.first), true) : false;
}
// 一場：瀏覽器那邊打（隊長由一個獨立的機器人操作，隊員是 ASH 自己的隊員機器人），記下輸入；伺服器那邊重播
const fresh = m => { const g = new SquadGame(JSON.parse(JSON.stringify(m))); installFullSquad(g); return g; };
function battle(m, n) {
  const g = fresh(m), log = [], prints = []; let t0 = performance.now(), slow = 0;
  record(g, e => { log.push(JSON.parse(JSON.stringify(e))); prints.push(fingerprint(g)); });
  const leads = new Map(), lead = () => { let b = leads.get(g.player); if (!b) { b = new ClearBot(g, {seed: 9000 + n * 10 + leads.size}); leads.set(g.player, b); } return b; };
  let k = 0, err = null;
  try { while (g.status === 'playing' && k++ < CAP) { const a = performance.now(); pointStep(g, lead()) || lead().step(); slow = Math.max(slow, performance.now() - a); } } catch (e) { err = e; }
  const playMs = performance.now() - t0;
  // 打完之後畫面又記了幾筆（伺服器要照收不播）：補兩筆假的
  if (g.status !== 'playing' && log.length) log.push({...log[log.length - 1]}, {...log[log.length - 1]});
  if (g.status === 'playing') return {g, s: g, log, err, k, playMs, replayMs: 0, slow, div: -1, res: -1};   // 卡住的不重播（很慢，也沒意義）
  // 伺服器：一批批收，打完就不再播；每一筆比對指紋
  t0 = performance.now(); const s = fresh(m); let div = -1;
  for (let i = 0; i < log.length; i += BATCH) for (let j = i; j < Math.min(log.length, i + BATCH); j++) { if (s.status === 'playing') { try { applyEntry(s, log[j]); } catch (e) { div = div < 0 ? j : div; } } if (j < prints.length && div < 0 && fingerprint(s) !== prints[j]) div = j; }
  const replayMs = performance.now() - t0;
  // 伺服器中途重開：從頭重播到一半，接著播完
  const half = Math.floor(prints.length / 2), q = fresh(m); let res = -1;
  for (let j = 0; j < prints.length; j++) { if (q.status === 'playing') applyEntry(q, log[j]); if (j >= half && res < 0 && fingerprint(q) !== prints[j]) res = j; }
  return {g, s, log, err, k, playMs, replayMs, slow, div, res};
}

const rows = [], byType = {}; let h = c.game.h, n = 0, idle = 0;
const t00 = Date.now();
while (n < nBattles && idle < 24 * 30) {
  c.advanceTo(++h); idle++; checks.before(c);
  if (h % 6 === 0) acceptSome();
  for (const tk of c.game.book.tickets.filter(t => t.player === NAME && !t.done && t.squad)) {
    if (n >= nBattles) { c.command({type: 'resolve', ticket: tk.id}, NAME); continue; }
    mission = null; const e = c.command({type: 'fight', ticket: tk.id}, NAME);
    if (e || !mission) { c.command({type: 'resolve', ticket: tk.id}, NAME); continue; }
    n++; idle = 0; const m = mission, b = battle(m, n);
    const tag = `${m.type}${m.facility ? '（設施）' : ''}${m.size === 50 ? '（50×50）' : ''}`;
    const save = why => { if (!out) return ''; fs.mkdirSync(out, {recursive: true}); const f = `${out}/battle-${n}-${m.type}.json`; fs.writeFileSync(f, JSON.stringify({mission: m, log: b.log})); return `（任務與輸入存在 ${f}）`; };
    if (b.err) issue('戰鬥丟出例外', `${tag} 種子 ${m.seed}：${String(b.err.stack || b.err).split('\n').slice(0, 3).join(' | ')}${save()}`);
    else if (b.g.status === 'playing') issue('打不完（卡住）', `${tag} 種子 ${m.seed}：${b.k} 個行動、${b.g.turn} 回合還沒結束${save()}`);
    if (b.div >= 0) issue('伺服器重播對不上', `${tag} 種子 ${m.seed}：第 ${b.div}/${b.log.length} 筆分岔${save()}`);
    if (b.res >= 0) issue('伺服器重開後重播對不上', `${tag} 種子 ${m.seed}：第 ${b.res} 筆分岔${save()}`);
    if (b.s.status !== b.g.status) issue('伺服器跟瀏覽器的結局不一樣', `${tag}：瀏覽器 ${b.g.status}、伺服器 ${b.s.status}${save()}`);
    // 戰果交回核心（伺服器用自己重播出來的戰果）
    let se = null; if (b.s.status !== 'playing') { try { se = c.command({type: 'submit', ticket: tk.id, result: b.s.missionResult}, NAME); } catch (x) { se = 'exception ' + String(x.stack || x).split('\n').slice(0, 2).join(' | '); } }
    else c.command({type: 'resolve', ticket: tk.id}, NAME);
    if (se) issue('戰果交不回去', `${tag}：${se}`);
    const T = byType[tag] ||= {場數: 0, 贏: 0, 卡住: 0, 對不上: 0, 回合: 0, 打ms: 0, 重播ms: 0, 最慢一步ms: 0};
    T.場數++; if (b.s.status === 'won' || b.s.missionResult?.win) T.贏++; if (b.g.status === 'playing') T.卡住++; if (b.div >= 0 || b.res >= 0) T.對不上++;
    T.回合 += b.g.turn; T.打ms += b.playMs; T.重播ms = Math.max(T.重播ms, b.replayMs); T.最慢一步ms = Math.max(T.最慢一步ms, b.slow);
    if (n % 10 === 0) console.log(`  ${n} 場（${((Date.now() - t00) / 1000).toFixed(0)} 秒）`);
  }
  checks.check(c);
}
console.table(Object.fromEntries(Object.entries(byType).map(([k, T]) => [k, {...T, 回合: Math.round(T.回合 / T.場數), 打ms: Math.round(T.打ms / T.場數), 重播ms: Math.round(T.重播ms), 最慢一步ms: Math.round(T.最慢一步ms)}])));
console.log(`${n} 場，${((Date.now() - t00) / 1000).toFixed(0)} 秒；接過的委託：${JSON.stringify(kindsDone)}（打ms 是平均、重播ms 是最慢的一場）`);
if (!issues.size) { console.log('沒有發現問題'); process.exit(0); }
console.log(`\n發現 ${issues.size} 種問題：`); for (const [k, e] of issues) console.log(`- ${k}（${e.n} 次）\n    ${e.text}`);
process.exit(1);
