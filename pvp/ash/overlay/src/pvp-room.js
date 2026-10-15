// PVP 的一個房間（pvp/DESIGN.md）：兩個座位 A／B、選角、輪流的階段、文字指令、每一方看得到的局面（文字給 AI、JSON 給真人介面）。
// 本機的 tools/pvp/arena.mjs（HTTP）和之後的 Worker（Durable Object）共用這一份。
// createRoom({generate, installBots, bots: {A, B}, seed, match, seats, log, onWake})：seats＝true 時下指令要帶座位的 token（線上版）；generate＝地圖產生器、installBots＝機器人（只有機器人座位用）、
//   log(file, obj)＝紀錄、onWake(side)＝輪到 side 或對戰結束時通知（WebSocket 推播用）
import {PvpGame, PVP_CLASSES} from './pvp-game.js';
import {sideState, MAP_LEGEND} from './pvp-view.js';
import {CHARACTERS} from './characters.js';
import {SKILLS} from './skills.js';
import {WEAPONS} from './data.js';

const DIRS = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};
const strip = x => String(x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const CLASS_HELP = '職業（武器：射程／彈匣）：\n' + PVP_CLASSES.map(c => { const C = CHARACTERS[c];
  const w = (C.weapons || []).map(b => { const W = WEAPONS[b]; return W ? `${W.name}${W.melee ? '（近戰，相鄰）' : `（基本射程 ${W.range}／彈匣 ${W.mag}）`}` : ''; }).join('、');
  const sk = (C.skills || []).map(id => `${id}「${SKILLS[id]?.name || id}」：${strip(SKILLS[id]?.text)}`).join('；');
  return `  ${c}：生命 ${C.hp}${c === 'bulwark' ? '・護甲板 60（PVP）・護甲 6' : C.plates ? '・護甲板 ' + C.plates : ''}${C.armor && c !== 'bulwark' ? '・護甲 ' + C.armor : ''}｜${w}｜技能 ${sk}`; }).join('\n') +
  '\n  實際射程以局面裡「我方」那一行為準（職業與配件會加）。recon、ninja 有紅外線（infrared）：看得穿煙霧。丟手榴彈不會暴露位置。\n  engineer 的 workshop 在文字介面用 deploy 指令（部署生產線上的無人機）；無人機在你的人都動完後自己行動，對方打得到它，它不算人頭。';
export const HELP = `PVP 文字對戰：兩隊各 4 人，XCOM 式輪流——你的階段裡你的每個人各做「一個動作」（順序自己決定），然後換對方。先拿下對方 2 人的贏；倒地就是死。
座標：x 往右、y 往下；N＝y-1、S＝y+1、E＝x+1、W＝x-1（只能走上下左右一格）。
視野：只看得到你的人看得到的。對方開火後會「暴露」到他下個階段開始——你在任何地方都看得到他（要打他還是要有射線）。你開火也一樣會暴露。
轉角：貼著牆角的人，沒開火就看不到、也打不到；開過火（暴露中）的人，只要他打得到你，你就打得到他。全黑的地方（地圖上的 ,）裡面的人看不到，開槍的火光會照亮。窗（=）看得到、打得到、不能過。掩體（c）擋子彈、不能站。

指令（一行一個，或用 ; 分開；單位寫 A1、A2⋯ 或只寫 1、2⋯）：
  A1 move N|S|E|W          走一格（走進相鄰的敵人＝近戰）
  A1 goto x,y              朝 (x,y) 走一格（用你看過的地圖找路）
  A1 fire B2               對看得到的敵人開火（B2 是對方的單位；無人機用列表裡的 id）
  A1 reload                裝填
  A1 weapon 1              換到第 1 格武器（免費，不算動作）
  A1 throw frag|smoke|stun|emp x,y    投擲（5 格內、看得到的格子）
  A1 heal                  用醫療包（+45）
  A1 plate                 用護甲噴劑補護甲板
  A1 skill <技能 id> [B2]  用技能（grapple 鉤爪要給目標）
  A1 deploy [0]            工兵：部署生產線上的無人機
  A1 flashlight            開關手電筒（免費）
  A1 wait                  待機（下一個對方階段比較難被打中）
  A1 raw <ASH 動作> <JSON> 進階：直接送 ASH 的動作
  end                      結束這個階段（還沒動的人待機）
  surrender                投降
做失敗的指令不算動作，可以改別的再試。
距離＝曼哈頓距離（|dx|+|dy|）。開火要：看得到、在手上武器的射程內、射線沒被隊友／掩體擋住。「看到的對方」會逐人寫命中率或打不到的原因。
命中率是「你的人打他」。wait＝防守姿態（下一個對方階段比較難被打中）。全部的人都動過就自動結束階段。
` + CLASS_HELP;


export function createRoom(opts = {}) {
  const {generate, installBots, onWake} = opts, BOT = {A: !!opts.bots?.A, B: !!opts.bots?.B};
  // journal：這一場（含選角）所有改變狀態的請求，照順序重播就回到同一個局面（遊戲用種子的亂數）；Durable Object 被回收後靠它重建
  let journal = [], replaying = false;
  const log = (...a) => { if (!replaying) opts.log?.(...a); };
  // 座位：{token, name, seen}；對戰結束後保留（同一個人可以再打一場）
  const seats = {A: null, B: null};
  // 現在這個階段：{no, side, at}（計時與斷線用）
  let phaseNo = 0, phaseInfo = null;
  let seed = opts.seed ?? 1, matchBase = opts.match ?? 0, evIdx = {A: 0, B: 0}, picks = {A: null, B: null}, g = null, matchNo = 0, waiters = {A: [], B: []}, mem = {A: {}, B: {}}, since = {A: [], B: []}, before = {A: null, B: null}, lastResult = null;

  function startMatch() {
    let map = null; for (let s = seed; !map; s++) map = generate(s);   // 地圖產生器由外面給（pvp/tools/mapgen.mjs）
    g = new PvpGame({seed, map, A: picks.A, B: picks.B}); matchNo = Math.max(matchNo, matchBase) + 1;
    installBots?.(g, {onError: e => log('errors.jsonl', {match: matchNo, where: 'bot', error: e})});
    for (const s of ['A', 'B']) if (!BOT[s]) for (const m of g.sides[s]) g.brains.delete(m);
    mem = {A: {}, B: {}}; since = {A: [], B: []}; evIdx = {A: 0, B: 0}; before = {A: null, B: null};
    log('arena-log.jsonl', {match: matchNo, seed, start: {A: picks.A, B: picks.B}});
    begin('A');
  }
  const snap = side => Object.fromEntries(g.sides[side].map(m => [m.squadId, {hp: Math.max(0, m.hp), plates: m.plates || 0}]));
  // 輪到 side：機器人就直接打完它的階段，換下一邊
  const GN = {frag: '破片手榴彈', smoke: '煙霧彈', stun: '震撼彈', emp: 'EMP'};
  const howText = h => !h ? '' : h.grenade ? `（${GN[h.grenade] || h.grenade}，落在 (${h.x},${h.y})；丟手榴彈不會暴露）` : h.type === 'drone' ? '' : h.weapon ? `（${['bumpMelee', 'hookBlade', 'grapple'].includes(h.type) ? '近戰 ' : ''}${h.weapon}）` : '';
  function begin(side) {
    while (g.status === 'playing') {
      // 上一個對方階段裡自己的人怎麼了
      const ev = g.pvp.events || [];
      for (const e of ev.slice(evIdx[side])) if (g.unit(e.target)?.pvpSide === side) { const u = g.unit(e.target); since[side].push(`${e.target} 受到 ${e.dmg} 傷害，來自 ${e.byVisible ? e.by : '看不到的對手'}${howText(e.how)}${e.killed ? '，倒下了' : `（剩生命 ${Math.max(0, u.hp)}、護甲板 ${u.plates || 0}）`}`); }
      evIdx[side] = ev.length;
      if (BOT[side]) { g.phase(side); before[side] = snap(side); side = g.other(side); continue; }
      if (!g.beginPhase(side)) { side = g.other(side); continue; }
      break;
    }
    if (g.status !== 'playing') finish(); else { phaseInfo = {no: ++phaseNo, side, at: Date.now()}; wake(side); }
  }
  function finish() {
    if (!g || lastResult?.match === matchNo) return;
    phaseInfo = null; lastResult = {match: matchNo, seed, status: g.status, winner: g.pvp.winner, rounds: g.pvp.round, kills: g.pvp.kills, A: picks.A, B: picks.B, log: g.pvp.log};
    log('results.jsonl', lastResult); seed++; picks = {A: null, B: null};
    wake('A'); wake('B');
  }
  const wake = side => { const w = waiters[side]; waiters[side] = []; for (const f of w) f(); onWake?.(side); };
  const myTurn = side => g && g.status === 'playing' && g.pvp.side === side && !BOT[side];

  // 真人介面用的 JSON（pvp/web/）：同一份「看得到的」局面
  function json(side) {
    const r = lastResult && lastResult.match === matchNo && g?.status !== 'playing' ? lastResult : null;
    const base = {side, match: matchNo, seats: {A: seats.A?.name || null, B: seats.B?.name || null}, picked: !!picks[side], classes: PVP_CLASSES, result: r && {winner: r.winner, status: r.status, rounds: r.rounds, log: r.log}};
    if (!g || r) return {...base, phase: 'pick'};
    if (!myTurn(side)) return {...base, phase: 'wait', round: g.pvp.round, active: g.pvp.side};
    return {...base, phase: 'play', since: since[side], state: sideState(g, mem[side])};
  }
  function render(side) {
    if (!g || (lastResult && lastResult.match === matchNo && g.status !== 'playing')) {
      const r = lastResult && lastResult.match === matchNo ? lastResult : null;
      const tail = r ? (g?.pvp.events || []).slice(evIdx[side]).filter(e => g.unit(e.target)?.pvpSide === side).map(e => `${e.target} 受到 ${e.dmg} 傷害，來自 ${e.byVisible ? e.by : '看不到的對手'}${howText(e.how)}${e.killed ? '，倒下了' : ''}`) : [];
      const head = r ? `== 第 ${r.match} 場結束：${r.status === 'won' ? (r.winner === side ? '你贏了' : '你輸了') : '平手'}（${r.rounds} 回合）==\n${r.log.join('\n')}\n${tail.length ? '最後的傷害：' + tail.join('；') + '\n' : ''}` : '';
      return head + (picks[side] ? '你已經選好職業，等對方選。用 /wait 等開打。' : `請選 4 個職業（同隊不重複）：POST /pick，內文例如 soldier,recon,bulwark,ninja。可選：${PVP_CLASSES.join('、')}`);
    }
    if (!myTurn(side)) return `== 第 ${g.pvp.round} 回合：現在是對方（${g.pvp.side} 隊）的階段，請用 /wait?side=${side} 等 ==`;
    const s = sideState(g, mem[side]), N = s.map.length;
    const L = [];
    L.push(`== 第 ${s.round}/${s.maxRounds} 回合・你是 ${side} 隊・你的階段 ==　已拿下對方 ${s.foeLost.length} 人（${s.foeLost.join('、') || '無'}）、自己倒下 ${s.dead.length} 人（${s.dead.join('、') || '無'}）；先拿下 2 人的贏`);
    L.push(`還沒動：${s.left.join(' ') || '（都動過了）'}`);
    if (since[side].length) L.push(`上一個對方階段：${since[side].join('；')}`);
    L.push('地圖（x 往右、y 往下）：');
    L.push('    ' + Array.from({length: N}, (_, x) => Math.floor(x / 10)).join(''));
    L.push('    ' + Array.from({length: N}, (_, x) => x % 10).join(''));
    s.map.forEach((r, y) => L.push(String(y).padStart(3) + ' ' + r));
    L.push('圖例：' + MAP_LEGEND);
    L.push('我方：');
    for (const u of s.units) {
      if (!u.alive) { L.push(`  ${u.n} ${u.id} ${u.cls}：倒下`); continue; }
      const w = u.slots.map((x, i) => `[${i}]${x.name}${x.melee ? '（近戰）' : ` ${x.ammo}/${x.mag} 射程${x.range}`}${x.slot === u.weapon ? '←手上' : ''}`).join(' ');
      const th = Object.entries(u.throwables).map(([k, n]) => `${k}×${n}`).join(' ') || '無';
      const sk = u.skills.map(x => `${x.id}${x.active ? '（作用中）' : x.cooldown ? `（冷卻 ${x.cooldown}）` : '（可用）'}`).join(' ') || '無';
      L.push(`  ${u.n} ${u.id} ${u.cls} (${u.x},${u.y}) 生命 ${u.hp}/${u.maxHp} 護甲板 ${u.plates} 護甲 ${u.armor}｜${w}｜醫療包 ${u.meds} 噴劑 ${u.sprays}｜投擲 ${th}｜技能 ${sk}${u.lines.length ? '｜生產線 ' + u.lines.join(',') : ''}${u.status.length ? '｜狀態 ' + u.status.join(' ') : ''}｜${u.acted ? '已動' : '還沒動'}`);
    }
    for (const d of s.drones) L.push(`  d ${d.id} ${d.kind} (${d.x},${d.y}) ${d.hp}/${d.maxHp}（自己行動，在你的人都動完之後）`);
    L.push('看到的對方：' + (s.foes.length ? '' : '無'));
    for (const f of s.foes) L.push(`  ${f.id} ${f.cls} (${f.x},${f.y}) 地圖上是 ${s.map[f.y][f.x]}・剩 ${f.hp}（生命＋護甲板）${f.exposed ? '・暴露中（開過火，牆後也看得到）' : ''}
       ${Object.entries(f.by).map(([k, v]) => v.chance != null ? `${k} 可開火 ${v.chance}%（距離 ${v.d}）` : `${k} 不行：${v.why}`).join('；')}`);
    for (const u of s.units) if (u.contacts?.length) L.push(`  ${u.id} 的 early_warning 偵測到（偵測當下的位置）：${u.contacts.map(q => `(${q.x},${q.y})`).join(' ')}`);
    if (s.smoke.length) L.push('煙霧（地圖上的 ~）：' + s.smoke.map(x => `(${x.at.x},${x.at.y}) 一帶 ${x.cells} 格，還有 ${x.phasesLeft} 個階段`).join('；'));
    if (s.ghosts.length) L.push('最後看到：' + s.ghosts.map(x => `${x.id} ${x.cls} (${x.x},${x.y}) 第 ${x.round} 回合`).join('；'));
    if (s.log.length) L.push('戰報：' + s.log.join('；'));
    return L.join('\n');
  }

  // 用看過的地圖找路，回傳第一步的方向
  function stepToward(m, goal, ignoreFriends = false) {
    const N = g.grid.length, key = (x, y) => y * N + x, prev = new Map([[key(m.x, m.y), null]]), q = [[m.x, m.y]];
    const blocked = (x, y) => g.grid[y]?.[x] !== 1 || !g.seen[y]?.[x] || g.props.some(o => o.type === 'cover' && o.x === x && o.y === y && (o.hp ?? 1) > 0) || !ignoreFriends && g.members.some(u => u !== m && u.hp > 0 && u.x === x && u.y === y);
    while (q.length) {
      const [x, y] = q.shift();
      if (x === goal.x && y === goal.y) { let k = key(x, y), p; while ((p = prev.get(k)) !== null && p !== key(m.x, m.y)) k = p; const tx = k % N, ty = Math.floor(k / N); return [tx - m.x, ty - m.y]; }
      for (const [dx, dy] of Object.values(DIRS)) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (prev.has(k) || (blocked(nx, ny) && !(nx === goal.x && ny === goal.y && g.grid[ny]?.[nx] === 1))) continue; prev.set(k, key(x, y)); q.push([nx, ny]); }
    }
    return null;
  }
  const xy = t => { const m = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(t || ''); return m ? {x: +m[1], y: +m[2]} : null; };

  function command(side, line) {
    const words = line.trim().split(/\s+/), head = words[0]?.toLowerCase();
    if (!head) return null;
    if (head === 'end') { g.endPhase(); before[side] = snap(side); since[side] = []; begin(g.other(side)); return '結束這個階段'; }
    if (head === 'surrender') { g.status = 'won'; g.pvp.winner = g.other(side); g.pvp.log.push(`${side} 隊投降`); finish(); return '投降了'; }
    const id = /^\d$/.test(words[0]) ? side + words[0] : words[0].toUpperCase(), verb = (words[1] || '').toLowerCase(), rest = words.slice(2);
    const m = g.sides[side].find(u => u.squadId === id);
    if (!m) return `看不懂「${line}」：第一個字要是你的單位（${g.sides[side].map(u => u.squadId).join('、')}）、end 或 surrender`;
    const foeTarget = w => { if (!w) return null; const W = w.toUpperCase(); const e = g.enemies.find(e => e.hp > 0 && (e.pvpOf === W || e.id === w || e.id === 'pa-' + w)); if (!e) return null;
      const keep = g.player, seen = e.pvpExposed || g.alive(side).some(u => { g.swap(u); try { return g.visible(e); } finally { g.swap(keep); } }); return seen ? e.id : null; };
    let type, a, opt = {};
    switch (verb) {
      case 'move': { const d = DIRS[(rest[0] || '').toUpperCase()]; if (!d) return `${id} move 要接 N、S、E 或 W`; const mate = g.sides[side].find(u => u !== m && u.hp > 0 && u.x === m.x + d[0] && u.y === m.y + d[1]); if (mate) return `${id} 往 ${rest[0].toUpperCase()} 被隊友 ${mate.squadId} 擋住`; type = 'move'; a = d; break; }
      case 'goto': { const p = xy(rest.join('')); if (!p) return `${id} goto 要接座標，例如 goto 12,5`; if (p.x === m.x && p.y === m.y) return `${id} 已經在 (${p.x},${p.y})`; const mate = g.sides[side].find(u => u !== m && u.hp > 0 && u.x === p.x && u.y === p.y); if (mate) return `${id}：(${p.x},${p.y}) 站著隊友 ${mate.squadId}`; const d = stepToward(m, p); if (!d) return stepToward(m, p, true) ? `${id} 去 (${p.x},${p.y}) 的路被自己的隊友擋住了（先讓隊友讓開，或換條路）` : `${id} 用你看過的地圖找不到去 (${p.x},${p.y}) 的路（沒看過的格子不會走）`; type = 'move'; a = d; break; }
      case 'fire': case 'shoot': case 'attack': { const t = foeTarget(rest[0]); if (!t) return `${id} 的隊伍看不到「${rest[0] || ''}」（要寫「看到的對方」列表裡的 id，例如 ${g.sides[g.other(side)].find(u => u.hp > 0)?.squadId || g.other(side) + '1'}）`; type = 'fire'; opt.target = t; break; }
      case 'reload': type = 'reload'; break;
      case 'wait': type = 'wait'; break;
      case 'heal': type = 'heal'; break;
      case 'plate': type = 'plate'; break;
      case 'flashlight': type = 'flashlight'; break;
      case 'weapon': { const i = +rest[0]; if (!Number.isInteger(i) || m.owned[i] === undefined) return `${id} weapon 要接武器格的號碼（0、1⋯）`; type = 'weapon'; a = m.owned[i]; break; }
      case 'throw': case 'grenade': { const kind = (rest[0] || '').toLowerCase(), p = xy(rest.slice(1).join('')); if (!['frag', 'smoke', 'stun', 'emp'].includes(kind) || !p) return `${id} throw 要接種類和座標，例如 throw frag 12,5`; type = 'grenade'; a = {...p, grenade: kind}; if (m.prepared?.grenade !== kind) opt.pre = [{type: 'prepare', arg: {category: 'grenade', id: kind}}];   // 已經預備同一種再預備一次會被拒絕
        const res = {frag: 'grenades', smoke: 'smoke', stun: 'stun', emp: 'emp'}[kind], dd = Math.abs(p.x - m.x) + Math.abs(p.y - m.y);
        if (!(m[res] > 0)) return `${id} 沒有 ${kind}`;
        if (dd > 5) return `${id} 投擲最遠 5 格，(${p.x},${p.y}) 距離 ${dd}`;
        if (g.grid[p.y]?.[p.x] !== 1) return `${id} 只能丟在地板上（(${p.x},${p.y}) 是牆或窗）`;
        break; }
      case 'skill': { const sid = rest[0]; if (!sid) return `${id} skill 要接技能 id`; if (sid === 'workshop') return `${id}：workshop 在文字介面用 deploy（部署生產線上的無人機：${(m.productionLines || []).map(l => l.blueprint).join(',') || '生產線是空的'}）`; type = 'skill'; a = sid; const t = foeTarget(rest[1]); if (t) opt.target = t; break; }
      case 'deploy': type = 'deployUnit'; a = {line: +(rest[0] || 0)}; break;
      case 'raw': { type = rest[0]; try { a = rest.length > 1 ? JSON.parse(rest.slice(1).join(' ')) : undefined; } catch { return `${id} raw 的參數要是 JSON`; } break; }
      default: return `看不懂動作「${verb}」（help 看指令）`;
    }
    const r = g.actAs(id, type, a, opt);
    if (g.status !== 'playing') finish();
    if (r.ok && type === 'move') r.msg = `現在在 (${m.x},${m.y})` + (r.msg ? '。' + r.msg : '');
    if (!r.ok && type === 'grenade') r.msg = (r.msg || '') + '（落點要是你這個人現在看得到的格子）';
    return `${r.ok ? '成功' : '失敗'}${r.done ? '（這個人這一階段動過了）' : ''}${r.msg ? '：' + r.msg : ''}`;
  }

  function handle(p, side, body = '', token = null) {
    side = (side || '').toUpperCase();
    if (opts.seats && ['/pick', '/cmd', '/report'].includes(p) && ['A', 'B'].includes(side) && (!seats[side] || seats[side].token !== token)) return '你沒有坐這個座位（先坐下：/seat）';
    if (['/pick', '/cmd'].includes(p) && !replaying) journal.push({p, side, body});
    if (seats[side] && token && seats[side].token === token) seats[side].seen = Date.now();
    if (p === '/help') return HELP;
    if (!['A', 'B'].includes(side)) return '要給 side=A 或 side=B';
    if (BOT[side]) return `${side} 是機器人的座位`;
    if (p === '/state') return render(side);
    if (p === '/json') return JSON.stringify(json(side));
    if (p === '/report') { log('reports.jsonl', {match: matchNo, side, round: g?.pvp.round, text: body}); return '收到，謝謝'; }
    if (p === '/pick') {
      if (g && g.status === 'playing') return '對戰進行中，不能選';
      const L = body.split(/[\s,，、]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (L.length !== 4 || new Set(L).size !== 4 || !L.every(c => PVP_CLASSES.includes(c))) return `要選 4 個不同的職業：${PVP_CLASSES.join('、')}`;
      picks[side] = L;
      for (const s of ['A', 'B']) if (BOT[s] && !picks[s]) picks[s] = [...PVP_CLASSES].sort(() => Math.random() - .5).slice(0, 4);
      
      if (picks.A && picks.B) { lastResult = null; startMatch(); }
      return `選好了：${L.join('、')}。` + (picks.A && picks.B ? '開打！用 /wait 等輪到你。' : '等對方選。');
    }
    if (p === '/cmd') {
      if (!myTurn(side)) return render(side);
      const out = [];
      for (const line of body.split(/[\n;]+/)) {
        if (!line.trim()) continue;
        if (!myTurn(side)) { out.push(`${line.trim()} → 略過（已經不是你的階段）`); continue; }
        let r;
        try { r = command(side, line); }
        catch (e) { r = '伺服器錯誤（已記錄，開發者會修）：' + (e.pvpMsg || e.message); log('errors.jsonl', {match: matchNo, side, round: g?.pvp.round, line, error: e.stack}); }
        if (r === null) continue;
        out.push(`${line.trim()} → ${r}`);
        log('arena-log.jsonl', {match: matchNo, side, round: g?.pvp.round, line: line.trim(), result: r});
        if (myTurn(side) && g.pvp.left.length === 0 && !/^end\b/i.test(line.trim())) { g.endPhase(); before[side] = snap(side); since[side] = []; out.push('（全部的人都動過了，自動結束階段）'); begin(g.other(side)); }
      }
      return out.join('\n') + '\n\n' + render(side);
    }
    return '沒有這個路徑（/help）';
  }

  async function waitTurn(side, t) {
    const done = () => myTurn(side) || (!picks[side] && (!g || g.status !== 'playing'));   // 輪到我，或該我選職業（對戰結束後）
    if (!done()) await new Promise(r => { const timer = setTimeout(r, t * 1000); waiters[side].push(() => { clearTimeout(timer); r(); }); });
    return done() ? render(side) : `還在等對方（第 ${g?.pvp.round} 回合），再呼叫一次 /wait?side=${side}`;
  }

  // 坐下：空位、或同一個 token 回來（斷線重連）就成功
  function seat(side, token, name) {
    side = (side || '').toUpperCase(); if (!['A', 'B'].includes(side) || !token) return {ok: false, msg: '座位是 A 或 B'};
    if (BOT[side]) return {ok: false, msg: `${side} 是機器人的座位`};
    const s = seats[side];
    if (s && s.token !== token) return {ok: false, msg: `${side} 已經有人坐了（${s.name}）`};
    for (const o of ['A', 'B']) if (o !== side && seats[o]?.token === token) return {ok: false, msg: `你已經坐在 ${o}`};
    seats[side] = {token, name: String(name || '訪客').slice(0, 24), seen: Date.now()}; return {ok: true, side};
  }
  // 離開座位：對戰中離開＝投降
  function leave(side, token) {
    if (!seats[side] || seats[side].token !== token) return false;
    if (g?.status === 'playing') handle('/cmd', side, 'surrender', token);
    seats[side] = null; if (!g || g.status !== 'playing') picks[side] = null; return true;
  }
  // 重播紀錄（Durable Object 重建時）
  function replay(entries) { replaying = true; try { for (const e of entries) handle(e.p, e.side, e.body, seats[e.side]?.token); } finally { replaying = false; } journal = entries.slice(); }
  // 對戰結束以後，紀錄可以清掉（下一場從新的種子開始）
  function settle() { if (g && g.status !== 'playing') { journal = []; return true; } return false; }
  return {
    seat, leave, replay, settle, seats, get phase() { return phaseInfo; }, get seed() { return seed; }, get journal() { return journal; },
    handle, render, json, waitTurn, myTurn, HELP, bots: BOT,
    get game() { return g; }, get match() { return matchNo; }, get result() { return lastResult; },
  };
}
