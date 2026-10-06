// 大陸沙盒的接頭：載入創世檔或存檔、推進時間、存檔
// 戰幫這一層只透過這裡碰沙盒。SIM 是活的模擬（不能 JSON 化），所以和戰幫的存檔分開存。
import {restore, W, H, N, NBR, BIOMES, MOVE, BASEP, GOODS, GN, hdist} from './sim/continent.js';
import {encode, decode} from './sim/codec.js';

export {W, H, N, NBR, BIOMES, MOVE, BASEP, GOODS, GN, hdist};
export let SIM = null;      // createSim 回傳的物件
export let WS = null;       // 靜態世界（地形、地名、河流）
export let SEED = '';

export function loadPack(pack) {
  const P = decode(pack);
  WS = P.static; SEED = P.seed || SEED;
  SIM = restore(P.static, P.state).sim;
  return SIM;
}
// 只換掉會變的部分（讀檔用）：靜態世界沿用創世檔
export function loadState(stateEnc) { SIM = restore(WS, decode(stateEnc)).sim; return SIM; }
export const saveState = () => encode(SIM.exportState());
export const K = () => SIM.peek();
export const nm = i => (WS.names[i] || '無名之地');
export const land = i => !!WS.land[i];
export const river = i => !!WS.river[i];
export const col = i => i % W, row = i => Math.floor(i / W), idx = (c, r) => r * W + c;
// 推進一個時段（六小時）。回傳這個時段新產生的世界事件
export function tick() {
  const k0 = SIM.peek(), n0 = k0.ev.length;
  SIM.periodTick();
  const ev = SIM.peek().ev;
  return ev.slice(Math.min(n0, ev.length));
}
