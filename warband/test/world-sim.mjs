// 世界層自動遊玩：跑商的戰幫（看得到 8 格內所有市集的行情，作弊版），看一個月下來賺不賺、會不會死
// 用法：node warband/test/world-sim.mjs [局數] [天數]
import {readFileSync} from 'node:fs';
import * as C from '../public/js/cont.js';
import * as Wd from '../public/js/world.js';
import * as B from '../public/js/battle.js';

const PACK = JSON.parse(readFileSync(new URL('../public/data/genesis.json', import.meta.url), 'utf8'));
const RUNS = +(process.argv[2] || 12), DAYS = +(process.argv[3] || 40);

function heroPlan(st) {
  const h = B.hero(st), r = B.reach(st, h), foes = B.living(st, 'enemy');
  let best = null;
  for (const [x, y] of r.tiles) for (const t of foes) { if (Math.abs(x - t.x) + Math.abs(y - t.y) !== 1) continue; const f = B.forecast(st, h, t, x, y); const s = f.aHit * f.aDmg * f.aCount - f.dHit * f.dDmg * f.dCount * 1.5; if (!best || s > best.s) best = {s, to: [x, y], target: t.id, f}; }
  if (best && !(h.hp < h.max * 0.4 && best.f.dDmg * best.f.dCount >= h.hp)) return {type: 'hero', to: best.to, act: {kind: 'attack', target: best.target}};
  const allies = B.living(st, 'ally').filter(u => !u.hero); let to = [h.x, h.y], bs = Infinity;
  for (const [x, y] of r.tiles) { const de = Math.min(...foes.map(f => Math.abs(f.x - x) + Math.abs(f.y - y))); const da = allies.length ? Math.min(...allies.map(a => Math.abs(a.x - x) + Math.abs(a.y - y))) : 0; const s = h.hp < h.max * 0.4 ? -de + da : Math.abs(de - 3) + da * 0.5; if (s < bs) { bs = s; to = [x, y]; } }
  return {type: 'hero', to, act: {kind: 'wait'}};
}
function fight(w) {
  const setup = w.pendingBattle;
  const st = B.createBattle({seed: setup.seed, biome: setup.biome, party: Wd.battleParty(w, setup), foes: setup.foes, order: {stance: 'follow'}});
  let g = 0; while (!st.result && g++ < 60) B.act(st, heroPlan(st));
  if (!st.result) st.result = 'retreat';
  return Wd.applyBattle(w, setup, st);
}
// 找一筆買賣：這裡買、8 格內某個市集賣，扣掉路上吃掉的糧
function bestDeal(w) {
  const k = C.K(), here = w.pos, room = Wd.capacity(w) - Wd.load(w);
  let best = null;
  for (const t of Object.keys(k.markets).map(Number)) {
    if (t === here || k.owner[t] < 0 || C.hdist(t, here) > 14) continue;
    const path = Wd.findPath(w, here, t); if (!path) continue;
    const days = Wd.pathHours(path) / 24;
    for (const g of (Wd.TRADE || Wd.GOODS)) {
      const q = Math.min(room, Wd.stockBales(here, g, w), Math.floor(w.gold * 0.7 / Math.max(1, Wd.basePrice(here, g) * 1.2)));
      for (let n = q; n >= 1; n = Math.floor(n * 0.6)) {
        const cost = Wd.quote(w, here, g, 'buy', n), sell = Wd.quote(w, t, g, 'sell', n), gain = sell - cost - days * (w.party.length * 1.5);
        if (!best || gain > best.gain) best = {t, g, n, gain, path, days};
      }
    }
  }
  return best && best.gain > 15 ? best : null;
}
const sum = {over: 0, gold: [], earned: [], battles: 0, fallen: 0, trades: 0, ambush: 0, days: []};
for (let s = 1; s <= RUNS; s++) {
  C.loadPack(PACK);
  const w = Wd.newWorld(s, '測試'); let plan = null, guard = 0;
  while (!w.over && w.day < DAYS && guard++ < 4000) {
    if (w.pendingBattle) { fight(w); continue; }
    const enc = Wd.bandAt(w, w.pos);
    if (enc) {
      sum.ambush++;
      const strong = Wd.partyPower(w.party) > Wd.partyPower(enc.foes) * 1.1;
      Wd.worldAct(w, {type: strong ? 'engage' : enc.kind === 'bandits' && Wd.load(w) === 0 ? 'pay' : 'evade', band: enc.id}); continue;
    }
    const here = Wd.siteAt(w, w.pos);
    try {
      if (here?.kind === 'town') {
        // 到了目的地就賣
        for (const g of (Wd.TRADE || Wd.GOODS)) if (w.cargo[g] > 0 && (!plan || plan.t === w.pos)) { Wd.worldAct(w, {type: 'sell', g, q: w.cargo[g]}); sum.trades++; }
        if (plan && plan.t === w.pos) plan = null;
        if (w.contracts.some(c => Wd.canClaimHere(w, c))) { Wd.worldAct(w, {type: 'claim'}); sum.claims = (sum.claims || 0) + 1; }
        // 有委託先做委託：護送、清狼、夠強就剿匪或從軍
        if (!plan && !w.escort) {
          const pw = Wd.partyPower(w.party), job = w.contracts.find(c => !c.taken && c.town === w.pos && (c.kind === 'escort' || (c.kind === 'wolves' && pw > 45) || (c.kind === 'merc' && pw > 70) || (c.kind === 'gang' && pw > 75)));
          if (job) { Wd.worldAct(w, {type: 'takeContract', id: job.id}); sum.jobs = (sum.jobs || 0) + 1; plan = {t: Wd.contractSite(w, job), job: job.id}; }
        }
        if (Wd.daysOfFood(w) < 6) Wd.worldAct(w, {type: 'buyFood', n: Math.ceil(Wd.eaters(w) * 10)});
        if (w.mules < 4 && w.gold > 180) Wd.worldAct(w, {type: 'buyMule'});
        if (w.party.some(m => m.hp < m.max * 0.6) && w.gold > 60) { Wd.worldAct(w, {type: 'rest', days: 1}); continue; }
        if (!plan) { const d = bestDeal(w); if (d) { Wd.worldAct(w, {type: 'buy', g: d.g, q: d.n}); plan = d; } }
        if (!plan) { // 沒生意就往別的大城走走
          const k = C.K(), ts = Object.keys(k.markets).map(Number).filter(t => t !== w.pos && k.owner[t] >= 0 && C.hdist(t, w.pos) <= 6);
          plan = {t: ts[(w.day * 7 + s) % ts.length]};
        }
      }
      if (plan?.job) { const c = w.contracts.find(x => x.id === plan.job); if (!c || c.done) plan = {t: c ? c.town : w.pos}; else if (c.kind === 'gang') { const site = Wd.contractSite(w, c); if (site === w.pos) { Wd.worldAct(w, {type: 'assault'}); continue; } plan.t = site; } }
      if (plan && plan.t < 0) plan = null;
      if (!plan) { const k = C.K(), ts = Object.keys(k.markets).map(Number).filter(t => Wd.isTown(t, k) && t !== w.pos).sort((a, b) => C.hdist(a, w.pos) - C.hdist(b, w.pos)); plan = {t: ts[0]}; }
      if (here?.kind === 'village' && Wd.daysOfFood(w) < 3) Wd.worldAct(w, {type: 'buyFood', n: 10});
      const path = Wd.findPath(w, w.pos, plan.t);
      if (!path || !path.length) { plan = null; Wd.worldAct(w, {type: 'rest', days: 1, inn: false}); continue; }
      Wd.worldAct(w, {type: 'travel', to: path[0]});
    } catch (e) { if (process.env.DBG) console.log('bot', e.message); plan = null; try { Wd.worldAct(w, {type: 'rest', days: 1, inn: false}); } catch {} }
  }
  if (w.over) (sum.where ||= []).push(`第${w.over.day}天・${w.over.where}`);
  sum.over += w.over ? 1 : 0; sum.gold.push(w.gold + Wd.cargoValue(w)); sum.earned.push(w.earned); sum.battles += w.battles; sum.fallen += w.fallen.length; sum.days.push(w.day);
  if (s === 1) console.log(w.log.slice(0, 60).reverse().map(l => `第${l.day}天 ${l.text}`).join('\n'));
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
console.log(`委託 ${sum.jobs || 0} 件、領賞 ${sum.claims || 0} 次；主角倒在：${(sum.where || []).join('、')}`);
console.log(`${RUNS} 局 × ${DAYS} 天：主角陣亡 ${sum.over}；結束時身家平均 ${avg(sum.gold)}（開局 200）；賣貨收入平均 ${avg(sum.earned)}；成交 ${sum.trades} 筆；遭遇 ${sum.ambush} 次、戰鬥 ${sum.battles} 場、同伴陣亡 ${sum.fallen}`);
