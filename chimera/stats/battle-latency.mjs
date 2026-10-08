// 量伺服器上戰鬥每個行動的成本：回應大小（未壓縮／gzip）、伺服器運算時間、往返時間。要先開 wrangler dev（DEV=1）。
// node chimera/stats/battle-latency.mjs [網址]
import {gzipSync} from 'node:zlib';
import {Core} from '../core.js';
const base = process.argv[2] || 'http://localhost:8787';
let mission = null;
const c = new Core(m => { if (m.type === 'mission') mission = m.data; }); c.start('奇美拉-1'); while (c.year < 60) c.stepYear();
const K = c.sim.peek(), town = Object.keys(K.markets).map(Number).find(t => K.owner[t] >= 0);
c.found(town, '量測'); const G = c.co('量測');
for (const o of c.sim.opportunities().filter(x => x.kind !== 'front' && x.kind !== 'tense')) { if (!c.command({type: 'accept', kind: o.kind, tile: o.tile, side: '', uids: G.roster.filter(x => x.alive && x.status === 'home').slice(0, 4).map(x => x.uid)}, '量測')) break; }
for (let h = 1; h < 400 && !c.game.book.tickets.some(t => t.player === '量測' && !t.done); h++) c.advanceTo(h);
const tk = c.game.book.tickets.find(t => t.player === '量測' && !t.done); c.command({type: 'fight', ticket: tk.id}, '量測');
mission.id = 'lat-' + Date.now();
const H = {'content-type': 'application/json', 'x-chimera-token': 'latency-test-token-0123456789'};
let t0 = Date.now(), r = await fetch(base + '/api/dev/remote', {method: 'POST', headers: H, body: JSON.stringify({mission})}), txt = await r.text();
console.log(`開戰 ${Date.now() - t0}ms，${(txt.length / 1024).toFixed(0)} KB（gzip ${(gzipSync(txt).length / 1024).toFixed(0)} KB）`);
for (const [type, arg] of [['wait'], ['move', [1, 0]], ['move', [-1, 0]], ['move', [0, 1]], ['move', [0, -1]], ['wait'], ['wait'], ['wait']]) {
  t0 = Date.now(); r = await fetch(`${base}/api/battle/${mission.id}/act`, {method: 'POST', headers: H, body: JSON.stringify({type, arg})}); txt = await r.text(); const d = JSON.parse(txt), rt = Date.now() - t0;
  const one = JSON.stringify(d.state).length;
  console.log(`${type.padEnd(5)} 往返 ${rt}ms・伺服器 ${d.ms}ms・${d.steps?.length ?? 0} 步・${(txt.length / 1024).toFixed(0)} KB（gzip ${(gzipSync(txt).length / 1024).toFixed(0)} KB）・單份狀態 ${(one / 1024).toFixed(0)} KB${d.error ? '・' + d.error : ''}`);
}
