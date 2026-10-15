// PVP 的 ASH：抓固定版本的 ASH PROTOCOL → 套補丁 → 蓋 overlay（.work/）。不動 ash_protocol 本身。
// 補丁和大部分 overlay（小隊、機器人）是從奇美拉 chimera/ash 複製來的（2026-10-15）；PVP 自己的在 overlay/src/pvp-*.js、overlay/tools/pvp/。
// 用法：node pvp/ash/build.mjs（ASH_REPO 可指向本機複本，預設 GitHub）。之後要給瀏覽器用時再加打包（照奇美拉的 build.mjs 第 5 段）
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {cp, mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), work = join(here, '.work');
const commit = readFileSync(join(here, 'ASH_COMMIT'), 'utf8').trim(), repo = process.env.ASH_REPO || 'https://github.com/darkbearlab/ash_protocol.git';
const git = (...args) => execFileSync('git', ['-C', work, ...args], {stdio: ['ignore', 'pipe', 'inherit']}).toString().trim();
if (!existsSync(join(work, '.git'))) { await mkdir(work, {recursive: true}); git('init', '-q'); }
let head = ''; try { head = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch {}
if (head !== commit) { git('fetch', '-q', '--depth', '1', repo, commit); git('checkout', '-q', '-f', commit); }
git('reset', '-q', '--hard', commit); git('clean', '-q', '-fdx');
for (const p of readdirSync(join(here, 'patches')).filter(n => n.endsWith('.patch')).sort()) { git('apply', '--whitespace=nowarn', join(here, 'patches', p)); console.log('補丁', p); }
await cp(join(here, 'overlay'), work, {recursive: true});
console.log(`ASH ${commit.slice(0, 7)} → ${work}`);
