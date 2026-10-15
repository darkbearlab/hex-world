// Clear bot class modules (docs/CLEAR_BOT.md). Each class may provide:
//   perks:{id:weight}                 what to take at a level-up (higher first; generic weights fill the rest)
//   prepare(view,bot) → intent|null   a free action to take before anything else this turn (skills, preparation)
//   combat(view,bot) → [option]       extra scored options for the combat chooser (same units as combat.mjs)
//   quiet(view,bot) → intent|null     something to do when no enemy is in sight (building, feeding)
//   beforeExit(view,bot) → intent|null  last thing before taking the elevator (gather units)
import soldier from './soldier.mjs';
import recon from './recon.mjs';
import engineer from './engineer.mjs';
import druid from './druid.mjs';
import necromancer from './necromancer.mjs';
import bulwark from './bulwark.mjs';
import berserker from './berserker.mjs';
import ninja from './ninja.mjs';
export const CLASS_MODULES={soldier,recon,engineer,druid,necromancer,bulwark,berserker,ninja,default:{}};
