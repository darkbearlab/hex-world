// PVP 地圖的預覽圖（PNG）與指標；生成器本身在 mapgen.mjs
// node pvp/tools/mapgen-sheet.mjs [張數 6] [起始種子 1] → pvp/tools/out/maps.png
import {deflateSync} from 'node:zlib';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generate, N} from './mapgen.mjs';

const COL = {'.': [196, 186, 160], '#': [52, 46, 40], '=': [92, 150, 190], '+': [222, 172, 82], 'c': [128, 108, 78]};
function png(w, h, px) {
  const crcT = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function sheet(maps, S = 14, cols = 3) {
  const pad = 10, W = cols * (N * S + pad) + pad, rowsN = Math.ceil(maps.length / cols), H = rowsN * (N * S + pad) + pad, px = Buffer.alloc(W * H * 3, 30);
  const put = (x, y, c) => { const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  maps.forEach((M, k) => {
    const ox = pad + (k % cols) * (N * S + pad), oy = pad + Math.floor(k / cols) * (N * S + pad);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let c = COL[M.T[y][x]]; if (M.L?.[y]?.[x] === 0 && M.T[y][x] !== '#') c = c.map(v => v * .45 | 0);
      if (x === M.A[0] && y === M.A[1]) c = [60, 120, 255]; else if (x === M.B[0] && y === M.B[1]) c = [235, 70, 60];
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const edge = (i === 0 || j === 0) && M.T[y][x] !== '#';
        put(ox + x * S + i, oy + y * S + j, edge ? c.map(v => v * .85 | 0) : M.T[y][x] === 'c' && (i < 2 || j < 2 || i > S - 3 || j > S - 3) ? [196, 186, 160] : c);
      }
    }
    // 戰壕：半身深暗棕、全身深更暗
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = M.D?.[y]?.[x]; if (!d) continue; const c = d === 2 ? [70, 50, 30] : [120, 90, 55]; for (let j = 2; j < S - 2; j++) for (let i = 2; i < S - 2; i++) put(ox + x * S + i, oy + y * S + j, c); }
    // 第二版：矮隔板（黃線，畫在兩格之間）、鹵素燈（亮黃點）、出煙口（青色）
    for (const [[ax, ay], [bx, by]] of M.P || []) { const vert = ax !== bx, mx = Math.max(ax, bx), my = Math.max(ay, by);
      for (let t = 0; t < S; t++) for (let w = -1; w <= 0; w++) put(ox + (vert ? mx * S + w : Math.min(ax, bx) * S + t), oy + (vert ? Math.min(ay, by) * S + t : my * S + w), [240, 200, 60]); }
    for (const [x, y] of M.lamps || []) for (let j = 4; j < S - 4; j++) for (let i = 4; i < S - 4; i++) put(ox + x * S + i, oy + y * S + j, [255, 245, 150]);
    for (const [x, y] of M.vents || []) for (let j = 3; j < S - 3; j++) for (let i = 3; i < S - 3; i++) if ((i + j) % 2) put(ox + x * S + i, oy + y * S + j, [80, 220, 230]);
  });
  return png(W, H, px);
}

if (process.argv[1]?.endsWith('mapgen-sheet.mjs')) {
  const n = +(process.argv[2] || 6), s0 = +(process.argv[3] || 1), maps = [];
  for (let s = s0; maps.length < n && s < s0 + 200; s++) { const M = generate(s); if (M) maps.push(M); }
  for (const [i, M] of maps.entries()) { const m = M.m; console.log(`#${i + 1} 種子 ${M.seed}：${M.version === 2 ? `矮隔板 ${m.partitions} 段、戰壕 ${m.trench} 格、鹵素燈 ${m.lamps}、出煙口 ${m.vents}、` : `房間 ${m.rooms}、通道 ${m.doors}、環路 ${m.loops}、`}雙方最短 ${m.dist} 步、開場到中央 ${m.center} 步、視線（短／中／長）${m.runs.短}/${m.runs.中}/${m.runs.長}${M.tries ? `（重生 ${M.tries} 次）` : ''}`); }
  const out = join(dirname(fileURLToPath(import.meta.url)), 'out'); mkdirSync(out, {recursive: true});
  writeFileSync(join(out, 'maps.png'), sheet(maps)); console.log('預覽：' + join(out, 'maps.png'));
}
