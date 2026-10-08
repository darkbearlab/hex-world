// 把固定版本的 ASH PROTOCOL 插進奇美拉：抓原始碼 → 套補丁 → 蓋 overlay → 建置 → 放進 public/ash/。
// 不動 ash_protocol 本身。用法：node chimera/ash/build.mjs（ASH_REPO 可指向本機複本，預設 GitHub）。
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {cp, rm, mkdir, readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scopeCss} from './scope-css.mjs';
import {createHash} from 'node:crypto';

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

// 5. 奇美拉頁面裡的 ASH（不用 iframe）：
//    - battle-dom.html：ASH 的畫面元素（index.html 的 body，去掉開機畫面與程式），放進 #ash-root；
//    - chimera.css：ASH 的樣式改寫成只作用在 #ash-root 裡，加上奇美拉的戰鬥畫面樣式（overlay/chimera-wide.css）；
//    - chimera-boot.js：載入器（版本號寫進去）；battle-test.html：單獨測試一場的頁面。
//    tools/ 底下的機器人照 ASH 的版本號引用（src/ 和彼此），入口引用機器人時也帶版本號：同一個模組只用一個網址載入一次。
const dist = join(work, 'dist'), index = await readFile(join(dist, 'index.html'), 'utf8');
const rev = index.match(/main\.js\?v=([0-9a-f]+)/)?.[1];
if (!rev) throw new Error('index.html 裡找不到 main.js 的版本號');
const dom = index.slice(index.indexOf('<div class="app">'), index.indexOf('<script type="module"'));
if (!dom.includes('id="battle"')) throw new Error('index.html 的版面變了，找不到戰場');
const styles = ['style.css', 'expansion.css'].map(n => scopeCss(readFileSync(join(work, n), 'utf8')));
const css = [...new Set(styles.flatMap(x => x.imports))].join('\n') + '\n' + styles.map(x => x.css).join('\n') + '\n' + readFileSync(join(work, 'chimera-wide.css'), 'utf8');
const toolDirs = ['tools/chimera', 'tools/clear-bot', 'tools/clear-bot/classes'];
const tools = toolDirs.flatMap(dir => readdirSync(join(work, dir)).filter(n => n.endsWith('.mjs')).map(n => [dir, n, readFileSync(join(work, dir, n), 'utf8')]));
// rev 只算 ASH 的 src/；奇美拉自己的樣式、畫面元素、機器人另外算一個 crev，改了才會換網址（service worker 對帶 ?v= 的網址只讀快取）
const crev = createHash('sha256').update([rev, css, dom, ...tools.map(t => t.join('\n'))].join('\n')).digest('hex').slice(0, 12);
await writeFile(join(dist, 'battle-dom.html'), dom);
await writeFile(join(dist, 'chimera.css'), css);
await writeFile(join(dist, 'chimera-boot.js'), readFileSync(join(work, 'chimera-boot.js'), 'utf8').replace("const REV='__REV__'", `const REV='${rev}',CREV='${crev}'`));
await cp(join(work, 'battle-test.html'), join(dist, 'battle-test.html'));
const stamp = body => body
  .replace(/(['"])((?:\.\.\/)+src\/[^'"?]+\.js)\1/g, (_, q, u) => `${q}${u}?v=${rev}${q}`)
  .replace(/(['"])((?:\.\.?\/)(?:[\w-]+\/)*[\w-]+\.mjs)\1/g, (_, q, u) => `${q}${u}?v=${crev}${q}`);
for (const dir of toolDirs) await mkdir(join(dist, dir), {recursive: true});
for (const [dir, n, body] of tools) await writeFile(join(dist, dir, n), stamp(body));
for (const n of readdirSync(join(dist, 'src')).filter(n => n.startsWith('chimera-')))
  await writeFile(join(dist, 'src', n), stamp(await readFile(join(dist, 'src', n), 'utf8')));
console.log(`版本 rev=${rev} crev=${crev}`);

// 6. 放進奇美拉的網頁
await rm(out, {recursive: true, force: true});
await cp(join(work, 'dist'), out, {recursive: true});
console.log(`ASH ${commit.slice(0, 7)} → ${out}`);
