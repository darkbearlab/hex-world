import * as Wd from '../public/js/world.js';
import * as B from '../public/js/battle.js';
function heroPlan(st) {
  const h = B.hero(st), r = B.reach(st, h), foes = B.living(st, 'enemy');
  let best = null;
  for (const [x, y] of r.tiles) for (const t of foes) { if (Math.abs(x - t.x) + Math.abs(y - t.y) !== 1) continue; const f = B.forecast(st, h, t, x, y); const s = f.aHit * f.aDmg * f.aCount - f.dHit * f.dDmg * f.dCount * 1.5; if (!best || s > best.s) best = {s, to: [x, y], target: t.id, f}; }
  if (best && !(h.hp < h.max * 0.4 && best.f.dDmg * best.f.dCount >= h.hp)) return {type: 'hero', to: best.to, act: {kind: 'attack', target: best.target}};
  const allies = B.living(st, 'ally').filter(u => !u.hero); let to = [h.x, h.y], bs = Infinity;
  for (const [x, y] of r.tiles) { const de = Math.min(...foes.map(f => Math.abs(f.x - x) + Math.abs(f.y - y))); const da = allies.length ? Math.min(...allies.map(a => Math.abs(a.x - x) + Math.abs(a.y - y))) : 0; const s = h.hp < h.max * 0.4 ? -de + da : Math.abs(de - 3) + da * 0.5; if (s < bs) { bs = s; to = [x, y]; } }
  return {type: 'hero', to, act: {kind: 'wait'}};
}
function fight(w, setup) {
  const st = B.createBattle({seed: setup.seed, biome: setup.biome, party: w.party, foes: setup.foes, order: {stance: 'follow'}});
  let g = 0; while (!st.result && g++ < 60) B.act(st, heroPlan(st));
  if (!st.result) st.result = 'retreat';
  return Wd.applyBattle(w, setup, st);
}
const stats = {over: 0, days: [], party: [], gold: [], fallen: 0, deserted: 0, battles: 0, camps: 0};
for (let s = 1; s <= 40; s++) {
  const w = Wd.newWorld(s, '測試'); w.allLog = []; const ol = w.log; w.log = new Proxy(ol, {get(t, k) { if (k === 'unshift') return (x) => { w.allLog.push(x.text); return t.unshift(x); }; return Reflect.get(t, k); }});
  let guard = 0;
  while (!w.over && w.day < 45 && guard++ < 2000) {
    if (w.pendingBattle) { fight(w, w.pendingBattle); continue; }
    const enc = Wd.bandAt(w, w.pos);
    if (enc) { Wd.worldAct(w, {type: Wd.partyPower(w.party) > Wd.partyPower(enc.foes) * 0.9 ? 'engage' : 'evade', band: enc.id}); continue; }
    const here = Wd.siteAt(w, w.pos), t = Wd.town(w);
    try {
      if (here && here.kind === 'village' && Wd.daysOfFood(w) < 5 && here.food > 0 && w.gold > 5) { Wd.worldAct(w, {type: 'buyFood', n: Math.min(here.food, w.party.length * 5, w.gold - 2)}); continue; }
      if (here && here.kind === 'town') {
        if (w.contracts.some(c => c.done && c.taken)) { Wd.worldAct(w, {type: 'claim'}); continue; }
        if (Wd.daysOfFood(w) < 5 && w.gold > 20) { Wd.worldAct(w, {type: 'buyFood', n: Math.min(Math.floor((w.gold - 10) / here.foodPrice), w.party.length * 6)}); continue; }
        if (w.party.length < 5 && t.recruits.length && w.gold > t.recruits[0].wage * 2 + 60) { Wd.worldAct(w, {type: 'hire', id: t.recruits[0].id}); continue; }
        const hurt = w.party.some(m => m.hp < m.max * 0.7);
        if (hurt && w.gold > w.party.length * 2 + 30) { Wd.worldAct(w, {type: 'rest', days: 1}); continue; }
        const c = w.contracts.find(c => !c.taken); if (c) Wd.worldAct(w, {type: 'takeContract', id: c.id});
      }
      // 目標：有接委託而且夠強 → 去打；否則巡邏村莊
      const job = w.contracts.find(c => c.taken && !c.done), site = job && w.sites.find(s => s.id === job.site);
      const strong = Wd.partyPower(w.party) > (site?.kind === 'camp' ? 55 : 30) && w.party.every(m => m.hp > m.max * 0.6);
      if (site && site.alive && strong) { if (Wd.hexDist(site.pos, w.pos) === 0) Wd.worldAct(w, {type: 'assault', site: site.id}); else Wd.worldAct(w, {type: 'travel', to: Wd.findPath(w, w.pos, site.pos)[0]}); continue; }
      const dest = Wd.daysOfFood(w) < 3 || w.party.some(m => m.hp < m.max * 0.5) || w.contracts.some(c => c.done) ? t.pos : w.sites.filter(s => s.kind === 'village')[w.day % 3].pos;
      if (Wd.hexDist(dest, w.pos) === 0) Wd.worldAct(w, {type: 'rest', days: 1, inn: false}); else Wd.worldAct(w, {type: 'travel', to: Wd.findPath(w, w.pos, dest)[0]});
    } catch (e) { Wd.worldAct(w, {type: 'rest', days: 1, inn: false}); }
  }
  stats.over += w.over ? 1 : 0; stats.days.push(w.day); stats.party.push(w.party.length); stats.gold.push(w.gold); stats.fallen += w.fallen.length; stats.battles += w.battles; stats.camps += w.sites.filter(s => s.kind === 'camp' && !s.alive).length;
  stats.deserted += w.log.filter(l => l.text.includes('不告而別')).length;
  stats.unpaid = (stats.unpaid || 0) + w.allLog.filter(l => l.includes('發不出來')).length; stats.hungry = (stats.hungry || 0) + w.allLog.filter(l => l.includes('吃光')).length; stats.paid = (stats.paid || 0) + w.allLog.filter(l => l.includes('發了這週')).length;
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(stats.unpaid, 'unpaid', stats.paid, 'paid', stats.hungry, 'hungry');console.log(`40 局（上限 45 天）：主角陣亡 ${stats.over} 局，平均存活 ${avg(stats.days)} 天，結束時隊伍 ${avg(stats.party)} 人，金幣 ${avg(stats.gold)}；同伴陣亡共 ${stats.fallen}、不告而別 ${stats.deserted}；戰鬥 ${stats.battles} 場、拔掉山寨 ${stats.camps} 個`);
