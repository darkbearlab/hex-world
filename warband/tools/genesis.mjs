// 創世：用大陸沙盒推演 400 年歷史，存成戰幫開局用的世界檔 public/data/genesis.json
// 用法：node warband/tools/genesis.mjs [種子]   （預設「大陸-6」）
import {writeFileSync} from 'node:fs';
import {generate, staticOf} from '../public/js/sim/continent.js';
import {encode} from '../public/js/sim/codec.js';

const seed = process.argv[2] || '大陸-6';
const t0 = Date.now();
const w = generate(seed);
w.sim.startLive(0);   // 不放 NPC 旅人：路上的人由戰幫這一層自己生
const out = {v: 1, seed, static: staticOf(w), state: w.sim.exportState()};
writeFileSync(new URL('../public/data/genesis.json', import.meta.url), JSON.stringify(encode(out)));
console.log(`創世完成：${seed}，${Date.now() - t0} ms`);
