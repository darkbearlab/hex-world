// Clear bot: the soldier (docs/CHARACTERS.md, docs/CLASS_PERKS.md). Rifle from cover (braced +12), the same target on
// consecutive turns (correction), and 預警 early warning — free, cooldown 5 — which marks everything within 8 (+10 to
// hit, +10% damage, lockable in the black) without alerting anyone. The bot scans whenever it is ready and something
// hostile is in sight or was just seen.
import {ready,skillIntent,hostiles,dist} from './common.mjs';
export default {
 perks:{soldier_hunter:62,soldier_marked:60,soldier_overwatch:52,steady:50,plate_rack:48},
 prepare(view){
  const me=view.me;if(!ready(me,'early_warning'))return null;
  const seen=hostiles(view).filter(e=>dist(e,me)<=8),recent=view.ghosts.filter(e=>dist(e,me)<=8&&view.turn-e.turn<=3);
  if(seen.length||recent.length)return skillIntent('early_warning','scan');
  return null;
 },
};
