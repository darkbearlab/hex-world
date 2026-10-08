// 把固定版本的 ASH PROTOCOL 插進奇美拉：抓原始碼 → 套補丁 → 蓋 overlay → 建置 → 放進 public/ash/。
// 不動 ash_protocol 本身。用法：node chimera/ash/build.mjs（ASH_REPO 可指向本機複本，預設 GitHub）。
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {cp, rm, mkdir, readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '.work'), out = resolve(here, '../public/ash');
const commit = readFileSync(join(here, 'ASH_COMMIT'), 'utf8').trim();
const repo = process.env.ASH_REPO || 'https://github.com/darkbearlab/ash_protocol.git';
const git = (...args) => execFileSync('git', ['-C', work, ...args], {stdio: ['ignore', 'pipe', 'inherit']}).toString().trim();

// 1. 抓那個版本（淺層），已經有就只重設
if (!existsSync(join(work, '.git'))) { await mkdir(work, {recursive: true}); git('init', '-q'); }
let head = ''; try { head = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch {}
if (head !== commit) { git('fetch', '-q', '--depth', '1', repo, commit); git('checkout', '-q', '-f', commit); }
git('reset', '-q', '--hard', commit); git('clean', '-q', '-fdx');

// 2. 補丁（依檔名順序）
const patches = join(here, 'patches');
for (const p of readdirSync(patches).filter(n => n.endsWith('.patch')).sort()) { git('apply', '--whitespace=nowarn', join(patches, p)); console.log('補丁', p); }

// 3. overlay：新增的檔案直接蓋上去
await cp(join(here, 'overlay'), work, {recursive: true});

// 4. 建置
execFileSync(process.execPath, ['tools/build.mjs'], {cwd: work, stdio: 'inherit'});

// 5. 奇美拉的任務頁與隊友大腦：mission.html 換入口；tools/ 底下的機器人照 ASH 的版本號引用 src/，
//    不然瀏覽器會把同一個模組載兩份
const dist = join(work, 'dist'), index = await readFile(join(dist, 'index.html'), 'utf8');
const rev = index.match(/main\.js\?v=([0-9a-f]+)/)?.[1];
if (!rev) throw new Error('index.html 裡找不到 main.js 的版本號');
await writeFile(join(dist, 'mission.html'), index.replace(`./src/main.js?v=${rev}`, `./src/chimera-entry.js?v=${rev}`));
for (const dir of ['tools/chimera', 'tools/clear-bot', 'tools/clear-bot/classes']) {
  await mkdir(join(dist, dir), {recursive: true});
  for (const n of readdirSync(join(work, dir)).filter(n => n.endsWith('.mjs'))) {
    const body = await readFile(join(work, dir, n), 'utf8');
    await writeFile(join(dist, dir, n), body.replace(/(['"])((?:\.\.\/)+src\/[^'"?]+\.js)\1/g, (_, q, u) => `${q}${u}?v=${rev}${q}`));
  }
}

// 6. 放進奇美拉的網頁
await rm(out, {recursive: true, force: true});
await cp(join(work, 'dist'), out, {recursive: true});
console.log(`ASH ${commit.slice(0, 7)} → ${out}`);
