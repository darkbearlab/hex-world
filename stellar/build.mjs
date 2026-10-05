// 產生 dist/stellar-lab.html：把劇本版模擬核心和設定對照塞進一個網頁
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const rd=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const sim=rd('./sim.js').replace(/^export\s*\{([^}]*)\};?\s*$/m,'return {$1};');
const lore=rd('./lore.js').replace(/^export\s+function/m,'function');
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});
writeFileSync(new URL('../dist/stellar-lab.html',import.meta.url),rd('./template.html').replace('/*SIM*/',()=>'const SIM=(()=>{\n'+sim+'\n})();').replace('/*LORE*/',()=>lore));
console.log('已產生 dist/stellar-lab.html');
