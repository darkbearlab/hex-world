// 實驗室：把模擬核心塞進一個 HTML 檔，雙擊就能在瀏覽器裡跑（不用伺服器）
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const sim=readFileSync(new URL('../src/sim.js',import.meta.url),'utf8').replace(/^export\s*\{([^}]*)\};?\s*$/m,'return {$1};');
const tpl=readFileSync(new URL('../lab/template.html',import.meta.url),'utf8');
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});
writeFileSync(new URL('../dist/lab.html',import.meta.url),tpl.replace('/*SIM*/',()=>'const SIM=(()=>{\n'+sim+'\n})();'));
console.log('已產生 dist/lab.html');
