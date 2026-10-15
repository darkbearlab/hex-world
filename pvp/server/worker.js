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
    this.room = createRoom({generate, installBots: installPvpBots, bots: meta.bots || {}, seed: meta.seed, match: meta.match, seats: true, log: (file, o) => { if (file === 'errors.jsonl' || file === 'reports.jsonl') console.log(file, JSON.stringify(o)); }});
    Object.assign(this.room.seats, meta.seats || {});
    const entries = [...(await this.ctx.storage.list({prefix: 'j:'})).values()];
    this.room.replay(entries); this.saved = entries.length;
  }
  async save() {
    const R = this.room, S = this.ctx.storage;
    if (R.settle()) { const keys = [...(await S.list({prefix: 'j:'})).keys()]; for (let i = 0; i < keys.length; i += 128) await S.delete(keys.slice(i, i + 128)); this.saved = 0; }
    const J = R.journal, put = {};
    for (let i = this.saved; i < J.length; i++) put['j:' + String(i).padStart(6, '0')] = J[i];
    this.saved = J.length;
    put.meta = {seed: R.seed, match: R.match, seats: R.seats, bots: {...R.bots}};
    await S.put(put);
    if (R.game?.status === 'playing' && !await S.getAlarm()) await S.setAlarm(Date.now() + 5000);
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
      if (p === '/seats') return json({A: R.seats.A?.name || (R.bots.A ? '機器人' : null), B: R.seats.B?.name || (R.bots.B ? '機器人' : null), playing: R.game?.status === 'playing'});
      if (p === '/bot') { if (!Object.values(R.seats).some(s => s?.token === token)) return json({ok: false, msg: '先坐下'}, 403); const r = JSON.parse(R.handle('/bot', side, url.searchParams.get('on') === '1' ? '1' : '0', token)); await this.save(); return json(r, r.ok ? 200 : 409); }
      if (p === '/json') return json(withTimer(R.json(side)));
      if (p === '/jwait') { const t = Math.min(50, +(url.searchParams.get('t') || 25)); if (mine) await R.waitTurn(side, t); return json(withTimer(R.json(side))); }
      if (p === '/wait') { const t = Math.min(50, +(url.searchParams.get('t') || 25)); return text(await R.waitTurn(side, t)); }
      const out = R.handle(p, side, body, token);
      if (p === '/pick' || p === '/cmd') await this.save();
      return text(out);
    } catch (e) { console.log('error', p, e.stack); return text('伺服器錯誤：' + e.message, 500); }
  }
}
