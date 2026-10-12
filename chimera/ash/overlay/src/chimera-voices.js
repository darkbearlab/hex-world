// 奇美拉：戰場上的台詞由小隊的隊員自己說（Alan 2026-10-12：開火、發現敵人、發現頭目、被包夾、戰死都換成每個人自己的台詞，頭像也換上）。
// ASH 原本由當班的管制員說（src/comms.js）；補丁 0010 讓 controller-comms 先問 game.chimeraVoice(事件, 細節)，回傳 null 就不說。
// 每位原主每種事件兩句（placeholder），隨機挑；頭像用 /donors/<原主>/portrait.png。沒有原主的人照通用台詞、不放頭像（SOUND ONLY）。
// 開火：ASH 沒有這個事件，這裡在開火之後排進 chimeraVoiceQueue（一位隊員至少隔 FIRE_CD 回合、機率 FIRE_P，才不會每一槍都講話）
const FIRE_P = .35, FIRE_CD = 5;
export const VOICES = {
  ember: {fire: ['目標確認，開火。', '照程序處理。'], contact: ['敵方接觸。保持隊形。', '前方有目標，各自就位。'], boss: ['高價值目標。優先排除。', '對方的指揮官……記下來，先處理他。'],
    flank: ['側翼失守，調整方向。', '我們被包了。冷靜，一個一個來。'], grenade: ['手榴彈，散開。', '投擲物——離開那一格。'], kia: ['……任務……還沒……', '報告……我的部分……到此為止。']},
  onyx: {fire: ['看到你了！', '打中了嗎？打中了吧！'], contact: ['有人！在那邊——我剛剛空拍看到的！', '前面有動靜，大家小心！'], boss: ['那個……是不是很大隻？', '頭目出來了！要不要先撤一下？'],
    flank: ['旁邊！旁邊也有！', '他們繞過來了，我的無人機怎麼沒拍到——'], grenade: ['手榴彈！趴下！', '有東西丟過來了！'], kia: ['地圖……還沒畫完……', '對不起……我看漏了……']},
  silver: {fire: ['我、我打了！', '對不起……但你擋到路了。'], contact: ['有、有人……', '前面……好像有敵人。'], boss: ['好、好大……我站前面就好。', '那個交給我擋，大家先打。'],
    flank: ['後面也有人！我來擋！', '不要怕，我在這邊。'], grenade: ['手榴彈！我擋著，快走！', '小心——！'], kia: ['我……還扛得住……的……', '大家……沒事就好……']},
  cedar: {fire: ['吃我這一下！', '嘿呀！'], contact: ['找到你們了！', '有客人！我先衝了喔！'], boss: ['哇，大隻的！我喜歡！', '頭目耶！送你一程！'],
    flank: ['好多人！更好玩了！', '從旁邊來？那我也從旁邊回敬！'], grenade: ['炸彈！跑跑跑——', '閃開閃開！'], kia: ['欸……路……好遠……', '這次……送不到了……']},
  'portrait-05': {fire: ['讓我看看你的構造。', '嗯，這個後座力不錯。'], contact: ['有東西在動，可能是敵人，也可能是好零件。', '接觸！先打，再拆。'], boss: ['那身裝備……拆下來應該很值錢。', '大傢伙！弱點一定在接縫。'],
    flank: ['側面！誰沒鎖好門？', '被包了——好，那就全部修理一遍。'], grenade: ['手工的？做得真爛。快躲！', '手榴彈！'], kia: ['可惡……我還沒……修好……', '扳手……給下一個人……']},
  'portrait-06': {fire: ['看好了。', '這才叫射擊。'], contact: ['敵人。跟著我。', '有東西靠近了，我先上。'], boss: ['終於有像樣的對手了。', '頭目？讓我來。'],
    flank: ['想繞我後面？太慢了。', '側翼！我來處理。'], grenade: ['手榴彈，散開！', '低頭！'], kia: ['哈……居然是我先……', '別看了……往前走……']},
  'portrait-07': {fire: ['……', '安靜點。'], contact: ['看到了。', '目標，三點鐘方向。'], boss: ['……那個不一樣。', '頭目。不要硬拚。'],
    flank: ['側面有人。', '被繞了。我去處理。'], grenade: ['手榴彈。', '散開。'], kia: ['……抱歉……', '……我沒看到……']},
  'portrait-08': {fire: ['退後。', '別過來。'], contact: ['敵人。站我後面。', '有接觸。我在前面。'], boss: ['頭目。我來擋。', '你們打，我擋著。'],
    flank: ['側面——別慌，往我這邊靠。', '他們繞過來了。我轉過去。'], grenade: ['手榴彈！靠過來！', '躲到我後面！'], kia: ['……守住……了嗎……', '……抱歉，沒擋好……']},
  'portrait-09': {fire: ['掉下去吧。', '這高度，剛好。'], contact: ['上面看得很清楚，有人。', '有敵人。我繞上去。'], boss: ['大傢伙，站穩了喔。', '頭目——我從上面下手。'],
    flank: ['想夾我？我換個高度就好。', '旁邊有人。沒差，我比他們快。'], grenade: ['手榴彈，跳開！', '下面有炸彈！'], kia: ['……這次……沒抓穩……', '……掉下來……了……']},
  'portrait-10': {fire: ['燒乾淨。', '慢慢來，不急。'], contact: ['有人。大家穩住呼吸。', '接觸了。照計畫。'], boss: ['那個，像一座要爆的鍋爐。', '頭目。控制好距離。'],
    flank: ['側翼有火……我是說，有敵人。', '被包了。別慌，一個一個熄掉。'], grenade: ['爆裂物。退開。', '手榴彈——別碰它。'], kia: ['……火……熄了……', '……沒關係……我習慣了……']},
  'portrait-11': {fire: ['讓路！', '喇叭不按，子彈照打！'], contact: ['前方有人攔路！', '有車匪？還是步兵？都一樣！'], boss: ['大魚！撞過去！', '頭目——我最喜歡跟大的飆。'],
    flank: ['後照鏡裡都是人！', '被包抄了？那就衝出去！'], grenade: ['炸彈！急轉！', '閃開——！'], kia: ['……這趟……送不到了……', '……油……用完了……']},
  'portrait-12': {fire: ['風向對了。', '一槍。'], contact: ['沙子裡有腳印。他們來了。', '有人。別出聲。'], boss: ['那個……沙漠也會怕。', '頭目。保持距離。'],
    flank: ['旁邊的沙丘後面有人。', '被包圍了。找掩護。'], grenade: ['手榴彈。', '趴下。'], kia: ['……水……留給你們……', '……沙子……好暖……']},
  'portrait-13': {fire: ['讓開，我要過去！', '別擋我救人！'], contact: ['有敵人！大家注意掩護！', '接觸！受傷的先往後！'], boss: ['頭目……大家別硬拚，我會把人拉回來。', '我來掩護，你們專心打。'],
    flank: ['側面有人！保護傷員！', '被包了——我殿後，你們先走！'], grenade: ['手榴彈！趴下！', '炸彈——別過來！'], kia: ['……還有人……沒帶回來……', '……把大家……帶回去……']},
  'portrait-14': {fire: ['啪～', '這個是見面禮～'], contact: ['有人有人～', '找到好東西了……啊，是敵人。'], boss: ['哇～大寶箱～', '那個看起來很值錢耶，打倒它吧？'],
    flank: ['欸欸，旁邊也有人？', '被包圍了～好刺激～'], grenade: ['炸彈～快跑～', '不要不要不要——'], kia: ['欸……沉下去了……', '……分我的那份……給大家吧……']},
  'portrait-15': {fire: ['……嗯。', '清掉了。'], contact: ['有東西。可能有毒，也可能是人。', '接觸。戴好面罩。'], boss: ['那個……比輻射還麻煩。', '頭目。嗯……麻煩。'],
    flank: ['側面也有。好煩。', '被包了。……我就知道。'], grenade: ['爆炸物，退開。', '手榴彈。別撿。'], kia: ['……啊……面罩……', '……早知道……就請假……']},
  'portrait-16': {fire: ['晚安。', '天還沒亮呢。'], contact: ['黑暗裡有人。我看得到。', '有人靠近了。'], boss: ['那個……很冷的感覺。', '頭目。今晚會很長。'],
    flank: ['旁邊也有……沒關係，我守著。', '被包圍了。大家靠緊一點。'], grenade: ['手榴彈，退開！', '小心！'], kia: ['……天……亮了嗎……', '……夜班……交給你們了……']},
};
// 沒有原主（或沒寫到）的人：通用台詞
const GENERIC = {fire: ['開火！'], contact: ['發現敵人！'], boss: ['頭目出現了！'], flank: ['側翼有敵人！'], grenade: ['手榴彈！'], kia: ['……我倒下了……']};
const EVENTS = new Set(Object.keys(GENERIC));
export function installVoices(Game) {
  const P = Game.prototype;
  // 回傳 comms 的訊息（text、name、face）或 null（不說話）
  P.chimeraVoice = function (type, detail = {}) {
    if (!EVENTS.has(type)) return null;   // 敵方小隊的口令、研究員⋯⋯這些交給畫面上的其他東西，隊員不說
    const pool = this.members || [this.player];
    let who = type === 'kia' ? pool.find(m => detail.fall?.id && m.id === detail.fall.id) || (detail.fall?.member ? pool.find(m => m.hp <= 0) : this.player) : detail.speaker || this.player;
    if (!who) return null;
    const lines = VOICES[who.donor]?.[type] || GENERIC[type], text = lines[Math.floor(Math.random() * lines.length)];
    const name = who.callName || who.squadId || '';
    return {text, name, short: name, ...(VOICES[who.donor] ? {face: `/donors/${who.donor}/portrait.png`} : {}), ...(type === 'kia' ? {} : {seconds: Math.min(4, 1.6 + text.length * .08)})};
  };
  // 開火：排進佇列，下一次 controller 說話時一起說。佇列、冷卻都放在遊戲狀態外面（伺服器重播驗證時，狀態不能因為隨機的台詞不一樣）
  const action = P.action;
  P.action = function (type, arg) {
    const shooter = this.player, ok = action.call(this, type, arg);
    if (ok && type === 'fire' && shooter && this.status === 'playing' && typeof document !== 'undefined') {
      const v = side(this), last = v.fire.get(shooter.id) ?? -99;
      if (this.turn - last >= FIRE_CD && Math.random() < FIRE_P) { v.fire.set(shooter.id, this.turn); v.queue.push({type: 'fire', speaker: shooter}); }
    }
    return ok;
  };
  P.chimeraVoiceTake = function () { const v = side(this), q = v.queue; v.queue = []; return q; };
}
const sides = new WeakMap(), side = g => { let v = sides.get(g); if (!v) sides.set(g, v = {queue: [], fire: new Map()}); return v; };
