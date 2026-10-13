// 性格技能（Alan 2026-10-13，chimera-talents.js）：每種性格的四個技能全點、11 級，機器人小隊打幾種戰場。
// 檢查：不出錯、打得完、各技能真的有觸發（看戰報和狀態）、廢料只有進場給的和戰場回收的；最後和沒有技能（1 級、同一批種子）比勝率。
// node tools/chimera/talent-check.mjs [--seeds 2] [--types probe,hold,clear,assault]
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {TALENTS, TALENT_ROWS, engineerScrap} from '../../../../company.js';
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const seeds = +opt('seeds', 2), types = opt('types', 'probe,hold,clear,assault').split(',');
const BASE = {soldier: {hp: 100, acc: 8, eva: 0, mel: 0}, recon: {hp: 100, acc: 0, eva: 10, mel: 0}, bulwark: {hp: 100, acc: 0, eva: 0, mel: 0}, berserker: {hp: 160, acc: -10, eva: 0, mel: 0}, engineer: {hp: 100, acc: 0, eva: 0, mel: 0}};
const SQUADS = [['soldier', 'recon', 'bulwark', 'berserker'], ['engineer', 'soldier', 'berserker', 'recon']];
const grow = (cls, lv) => { const g = TALENTS[cls].grow, n = Math.floor((lv - 1) / 2); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v * n])); };
const member = (cls, i, path, lv) => ({id: `${cls[0].toUpperCase()}${i}`, cls, st: {...BASE[cls]}, lv, skills: [], tal: path == null ? [] : TALENT_ROWS.map(r => TALENTS[cls].rows[r][path].id), grow: path == null ? {} : grow(cls, lv), scrap: cls === 'engineer' ? engineerScrap(lv) : 0});
// 戰報裡看得到的觸發（其他的看狀態）
const SIGNS_UNUSED = {sol_charge: /衝鋒！/, sol_line: /對移動的敵人開火/, sol_stand: /咬著牙撐住/, rec_hitrun: /打完就走/, rec_dodge: /閃身/, bul_guard: /擋下/, bul_knock: /打退一格/, bul_wall: /掩體打爛/,
  ber_execute: /處決/, ber_rehook: /收回鉤鎖/, ber_roar: /怒吼/, ber_slaughter: /殺紅了眼/, ber_undying: /不肯倒下/, eng_cover: /立起一塊掩體/, eng_mine: /埋下一顆絆雷/, eng_boom: /機體爆開/};
const rows = [], fired = {}, bad = [];
for (const [si, cls] of SQUADS.entries()) for (const path of [null, 0, 1, 2]) for (const type of types) for (let seed = 1; seed <= seeds; seed++) {
  const lv = path == null ? 1 : 11, squad = cls.map((c, i) => member(c, i, path, lv));
  const H = +opt('hard', 1), units = {trooper: 12 * H, trooper_heavy: 4 * H, shotgunner: 4 * H, raider: 6 * H};   // --hard 2：敵人加倍（看倒下時的技能）
  let g; try { g = new SquadGame({seed: seed * 101 + si, faction: 'loyalist', type, biome: '旱原', night: seed % 2 === 0, enemy: {units, veh: {}, boss: null}, squad}); }
  catch (e) { bad.push(`建不起來 ${cls.join('/')} 性格${path} ${type}：${e.stack}`); continue; }
  const logs = [], log0 = g.log.bind(g); g.log = (m, ...a) => { logs.push(String(m)); return log0(m, ...a); };
  const eng = g.members.find(m => m.character === 'engineer'), scrap0 = eng?.scrap || 0; let scrapMax = scrap0, salvage = 0;
  const errs = []; const {botFor} = installFullSquad(g, {onError: e => errs.push(e)});
  let n = 0;
  try { while (g.status === 'playing' && n++ < 6000) { botFor(g.player).step(); if (eng) { scrapMax = Math.max(scrapMax, eng.scrap || 0); } } }
  catch (e) { errs.push(e.stack || String(e)); }
  if (eng && path === 1) salvage = 3 * g.enemies.filter(e => e.hp <= 0).length;   // 工廠路線有戰場回收
  if (errs.length) bad.push(`${cls.join('/')} 性格${path} ${type} 種子${seed}：${errs[0].slice(0, 400)}`);
  if (eng && scrapMax > scrap0 + salvage) bad.push(`${cls.join('/')} 性格${path} ${type}：廢料變多了 ${scrap0} → ${scrapMax}（戰場回收最多 ${salvage}）`);
  if (path != null) { for (const m of g.members) for (const id of m.chimeraTal || []) fired[id] ??= 0; for (const [id, k] of Object.entries(g.chimeraFired || {})) fired[id] = (fired[id] || 0) + k; }
  rows.push({squad: si, path: path ?? '-', type, seed, status: g.status, turns: g.turn, alive: g.members.filter(m => m.hp > 0).length, kills: g.enemies.filter(e => e.hp <= 0).length});
  console.log(JSON.stringify(rows.at(-1)));
}
const won = p => { const R = rows.filter(r => r.path === p); return `${R.filter(r => r.status === 'won').length}/${R.length} 勝、平均 ${(R.reduce((a, r) => a + r.turns, 0) / Math.max(1, R.length)).toFixed(0)} 回合、平均活 ${(R.reduce((a, r) => a + r.alive, 0) / Math.max(1, R.length)).toFixed(1)} 人`; };
console.log(`沒有技能（1 級）：${won('-')}`); for (const p of [0, 1, 2]) console.log(`性格 ${p}（11 級）：${won(p)}`);
const all = Object.values(TALENTS).flatMap(T => TALENT_ROWS.flatMap(r => T.rows[r].map(o => o.id)));
// ASH 的強化階數、進場給的東西：沒有觸發點
const PASSIVE = new Set(['sol_wide', 'sol_track', 'sol_supp', 'rec_unseen', 'rec_side', 'rec_break', 'rec_smoke', 'bul_anchor', 'bul_plate', 'ber_thirst', 'ber_fury', 'ber_endure', 'eng_frame', 'eng_lines', 'eng_fire', 'eng_deploy', 'eng_sentry']);
console.log('觸發次數：' + all.filter(id => !PASSIVE.has(id)).map(id => `${id} ${fired[id] || 0}`).join('、'));
console.log('其他：' + Object.entries(fired).filter(([id]) => !all.includes(id)).map(([id, k]) => `${id} ${k}`).join('、'));
console.log(bad.length ? `有 ${bad.length} 個問題：\n` + bad.join('\n') : '沒有出錯');
process.exit(bad.length ? 1 : 0);
