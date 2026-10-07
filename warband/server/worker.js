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
import {verifyGoogle} from './auth.js';
import {MALE_NAMES, FEMALE_NAMES, SURNAMES} from '../public/js/data.js';

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
        this.feed = []; this.poiState = {}; this.roster = {}; this.names = {};
        await st.put('pois', Wd.genPOIs());
        await this.persist(true);
      }
      this.pois = await st.get('pois'); this.poiState = await st.get('poiState') || {}; this.feed = await st.get('feed') || []; this.roster = await st.get('roster') || {};
      this.names = await st.get('names'); if (!this.names) { this.names = {}; for (const [id, r] of Object.entries(this.roster)) if (!this.names[r.name]) this.names[r.name] = id; }
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
    this.meta.chunks = n; await st.put('meta', this.meta); await st.put('feed', this.feed.slice(-400)); await st.put('poiState', this.poiState); await st.put('roster', this.roster); await st.put('names', this.names || {});
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
  // 身分：Google 登入發的工作階段代碼對到帳號；沒有的話就是舊的「瀏覽器代碼」訪客
  async who(token) { const h = await sha(token), s = await this.ctx.storage.get('sess:' + h); return s ? s.pid : h; }
  async googleLogin(body) {
    const cid = this.env.GOOGLE_CLIENT_ID; if (!cid) return bad('伺服器沒有設定 Google 登入');
    let g; try { g = this.env.DEV === '1' && body.devSub ? {sub: String(body.devSub), email: 'dev@test', name: 'dev'} : await verifyGoogle(body.credential, cid); } catch (e) { return bad(e.message, 401); }
    const gid = 'g' + (await sha('google:' + g.sub)).slice(0, 23), st = this.ctx.storage;
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    await st.put('sess:' + await sha(token), {pid: gid, at: Date.now()});
    await st.put('acct:' + gid, {email: g.email, name: g.name, last: Date.now()});
    let p = await this.player(gid), moved = false;
    // 第一次用 Google 登入：把這個瀏覽器原本的訪客角色搬過來
    if (!p && body.legacy && String(body.legacy).length >= 16) {
      const lid = await this.who(body.legacy), lp = lid !== gid ? await this.player(lid) : null;
      if (lp && !lp.w.over) {
        lp.id = gid; await st.put('p:' + gid, lp); await st.delete('p:' + lid);
        if (this.roster[lid]) { this.roster[gid] = this.roster[lid]; delete this.roster[lid]; }
        if (this.names[lp.name] === lid) this.names[lp.name] = gid;
        p = lp; moved = true; await this.persist(true);
      }
    }
    return json({token, email: g.email, hasPlayer: !!(p && !p.w.over), name: p?.name || null, moved});
  }
  // 行動點回復；超過上限、沒用掉的時間就是「離線」：照離線的規則結算（吃得少、發一半的餉、野外可能被夜襲）
  regen(p) {
    const now = Date.now(), w = p.w, got = (w.ap ?? 0) + (now - (p.apAt || now)) / this.apMs(), over = Math.max(0, got - Wd.AP_MAX);
    w.ap = Math.min(Wd.AP_MAX, got); p.apAt = now;
    if (over >= 6 && !p.battle && !w.over) {
      this.prep(p); const r = Wd.idle(w, over, C.K().T);
      if (r.hours >= 6) { const a = p.away || {hours: 0, food: 0, gold: 0, raids: []}; a.hours += r.hours; a.food += r.food; a.gold += r.gold; a.raids.push(...r.raids); p.away = a; }
      if (r.raids.some(t => !/擊退/.test(t))) w.shieldT = C.K().T + Wd.SHIELD_T;
    }
  }
  prep(p) { const w = p.w; w.poiShared = this.poiState; w.pois = this.pois; Wd.MODE.worldT = C.K().T; Wd.MODE.bandName = `${p.name}的戰幫`; }
  async savePlayer(p) {
    const w = p.w, keepPois = w.pois, keepShared = w.poiShared; delete w.pois; delete w.poiShared;
    await this.ctx.storage.put('p:' + p.id, p); w.pois = keepPois; w.poiShared = keepShared;
    const ci = Wd.campInfo(w), town = C.K().markets[w.pos] && C.K().owner[w.pos] >= 0;
    this.roster[p.id] = {name: p.name, pos: w.pos, size: w.party.length, fame: +(w.fame || 0).toFixed(1), over: !!w.over, seen: Date.now(),
      banner: w.banner ?? null, face: w.party.find(m => m.hero)?.face ?? null, g: w.party.find(m => m.hero)?.g || 'm', wantedMax: Math.max(0, ...Object.values(w.wanted || {})), shieldT: w.shieldT || 0, town: !!town, busy: !!p.battle,
      camp: ci ? {stake: ci.stake, watch: ci.watch, fire: ci.fire, ready: ci.ready} : null, power: Math.round(Wd.partyPower(w.party))};
  }
  view(p) { const w = p.w, away = p.away; p.away = null; return {away, me: p.id.slice(0, 6), w: {...w, pois: undefined, poiShared: undefined}, battle: p.battle ? {setup: p.battle.setup, party: p.battle.party, order: p.battle.order} : null, apMs: this.apMs(), T: C.K().T, name: p.name, notes: p.notes || '', pois: this.pois, poiState: this.poiState}; }

  /* ───── 襲擊其他玩家：防守方由 AI 操作，打完由伺服器結算 ───── */
  async findPlayer(prefix) { const id = Object.keys(this.roster).find(k => k.startsWith(prefix)); return id ? await this.player(id) : null; }
  async attackPlayer(p, a) {
    const w = p.w, t = await this.findPlayer(String(a.target || '')), k = C.K();
    if (!t || t.id === p.id) return bad('找不到這支戰幫');
    if (t.w.over) return bad('他們已經散了');
    if (t.w.pos !== w.pos) return bad('他們不在這一格');
    if (k.markets[w.pos] && k.owner[w.pos] >= 0) return bad('城裡不能動手');
    if (t.battle) return bad('他們正在跟別人交戰');
    if ((t.w.shieldT || 0) > k.T) return bad('他們剛被洗劫過，元氣未復——現在動手太難看了');
    const need = Wd.apCost(w, a); if ((w.ap ?? 0) < need) return bad(`行動點不夠：要 ${need}`);
    this.regen(t); this.prep(t);
    const tw = t.w, target = {id: t.id, name: t.name, banner: tw.banner ?? null, wantedMax: Math.max(0, ...Object.values(tw.wanted || {})), party: Wd.battleParty(tw), camp: Wd.campInfo(tw)};
    this.prep(p);
    const legal = Wd.raidLegality(w, target);
    if (!legal.ok) { w.wanted = w.wanted || {}; w.wanted[legal.fac] = (w.wanted[legal.fac] || 0) + 3; }
    const setup = Wd.pvpSetup(w, target); setup.source.legal = legal.note; w.ap -= need;
    p.battle = {setup, party: Wd.battleParty(w), order: w.lastOrder || {stance: 'follow', focus: null}};
    await this.savePlayer(p); await this.persist(false);
    return json({out: {lines: [`襲擊${t.name}的戰幫！${legal.note}。`], battle: true}, ...this.view(p)});
  }
  async settlePvp(p, setup, st, out) {
    const t = await this.player(setup.source.target); if (!t) return;
    const k = C.K();
    this.prep(t);
    if (st.result === 'win') {
      const r = Wd.defeatStep(t.w, `${p.name}的戰幫`), w = p.w; let room = Wd.capacity(w) - Wd.load(w); const took = [];
      for (const [g, n] of Object.entries(r.cargo)) { const q = Math.min(room, n); if (q > 0) { w.cargo[g] = (w.cargo[g] || 0) + q; room -= q; took.push(`${Wd.GN[g]} ${q} 包`); } }
      if (r.gold) { w.gold += r.gold; took.push(`${r.gold} 金幣`); }
      t.w.shieldT = k.T + Wd.SHIELD_T;
      out.lines.push(took.length ? `搶到${took.join('、')}。` : r.lost ? `${r.text}` : '他們身上沒什麼值錢的東西。');
      k.ev.push({y: k.curY, type: 'bandit', text: `${p.name}的戰幫在${C.nm(w.pos)}洗劫了${t.name}的戰幫。`, tile: w.pos, ts: k.stamp});
    } else {
      t.w.log.unshift({day: t.w.day, text: `${p.name}的戰幫襲擊了你們的${Wd.campInfo(t.w) ? '營地' : '隊伍'}，被打退了。`});
    }
    await this.savePlayer(t); this.prep(p);
  }

  async fetch(req) {
    await this.init();
    const url = new URL(req.url), path = url.pathname;
    if (path === '/api/world') {
      const k = C.K(), others = Object.entries(this.roster).filter(([, r]) => !r.over && Date.now() - r.seen < 7 * 864e5).map(([id, r]) => ({id: id.slice(0, 6), ...r}));
      return json({clientId: this.env.GOOGLE_CLIENT_ID || '', guest: this.env.ALLOW_GUEST !== '0', T: k.T, stamp: k.stamp, tickMs: this.tickMs(), apMs: this.apMs(), players: others.length, others, poiState: this.poiState, version: this.meta.version});
    }
    if (path === '/api/name') {   // 名字：檢查有沒有人用、或抽一個沒人用過的
      const taken = async n => { const o = this.names[n]; if (!o) return false; const pl = await this.player(o); return !!(pl && !pl.w.over); };
      const q = url.searchParams.get('check');
      if (q != null) return json({name: q, taken: await taken(String(q).trim().slice(0, 8))});
      const pool = url.searchParams.get('g') === 'f' ? FEMALE_NAMES : MALE_NAMES;
      for (let i = 0; i < 40; i++) { const n = `${pool[Math.floor(Math.random() * pool.length)]}・${SURNAMES[Math.floor(Math.random() * SURNAMES.length)]}`; if (!(await taken(n))) return json({name: n}); }
      return json({name: ''});
    }
    if (path === '/api/snapshot') {
      if (!this.snap) this.snap = JSON.stringify({T: C.K().T, state: C.saveState()});
      return new Response(this.snap, {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
    }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (path === '/api/auth/google') return this.googleLogin(body);
    const token = req.headers.get('x-token') || ''; if (token.length < 16) return bad('沒有身分', 401);
    const id = await this.who(token);
    if (!id.startsWith('g') && this.env.ALLOW_GUEST === '0' && path === '/api/join') return bad('請先用 Google 帳號登入', 401);
    let p = await this.player(id);

    if (path === '/api/join') {
      if (p && !p.w.over && !body.restart) { this.regen(p); this.prep(p); return json(this.view(p)); }
      const name = String(body.name || '').trim().slice(0, 8) || '無名的騎士';
      const owner = this.names[name]; if (owner && owner !== id) { const o = await this.player(owner); if (o && !o.w.over) return bad(`「${name}」這個名字已經有人用了，換一個吧`); }
      this.names[name] = id;
      const w = Wd.newWorld((Math.random() * 2 ** 31) | 0, name, {origin: String(body.origin || ''), g: body.g === 'f' ? 'f' : 'm', face: Number.isInteger(body.face) ? Math.max(0, Math.min(999, body.face)) : undefined});
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
      if (body.action?.type === 'attackPlayer') return this.attackPlayer(p, body.action);
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
      const {setup, party, order} = p.battle, st = B.createBattle({seed: setup.seed, biome: setup.biome, party, foes: setup.foes, order, camp: setup.camp});
      try { for (const a of body.log || []) { if (st.result) break; B.act(st, a); } } catch (e) { return bad('戰鬥紀錄對不上：' + e.message); }
      if (!st.result && !body.giveUp) return bad('戰鬥還沒結束');
      if (!st.result) st.result = 'retreat';
      const out = Wd.applyBattle(p.w, setup, st); p.battle = null;
      if (setup.source.kind === 'pvp') await this.settlePvp(p, setup, st, out);
      this.pump(); await this.savePlayer(p); await this.persist(false);
      return json({out: {lines: out.lines, result: st.result}, ...this.view(p)});
    }
    if (path === '/api/dev/fight' && this.env.DEV === '1') {   // 本機測試用：在玩家身邊放一群狼直接開打
      p.w.bands.push({id: 'b' + p.w.nextId++, kind: 'wolves', name: '測試狼群', pos: p.w.pos, foes: [Wd.makeMember(p.w, 'wolf', 1), Wd.makeMember(p.w, 'wolf', 1)], loot: 0, ttl: 1});
      const out = Wd.worldAct(p.w, {type: 'engage', band: p.w.bands[p.w.bands.length - 1].id});
      if (body.camp) out.battle.camp = {side: 'ally', stake: true, watch: true, ready: true, def: 1};
      p.battle = {setup: out.battle, party: Wd.battleParty(p.w), order: p.w.lastOrder || {stance: 'follow', focus: null}};
      await this.savePlayer(p); return json(this.view(p));
    }
    if (path === '/api/dev/age' && this.env.DEV === '1') { p.w.ap = Wd.AP_MAX; p.apAt = Date.now() - (+body.hours || 48) * this.apMs(); this.regen(p); await this.savePlayer(p); return json(this.view(p)); }
    if (path === '/api/dev/tp' && this.env.DEV === '1') { p.w.pos = +body.pos; p.w.camp = null; Wd.reveal(p.w, p.w.pos, 2); await this.savePlayer(p); return json(this.view(p)); }
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
