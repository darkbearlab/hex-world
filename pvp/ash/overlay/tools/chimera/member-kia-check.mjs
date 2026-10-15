// 隊員戰死演出與綽號（Alan 2026-10-10）：沒在操作的隊員倒下，演出要有玩家戰死的倒地（fall，actorType player、member）；戰場上的名字用綽號
// node tools/chimera/member-kia-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {snapshot, planPresentation} from '../../src/presentation.js';
const tk = {id: 'T1', seed: 5, faction: 'rebel', enemy: {units: {}}, squad: [
  {id: 'X-0910', name: '瑟琳', callsign: '人獵人', cls: 'bulwark', st: {hp: 100}},
  {id: 'L-0251', name: '露恩', cls: 'soldier', st: {hp: 100}},
  {id: 'M-0252', cls: 'recon', st: {hp: 100}}]};
const g = new SquadGame(tk);
console.log('名字', g.members.map(m => m.callName).join('、'));
const m = g.members.find(x => x !== g.controlled);
const before = snapshot(g); m.hp = 0; const after = snapshot(g);
console.log('快照裡的隊員', before.squadMembers?.length, '操作中的是玩家', before.player.id === g.controlled.id);
const plan = planPresentation([{before, after, effects: []}]), ev = plan.events || plan, falls = ev.flatMap(e => e.effects || []).filter(e => e.type === 'fall');
console.log('倒地演出', falls.length, JSON.stringify(falls.map(f => ({actorType: f.actorType, member: f.member, at: f.to}))), '位置對', falls[0] && falls[0].to.x === m.x && falls[0].to.y === m.y);
// 操作中的人沒倒：不應該有演出
m.hp = 100; const b2 = snapshot(g), a2 = snapshot(g);
console.log('沒人倒下時的倒地演出', (p => p.events || p)(planPresentation([{before: b2, after: a2, effects: []}])).flatMap(e => e.effects || []).filter(e => e.type === 'fall').length);
