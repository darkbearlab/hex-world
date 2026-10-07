// 奇幻戰幫切片：資料表（職業、武器、地形、特性、名字）
// 這個檔案只有資料，沒有邏輯；伺服器與瀏覽器共用。

// 種子亂數：狀態是一個 32 位元整數，可以存檔、可以重現
export function rngNext(st) {
  let t = (st.rng = (st.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rngInt = (st, n) => Math.floor(rngNext(st) * n);
export const rngPick = (st, arr) => arr[rngInt(st, arr.length)];
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) for (const ch of String(p)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h | 0;
}

// 武器：三角相剋 劍 > 斧 > 槍 > 劍；弓只能打 2 格；爪牙與棍棒不參與相剋
export const WEAPONS = {
  sword: {name: '鐵劍', type: 'sword', mt: 4, hit: 90, crit: 0, range: [1, 1]},
  lance: {name: '長槍', type: 'lance', mt: 6, hit: 80, crit: 0, range: [1, 1]},
  axe: {name: '戰斧', type: 'axe', mt: 7, hit: 70, crit: 0, range: [1, 1]},
  bow: {name: '短弓', type: 'bow', mt: 5, hit: 85, crit: 0, range: [2, 2]},
  staff: {name: '木杖', type: 'club', mt: 1, hit: 80, crit: 0, range: [1, 1]},
  fang: {name: '利牙', type: 'beast', mt: 5, hit: 80, crit: 5, range: [1, 1]},
  tusk: {name: '獠牙', type: 'beast', mt: 7, hit: 75, crit: 0, range: [1, 1]},
  claw: {name: '熊掌', type: 'beast', mt: 9, hit: 70, crit: 0, range: [1, 1]},
};
export const TRIANGLE = {sword: 'axe', axe: 'lance', lance: 'sword'};   // 左邊剋右邊

// 職業：基礎數值與成長率（%）
export const CLASSES = {
  knight: {name: '騎士', weapon: 'sword', skill: ['sword', 'lance'], kit: {w: 'sword', a: 'mail', s: 'kite'}, sprites: [['people', 'knight']], base: {hp: 26, str: 6, skl: 7, spd: 8, def: 2, mov: 5}, grow: {hp: 80, str: 50, skl: 45, spd: 40, def: 40}},
  swordsman: {name: '劍士', weapon: 'sword', skill: ['sword'], kit: {w: 'sword', a: 'leather', s: 'buckler'}, sprites: [['people', 'squire'], ['people', 'thief']], base: {hp: 21, str: 5, skl: 7, spd: 8, def: 1, mov: 5}, grow: {hp: 65, str: 40, skl: 55, spd: 55, def: 25}},
  spearman: {name: '槍兵', weapon: 'lance', skill: ['lance'], kit: {w: 'spear', a: 'leather', s: 'buckler'}, sprites: [['people', 'spearman'], ['people', 'peasant']], base: {hp: 23, str: 6, skl: 5, spd: 5, def: 4, mov: 5}, grow: {hp: 75, str: 45, skl: 40, spd: 35, def: 45}},
  axeman: {name: '斧手', weapon: 'axe', skill: ['axe'], kit: {w: 'hatchet', a: 'leather'}, sprites: [['people', 'smith']], base: {hp: 27, str: 8, skl: 4, spd: 4, def: 3, mov: 5}, grow: {hp: 85, str: 55, skl: 30, spd: 30, def: 30}},
  archer: {name: '弓手', weapon: 'bow', skill: ['bow'], kit: {w: 'bow', a: 'leather'}, sprites: [['people', 'archer'], ['people', 'crossbow']], base: {hp: 20, str: 5, skl: 7, spd: 6, def: 2, mov: 5}, grow: {hp: 60, str: 40, skl: 55, spd: 45, def: 25}},
  herbalist: {name: '草藥師', weapon: 'staff', skill: [], kit: {w: 'staff', a: 'robe'}, sprites: [['people', 'herbalist'], ['people', 'nun'], ['people', 'monk']], base: {hp: 19, str: 2, skl: 5, spd: 6, def: 3, mov: 5}, grow: {hp: 55, str: 20, skl: 40, spd: 40, def: 20}, heals: 8},
  // 敵人
  bandit: {name: '山賊', weapon: 'axe', skill: ['axe'], kit: {w: 'hatchet', a: 'cloth'}, sprites: [['foes', 'bandit']], base: {hp: 19, str: 6, skl: 3, spd: 4, def: 3, mov: 5}, grow: {hp: 70, str: 45, skl: 30, spd: 30, def: 25}},
  cutthroat: {name: '劫匪', weapon: 'sword', skill: ['sword'], kit: {w: 'sword', a: 'leather'}, sprites: [['people', 'thief']], base: {hp: 16, str: 5, skl: 6, spd: 8, def: 1, mov: 5}, grow: {hp: 60, str: 40, skl: 45, spd: 50, def: 20}},
  poacher: {name: '盜獵者', weapon: 'bow', skill: ['bow'], kit: {w: 'bow', a: 'cloth'}, sprites: [['people', 'crossbow']], base: {hp: 16, str: 5, skl: 5, spd: 5, def: 2, mov: 5}, grow: {hp: 55, str: 40, skl: 45, spd: 40, def: 20}},
  chief: {name: '山賊頭目', weapon: 'axe', skill: ['axe', 'sword'], kit: {w: 'hatchet', a: 'leather'}, sprites: [['foes', 'cultist']], base: {hp: 28, str: 9, skl: 6, spd: 6, def: 4, mov: 5}, grow: {hp: 80, str: 50, skl: 40, spd: 35, def: 35}},
  wolf: {name: '灰狼', weapon: 'fang', beast: true, sprites: [['foes', 'wolf']], base: {hp: 15, str: 5, skl: 6, spd: 9, def: 1, mov: 6}, grow: {hp: 50, str: 35, skl: 40, spd: 50, def: 15}},
  boar: {name: '野豬', weapon: 'tusk', beast: true, sprites: [['foes', 'boar']], base: {hp: 22, str: 6, skl: 3, spd: 5, def: 4, mov: 5}, grow: {hp: 70, str: 45, skl: 25, spd: 30, def: 35}},
  bear: {name: '棕熊', weapon: 'claw', beast: true, sprites: [['foes', 'bear']], base: {hp: 32, str: 8, skl: 3, spd: 3, def: 5, mov: 4}, grow: {hp: 90, str: 50, skl: 20, spd: 20, def: 40}},
};

// 裝備：真的物品，放在行囊裡可以換手、買賣。四格：武器、套裝、盾牌、飾品
// 武器種類：劍、槍、斧、弓，加上不進相剋的「雜兵器」（other）；不擅長的武器命中 −15（雜兵器誰都會用）
// h：1 單手、2 雙手（雙手武器不能配盾）。v：基本價錢。tier 0～3，每級武器攻擊 +1、防具和盾牌防禦 +1
export const ITEMS = {
  sword: {k: 'w', n: '鐵劍', type: 'sword', mt: 4, hit: 90, h: 1, v: 30, icon: '🗡️'},
  longsword: {k: 'w', n: '長劍', type: 'sword', mt: 5, hit: 85, h: 1, v: 55, icon: '🗡️'},
  spear: {k: 'w', n: '長矛', type: 'lance', mt: 6, hit: 80, h: 1, v: 30, icon: '🔱'},
  pike: {k: 'w', n: '長槍', type: 'lance', mt: 8, hit: 75, h: 2, v: 45, icon: '🔱'},
  hatchet: {k: 'w', n: '戰斧', type: 'axe', mt: 7, hit: 70, h: 1, v: 30, icon: '🪓'},
  greataxe: {k: 'w', n: '大斧', type: 'axe', mt: 10, hit: 60, h: 2, v: 50, icon: '🪓'},
  bow: {k: 'w', n: '短弓', type: 'bow', mt: 5, hit: 85, range: [2, 2], h: 2, v: 30, icon: '🏹'},
  longbow: {k: 'w', n: '長弓', type: 'bow', mt: 6, hit: 80, range: [2, 3], h: 2, v: 60, icon: '🏹'},
  dagger: {k: 'w', n: '匕首', type: 'other', mt: 3, hit: 95, crit: 5, h: 1, v: 15, icon: '🔪'},
  club: {k: 'w', n: '棍棒', type: 'other', mt: 3, hit: 85, h: 1, v: 6, icon: '🏏', wood: true},
  staff: {k: 'w', n: '木杖', type: 'other', mt: 1, hit: 80, h: 2, v: 8, icon: '🦯', wood: true},
  cloth: {k: 'a', n: '布衣', def: 0, spd: 0, v: 5, sprite: ['people', 'peasant'], soft: true},
  robe: {k: 'a', n: '長袍', def: 0, spd: 0, v: 12, sprite: ['people', 'monk'], soft: true},
  leather: {k: 'a', n: '皮甲', def: 1, spd: 0, v: 30, sprite: ['people', 'thief'], soft: true},
  mail: {k: 'a', n: '鎖子甲', def: 2, spd: -1, v: 70, sprite: ['people', 'squire']},
  plate: {k: 'a', n: '板甲', def: 3, spd: -2, v: 140, sprite: ['people', 'knight'], wt: 2},
  buckler: {k: 's', n: '小圓盾', def: 1, arrow: 1, spd: 0, v: 20, icon: '🛡️'},
  kite: {k: 's', n: '鳶盾', def: 2, arrow: 2, spd: -1, v: 45, icon: '🛡️'},
  charm: {k: 't', n: '護身符', def: 1, v: 40, icon: '🧿', rare: true},
  coin: {k: 't', n: '幸運銅幣', skl: 2, v: 40, icon: '🪙', rare: true},
  badge: {k: 't', n: '舊軍徽', str: 1, v: 40, icon: '🎖', rare: true},
};
export const SLOT_NAME = {w: '武器', a: '套裝', s: '盾牌', t: '飾品'};
export const WTYPE_NAME = {sword: '劍', lance: '槍', axe: '斧', bow: '弓', other: '雜兵器'};
export const TIER_NAME = ['', '精良', '名匠', '大師'];
export const itemName = it => (TIER_NAME[it.t || 0] || '') + (ITEMS[it.b]?.n || '？');
// 在行囊裡佔的位置（包）：盔甲一包（板甲兩包），武器、盾牌半包，飾品不算
export const itemWeight = it => { const I = ITEMS[it.b]; return !I ? 0 : I.k === 'a' ? (I.wt || 1) : I.k === 't' ? 0 : 0.5; };
// 打仗時裝備帶來的加成（回來時要扣掉，才不會疊上去）
export function gearAdd(m) {
  const e = m.eq || {}, r = {str: 0, skl: 0, spd: 0, def: 0};
  for (const s of ['a', 's', 't']) { const it = e[s]; if (!it || !ITEMS[it.b]) continue; const I = ITEMS[it.b]; r.def += (I.def || 0) + (s !== 't' ? (it.t || 0) : 0); r.spd += I.spd || 0; r.str += I.str || 0; r.skl += I.skl || 0; }
  return r;
}
// 手上的武器（野獸用爪牙；還沒換成物品的舊角色用職業的武器）
export function weaponOf(m) {
  const c = CLASSES[m.cls], it = m.eq?.w; if (c?.beast || !it || !ITEMS[it.b]) return WEAPONS[m.weapon || c?.weapon || 'staff'];
  const I = ITEMS[it.b], skilled = I.type === 'other' || (c?.skill || []).includes(I.type);
  return {name: itemName(it), type: I.type, mt: I.mt + (it.t || 0), hit: I.hit - (skilled ? 0 : 15), crit: I.crit || 0, range: I.range || [1, 1], icon: I.icon, unskilled: !skilled};
}
export const armorSprite = m => (m.eq?.a && ITEMS[m.eq.a.b]?.sprite) || m.sprite;

export const RECRUIT_CLASSES = ['swordsman', 'spearman', 'axeman', 'archer', 'herbalist'];

// 戰場地形：迴避、防禦、移動消耗（Infinity = 不能走）
export const TERRAIN = {
  grass: {name: '草地', avo: 0, def: 0, cost: 1},
  road: {name: '道路', avo: 0, def: 0, cost: 1},
  bush: {name: '灌木', avo: 10, def: 0, cost: 1},
  forest: {name: '樹林', avo: 20, def: 1, cost: 2},
  hill: {name: '丘陵', avo: 10, def: 2, cost: 2},
  rock: {name: '岩石', avo: 0, def: 0, cost: Infinity},
  water: {name: '水', avo: 0, def: 0, cost: Infinity},
  wall: {name: '木柵', avo: 0, def: 0, cost: Infinity},
  camp: {name: '營地', avo: 10, def: 1, cost: 1},
};

// 特性：每個都有好有壞
export const TRAITS = {
  reckless: {name: '魯莽', desc: '力量 +2；附近有敵人時常常不管命令直接衝上去', obey: -10},
  cautious: {name: '謹慎', desc: '迴避 +10；預估會被打掉一半以上血量的仗不打', obey: 0},
  coward: {name: '膽小', desc: '血量低於一半就想逃；撤退時跑得最快（移動 +1）', obey: -5},
  loyal: {name: '忠心', desc: '聽令機率 +20；欠薪時忠誠掉得少', obey: 20},
  guardian: {name: '護主', desc: '在主角身邊時防禦 +2；總想站在主角旁邊', obey: 5},
  bloodthirsty: {name: '嗜血', desc: '暴擊 +10；專挑血量最低的敵人', obey: -5},
  marksman: {name: '神射', desc: '用弓命中 +15', obey: 0},
  greedy: {name: '貪財', desc: '薪水 +50%；打勝仗分到戰利品時忠誠多漲', obey: 0},
  drunkard: {name: '酒鬼', desc: '命中 -10；薪水便宜 30%', obey: -5},
  veteran: {name: '老兵', desc: '命中 +10、聽令 +10；成長比較慢', obey: 10},
};
export const TRAIT_KEYS = Object.keys(TRAITS);

export const NAMES = ['艾德', '布蘭', '卡爾', '道格', '艾倫', '費恩', '葛雷', '哈羅', '伊凡', '賈斯', '凱爾', '洛克', '馬汀', '奈德', '歐文', '派克', '昆特', '羅蘭', '席恩', '托爾', '烏瑞', '維克', '韋恩', '雅各', '澤克', '艾菈', '貝絲', '柯拉', '黛娜', '艾瑪', '芙蕾', '葛妲', '海倫', '艾薇', '茱恩', '凱特', '莉娜', '瑪菈', '妮娜', '歐拉', '佩琪', '蘿絲', '莎拉', '泰莎', '烏娜', '薇拉'];
export const MALE_NAMES = NAMES.slice(0, 25), FEMALE_NAMES = NAMES.slice(25);
export const SURNAMES = ['石丘', '灰河', '鐵爐', '橡木', '黑溪', '鹽沼', '風谷', '老橋', '紅泥', '霜坡', '麥田', '狼嶺'];

// 命令（含糊指令）
export const ORDERS = {
  follow: {name: '跟著我', desc: '待在主角兩格內，順手打附近的敵人'},
  hold: {name: '守住', desc: '不移動，只打站著就打得到的敵人'},
  engage: {name: '進攻', desc: '自己挑最好打的目標'},
  focus: {name: '集火', desc: '全力攻擊指定的敵人'},
  retreat: {name: '撤退', desc: '遠離敵人，往主角或地圖邊緣靠'},
};
