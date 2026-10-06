// 奇幻戰幫：共享世界的伺服器（Cloudflare Worker ＋ 一個 Durable Object）
//
// 架構
// - 一個 Durable Object「Realm」持有整個大陸沙盒（和單人版同一份 sim 與規則），用鬧鐘每 TICK_SECONDS 秒推進一個時段（6 小時）。
// - 每個玩家的戰幫狀態存在伺服器上；玩家的每個行動都送到這裡，由伺服器執行 worldAct，瀏覽器只負責畫面。
// - 玩家的行動花「行動點」（1 AP = 1 小時），AP 隨現實時間回復，速度和世界時鐘一樣；離線時戰幫原地不動，不吃糧也不發餉。
// - 戰鬥在瀏覽器裡跑（規則是決定性的），打完把每一步的操作送回來，伺服器照同樣的種子重播一次，結果以伺服器為準（防作弊）。
// - 瀏覽器保有一份唯讀的沙盒鏡像（/api/snapshot）用來畫地圖、查價格；真正的狀態只在這裡。
import {DurableObject} from 'cloudflare:workers';
import * as C from '../public/js/cont.js';
import * as Wd from '../public/js/world.js';
import * as B from '../public/js/battle.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const bad = (msg, status = 400) => json({error: msg}, status);
const CHUNK = 500000;

async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
async function gzip(str) { return new Uint8Array(await new Response(new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(u8) { return new TextDecoder().decode(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

export class Realm extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ready = null; this.snap = null; this.lastPersist = 0; this.dirty = false; }
  tickMs() { return Math.max(30, +(this.env.TICK_SECONDS || 120)) * 1000; }
  apMs() { return this.tickMs() / 6; }   // 一個時段 6 小時 → 每 tickMs/6 毫秒回 1 AP，和世界時鐘同速

  /* ───── 讀檔、存檔 ───── */
  async pack() { const r = await this.env.ASSETS.fetch(new Request('https://assets/data/genesis.json')); return r.json(); }
  async init() {
    if (this.ready) return this.ready;
    return this.ready = (async () => { try {
      const st = this.ctx.storage, meta = await st.get('meta');
      const pack = await this.pack();
      C.loadPack(pack);
      if (meta && meta.version === (this.env.WORLD_VERSION || '1')) {
        const n = meta.chunks, parts = [];
        for (let i = 0; i < n; i++) parts.push(await st.get('simz:' + i));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        C.loadState(JSON.parse(await gunzip(all)));
        this.meta = meta;
      } else {
        await st.deleteAll();
        this.meta = {version: this.env.WORLD_VERSION || '1', seq: 0, startedAt: Date.now(), chunks: 0};
        this.feed = []; this.poiState = {}; this.roster = {};
        await st.put('pois', Wd.genPOIs());
        await this.persist(true);
      }
      this.pois = await st.get('pois'); this.poiState = await st.get('poiState') || {}; this.feed = await st.get('feed') || []; this.roster = await st.get('roster') || {};
      this.evLen = C.K().ev.length;
      Wd.MODE.shared = true;
      Wd.MODE.events = w => { const out = this.feed.filter(f => f.seq > (w.feedSeq || 0)).map(f => f.e); w.feedSeq = this.meta.seq; return out; };
      if (!(await st.getAlarm()) && this.env.PAUSED !== '1') await st.setAlarm(Date.now() + this.tickMs());
    } catch (e) { this.ready = null; throw e; } })();
  }
  async persist(force) {
    if (!force && Date.now() - this.lastPersist < 30000) { this.dirty = true; return; }
    const st = this.ctx.storage, z = await gzip(JSON.stringify(C.saveState())), n = Math.ceil(z.length / CHUNK);
    for (let i = 0; i < n; i++) await st.put('simz:' + i, z.slice(i * CHUNK, (i + 1) * CHUNK));
    this.meta.chunks = n; await st.put('meta', this.meta); await st.put('feed', this.feed.slice(-400)); await st.put('poiState', this.poiState); await st.put('roster', this.roster);
    this.lastPersist = Date.now(); this.dirty = false;
  }
  // 沙盒新產生的事件收進共用的事件流（每個玩家的「聽說」從這裡讀）
  pump() { const ev = C.K().ev; for (let i = this.evLen; i < ev.length; i++) this.feed.push({seq: ++this.meta.seq, e: ev[i]}); this.evLen = ev.length; if (this.feed.length > 600) this.feed = this.feed.slice(-400); this.snap = null; }

  /* ───── 世界時鐘 ───── */
  async alarm() {
    await this.init();
    if (this.env.PAUSED === '1') return;
    C.SIM.periodTick(); this.pump();
    await this.persist(true);
    await this.ctx.storage.setAlarm(Date.now() + this.tickMs());
  }

  /* ───── 玩家 ───── */
  async player(id) { return await this.ctx.storage.get('p:' + id); }
  regen(p) { const now = Date.now(), w = p.w; w.ap = Math.min(Wd.AP_MAX, (w.ap ?? 0) + (now - (p.apAt || now)) / this.apMs()); p.apAt = now; }
  prep(p) { const w = p.w; w.poiShared = this.poiState; w.pois = this.pois; Wd.MODE.worldT = C.K().T; Wd.MODE.bandName = `${p.name}的戰幫`; }
  async savePlayer(p) {
    const w = p.w, keepPois = w.pois, keepShared = w.poiShared; delete w.pois; delete w.poiShared;
    await this.ctx.storage.put('p:' + p.id, p); w.pois = keepPois; w.poiShared = keepShared;
    this.roster[p.id] = {name: p.name, pos: w.pos, size: w.party.length, fame: +(w.fame || 0).toFixed(1), over: !!w.over, seen: Date.now()};
  }
  view(p) { const w = p.w; return {w: {...w, pois: undefined, poiShared: undefined}, battle: p.battle ? {setup: p.battle.setup, party: p.battle.party, order: p.battle.order} : null, apMs: this.apMs(), T: C.K().T, name: p.name, notes: p.notes || '', pois: this.pois, poiState: this.poiState}; }

  async fetch(req) {
    await this.init();
    const url = new URL(req.url), path = url.pathname;
    if (path === '/api/world') {
      const k = C.K(), others = Object.entries(this.roster).filter(([, r]) => !r.over && Date.now() - r.seen < 7 * 864e5).map(([id, r]) => ({id: id.slice(0, 6), ...r}));
      return json({T: k.T, stamp: k.stamp, tickMs: this.tickMs(), apMs: this.apMs(), players: others.length, others, poiState: this.poiState, version: this.meta.version});
    }
    if (path === '/api/snapshot') {
      if (!this.snap) this.snap = JSON.stringify({T: C.K().T, state: C.saveState()});
      return new Response(this.snap, {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
    }
    const token = req.headers.get('x-token') || ''; if (token.length < 16) return bad('沒有身分', 401);
    const id = await sha(token);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    let p = await this.player(id);

    if (path === '/api/join') {
      if (p && !p.w.over && !body.restart) { this.regen(p); this.prep(p); return json(this.view(p)); }
      const name = String(body.name || '').trim().slice(0, 8) || '無名的騎士';
      const w = Wd.newWorld((Math.random() * 2 ** 31) | 0, name);
      w.pois = this.pois; w.ap = 72; w.feedSeq = this.meta.seq;
      p = {id, name, w, battle: null, apAt: Date.now(), created: Date.now()};
      await this.savePlayer(p); this.prep(p);
      return json(this.view(p));
    }
    if (!p) return bad('還沒加入這個世界', 404);
    this.regen(p); this.prep(p);
    if (path === '/api/me') return json(this.view(p));

    if (path === '/api/act') {
      if (p.battle) return bad('還在戰鬥中');
      const before = {...(p.w.poi || {})};
      let out;
      try { out = Wd.worldAct(p.w, body.action || {}); } catch (e) { await this.savePlayer(p); return json({error: e.message, ...this.view(p)}, 400); }
      for (const k in p.w.poi || {}) if (!before[k]) this.poiState[k] = {T: C.K().T, by: p.name};
      if (out.battle) p.battle = {setup: out.battle, party: Wd.battleParty(p.w), order: p.w.lastOrder || {stance: 'follow', focus: null}};
      this.pump(); await this.savePlayer(p); await this.persist(false);
      return json({out: {lines: out.lines, encounter: out.encounter || null, battle: !!out.battle}, mk: C.K().markets[p.w.pos] || null, ...this.view(p)});
    }
    if (path === '/api/battle') {   // 打完的戰鬥：照操作紀錄重播一次
      if (!p.battle) return bad('沒有進行中的戰鬥');
      const {setup, party, order} = p.battle, st = B.createBattle({seed: setup.seed, biome: setup.biome, party, foes: setup.foes, order});
      try { for (const a of body.log || []) { if (st.result) break; B.act(st, a); } } catch (e) { return bad('戰鬥紀錄對不上：' + e.message); }
      if (!st.result && !body.giveUp) return bad('戰鬥還沒結束');
      if (!st.result) st.result = 'retreat';
      const out = Wd.applyBattle(p.w, setup, st); p.battle = null;
      this.pump(); await this.savePlayer(p); await this.persist(false);
      return json({out: {lines: out.lines, result: st.result}, ...this.view(p)});
    }
    if (path === '/api/dev/fight' && this.env.DEV === '1') {   // 本機測試用：在玩家身邊放一群狼直接開打
      p.w.bands.push({id: 'b' + p.w.nextId++, kind: 'wolves', name: '測試狼群', pos: p.w.pos, foes: [Wd.makeMember(p.w, 'wolf', 1), Wd.makeMember(p.w, 'wolf', 1)], loot: 0, ttl: 1});
      const out = Wd.worldAct(p.w, {type: 'engage', band: p.w.bands[p.w.bands.length - 1].id});
      p.battle = {setup: out.battle, party: Wd.battleParty(p.w), order: p.w.lastOrder || {stance: 'follow', focus: null}};
      await this.savePlayer(p); return json(this.view(p));
    }
    if (path === '/api/notes') { p.notes = String(body.notes || '').slice(0, 20000); await this.ctx.storage.put('p:' + id, p); return json({ok: true}); }
    return bad('找不到這個 API', 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.REALM.get(env.REALM.idFromName('realm-' + (env.WORLD_VERSION || '1'))).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
