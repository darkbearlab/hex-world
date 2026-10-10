// Chimera 用到的點陣圖清單（Alan 2026-10-10：給像素工作室的「Chimera 素材」瀏覽、拿來開新作品）
// node chimera/scripts/asset-manifest.mjs → chimera/public/asset-manifest.json（部署時跑，在 ASH 建置之後）
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// 資料夾 → 分類名稱（照前綴比對，越前面越優先）
const GROUPS = [
  ['donors/', '原主專屬圖（頭像、立繪、戰場）'],
  ['portraits/', '複製人頭像'],
  ['ash-outdoor/', '戶外戰場材質（Chimera）'],
  ['ash/assets/pixel/units', 'ASH 單位'],
  ['ash/assets/pixel/classes', 'ASH 職業'],
  ['ash/assets/pixel/portraits', 'ASH 頭像'],
  ['ash/assets/pixel/terrain', 'ASH 地形'],
  ['ash/assets/pixel/walls', 'ASH 牆壁'],
  ['ash/assets/pixel/doors', 'ASH 門'],
  ['ash/assets/pixel/scenery', 'ASH 場景物件'],
  ['ash/assets/pixel/nests', 'ASH 蟲巢'],
  ['ash/assets/pixel/swarm', 'ASH 蟲群'],
  ['ash/assets/pixel/civilians', 'ASH 平民'],
  ['ash/assets/pixel/fx', 'ASH 特效'],
  ['ash/assets/pixel/smoke', 'ASH 煙霧'],
  ['ash/assets/pixel/killhouse', 'ASH 訓練場'],
  ['ash/assets/pixel/comms', 'ASH 通訊'],
  ['ash/assets/pixel/loot', 'ASH 戰利品圖示'],
  ['ash/assets/pixel/faction', 'ASH 勢力標誌'],
  ['ash/assets/pixel/', 'ASH 其他點陣圖'],
  ['ash/assets/course', 'ASH 教學關卡'],
  ['ash/', 'ASH 其他'],
  ['', '其他'],
];
const out = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.toLowerCase().endsWith('.png')) continue;
    const b = readFileSync(p); if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') continue;
    const path = relative(pub, p).replace(/\\/g, '/'), group = GROUPS.find(([pre]) => path.startsWith(pre))[1];
    out.push({path, w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: st.size, group});
  }
})(pub);
out.sort((a, b) => GROUPS.findIndex(g => g[1] === a.group) - GROUPS.findIndex(g => g[1] === b.group) || a.path.localeCompare(b.path));
writeFileSync(join(pub, 'asset-manifest.json'), JSON.stringify({generated: new Date().toISOString(), base: 'https://chimera.darkbearlab.workers.dev/', items: out}));
console.log(`素材清單：${out.length} 張（${[...new Set(out.map(x => x.group))].length} 類）`);
