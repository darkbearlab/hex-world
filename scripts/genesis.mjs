// 創世：在部署前先用 Node 跑完開服前的歷史，產生 src/genesis.json 一起打包
// 這一步大約 1～2 秒，放在 Cloudflare 免費版的單次 10ms CPU 限制裡跑不完，所以在建置階段做
import {writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {generate,staticOf,N} from '../src/sim.js';
import {encode} from '../src/codec.js';
const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
const v=k=>(toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`,'m'))||[])[1];
const seed=v('SEED')||'灰燼-1031',npc=+(v('NPC_COUNT')||25),version=v('WORLD_VERSION')||'1';
const t0=Date.now();
const w=generate(seed);
const hist=new Int8Array(w.snaps.length*N);w.snaps.forEach((s,y)=>hist.set(s.owner,y*N));
const archive=w.events.slice();
w.sim.startLive(npc);
const out={version,seed,static:staticOf(w),state:w.sim.exportState(),hist,archive};
writeFileSync(new URL('../src/genesis.json',import.meta.url),JSON.stringify(encode(out)));
console.log(`創世完成：種子「${seed}」，${w.snaps.length-1} 年歷史，${archive.length} 條紀錄，${npc} 名 NPC，${Date.now()-t0} ms`);
// 觀看網頁也要用同一份模擬常數（地形顏色、格子幾何），複製一份到 public/
copyFileSync(new URL('../src/sim.js',import.meta.url),new URL('../public/sim.js',import.meta.url));
