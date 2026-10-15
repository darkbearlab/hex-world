// PVP 的 ASH：抓固定版本的 ASH PROTOCOL → 套補丁 → 蓋 overlay（.work/）。不動 ash_protocol 本身。
// 補丁和大部分 overlay（小隊、機器人）是從奇美拉 chimera/ash 複製來的（2026-10-15）；PVP 自己的在 overlay/src/pvp-*.js、overlay/tools/pvp/。
// 用法：node pvp/ash/build.mjs（ASH_REPO 可指向本機複本，預設 GitHub）。瀏覽器用的 ASH 畫面放進 pvp/web/ash/（照奇美拉的 build.mjs 第 4–6 段）
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {cp, mkdir, rm, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {scopeCss} from './scope-css.mjs';
import {fileURLToPath} from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), work = join(here, '.work');
const commit = readFileSync(join(here, 'ASH_COMMIT'), 'utf8').trim(), repo = process.env.ASH_REPO || 'https://github.com/darkbearlab/ash_protocol.git';
const git = (...args) => execFileSync('git', ['-C', work, ...args], {stdio: ['ignore', 'pipe', 'inherit']}).toString().trim();
// PVP_NO_RESET=1：不重抓、不重套補丁，只把 overlay 蓋上去再建（.work 正在被別的工具用的時候）
if (!process.env.PVP_NO_RESET) {
if (!existsSync(join(work, '.git'))) { await mkdir(work, {recursive: true}); git('init', '-q'); }
let head = ''; try { head = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch {}
if (head !== commit) { git('fetch', '-q', '--depth', '1', repo, commit); git('checkout', '-q', '-f', commit); }
git('reset', '-q', '--hard', commit); git('clean', '-q', '-fdx');
for (const p of readdirSync(join(here, 'patches')).filter(n => n.endsWith('.patch')).sort()) { git('apply', '--whitespace=nowarn', join(here, 'patches', p)); console.log('補丁', p); }
}
await cp(join(here, 'overlay'), work, {recursive: true});
console.log(`ASH ${commit.slice(0, 7)} → ${work}`);

// 4. 建置瀏覽器版（ASH 自己的 tools/build.mjs → .work/dist）
execFileSync(process.execPath, ['tools/build.mjs'], {cwd: work, stdio: 'inherit'});
// 5. PVP 頁面裡的 ASH（照奇美拉）：battle-dom.html＝ASH 畫面元素；pvp.css＝ASH 的樣式只作用在 #ash-root 裡；pvp-boot.js＝載入器
const dist = join(work, 'dist'), index = await readFile(join(dist, 'index.html'), 'utf8');
const rev = index.match(/main\.js\?v=([0-9a-f]+)/)?.[1];
if (!rev) throw new Error('index.html 裡找不到 main.js 的版本號');
const dom = index.slice(index.indexOf('<div class="app">'), index.indexOf('<script type="module"'));
if (!dom.includes('id="battle"')) throw new Error('index.html 的版面變了，找不到戰場');
const styles = ['style.css', 'expansion.css'].map(n => scopeCss(readFileSync(join(work, n), 'utf8')));
const css = [...new Set(styles.flatMap(x => x.imports))].join('\n') + '\n' + styles.map(x => x.css).join('\n') + '\n' + readFileSync(join(work, 'chimera-wide.css'), 'utf8');
const crev = createHash('sha256').update([rev, css, dom].join('\n')).digest('hex').slice(0, 12);
await writeFile(join(dist, 'battle-dom.html'), dom);
await writeFile(join(dist, 'pvp.css'), css);
await writeFile(join(dist, 'pvp-boot.js'), readFileSync(join(work, 'pvp-boot.js'), 'utf8').replace("const REV='__REV__'", `const REV='${rev}',CREV='${crev}'`));
// 6. 放進 pvp/web/ash（gitignore；CI 部署前建）
const out = resolve(here, '../web/ash');
await rm(out, {recursive: true, force: true}); await cp(dist, out, {recursive: true});
console.log(`版本 rev=${rev} crev=${crev} → ${out}`);
