// 高強度測試共用的「不該發生的事」檢查（Alan 2026-10-12）：stats/soak.mjs（本機每小時）和 stats/server-soak.mjs（本機伺服器，抓存檔回來檢查）都用這一份。
// createChecks(issue, h0) → {before(core), check(core), seen(core)}
// - issue(種類, 說明, 遊戲小時, 公司)：發現問題時呼叫
// - before：推進一小時之前呼叫（記下「有空的駐軍」，用來判斷違約是不是冤枉的）；沒有逐小時推進的（伺服器）可以不叫
// - seen：存檔裡以前就有的違約不算，開始跑之前叫一次
export function createChecks(issue, h0 = 0) {
  const garFree = (sq, now) => !sq.caseId && sq.readyAt <= now && sq.clones.filter(x => x.alive).length >= 2 && sq.clones.filter(x => x.alive).every(x => x.status === 'away');
  let freeGar = new Set(); const missedSeen = new Set(), npcErr = {};
  const day = h => ((h - h0) / 24).toFixed(1);
  function before(c) { const b = c.game.book, h = c.game.h; freeGar = new Set(Object.values(b.squads).filter(sq => sq.garrison != null && garFree(sq, h)).map(sq => sq.player + '@' + sq.garrison)); }
  function seen(c) { for (const k of c.game.book.contracts || []) for (const q of k.calls || []) if (q.state === 'missed') missedSeen.add(q.id); }
  function check(c) {
    const game = c.game, b = game.book, h = game.h, uids = new Map(), inSq = new Map();
    for (const sq of Object.values(b.squads)) for (const x of sq.clones) { if (!x.alive) continue; const k = sq.player + '#' + x.uid, o = inSq.get(k);
      // 已經在回程的舊小隊名單會留著已經去做別的事的人，不算
      if (sq.headedHome == null && o && o.headedHome == null && (sq.caseId || sq.garrison != null) && (o.caseId || o.garrison != null) && o.caseId !== sq.caseId) issue('同一個人同時在兩支有任務的小隊', `${sq.player} ${x.id}：${o.name} 和 ${sq.name}`, h, sq.player);
      if (sq.headedHome == null || !o) inSq.set(k, sq);
      const co = game.cos[sq.player]; if (co && x.uid != null && co.roster.find(y => y.uid === x.uid) !== x) issue('小隊成員和名冊不是同一個物件', `${sq.player} ${x.id} 在 ${sq.name}`, h); }
    for (const g of Object.values(game.cos)) {
      if (!Number.isFinite(g.cash)) issue('現金不是數字', `${g.name}：${g.cash}`, h, g.name);
      for (const [m, v] of Object.entries(g.mats || {})) if (!Number.isFinite(v) || v < 0) issue('素材數量不對', `${g.name} ${m}=${v}`, h, g.name);
      const ret = new Set((g.returning || []).map(x => x.uid)), roverSq = g.rover?.squad;
      for (const x of g.roster) {
        if (x.uid > 0) { if (uids.has(x.uid)) issue('uid 重複', `${g.name} ${x.id} 和 ${uids.get(x.uid)}`, h, g.name); uids.set(x.uid, `${g.name} ${x.id}`); }   // 負的是易主遺體留下的影子，本來就可能重複
        if (!x.alive) continue;
        const sq = inSq.get(g.name + '#' + x.uid);
        if (x.status === 'away' && !sq && !ret.has(x.uid)) issue('出勤中卻不在任何小隊（人不見了）', `${g.name} ${x.id}，最後的紀錄：${JSON.stringify((x.record || []).at(-1))}`, h, g.name);
        if (x.status === 'home' && sq && (sq.caseId || sq.garrison != null) && sq.headedHome == null && sq.id !== roverSq && sq.clones.some(y => y.alive && y.status === 'away')) issue('在總部卻還掛在有任務的小隊', `${g.name} ${x.id} 在 ${sq.name}`, h, g.name);
      }
      // 物品編號：同一家公司的倉庫、身上、行李裡不能撞號
      const mine = [...(g.store || [])]; for (const x of g.roster) if (x.alive && x.gear) mine.push(...x.gear.guns, x.gear.melee, x.gear.armor, ...x.gear.kits); for (const sq of Object.values(b.squads)) if (sq.player === g.name) mine.push(...(sq.pack || []));
      const ids = new Set(), objs = new Set(); for (const it of mine) { if (!it || objs.has(it)) continue; objs.add(it); if (ids.has(it.id)) issue('公司裡有重複的物品編號', `${g.name} ${it.id} ${JSON.stringify(it)}`, h, g.name); ids.add(it.id); if (it.kind === 'kit' && !(it.n > 0)) issue('預備品數量不對', `${g.name} ${it.base} n=${it.n}`, h, g.name); }
      if (g.npc?.err && npcErr[g.name] !== g.npc.err) { npcErr[g.name] = g.npc.err; issue('NPC 公司的行動出錯', `${g.name}：${g.npc.err}`, h); }
    }
    for (const tk of b.tickets) if (!tk.done) {
      if (!tk.squad) continue;   // 還沒派人的（例如獵場的清剿）在等人接
      if (!b.squads[tk.squad]) issue('服務單的小隊不在了', `${tk.player} ${tk.title}`, h, tk.player);
      if (h - (tk.issued ?? h) > 24 * 7) issue('服務單超過七天沒結算', `${tk.player} ${tk.title}（第 ${day(tk.issued)} 天開的）`, h);
    }
    for (const k of b.cases) if (!k.settled) for (const id of k.squads || []) if (!b.squads[id]) issue('案件的小隊名單指向不存在的小隊', `${k.title}（${k.kind}）→ ${id}`, h, Object.values(game.cos).find(g => g.cases.includes(k.id))?.name);
    for (const k of b.cases) if (!k.settled && k.end != null && h - k.end > 24 * 7) issue('案件過期七天還沒結案', `${k.title}（${k.kind}）`, h);
    // 有駐軍在、駐軍有空，車隊卻因為沒人護送而違約
    for (const k of b.contracts || []) for (const q of k.calls || []) if (q.state === 'missed' && !missedSeen.has(q.id)) { missedSeen.add(q.id); if (freeGar.has(q.co + '@' + k.site)) issue('有空的駐軍卻被判違約', `${q.co} 在 ${c.w.names[k.site]}`, h, q.co); }
  }
  return {before, check, seen};
}
// 兩份 JSON 哪裡不一樣（最多列幾處，路徑＋前後的值）
export function diff(a, b, path = '', out = []) {
  if (out.length > 8 || a === b) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) { out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path + '.' + k, out);
  return out;
}
