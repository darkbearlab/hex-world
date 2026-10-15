// PVP 文字對戰伺服器（給 AI 代理用；pvp/DESIGN.md）：一場對戰、兩個座位 A／B，每一方只拿得到自己看得到的局面。
// node pvp/ash/build.mjs && node pvp/ash/.work/tools/pvp/arena.mjs [--port 8790] [--A bot] [--B bot] [--seed 1] [--out 資料夾]
//   GET  /help                     指令說明
//   POST /pick?side=A   內文 soldier,recon,bulwark,ninja   暗選 4 個職業（同隊不重複）；兩邊都選好就開打
//   GET  /wait?side=A[&t=50]       等到輪到你（或對戰結束），回傳局面；最多等 t 秒
//   GET  /state?side=A             現在的局面（不是你的階段也可以看，但只會說在等對方）
//   POST /cmd?side=A[&wait=1]  內文 一行一個指令（或用 ; 分開）   做完回傳結果和新的局面；全部的人都動過就自動結束階段
//                              wait=1：階段結束後直接等到下一個你的階段（最多 50 秒），一次呼叫打一回合
//   POST /report?side=A 內文 任何問題、bug、看不懂的地方   記到回報檔，開發者會看
// 紀錄：<out>/arena-log.jsonl（每個指令和結果）、errors.jsonl（伺服器錯誤）、reports.jsonl（代理的回報）、results.jsonl（每場結果）
import './lang-zh.mjs';   // 遊戲訊息用中文
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import '../clear-bot/lang-default.mjs';
import '../../src/game.js';
import {createRoom} from '../../src/pvp-room.js';
import {generate} from '../../../../tools/mapgen.mjs';
import {installPvpBots} from './match.mjs';


const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('port', 8790), OUT = arg('out', path.resolve('pvp-arena-out')), BOT = {A: arg('A') === 'bot', B: arg('B') === 'bot'};
let seed = +arg('seed', 1);
const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../../../../web');   // pvp/web（真人介面）
fs.mkdirSync(OUT, {recursive: true});
const append = (file, o) => fs.appendFileSync(path.join(OUT, file), JSON.stringify({t: new Date().toISOString(), ...o}) + '\n');

const room = createRoom({generate, installBots: installPvpBots, bots: BOT, seed, log: append});

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', async () => {
    const url = new URL(req.url.replace(/^\/api(?=\/)/, ''), 'http://x'), side = (url.searchParams.get('side') || '').toUpperCase();
    let text;
    try {
      const ok = ['A', 'B'].includes(side) && !room.bots[side], t = Math.min(120, +(url.searchParams.get('t') || 50));
      if (url.pathname === '/seat' || url.pathname === '/seats' || url.pathname === '/leave') { res.writeHead(200, {'content-type': 'application/json'}); return res.end(JSON.stringify(url.pathname === '/seats' ? {A: null, B: null, local: true} : {ok: true, side})); }   // 本機不管座位
      if (url.pathname === '/json' && ok) text = JSON.stringify({...room.json(side), local: true});
      else if (url.pathname === '/wait' && ok) text = await room.waitTurn(side, t);
      else if (url.pathname === '/jwait' && ok) { await room.waitTurn(side, t); text = JSON.stringify({...room.json(side), local: true}); }
      else if (url.pathname === '/' || url.pathname.startsWith('/web/')) {
        const f = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname.slice(5).replace(/\.\./g, ''));
        if (fs.existsSync(f)) { res.writeHead(200, {'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'}); return res.end(fs.readFileSync(f)); }
        text = 'not found';
      }
      else {
        text = room.handle(url.pathname, side, body);
        if (url.pathname === '/cmd' && ok && url.searchParams.get('wait') && !room.myTurn(side) && room.game?.status === 'playing') text = text.slice(0, text.lastIndexOf('\n\n')) + '\n\n' + await room.waitTurn(side, t);
      }
    } catch (e) { text = '伺服器錯誤：' + e.message; append('errors.jsonl', {path: req.url, error: e.stack}); }
    res.writeHead(200, {'content-type': 'text/plain; charset=utf-8'}); res.end(text + '\n');
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`PVP 文字對戰：http://127.0.0.1:${PORT}/help　紀錄在 ${OUT}${room.bots.A ? '　A＝機器人' : ''}${room.bots.B ? '　B＝機器人' : ''}`));
