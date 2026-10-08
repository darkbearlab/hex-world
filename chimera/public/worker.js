// 單人測試模式（伺服器化 S0）：遊戲核心（core.js）跑在瀏覽器的背景，這裡只負責傳訊與時鐘。
// 開局：一年一年推演沙盒歷史，每推完一年送回畫面；開公司後用加速時鐘（速度選單）推進遊戲小時。
// 伺服器版用同一份 core.js，改成依現實時間推進（warband/DESIGN.md「伺服器化實作計畫」）。
import {Core, COMMANDS, QUERIES, YEARS} from './core.js';

const core = new Core(msg => postMessage(msg));
core.pauseOnFight = true;   // 單人測試：親自打的時候時間停住
let me = null;              // 這個瀏覽器開的那家公司
let target = 0, running = false, clock = null, acc = 0;

function loop() {
  if (!running) return;
  if (core.year >= target) { running = false; postMessage({type: 'idle', year: core.year}); return; }
  core.stepYear();
  setTimeout(loop, 0);
}
// 加速時鐘：每 250 毫秒推進 speed/4 個遊戲小時（一次最多 48 小時）
function tick() {
  const game = core.game; if (!game || !game.speed) return;
  acc += game.speed / 4; let n = 0;
  while (acc >= 1 && n < 48) { acc--; n++; }
  if (n) core.advanceTo(core.hour + n);
  postMessage(core.view(me));
}

onmessage = e => {
  const m = e.data;
  if (m.type === 'found') { running = false; me = m.name || '我的公司'; const err = core.found(m.base, me); if (err) { me = null; return; } acc = 0; clearInterval(clock); clock = setInterval(tick, 250); postMessage(core.view(me)); return; }
  if (me && (COMMANDS.includes(m.type) || QUERIES.includes(m.type))) { const err = core.command(m, me); postMessage(core.view(me, err)); return; }
  if (m.type === 'start') { running = false; clearInterval(clock); core.start(m.seed); target = m.years || YEARS; running = true; loop(); }
  else if (m.type === 'more') { target = core.year + (m.years || 50); if (!running) { running = true; loop(); } }
  else if (m.type === 'stop') running = false;
};
