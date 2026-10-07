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
  knight: {name: '騎士', weapon: 'sword', sprites: [['people', 'knight']], base: {hp: 26, str: 6, skl: 7, spd: 6, def: 6, mov: 5}, grow: {hp: 80, str: 50, skl: 45, spd: 40, def: 40}},
  swordsman: {name: '劍士', weapon: 'sword', sprites: [['people', 'squire'], ['people', 'thief']], base: {hp: 21, str: 5, skl: 7, spd: 8, def: 3, mov: 5}, grow: {hp: 65, str: 40, skl: 55, spd: 55, def: 25}},
  spearman: {name: '槍兵', weapon: 'lance', sprites: [['people', 'spearman'], ['people', 'peasant']], base: {hp: 23, str: 6, skl: 5, spd: 5, def: 6, mov: 5}, grow: {hp: 75, str: 45, skl: 40, spd: 35, def: 45}},
  axeman: {name: '斧手', weapon: 'axe', sprites: [['people', 'smith']], base: {hp: 27, str: 8, skl: 4, spd: 4, def: 4, mov: 5}, grow: {hp: 85, str: 55, skl: 30, spd: 30, def: 30}},
  archer: {name: '弓手', weapon: 'bow', sprites: [['people', 'archer'], ['people', 'crossbow']], base: {hp: 20, str: 5, skl: 7, spd: 6, def: 3, mov: 5}, grow: {hp: 60, str: 40, skl: 55, spd: 45, def: 25}},
  herbalist: {name: '草藥師', weapon: 'staff', sprites: [['people', 'herbalist'], ['people', 'nun'], ['people', 'monk']], base: {hp: 19, str: 2, skl: 5, spd: 6, def: 3, mov: 5}, grow: {hp: 55, str: 20, skl: 40, spd: 40, def: 20}, heals: 8},
  // 敵人
  bandit: {name: '山賊', weapon: 'axe', sprites: [['foes', 'bandit']], base: {hp: 19, str: 6, skl: 3, spd: 4, def: 3, mov: 5}, grow: {hp: 70, str: 45, skl: 30, spd: 30, def: 25}},
  cutthroat: {name: '劫匪', weapon: 'sword', sprites: [['people', 'thief']], base: {hp: 16, str: 5, skl: 6, spd: 8, def: 2, mov: 5}, grow: {hp: 60, str: 40, skl: 45, spd: 50, def: 20}},
  poacher: {name: '盜獵者', weapon: 'bow', sprites: [['people', 'crossbow']], base: {hp: 16, str: 5, skl: 5, spd: 5, def: 2, mov: 5}, grow: {hp: 55, str: 40, skl: 45, spd: 40, def: 20}},
  chief: {name: '山賊頭目', weapon: 'axe', sprites: [['foes', 'cultist']], base: {hp: 28, str: 9, skl: 6, spd: 6, def: 5, mov: 5}, grow: {hp: 80, str: 50, skl: 40, spd: 35, def: 35}},
  wolf: {name: '灰狼', weapon: 'fang', beast: true, sprites: [['foes', 'wolf']], base: {hp: 15, str: 5, skl: 6, spd: 9, def: 1, mov: 6}, grow: {hp: 50, str: 35, skl: 40, spd: 50, def: 15}},
  boar: {name: '野豬', weapon: 'tusk', beast: true, sprites: [['foes', 'boar']], base: {hp: 22, str: 6, skl: 3, spd: 5, def: 4, mov: 5}, grow: {hp: 70, str: 45, skl: 25, spd: 30, def: 35}},
  bear: {name: '棕熊', weapon: 'claw', beast: true, sprites: [['foes', 'bear']], base: {hp: 32, str: 8, skl: 3, spd: 3, def: 5, mov: 4}, grow: {hp: 90, str: 50, skl: 20, spd: 20, def: 40}},
};
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
