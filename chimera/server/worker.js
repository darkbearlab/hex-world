// 奇美拉的伺服器（伺服器化 S1，warband/DESIGN.md「伺服器化實作計畫」）：Cloudflare Worker ＋ 一個 Durable Object「Planet」。
//
// - Planet 持有一顆大家共用的星球：遊戲核心（../core.js：沙盒、帳本、所有公司），和單人測試模式是同一份程式。
// - 時間：遊戲小時＝(現在 − 開服時間) ÷ HOUR_MS（預設一小時，現實時間一比一）。每次有請求、每次鬧鐘醒來就補算到現在；
//   鬧鐘每個遊戲小時響一次，沒人在線時間也照走。
// - 存檔：核心的完整存檔（沙盒 exportState＋帳本＋公司），gzip 後分塊存在 Durable Object 的儲存空間；每個指令與每個小時都存。
// - 身分（先做訪客）：瀏覽器自己產生一組代碼，雜湊後就是玩家 ID；一個玩家一家公司。Google 登入之後照 warband 接上。
// - 戰鬥（S1 還在瀏覽器裡跑）：fight 回傳任務資料，submit 收戰果。S2 搬到伺服器。
import {DurableObject} from 'cloudflare:workers';
import {Core, COMMANDS, QUERIES, YEARS} from '../core.js';
export {Skirmish} from './battle.js';

const json = (data, status = 200) => new Response(JSON.stringify(data, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const bad = (msg, status = 400) => json({error: msg}, status);
const CHUNK = 100000;
// 伺服器上玩家能下的指令：加速、改年長度只有單人測試模式有；放棄親自打（abort）在伺服器上不用通知
// 戰果（submit）只能由伺服器上的戰鬥交（S2），瀏覽器不能自己報
const ALLOWED = COMMANDS.filter(c => !['speed', 'yearDays', 'submit', 'abort'].includes(c));
export const battleName = (env, ticket) => `battle-${env.WORLD_VERSION || '1'}-${ticket}`;

async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
async function gzip(str) { return new Uint8Array(await new Response(new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(u8) { return new TextDecoder().decode(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

export class Planet extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ready = null; this.out = []; this.core = new Core(m => this.out.push(m)); }
  hourMs() { return Math.max(1000, +(this.env.HOUR_MS || 3600000)); }
  nowHour() { return Math.floor((Date.now() - this.meta.startedAt) / this.hourMs()); }

  /* ───── 讀檔、建世界、存檔 ───── */
  async init() {
    if (this.ready) return this.ready;
    return this.ready = (async () => { try {
      const st = this.ctx.storage, meta = await st.get('meta'), version = this.env.WORLD_VERSION || '1';
      if (meta && meta.version === version) {
        const parts = []; for (let i = 0; i < meta.chunks; i++) parts.push(await st.get('save:' + i));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        this.meta = meta; this.core.load(meta.seed, JSON.parse(await gunzip(all)));
      } else {
        // 新世界：用 WORLD_SEED 產生星球、推演歷史，開服時間就是現在
        await st.deleteAll();
        const seed = this.env.WORLD_SEED || '奇美拉-1';
        this.core.start(seed); while (this.core.year < YEARS) this.core.sim.stepYear();
        this.core.open();
        this.meta = {version, seed, startedAt: Date.now(), chunks: 0};
        await this.persist();
      }
      this.roster = await st.get('roster') || {};
      this.out = [];
      if (!(await st.getAlarm()) && this.env.PAUSED !== '1') await this.arm();
    } catch (e) { this.ready = null; throw e; } })();
  }
  async persist() {
    const st = this.ctx.storage, d = this.core.save(); d.log = d.log.slice(-500);
    const z = await gzip(JSON.stringify(d)), n = Math.ceil(z.length / CHUNK);
    for (let i = 0; i < n; i++) await st.put('save:' + i, z.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < (this.meta.chunks || 0); i++) await st.delete('save:' + i);
    this.meta.chunks = n; this.meta.savedAt = Date.now(); this.meta.bytes = z.length; await st.put('meta', this.meta);
  }

  /* ───── 時鐘 ───── */
  async arm() { const ms = this.hourMs(), next = this.meta.startedAt + (this.nowHour() + 1) * ms; await this.ctx.storage.setAlarm(next + 50); }
  // 補算到現在（每個請求、每次鬧鐘都先做）
  catchUp() { if (this.env.PAUSED === '1' || this.meta.paused) return false; const before = this.core.hour; this.core.advanceTo(this.nowHour()); return this.core.hour !== before; }
  async alarm() {
    await this.init();
    if (this.catchUp()) await this.persist();
    this.out = [];
    await this.arm();
  }

  /* ───── 請求 ───── */
  async who(req) { const t = req.headers.get('x-chimera-token') || ''; return t.length >= 16 ? 'v' + await sha('guest:' + t) : null; }
  async fetch(req) {
    await this.init();
    const url = new URL(req.url), path = url.pathname.slice(5), pid = await this.who(req);
    if (this.catchUp()) await this.persist();
    this.out = [];
    const name = pid ? this.roster[pid] : null;
    if (path === 'hello') return json({pid: !!pid, company: name, hour: this.core.hour, year: this.core.year, startedAt: this.meta.startedAt, hourMs: this.hourMs(), yearDays: this.core.game.yearDays, companies: Object.keys(this.core.game.cos).length});
    if (path === 'static') { if (!this.staticMsg) { const c = new Core(m => { if (m.type === 'static') this.staticMsg = m; }); c.w = this.core.w; c.emitStatic(); } return json(this.staticMsg); }
    if (path === 'year') { const y = +url.searchParams.get('y'); return y === this.core.year ? json({same: true, year: y}) : json({type: 'year', data: this.core.snapshot()}); }
    // 伺服器上的戰鬥打完，交戰果（只有 Skirmish 會叫，外面的請求在入口就擋掉了）
    if (path === 'internal/settle') {
      const b = await req.json(), nm = this.roster[b.owner]; if (!nm) return bad('沒有這家公司');
      const err = this.core.command({type: 'submit', ticket: b.ticket, result: b.result}, nm); await this.persist();
      return json({ok: !err, err});
    }
    if (!pid) return bad('沒有身分代碼', 401);
    if (path === 'view') return name ? json({view: this.core.view(name), hour: this.core.hour}) : json({view: null});
    if (req.method !== 'POST') return bad('不認得的請求', 404);
    let body; try { body = await req.json(); } catch { return bad('請求格式不對'); }
    if (path === 'found') {
      if (name) return bad('你已經開過公司了');
      const nm = String(body.name || '').trim().slice(0, 16);
      if (!nm) return bad('公司要有名字');
      const err = this.core.found(+body.base, nm); if (err) return bad(err);
      this.roster[pid] = nm; await this.ctx.storage.put('roster', this.roster); await this.persist();
      return json({view: this.core.view(nm)});
    }
    if (path === 'cmd') {
      if (!name) return bad('還沒開公司');
      if (!ALLOWED.includes(body.type) && !QUERIES.includes(body.type)) return bad('不認得的指令');
      const err = this.core.command(body, name), msgs = this.out.splice(0);
      // 親自打：在伺服器上開（或接回）這場戰鬥；種子留在伺服器，瀏覽器只拿到畫面
      for (const m of msgs) if (m.type === 'mission') {
        const r = await this.env.SKIRMISH.get(this.env.SKIRMISH.idFromName(battleName(this.env, m.data.id))).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission: m.data, owner: pid})}));
        const d = await r.json(); if (!r.ok) return bad(d.error || '開戰失敗', 500);
        m.data = {id: m.data.id, title: m.data.title, remote: true, state: d.state, resumed: !!d.resumed};
      }
      if (ALLOWED.includes(body.type)) await this.persist();
      return json({view: this.core.view(name, err), msgs});
    }
    return bad('不認得的請求', 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/internal/')) return new Response('not found', {status: 404});
    // 伺服器上的戰鬥：/api/battle/<任務票>/act|state，用身分代碼確認是自己的戰鬥
    const mb = url.pathname.match(env.DEV === '1' ? /^\/api\/battle\/([^/]+)\/(act|state|selftest)$/ : /^\/api\/battle\/([^/]+)\/(act|state)$/);   // selftest：開發用，機器人打完
    if (mb) {
      const t = req.headers.get('x-chimera-token') || ''; if (t.length < 16) return bad('沒有身分代碼', 401);
      const owner = 'v' + await sha('guest:' + t);
      return env.SKIRMISH.get(env.SKIRMISH.idFromName(battleName(env, decodeURIComponent(mb[1])))).fetch(new Request('https://battle/' + mb[2], {method: req.method, headers: {'content-type': 'application/json', 'x-owner': owner}, body: req.method === 'POST' ? await req.text() : undefined}));
    }
    // 開發用：開一場屬於這個瀏覽器的伺服器戰鬥（不經過任務票），測遠端操作（DEV=1 才開）
    if (env.DEV === '1' && url.pathname === '/api/dev/remote' && req.method === 'POST') {
      const t = req.headers.get('x-chimera-token') || '', owner = 'v' + await sha('guest:' + t), b = await req.json();
      return env.SKIRMISH.get(env.SKIRMISH.idFromName(battleName(env, b.mission.id))).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission: b.mission, owner})}));
    }
    // 開發用：直接開一場戰鬥、讓機器人打完（DEV=1 才開）
    if (env.DEV === '1' && url.pathname.startsWith('/api/dev/battle/')) { const [, , , , id, op] = url.pathname.split('/'); return env.SKIRMISH.get(env.SKIRMISH.idFromName('dev-' + id)).fetch(new Request('https://battle/' + op, req)); }
    if (url.pathname.startsWith('/api/')) return env.PLANET.get(env.PLANET.idFromName('planet-' + (env.WORLD_VERSION || '1'))).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
