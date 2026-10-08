// 把固定版本的 ASH PROTOCOL 插進奇美拉：抓原始碼 → 套補丁 → 蓋 overlay → 建置 → 放進 public/ash/。
// 不動 ash_protocol 本身。用法：node chimera/ash/build.mjs（ASH_REPO 可指向本機複本，預設 GitHub）。
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {cp, rm, mkdir} from 'node:fs/promises';
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

// 5. 放進奇美拉的網頁
await rm(out, {recursive: true, force: true});
await cp(join(work, 'dist'), out, {recursive: true});
console.log(`ASH ${commit.slice(0, 7)} → ${out}`);
