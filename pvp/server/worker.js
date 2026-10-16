// PVP 線上版（pvp/DESIGN.md「技術方向」）：靜態網頁（pvp/web）＋一個 Durable Object「Room」持有全站唯一的房間。
// 房間的規則、指令、每一方看得到的局面都在 pvp/ash/.work/src/pvp-room.js（本機的 tools/pvp/arena.mjs 也用同一份）。
// - 存檔：座位與種子（meta）＋這一場所有改變狀態的請求（j:000001…）；Durable Object 被回收後重播回同一個局面
// - 計時：每個階段 PHASE_MS（預設 60 秒），時間到自動結束階段（沒動的人待機）；對戰中座位 GRACE_MS（預設 2 分鐘）沒有任何請求＝投降
// - 身分：先用訪客代碼（瀏覽器自己產生的 token，存在 localStorage）；Google 登入之後再接
import './shim.js';   // 機器人的工具要 process（一定要第一個）
import {DurableObject} from 'cloudflare:workers';
import {createRoom} from '../ash/.work/src/pvp-room.js';
import {generate} from '../tools/mapgen.mjs';
import {installPvpBots} from '../ash/.work/tools/pvp/match.mjs';
import {watchMatch} from '../ash/.work/src/pvp-spectate.js';
import {replayMatch} from '../ash/.work/src/pvp-replay.js';
import {PVP_CLASSES} from '../ash/.work/src/pvp-game.js';
import Alpha from '../ash/.work/tools/pvp/bots/alpha.mjs';
import Beta from '../ash/.work/tools/pvp/bots/beta.mjs';
const tag = (k, v) => v instanceof Set ? {$set: [...v]} : v instanceof Map ? {$map: [...v]} : v;
// 觀戰的陣容：用種子抽（同一個種子一模一樣，倒回去重算才對得上）
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick4 = r => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };

const text = (t, status = 200) => new Response(t + '\n', {status, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req);
    return env.ASSETS.fetch(req);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.PHASE_MS = +(env.PHASE_MS || 60000); this.GRACE_MS = +(env.GRACE_MS || 120000);
    ctx.blockConcurrencyWhile(() => this.load());
  }
  async load() {
    const meta = await this.ctx.storage.get('meta') || {seed: 1, match: 0, seats: {A: null, B: null}, bots: {}};
    // 練習的機器人用 beta（團隊協調；新地圖上對原本的機器人 84%、對 alpha 約五五波，不會離開戰場亂逛）
    this.room = createRoom({generate, installBots: (g, o) => installPvpBots(g, {...o, bots: {A: Beta, B: Beta}}), bots: meta.bots || {}, seed: meta.seed, match: meta.match, seats: true, log: (file, o) => { if (file === 'errors.jsonl' || file === 'reports.jsonl') console.log(file, JSON.stringify(o)); }});
    Object.assign(this.room.seats, meta.seats || {});
    const entries = [...(await this.ctx.storage.list({prefix: 'j:'})).values()];
    this.room.replay(entries); this.saved = entries.length;
  }
  async save() {
    const R = this.room, S = this.ctx.storage;
    const done = R.game && R.game.status !== 'playing' && R.lastMatch;
    if (done) await S.put('last', R.lastMatch);   // 打完的那一場：玩家可以選擇存起來（/save）
    if (R.settle()) { const keys = [...(await S.list({prefix: 'j:'})).keys()]; for (let i = 0; i < keys.length; i += 128) await S.delete(keys.slice(i, i + 128)); this.saved = 0; }
    const J = R.journal, put = {};
    for (let i = this.saved; i < J.length; i++) put['j:' + String(i).padStart(6, '0')] = J[i];
    this.saved = J.length;
    put.meta = {seed: R.seed, match: R.match, seats: R.seats, bots: {...R.bots}};
    await S.put(put);
    if (R.game?.status === 'playing' && !await S.getAlarm()) await S.setAlarm(Date.now() + 5000);
  }
  // 觀戰（pvp-spectate.js）：/watch?seed=S&i=N 回傳第 N 格；同一場往下算，倒回去或換一場就從頭重算。只放記憶體（被回收了就重算，同種子一模一樣）
  // 儲存的戰鬥（Alan 2026-10-16）：replay:<id> ＝ {meta, journal}；replays ＝ 最近 60 場的清單（meta）
  async replayFrame(id, i) {
    let w = this.watch;
    if (!w || w.key !== 'r:' + id || i < w.i - 1) {
      const saved = await this.ctx.storage.get('replay:' + id); if (!saved) return {error: '找不到這場戰鬥'};
      w = this.watch = {key: 'r:' + id, i: 0, A: saved.meta.A, B: saved.meta.B, names: saved.meta.names, it: replayMatch({saved, generate, installBots: (g, o) => installPvpBots(g, {...o, bots: {A: Beta, B: Beta}})}), frame: null, done: false};
    }
    while (!w.done && w.i <= i) { const n = w.it.next(); if (n.done) { w.done = true; break; } w.frame = n.value; w.i++; }
    return {replay: id, i: w.i - 1, A: w.A, B: w.B, names: w.names, done: w.done || w.frame?.kind === 'over', ...w.frame};
  }
  watchFrame(seed, i) {
    let w = this.watch;
    if (!w || w.seed !== seed || i < w.i - 1) {   // w.i＝已經算出的格數，w.frame＝第 w.i-1 格
      let map = null; for (let s = seed; !map; s++) map = generate(s);
      const r = lcg(seed * 7 + 3), A = pick4(r), B = pick4(r);
      w = this.watch = {seed, i: 0, A, B, it: watchMatch({seed, map, A, B, bots: {A: Alpha, B: Beta}, installBots: installPvpBots}), frame: null, done: false};
    }
    while (!w.done && w.i <= i) { const n = w.it.next(); if (n.done) { w.done = true; break; } w.frame = n.value; w.i++; }
    return {seed, i: w.i - 1, A: w.A, B: w.B, bots: {A: 'alpha', B: 'beta'}, done: w.done || w.frame?.kind === 'over', ...w.frame};
  }
  // 計時與斷線
  async alarm() {
    const R = this.room, g = R.game;
    if (!g || g.status !== 'playing') return;
    const now = Date.now(), ph = R.phase;
    for (const side of ['A', 'B']) { if (R.bots[side]) continue; const s = R.seats[side]; if (!s || now - s.seen > this.GRACE_MS) { R.handle('/cmd', side, 'surrender', s?.token); break; } }
    if (g.status === 'playing' && ph && now - ph.at > this.PHASE_MS && R.phase?.no === ph.no) R.handle('/cmd', ph.side, 'end', R.seats[ph.side]?.token);
    await this.save();
    if (R.game?.status === 'playing') await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  async fetch(req) {
    const url = new URL(req.url), p = url.pathname.replace(/^\/api/, ''), side = (url.searchParams.get('side') || '').toUpperCase();
    const token = req.headers.get('x-seat') || url.searchParams.get('token'), body = req.method === 'POST' ? await req.text() : '';
    const R = this.room, mine = R.seats[side] && R.seats[side].token === token;
    if (mine) R.seats[side].seen = Date.now();
    const withTimer = o => ({...o, deadline: R.phase && R.phase.side === side ? R.phase.at + this.PHASE_MS : null, phaseMs: this.PHASE_MS});
    try {
      if (p === '/seat') { let name = ''; try { name = JSON.parse(body || '{}').name; } catch {} const r = R.seat(side, token, name); await this.save(); return json(r, r.ok ? 200 : 409); }
      if (p === '/leave') { const ok = R.leave(side, token); await this.save(); return json({ok}); }
      if (p === '/save') {
        const last = R.lastMatch || await this.ctx.storage.get('last');
        if (!last) return json({ok: false, msg: '沒有剛打完的戰鬥'}, 404);
        const who = ['A', 'B'].find(k => last.seats?.[k]?.token && last.seats[k].token === token);
        if (!who) return json({ok: false, msg: '只有這一場的玩家可以儲存'}, 403);
        if (last.savedId) return json({ok: true, id: last.savedId});
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), r = last.result || {};
        const meta = {id, at: last.at, match: last.match, A: r.A, B: r.B, winner: r.winner, rounds: r.rounds, names: {A: last.seats.A?.name || (last.bots?.A ? '機器人' : '?'), B: last.seats.B?.name || (last.bots?.B ? '機器人' : '?')}, by: who};
        await this.ctx.storage.put('replay:' + id, {meta, seed: last.seed, bots: last.bots, journal: last.journal, result: r});
        const list = (await this.ctx.storage.get('replays')) || []; list.unshift(meta); await this.ctx.storage.put('replays', list.slice(0, 60));
        last.savedId = id; if (R.lastMatch) R.lastMatch.savedId = id; await this.ctx.storage.put('last', last);
        return json({ok: true, id});
      }
      if (p === '/replays') return json((await this.ctx.storage.get('replays')) || []);
      if (p === '/watch' && url.searchParams.get('replay')) {
        const f = await this.replayFrame(url.searchParams.get('replay'), Math.max(0, +(url.searchParams.get('i') || 0)));
        return new Response(JSON.stringify(f, tag), {status: f.error ? 404 : 200, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
      }
      if (p === '/watch') {
        const seed = +(url.searchParams.get('seed') || 0) || Math.floor(Math.random() * 1e6) + 1, i = Math.max(0, +(url.searchParams.get('i') || 0));
        return new Response(JSON.stringify(this.watchFrame(seed, i), tag), {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
      }
      if (p === '/seats') return json({A: R.seats.A?.name || (R.bots.A ? '機器人' : null), B: R.seats.B?.name || (R.bots.B ? '機器人' : null), playing: R.game?.status === 'playing'});
      if (p === '/bot') { if (!Object.values(R.seats).some(s => s?.token === token)) return json({ok: false, msg: '先坐下'}, 403); const r = JSON.parse(R.handle('/bot', side, url.searchParams.get('on') === '1' ? '1' : '0', token)); await this.save(); return json(r, r.ok ? 200 : 409); }
      if (p === '/json') return json(withTimer(R.json(side)));
      if (p === '/jwait') { const t = Math.min(50, +(url.searchParams.get('t') || 25)); if (mine) await R.waitTurn(side, t); return json(withTimer(R.json(side))); }
      if (p === '/wait') { const t = Math.min(50, +(url.searchParams.get('t') || 25)); return text(await R.waitTurn(side, t)); }
      const out = R.handle(p, side, body, token);
      if (p === '/pick' || p === '/cmd' || p === '/act' || p === '/mode') await this.save();
      if (p === '/act' || p === '/view' || p === '/replay') return new Response(out, {status: out.startsWith('你沒有坐') ? 403 : 200, headers: {'content-type': out.startsWith('{') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
      return text(out);
    } catch (e) { console.log('error', p, e.stack); return text('伺服器錯誤：' + e.message, 500); }
  }
}
