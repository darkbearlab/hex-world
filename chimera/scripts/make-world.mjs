// 產生新世界（Alan 2026-10-11）：×10,000＋每日結算的 150 年歷史在 Worker 上推不完（本機約 100 秒、本機 workerd 要 6 分鐘），
// 所以在本機推好、開成公司模式（還沒有公司），存成 admin/import 的格式，再傳上去。
//   node chimera/scripts/make-world.mjs [種子] [輸出檔]
//   上傳（wrangler.toml 的 WORLD_IMPORT＝"1"、WORLD_VERSION 換新號、部署後）：
//   curl -X POST -H "x-admin-token: $(cat ~/.chimera-admin-token)" -H "content-type: application/json" --data-binary @world-import.json https://chimera.darkbearlab.workers.dev/api/admin/import
import {writeFileSync} from 'node:fs';
import {YEARS} from '../sim.js';
import {Core} from '../core.js';
const [seed = '奇美拉-1', out = 'world-import.json'] = process.argv.slice(2);
const t0 = performance.now(), c = new Core(() => {}); c.start(seed); while (c.year < YEARS) c.sim.stepYear(); c.open();
const save = c.save(); writeFileSync(out, JSON.stringify({seed, save}));
const K = c.sim.peek(); let pop = 0; for (let i = 0; i < K.pop.length; i++) if (K.owner[i] >= 0) pop += K.pop[i];
console.log(`第 ${c.year} 年・人口 ${(pop / 1e6).toFixed(0)}M・勢力 ${K.fac.filter(f => f.alive).length}・城 ${Object.keys(K.markets).length}・存檔 ${(JSON.stringify(save).length / 1e6).toFixed(1)}MB・${((performance.now() - t0) / 1000).toFixed(0)} 秒 → ${out}`);
