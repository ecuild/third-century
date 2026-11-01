// 三世纪：罗马的黄昏 —— 核心常量与规则数据
// 严格对齐 rules.html 客户版

// 6 中央势力 = 6 花色（决定牌面颜色）
export const SUITS = [
  { id: 0, name: '元老院',   latin: 'Senatus',     color: '#6b4a8c' },
  { id: 1, name: '禁卫军',   latin: 'Praetoriani', color: '#b23a2e' },
  { id: 2, name: '宫廷近臣', latin: 'Aula Regia',  color: '#2f6f9f' },
  { id: 3, name: '财政使',   latin: 'Fiscus',     color: '#d98324' },
  { id: 4, name: '意大利城市', latin: 'Italia',    color: '#4e8a4f' },
  { id: 5, name: '北非粮仓', latin: 'Annona',     color: '#d9ad2e' },
];

// 8 玩家势力（席位 0..7，对应规则书第 1-8 席）
export const FACTIONS = [
  { seat: 0, name: '卡劳修斯',   realm: '不列颠分离政权', title: '不列颠的奥古斯都', color: '#1f6f8b' },
  { seat: 1, name: '克罗库斯',   realm: '阿勒曼尼/法兰克诸部', title: '神庙毁灭者',  color: '#8a5a2b' },
  { seat: 2, name: '奥勒良',     realm: '伊利里亚/多瑙河军团', title: '世界光复者',  color: '#b5462f' },
  { seat: 3, name: '尼瓦',       realm: '哥特诸部',   title: '皇帝杀手',            color: '#3a3a3a' },
  { seat: 4, name: '沙普尔一世', realm: '萨珊波斯',   title: '王中之王',            color: '#2f5fa8' },
  { seat: 5, name: '芝诺比娅',   realm: '帕米拉帝国', title: '东方女王',            color: '#7a3b8f' },
  { seat: 6, name: '巴高达',     realm: '巴高达起义', title: '自称皇帝',            color: '#4f6b3a' },
  { seat: 7, name: '波斯图穆斯', realm: '高卢帝国',   title: '高卢帝国建立者',      color: '#6b6f76' },
];

// 牌型等级（规则 5.1）：同花顺 > 方阵 > 同花 > 顺子 > 杂军
export const FORM = {
  SCRAP: 1,          // 杂军
  STRAIGHT: 2,       // 顺子
  FLUSH: 3,          // 同花
  THREE_KIND: 4,     // 方阵
  STRAIGHT_FLUSH: 5, // 同花顺
};

export const FORM_NAME = {
  5: '同花顺', 4: '方阵', 3: '同花', 2: '顺子', 1: '杂军', 0: '空',
};

// 环型规模：战场数 = 人数（规则 3.1）。默认 8（标准局）；setRingSize(n) 可在 2..8 间
// 切换（少人数局模拟/对战用——规则书 3.1 人数表：3 人 = 3 条战线闭环，27 面旗）。
// ES 模块活绑定：切换后所有 import 方即时生效；建局时应通过 createGame(seed,{nSeats})
// 传入，规模同时烙进 g.nSeats 供 UI/统计读取。
export let N_SEATS = 8;
export let N_LINES = 8;
export function setRingSize(n) {
  if (!Number.isInteger(n) || n < 2 || n > 8) throw new Error(`ring size must be 2..8, got ${n}`);
  N_SEATS = n;
  N_LINES = n;   // 规则 3.1：战场数 = 人数
}
export const N_ZONES = 6;

// 每条战线格数（规则 3.5）
export const CELLS_PER_LINE = 9;
// 每条战线牌堆张数（6 色 × 1-10，规则 2.2）
export const DECK_SIZE = 60;
// 每线每玩家手牌上限（规则 7.1 / 7.3，两线不可混用）
export const HAND_PER_LINE = 7;
// 中心区夺战术牌门槛（规则 8.5）
export const CENTER_THRESHOLD = 6;
// 领袖计点（规则 8.4）
export const LEADER_WORTH = 2;
// 终局：任一玩家「旗子数」达到此值（规则 10.2 v1.5）。
// 旗子数 = 该玩家累计夺得的旗幟格数 + 当前持有的中央区数（中央区每区算 1 面旗）。
export const WIN_FLAGS = 12;
// 中央区占位计分（规则 8.6）：某区影响力达门槛且唯一第一者，夺得该区 1 分；
// 该区易主时新区主 +1、旧区主 −1（严格零和）。开局各区无主，首次夺取无人扣分。
export const ZONE_POINT = 1;
// 终局：牌堆需洗回次数（规则 10.2 第 2 条「第二次洗回后再次用尽」）
export const RESHUFFLES_TO_END = 2;
// 兜底最大回合数（防止病态死循环）
export const MAX_ROUNDS = 400;

// 战术牌库（10 张：士气 4 / 环境 2 / 计谋 4，规则 11.1）
// cat: morale 参与阵型 / env 改变该格比较方式 / guile 即时结算
// wild: 结算时才确定的「颜色 + 点数」取值域
export const TACTICS = [
  { id: 'god1',   cat: 'morale', name: '领袖·克劳狄乌斯·哥提库斯',
    desc: '万能牌：结算时确定颜色与数字', wild: { suits: null, ranks: null }, isLeaderCard: true },
  { id: 'god2',   cat: 'morale', name: '领袖·普罗布斯',
    desc: '万能牌：结算时确定颜色与数字', wild: { suits: null, ranks: null }, isLeaderCard: true },
  { id: 'horse',  cat: 'morale', name: '御林铁骑',
    desc: '视为任一花色的 8', wild: { suits: null, ranks: [8] } },
  { id: 'shield', cat: 'morale', name: '戍边军团',
    desc: '视为任一花色、点数 ≤3 的牌', wild: { suits: null, ranks: [1, 2, 3] } },
  { id: 'plague', cat: 'env',    name: '西普里安瘟疫',
    desc: '该旗幟忽略一切牌型，仅比双方点数总和', env: 'points' },
  { id: 'flood',  cat: 'env',    name: '多瑙河春汛',
    desc: '该旗幟改为以四张牌组成阵型比较', env: 'four' },
  { id: 'scout',  cat: 'guile',  name: '哥特游骑',
    desc: '从本战线牌堆抽 3 张入手；任选 2 张正面朝下放回牌堆顶。本回合不再补牌' },
  { id: 'shift',  cat: 'guile',  name: '莱茵换防',
    desc: '将你方某未夺旗幟旁的一张牌，移到己方另一空位，或弃掉' },
  { id: 'mutiny', cat: 'guile',  name: '军团哗变',
    desc: '将对手某未夺旗幟旁的一张牌移出并弃掉' },
  { id: 'defect', cat: 'guile',  name: '附庸倒戈',
    desc: '取对手某未夺旗幟旁的一张部队牌，放到己方一个空位' },
];

export const TACTIC_BY_ID = Object.fromEntries(TACTICS.map(t => [t.id, t]));

// 8 条战线：战线 i 连接席位 i 与 (i+1)%8（规则 3.3）
export function lineSeats(i) {
  return [i, (i + 1) % N_SEATS];
}
// 某席参与的两条战线（规则 3.3）
export function playerLines(seat) {
  return [(seat - 1 + N_SEATS) % N_SEATS, seat];
}

// 规则 6.3：先手方判定 —— 看方向指示器。
// 顺时针(dir=+1)时战线 i 上「席 i+1」先结算；逆时针(dir=-1)时「席 i」先结算。
export function firstHand(lineIdx, dir) {
  const [a, b] = lineSeats(lineIdx);
  return dir > 0 ? b : a;
}
// 后结算方（规则 5.1 第 3 条 / 9.1：平手时后结算方判负）
export function secondHand(lineIdx, dir) {
  const [a, b] = lineSeats(lineIdx);
  return dir > 0 ? a : b;
}

// 规则 6.2 / 4.1：本回合摊开顺序 = 从标记所在线起，沿指示器方向绕环一圈。
// 起点恒为标记线本身。
export function revealOrder(markerLine, dir = +1) {
  const order = [];
  for (let k = 0; k < N_LINES; k++) {
    order.push((markerLine + dir * k + N_LINES * 2) % N_LINES);
  }
  return order;
}

// 规则 3.5：旗幟初始归属。
// 线 i（连接席 i 与席 i+1）由「环向前位」席 i 拿 5 面、席 i+1 拿 4 面。
// 战线⑧（席 8 – 席 1）由席 8 拿 5 面、席 1 拿 4 面 —— 与规则书表格一致。
// 每人恰在两条线上一次拿 5、一次拿 4，合计 9 面，全局 72 面严格对称。
export function initialFlags() {
  const assign = [];
  for (let i = 0; i < N_LINES; i++) {
    const [a, b] = lineSeats(i);
    const cells = [];
    for (let k = 0; k < CELLS_PER_LINE; k++) cells.push(k < 5 ? a : b);
    assign.push(cells);
  }
  return assign;
}
// 规则 8.3：打空手牌时的领袖放置。
// 注：多个玩家同回合打空时规则要求「按标记顺时针轮流放置」，但因暗扣本身是全桌同时
// 进行的（6.2），且同一色区可容纳多名玩家的领袖（互不排斥），放置先后不改变任何结果，
// 故引擎按席序一次性结算，不额外实现轮转次序。
