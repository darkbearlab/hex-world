// PVP：一方「看得到的」局面（pvp/DESIGN.md 視野與暴露）。只在這一方的階段裡呼叫（PvpGame.enter 之後：enemies＝對方的替身、seen＝這一方的迷霧）。
// 給 AI 的文字介面（tools/pvp/arena.mjs）和之後的真人介面共用；不含任何對方看不到的資訊。
import {WEAPONS} from './data.js';
import {weaponStats} from './weapons.js';
import {SKILLS} from './skills.js';
import {GRENADES} from './throwables.js';
import {isBlack} from './lighting.js';

// 地圖字元（代理回報撞字後改過：對方用 W–Z，不跟地形和我方重複）
export const MAP_LEGEND = '? 沒看過・# 牆・= 窗（看得到、打得到、不能過）・. 看得到的地板・, 看得到但全黑（裡面的人看不到）・: 記得的地板（現在看不到）・c 掩體（擋子彈、不能站）・~ 煙霧・1-4 我方・@ 我方無人機・W X Y Z 對方 1-4 號・V 對方無人機・! 對方最後被看到的位置';
const FOE_CH = 'WXYZ';

export function sideState(g, memory = {}) {
  const side = g.pvp.side, foe = g.other(side), N = g.grid.length, vis = g.visibleTiles || new Set();
  const rows = [];
  for (let y = 0; y < N; y++) {
    let r = '';
    for (let x = 0; x < N; x++) {
      const t = g.grid[y][x];
      if (!g.seen[y]?.[x]) { r += '?'; continue; }
      if (t === 0) { r += '#'; continue; }
      if (t === 2) { r += '='; continue; }
      const cover = g.props.some(o => o.type === 'cover' && o.x === x && o.y === y && (o.hp ?? 1) > 0);
      if (cover) { r += 'c'; continue; }
      const smoky = vis.has(`${x},${y}`) && (g.smoke || []).some(sm => sm.cells?.some(q => q.x === x && q.y === y));
      r += smoky ? '~' : vis.has(`${x},${y}`) ? (isBlack(g, {x, y}) ? ',' : '.') : ':';
    }
    rows.push([...r]);
  }
  const put = (x, y, ch) => { if (rows[y]?.[x] !== undefined) rows[y][x] = ch; };
  const keep = g.player;
  const own = g.sides[side].map((m, i) => {
    const slots = m.owned.map(s => { const w = WEAPONS[m.weaponBases[s]]; return {slot: s, name: w?.name || '?', melee: !!w?.melee, ammo: w?.melee ? null : m.ammo[s], mag: w?.melee ? null : weaponStats(m.weaponBases[s], m.affixes[s], m).mag, range: w?.melee ? 1 : weaponStats(m.weaponBases[s], m.affixes[s], m).range}; });
    const skills = (m.skills || []).map(id => ({id, name: SKILLS[id]?.name || id, active: (m.skillState?.[id]?.remaining || 0) > 0, cooldown: m.skillState?.[id]?.cooldown || 0}));
    const throwables = Object.fromEntries(Object.entries(GRENADES).map(([id, d]) => [id, m[d.resource] || 0]).filter(([, n]) => n > 0));
    const status = (m.traits || []).filter(t => t.turns !== undefined).map(t => `${t.id}(${t.turns})`);
    if (m.pvpExposed) status.push('exposed');
    return {id: m.squadId, n: i + 1, cls: m.character, x: m.x, y: m.y, hp: Math.max(0, m.hp), maxHp: m.maxHp, plates: m.plates || 0, armor: m.armor || 0, alive: m.hp > 0,
      acted: m.hp > 0 && !g.pvp.left.includes(m.squadId), weapon: m.weapon, slots, meds: m.meds || 0, sprays: m.sprays || 0, throwables, skills, status,
      lines: (m.productionLines || []).map(l => l.blueprint), contacts: m === keep ? (g.sensorContacts || []).map(q => ({x: q.x, y: q.y})) : (g.stash?.get(m)?.sensorContacts || []).map(q => ({x: q.x, y: q.y}))};
  });
  // 對方：任何一個我方活人看得到的（暴露中的牆後也看得到）。每個我方活人：能不能開火、命中率；不能的寫原因
  // （ASH 的 visible／teamVisible 只看「目前操作的那個人」，同一階段裡換人就會跳，所以這裡每個人都換過去算一次）
  const living = g.alive(side), seenBy = new Map();
  for (const u of living) { g.swap(u); try { for (const e of g.enemies) if (e.hp > 0 && (e.pvpExposed || g.visible(e))) { if (!seenBy.has(e)) seenBy.set(e, {}); const w = g.weapon, d = Math.abs(u.x - e.x) + Math.abs(u.y - e.y), range = w.melee ? 1 : w.range;
    const why = !g.sight(u, e) ? '沒有視線（轉角或牆）' : d > range ? `射程外（距離 ${d}／${w.name} 射程 ${range}）` : !w.melee && !g.shotClear(u, e) ? '射線被擋（隊友、掩體或其他單位）' : !w.melee && g.player.ammo[g.player.weapon] <= 0 ? '彈匣空了' : null;
    seenBy.get(e)[u.squadId] = why ? {why, d} : {chance: Math.round(g.fireChance(e)), d}; } } finally { g.swap(keep); } }
  const foes = [...seenBy].map(([e, by]) => {
    const m = e.pvpOf ? g.unit(e.pvpOf) : null;
    return {id: e.pvpOf || e.id, target: e.id, cls: m?.character || 'drone', x: e.x, y: e.y, hp: Math.max(0, e.hp), exposed: !!e.pvpExposed,
      chance: Object.fromEntries(Object.entries(by).filter(([, v]) => v.chance != null).map(([k, v]) => [k, v.chance])), by};
  });
  // 記憶：最後一次看到對方每個人的位置
  for (const f of foes) (memory.lastSeen ||= {})[f.id] = {x: f.x, y: f.y, round: g.pvp.round, hp: f.hp, cls: f.cls};
  const ghosts = Object.entries(memory.lastSeen || {}).filter(([id]) => !foes.some(f => f.id === id) && !(g.unit(id) && g.unit(id).hp <= 0)).map(([id, v]) => ({id, ...v}));
  // 地圖上放單位
  for (const gh of ghosts) put(gh.x, gh.y, '!');
  for (const a of g.allAllies) if (a.status === 'active' && a.hp > 0 && a.pvpSide === side) put(a.x, a.y, '@');
  for (const f of foes) put(f.x, f.y, f.cls === 'drone' ? 'V' : FOE_CH[g.sides[foe].findIndex(m => m.squadId === f.id)] || 'V');
  for (const u of own) if (u.alive) put(u.x, u.y, String(u.n));
  const dead = id => g.unit(id)?.hp <= 0;
  return {
    side, foe, round: g.pvp.round, maxRounds: 300, status: g.status, winner: g.pvp.winner || null,
    kills: {...g.pvp.kills}, foeLost: g.sides[foe].filter(m => m.hp <= 0).map(m => m.squadId), foeCount: g.sides[foe].length,
    left: [...(g.pvp.left || [])], map: rows.map(r => r.join('')), units: own, foes, ghosts,
    drones: g.allAllies.filter(a => a.status === 'active' && a.hp > 0 && a.pvpSide === side).map(a => ({id: a.id, kind: a.sourceId || a.kind, x: a.x, y: a.y, hp: a.hp, maxHp: a.maxHp})),
    smoke: (g.smoke || []).filter(sm => sm.cells?.some(q => vis.has(`${q.x},${q.y}`))).map(sm => ({cells: sm.cells.length, at: sm.cells[0], phasesLeft: sm.expires - g.turn + 1})),
    log: (g.pvp.log || []).slice(-6), dead: g.sides[side].filter(m => dead(m.squadId)).map(m => m.squadId),
  };
}
