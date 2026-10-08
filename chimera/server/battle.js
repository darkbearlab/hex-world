// 奇美拉：伺服器上的戰鬥（伺服器化 S2，warband/DESIGN.md「伺服器化實作計畫」）。每張任務票一個 Durable Object「Skirmish」。
// - 戰鬥的規則與三名隊員的機器人都在這裡跑（ASH，chimera/ash/.work 是 build.mjs 套好補丁的原始碼）；種子與亂數狀態從不離開伺服器。
// - 玩家每個行動送到這裡：跑 ASH 的 captureAction，回傳這一步的動畫快照（瀏覽器照原本的 Playback 播放）與最後的狀態。
// - 存檔：遊戲資料（Durable Object 的儲存用結構化複製，物件之間的參照會保留）＋亂數狀態＋隊員的個人狀態；機器人的記憶不存，重建。
// - 打完：把戰果交給星球（Planet）結算。
import {DurableObject} from 'cloudflare:workers';
import {SquadGame} from '../ash/.work/src/chimera-squad.js';
import {installFullSquad} from '../ash/.work/tools/chimera/full-squad.mjs';
import {captureAction, snapshot} from '../ash/.work/src/presentation.js';
import {random} from '../ash/.work/src/world.js';

// Set、Map 在 JSON 裡會變成空物件（例如 visibleTiles）：標記起來，瀏覽器解析時還原（chimera-entry.js 的 revive）
const tag = (k, v) => v instanceof Set ? {$set: [...v]} : v instanceof Map ? {$map: [...v]} : v;
const json = (data, status = 200) => new Response(JSON.stringify(data, tag), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const bad = (msg, status = 400) => json({error: msg}, status);

// 存下來的戰鬥：可複製的遊戲資料＋亂數狀態＋隊員的個人狀態（stash 依 members 的順序）
function pack(g) {
  const {rng, effects, onEnemyCallout, ...data} = g;
  return {data, rng: g.rng.state(), stash: g.members.map(m => g.stash.get(m) || null)};
}
function unpack(p) {
  const g = Object.assign(Object.create(SquadGame.prototype), structuredClone(p.data));
  g.rng = random(p.rng); g.effects = [];
  for (const [k, v] of [['stash', new Map(g.members.map((m, i) => [m, p.stash[i] || {}]))], ['brains', new Map()]]) Object.defineProperty(g, k, {configurable: true, writable: true, enumerable: false, value: v});
  installFullSquad(g);
  return g;
}

export class Skirmish extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.g = null; this.meta = null; }
  async load() {
    if (this.g) return true;
    const p = await this.ctx.storage.get('battle'); if (!p) return false;
    this.meta = await this.ctx.storage.get('meta'); this.g = unpack(p); return true;
  }
  async save() { await this.ctx.storage.put('battle', pack(this.g)); await this.ctx.storage.put('meta', this.meta); }
  // 瀏覽器拿到的畫面（Alan 2026-10-08：一開始就過濾）：只留這一方從畫面上就知道的事。
  // - 種子不送（地圖與很多擲骰都由它算出來）；亂數狀態本來就不在快照裡
  // - 敵人：活著的只留隊伍看得到的（visibleEnemies，和畫面一樣）；屍體只留在看過的格子上；還沒顯露的詞條拿掉
  // - 看過的格子以外：地形當成牆、地上的東西、箱子、終端、危險地形、痕跡、出口都不送；箱子沒打開前不送內容
  // - 之後的增援、蟲潮、主要路線（地圖產生時的資料）不送
  view(s) {
    const seen = (x, y) => Boolean(s.seen?.[y]?.[x]), vis = new Set((s.visibleEnemies || []).map(e => e.id));
    const enemies = (s.enemies || []).filter(e => e.hp > 0 ? vis.has(e.id) : seen(e.x, e.y)).map(e => e.affixes ? {...e, affixes: e.affixes.filter(a => a.revealed)} : e);
    return {...s, seed: 0, ticket: s.ticket ? {...s.ticket, seed: 0} : s.ticket, enemies,
      grid: s.grid?.map((row, y) => row.map((v, x) => seen(x, y) ? v : 0)),
      items: (s.items || []).filter(i => seen(i.x, i.y)),
      props: (s.props || []).filter(o => o.x === undefined || seen(o.x, o.y)).map(o => o.contents && !o.opened ? {...o, contents: []} : o),
      slots: (s.slots || []).filter(o => seen(o.x, o.y)), hazards: (s.hazards || []).filter(h => seen(h.x, h.y)), traces: (s.traces || []).filter(t => seen(t.x, t.y)),
      end: s.end && seen(s.end.x, s.end.y) ? s.end : {x: -99, y: -99},
      reinforcements: [], swarmWaves: undefined, mainRoute: undefined, rewardRooms: undefined,
      purge: s.purge ? {floors: Object.fromEntries(Object.entries(s.purge.floors || {}).map(([k, f]) => [k, {...f, ids: [], alive: null}]))} : s.purge};
  }
  // 打完：把戰果交給星球結算（只做一次）
  async settle() {
    if (this.meta.settled || this.g.status === 'playing') return;
    this.meta.settled = true; await this.save();
    const planet = this.env.PLANET.get(this.env.PLANET.idFromName('planet-' + (this.env.WORLD_VERSION || '1')));
    await planet.fetch(new Request('https://planet/api/internal/settle', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ticket: this.meta.ticket, owner: this.meta.owner, result: this.g.missionResult})}));
  }
  async fetch(req) {
    const url = new URL(req.url), path = url.pathname.split('/').pop();
    let body = {}; if (req.method === 'POST') { try { body = await req.json(); } catch { return bad('請求格式不對'); } }
    if (path === 'start') {
      // 接回：只有星球會叫 start，以它說的主人為準（訪客改用 Google 登入之後，公司換了玩家 ID）
      if (await this.load()) { if (body.owner && body.owner !== this.meta.owner) { this.meta.owner = body.owner; await this.save(); } return json({state: this.view(snapshot(this.g)), resumed: true}); }
      const t0 = Date.now();
      this.g = new SquadGame(body.mission); installFullSquad(this.g);
      this.meta = {ticket: body.mission.id, owner: body.owner, startedAt: Date.now()};
      await this.save();
      return json({state: this.view(snapshot(this.g)), ms: Date.now() - t0});
    }
    if (!(await this.load())) return bad('沒有這場戰鬥', 404);
    const owner = req.headers.get('x-owner'); if (owner !== null && owner !== this.meta.owner) return bad('這不是你的戰鬥', 403);
    if (path === 'state') return json({state: this.view(snapshot(this.g))});
    if (path === 'act') {
      const g = this.g, t0 = Date.now();
      if (g.status !== 'playing') return bad('戰鬥已經結束');
      if (body.target !== undefined) g.target = body.target;
      // 選單裡的操作：選升級、換人操作（不推進回合，沒有動畫）
      if (body.op) {
        let ok = false;
        if (body.op === 'perk') ok = g.choosePerk(body.id);
        else if (body.op === 'control') ok = g.setControlled(g.members.find(m => m.squadId === body.id));
        else if (body.op === 'cycle') ok = g.cycleControlled();
        await this.save();
        return json({success: !!ok, steps: [], state: this.view(snapshot(g)), status: g.status, ms: Date.now() - t0});
      }
      const {success, steps} = captureAction(g, () => g.action(body.type, body.arg));
      await this.save(); await this.settle();
      return json({success, refusal: g.refusal || null, steps: steps.map(s => ({before: this.view(s.before), after: this.view(s.after), effects: s.effects})), state: this.view(snapshot(g)), status: g.status, ms: Date.now() - t0});
    }
    // 開發用：讓機器人把整場打完，量運算時間（DEV=1 才開）
    if (path === 'selftest' && this.env.DEV === '1') {
      const g = this.g, t0 = Date.now(); let n = 0, slow = 0;
      const lead = installFullSquad(g).botFor;
      while (g.status === 'playing' && n++ < 3000) { const a = Date.now(); lead(g.player).step(); slow = Math.max(slow, Date.now() - a); }
      await this.save(); await this.settle();
      return json({status: g.status, turns: g.turn, actions: n, ms: Date.now() - t0, slowestAction: slow, result: g.missionResult});
    }
    return bad('不認得的請求', 404);
  }
}
