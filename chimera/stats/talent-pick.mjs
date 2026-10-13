// 成長改版（Alan 2026-10-13）：在角色詳細選性格技能（talent 指令）、送進戰鬥的資料（tal、grow、工兵的廢料）、舊存檔轉換（mig.tal1013）
// node chimera/stats/talent-pick.mjs [舊存檔.json]
import {readFileSync} from 'node:fs';
import {Core} from '../core.js';
import {makeSquad} from '../cases.js';
import {TALENTS, engineerScrap} from '../company.js';
let bad = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) bad++; };
const out = [], a = new Core(m => out.push(m)); a.start('奇美拉-1'); while (a.year < 100) a.stepYear();
const K = a.sim.peek(), base = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
a.found(base, '測試公司'); const co = a.co('測試公司');
ok(a.game.mig.tal1013, '新星球不用轉換（mig.tal1013 已設）');
const c = co.roster.find(x => x.alive); c.cls = 'engineer'; c.lv = 6;
ok(a.command({type: 'talent', uid: c.uid, row: 8, k: 0}, '測試公司') === '8 級才能選', '還沒到的等級不能選');
ok(a.command({type: 'talent', uid: c.uid, row: 4, k: 2}, '測試公司') === null, '4 級選第三個');
ok(a.command({type: 'talent', uid: c.uid, row: 4, k: 0}, '測試公司') === '這一級已經選過了', '選過的不能改');
ok(a.command({type: 'talent', uid: c.uid, row: 6, k: 1}, '測試公司') === null, '6 級選第二個');
ok(a.command({type: 'talent', uid: c.uid, row: 5, k: 0}, '測試公司') === '沒有這個選項', '5 級沒有選項');
ok(JSON.stringify(c.tal) === '{"4":2,"6":1}', `記在 c.tal：${JSON.stringify(c.tal)}`);
// 送進戰鬥的資料
a.advanceTo(2); const B = a.game.book, sq = makeSquad(B, '測試公司', {clones: [c], at: base, name: '測試隊'});
const tk = {id: 'T-tal', title: '測試', type: 'probe', tile: base, biome: '', night: false, enemy: {side: 'army', units: {trooper: 4}, veh: {}, boss: null, power: 20}, squad: sq.id, player: '測試公司', done: false, deadline: 1e9}; B.tickets.push(tk);
out.length = 0; const err = a.command({type: 'fight', ticket: tk.id}, '測試公司'), m = out.find(x => x.type === 'mission'), s0 = m?.data.squad[0];
ok(!err && s0, `開戰${err ? '：' + err : ''}`);
if (s0) {
  const want = [TALENTS.engineer.rows[4][2].id, TALENTS.engineer.rows[6][1].id];
  ok(JSON.stringify(s0.tal) === JSON.stringify(want), `tal ${JSON.stringify(s0.tal)}`);
  ok(s0.grow.hp === 10 && s0.grow.acc === 2 && s0.grow.drone === 10, `6 級的成長（兩次）${JSON.stringify(s0.grow)}`);
  ok(s0.scrap === engineerScrap(6) && s0.scrap === 120, `工兵 6 級的廢料 ${s0.scrap}`);
  ok(s0.picks.length === 0 && !s0.perkPicks, '不再帶舊的強化');
}
// 舊存檔轉換
const file = process.argv[2];
if (file) {
  const raw = JSON.parse(readFileSync(file, 'utf8')), save = raw.save || raw, seed = raw.seed || save.seed || '奇美拉-1';
  const had = Object.values(save.game?.cos || {}).flatMap(x => x.roster || []).filter(x => (x.picks || []).length).length;
  const b = new Core(() => {}); b.load(seed, save);
  const R = Object.values(b.game.cos).flatMap(x => x.roster);
  ok(b.game.mig.tal1013, '舊存檔轉換過了');
  ok(R.every(x => !(x.picks || []).length && x.tal && !x.perkPicks), `舊的強化清掉（原本 ${had} 人有）`);
  const note = b.game.book.inbox.filter(x => /成長改版/.test(x.text)).length;
  ok(note > 0, `通知 ${note} 家公司`);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
