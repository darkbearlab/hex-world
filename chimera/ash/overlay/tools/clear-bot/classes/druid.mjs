// Clear bot: the druid (docs/DRUID_FEEDING.md). The beast fights on its own (it chases what it sees within reach and
// always changes floors with you); the druid's part is feeding it between fights, standing beside it: plates into its
// armour line (cover, then steadfastness), spare health into its vitality line (more health, regeneration), a medkit
// when it is badly hurt. The turret line is left alone: a little fuel makes the beast stop at range 3 and plink instead
// of biting (a trap noted in docs/DRUID_FEEDING.md).
import {petFeedingState} from '../../../src/pet-growth.js';
export default {
 perks:{druid_symbiosis:62,druid_claws:50,druid_beast:35,health:58},
 quiet(view){
  const g=view.g,me=view.me,s=petFeedingState(g);if(!s)return null;
  const allowed=id=>s.options.find(o=>o.action.optionId===id&&o.allowed);
  const rank=line=>s.growth[line]?.rank||0;
  if(s.hp<s.maxHp*.5&&me.meds>=3){const o=allowed('medkit');if(o)return {type:'feedPet',arg:o.action,why:'medkit to beast'};}
  if(me.plates>=10&&rank('armor')<3){const o=allowed('plates');if(o)return {type:'feedPet',arg:o.action,why:'plates to beast'};}
  if(me.hp>=me.maxHp*.95&&rank('vitality')<4){const o=allowed('life');if(o)return {type:'feedPet',arg:o.action,why:'health to beast'};}
  return null;
 },
};
