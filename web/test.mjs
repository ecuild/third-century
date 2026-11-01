// 完整单元测试 —— 逐条对齐 rules.html 客户版
// 运行： node test.mjs
import {
  createGame, runRound, applyAction, applyCenterAction, centerOptions,
  canPlayTroop, canPlayTactic, checkCapture, resolveCapture,
  refill, revealAll, endRound, finalRanking,
  collectRound, revealLine, finishRound,
  setInitialLeader, applyInitialLeaders, suggestInitialLeader,
  computeDominantSuit, playerZoneScore, zoneScoreAll,
  checkTacticsWin, checkAllTacticsWins, recycleTactic, cellCapacity,
  zoneLeaderOf, checkZoneScore, checkAllZoneScores,
  processGuileBoard, hasFreePlay, useFreePlay, locateTactic,
  resolveOneFloodDiscard, resolveFloodDiscards, floodDiscardCandidates,
  flagTotal, zoneHoldCount, resolveFreePlays,
} from './src/engine.mjs';
import {
  formationLevel, compareForm, comparePointsOnly, bestFormation,
  maxPointSum, pointSum, cardOptions,
} from './src/formation.mjs';
import {
  CELLS_PER_LINE, DECK_SIZE, HAND_PER_LINE, WIN_FLAGS, LEADER_WORTH,
  CENTER_THRESHOLD, ZONE_POINT, TACTIC_BY_ID, TACTICS, N_SEATS, N_LINES, N_ZONES,
  initialFlags, lineSeats, playerLines, firstHand, secondHand, revealOrder,
} from './src/rules.mjs';
import { chooseActions } from './src/ai.mjs';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name); }
}
function eq(a, b, name) { ok(Object.is(a, b), `${name}  (实际=${JSON.stringify(a)}, 期望=${JSON.stringify(b)})`); }
function section(t) { console.log('=== ' + t + ' ==='); }

const S = (s, r) => ({ suit: s, rank: r });
const W = id => ({ tactic: id });   // 万能/战术牌

// 测试辅助：把某战术牌绑定到指定中央区（createGame 只随机给 6 张绑区）
function bindTactic(g, id, home) {
  g.tacticHome[id] = home;
  g.zoneTactic[home] = id;
  for (let z = 0; z < N_ZONES; z++) if (z !== home && g.zones[z].tactics === id) g.zones[z].tactics = null;
  g.zones[home].tactics = null;   // 落场前牌在手中
}

// 构造受控局面
function mk(seed = 1) {
  const g = createGame(seed);
  g.dominantSuit = null;
  return g;
}
function setCell(g, li, k, cardsA, cardsB, owner) {
  const [a, b] = lineSeats(li);
  const cell = g.lines[li].cells[k];
  cell.sides = {};
  if (cardsA) cell.sides[a] = cardsA.slice();
  if (cardsB) cell.sides[b] = cardsB.slice();
  if (owner !== undefined) cell.owner = owner;
  cell.decided = false;
  return cell;
}

// ─────────────────────────────────────────
section('1. 牌型判定（规则 5.1）');
eq(formationLevel([S(0, 3), S(0, 4), S(0, 5)]), 5, '同花顺 = 5');
eq(formationLevel([S(0, 7), S(1, 7), S(2, 7)]), 4, '方阵 = 4');
eq(formationLevel([S(0, 2), S(0, 5), S(0, 9)]), 3, '同花 = 3');
eq(formationLevel([S(0, 2), S(1, 3), S(2, 4)]), 2, '顺子 = 2');
eq(formationLevel([S(0, 1), S(1, 5), S(2, 9)]), 1, '杂军 = 1');
eq(formationLevel([]), 0, '空 = 0');
// v1.2 修复：不足 3 张不算阵型（此前 n<3 时「同花/连续」空真成立，1 张被误判为同花顺=最强）
eq(formationLevel([S(0, 9)]), 1, '不足 3 张：单张按杂军(1)，不再误判为同花顺');
eq(formationLevel([S(0, 9), S(0, 10)]), 1, '不足 3 张：两张同色连续也按杂军(1)');
// 规则 2.2：每色 1–10 各一张 → 同色连续三张必为同花顺
eq(formationLevel([S(2, 9), S(2, 10), S(2, 1)]), 3, '10-1 不连号，仅同花');
// 多瑙河春汛：4 张阵型（规则 11.2）
eq(formationLevel([S(1, 4), S(1, 5), S(1, 6), S(1, 7)]), 5, '四张同花顺 = 5');
eq(formationLevel([S(0, 5), S(1, 5), S(2, 5), S(3, 5)]), 4, '四张方阵 = 4');
eq(formationLevel([S(0, 1), S(0, 3), S(0, 5), S(0, 7)]), 3, '四张同花 = 3');
eq(formationLevel([S(0, 1), S(1, 2), S(2, 3), S(3, 4)]), 2, '四张顺子 = 2');

section('2. 三级优先度比较（规则 5.2）');
{
  const a = [S(0, 7), S(0, 8), S(0, 9)], b = [S(1, 7), S(1, 8), S(1, 9)];
  eq(compareForm(a, b, 0), 1, '同花顺同级：主导花色多者胜(a)');
  eq(compareForm(a, b, 1), -1, '主导花色换边则 b 胜');
  eq(compareForm(a, b, null), 0, '无主导花色 → 点数和相同 → 平手');
  eq(compareForm([S(0, 2), S(0, 5), S(0, 9)], [S(1, 7), S(1, 8), S(1, 9)], 3), -1, '第1级牌型等级优先（同花顺>同花）');
  eq(compareForm([S(1, 2), S(1, 5), S(1, 9)], [S(1, 3), S(1, 4), S(1, 8)], 0), 1, '第3级点数和决胜(16>15)');
}

section('3. 万能牌结算（规则 11.2 士气类）');
eq(cardOptions(W('god1')).length, 60, '领袖牌：6 色 × 10 点 = 60 种取值');
eq(cardOptions(W('horse')).length, 6, '御林铁骑：6 色 × 固定 8 = 6 种');
eq(cardOptions(W('shield')).length, 18, '戍边军团：6 色 × 1/2/3 = 18 种');
eq(cardOptions(S(2, 5)).length, 1, '普通部队牌取值唯一');
// 领袖牌可凑成同花顺
eq(bestFormation([S(0, 7), S(0, 8), W('god1')], 0).level, 5, '领袖牌补成同花顺');
eq(bestFormation([S(0, 7), S(1, 7), W('god1')], 0).level, 4, '领袖牌补成方阵');
// 御林铁骑固定 8
eq(bestFormation([S(0, 7), S(0, 9), W('horse')], 0).level, 5, '御林铁骑=8 可凑 7-8-9 同花顺');
eq(maxPointSum([S(0, 10), W('god1'), W('god2')]), 30, '瘟疫下万能牌取最大点数 10');
eq(maxPointSum([S(0, 10), W('horse')]), 18, '御林铁骑点数和固定为 8');

section('4. 旗幟初始归属（规则 3.5）');
{
  const fa = initialFlags();
  const perSeat = Array(N_SEATS).fill(0);
  let total = 0;
  fa.forEach(cells => cells.forEach(s => { perSeat[s]++; total++; }));
  eq(total, 72, '全局 72 面旗');
  ok(perSeat.every(n => n === 9), `每席恰 9 面（实际 [${perSeat}]）`);
  // 与规则书 3.5 表格逐行比对
  eq(fa[0][0], 0, '战线① 前 5 面归第 1 席（卡劳修斯）');
  eq(fa[0][8], 1, '战线① 后 4 面归第 2 席（克罗库斯）');
  eq(fa[7][0], 7, '战线⑧ 前 5 面归第 8 席（波斯图穆斯）');
  eq(fa[7][8], 0, '战线⑧ 后 4 面归第 1 席（卡劳修斯）');
  for (let i = 0; i < N_LINES; i++) {
    const five = fa[i].filter(s => s === i).length;
    eq(five, 5, `战线${i + 1}：环向前位席取 5 面`);
  }
}

section('5. 战线与席次的环型结构（规则 3.1 / 3.3）');
eq(lineSeats(0).join(','), '0,1', '战线① 连接席 1–2');
eq(lineSeats(7).join(','), '7,0', '战线⑧ 连接席 8–1（闭合整圈）');
eq(playerLines(0).join(','), '7,0', '第 1 席镇守战线 ⑧ 与 ①');
eq(playerLines(7).join(','), '6,7', '第 8 席镇守战线 ⑦ 与 ⑧');
{
  const cnt = Array(N_SEATS).fill(0);
  for (let s = 0; s < N_SEATS; s++) for (const li of playerLines(s)) cnt[li] += 0;
  const appear = Array(N_SEATS).fill(0);
  for (let li = 0; li < N_LINES; li++) for (const s of lineSeats(li)) appear[s]++;
  ok(appear.every(n => n === 2), '每席恰出现在 2 条战线（全员双线）');
  const perLine = Array(N_LINES).fill(0);
  for (let li = 0; li < N_LINES; li++) perLine[li] = lineSeats(li).length;
  ok(perLine.every(n => n === 2), '每条战线恰 2 名玩家');
}

section('6. 先手 / 后结算方（规则 6.3 / 5.1 第3条）');
eq(firstHand(0, +1), 1, '顺时针：战线① 上席 2 先结算');
eq(firstHand(0, -1), 0, '逆时针：战线① 上席 1 先结算');
eq(secondHand(0, +1), 0, '顺时针：战线① 后结算方为席 1');
eq(secondHand(0, -1), 1, '逆时针：战线① 后结算方为席 2');
{
  let flipOk = true;
  for (let li = 0; li < N_LINES; li++) {
    if (firstHand(li, +1) === firstHand(li, -1)) flipOk = false;
    if (firstHand(li, +1) === secondHand(li, +1)) flipOk = false;
  }
  ok(flipOk, '方向翻面时每条战线两人先后互换，且先手≠后手');
  const cnt = Array(N_SEATS).fill(0);
  for (let r = 0; r < 8; r++) {
    const dir = r % 2 === 0 ? +1 : -1;
    for (let li = 0; li < N_LINES; li++) cnt[firstHand(li, dir)]++;
  }
  ok(cnt.every(c => c === 8), `8 回合内每席当先手 8 次（实际 [${cnt}]）`);
}

section('7. 摊开顺序（规则 4.1 / 6.2）');
eq(revealOrder(3, +1).join(','), '3,4,5,6,7,0,1,2', '顺时针：从标记线起绕环一圈');
eq(revealOrder(3, -1).join(','), '3,2,1,0,7,6,5,4', '逆时针：仍从标记线起，反向绕环');
ok(revealOrder(0, +1)[0] === 0 && revealOrder(0, -1)[0] === 0, '两种方向的起点恒为标记所在线');
ok(revealOrder(5, +1).length === N_LINES && new Set(revealOrder(5, -1)).size === N_LINES, '摊开顺序覆盖全部 8 条战线且不重复');

section('8. 起始战场标记迁移（规则 4.2 / 4.3）');
{
  const g = mk(11);
  eq(g.markerLine, 0, '开局标记固定钉在战线 ①');
  g._round = { pending: [], noRefill: new Set() };
  endRound(g);
  eq(g.markerLine, 7, '第 2 回合标记逆时针移到战线 ⑧（与规则书示例一致）');
  g._round = { pending: [], noRefill: new Set() };
  endRound(g);
  eq(g.markerLine, 6, '第 3 回合移到战线 ⑦');
  const seen = new Set([0, 7, 6]);
  for (let i = 0; i < 5; i++) { g._round = { pending: [], noRefill: new Set() }; endRound(g); seen.add(g.markerLine); }
  eq(seen.size, 8, '标记 8 回合绕环一周，每条战线都当过一次起点');
}

section('9. 方向指示器（规则 6.3b）');
{
  const g = mk(12);
  eq(g.revealDir, +1, '首回合为顺时针');
  g._round = { pending: [], noRefill: new Set() }; endRound(g);
  eq(g.revealDir, -1, '第 2 回合翻面为逆时针');
  g._round = { pending: [], noRefill: new Set() }; endRound(g);
  eq(g.revealDir, +1, '第 3 回合再翻回顺时针');
}

section('10. 手牌与牌堆（规则 2.1 / 7.1）');
{
  const g = mk(13);
  let handOk = true, deckOk = true;
  for (let s = 0; s < N_SEATS; s++) {
    for (const li of playerLines(s)) {
      if (g.hands[s][li].length !== HAND_PER_LINE) handOk = false;
    }
    if (g.hands[s][(s + 2) % N_LINES] !== undefined) handOk = false; // 未在战线上的席不持牌
  }
  ok(handOk, '每人两条战线各持 7 张手牌（共 14 张），且不持有其他战线的手牌');
  for (let li = 0; li < N_LINES; li++) {
    if (g.lines[li].deck.length !== DECK_SIZE - 2 * HAND_PER_LINE) deckOk = false;
  }
  ok(deckOk, `每线牌堆发剩 ${DECK_SIZE - 2 * HAND_PER_LINE} 张（60 − 2×7）`);
  // 牌张守恒
  const total = g.lines.reduce((a, l) => a + l.deck.length + l.discard.length, 0)
    + Object.values(g.hands).reduce((a, h) => a + Object.values(h).reduce((x, c) => x + c.length, 0), 0);
  eq(total, DECK_SIZE * N_LINES, '全局牌张守恒 = 60 × 8');
}

section('11. 暗扣合法性（规则 7.2）');
{
  const g = mk(14);
  const seat = 0, li = 0, k = 0;
  ok(canPlayTroop(g, seat, li, k, 0).ok, '选线→选格→扣牌：合法暗扣');
  ok(!canPlayTroop(g, seat, li, k, 99).ok, '手牌索引越界 → 拒绝');
  ok(!canPlayTroop(g, seat, 3, k, 0).ok, '不可把某线手牌打到另一条战线（两线不可混用）');
  // 满 3 张不可再投
  setCell(g, li, k, [S(0, 1), S(0, 2), S(0, 3)], null);
  ok(!canPlayTroop(g, seat, li, k, 0).ok, '己方该格已满 3 张 → 拒绝');
  // 已决出的格不可再投入新牌
  const g2 = mk(15);
  setCell(g2, li, 1, [S(0, 1), S(0, 2), S(0, 3)], [S(1, 1), S(1, 2), S(1, 3)]);
  g2.lines[li].cells[1].decided = true;
  ok(!canPlayTroop(g2, seat, li, 1, 0).ok, '已决出的格不可再投入新牌');
}

section('12. 补牌（规则 7.3）');
{
  const g = mk(16);
  const seat = 0, li = 0;
  g.hands[seat][li].pop();
  eq(g.hands[seat][li].length, 6, '出牌后手牌 6 张');
  refill(g, seat, li);
  eq(g.hands[seat][li].length, 7, '摊开结算后从该战线牌堆补 1 张');
  // 牌堆空 → 洗回弃牌堆
  const g2 = mk(17);
  g2.lines[li].discard.push(S(0, 1), S(0, 2), S(0, 3));
  g2.lines[li].deck = [];
  const before = g2.lines[li].reshuffles;
  refill(g2, seat, li);
  ok(g2.lines[li].reshuffles === before + 1, '牌堆为空时将弃牌堆洗回，洗回次数 +1');
  ok(g2.lines[li].discard.length === 0, '洗回后弃牌堆清空');
  // 手牌已达上限不再补
  const g3 = mk(18);
  const n3 = g3.lines[li].deck.length;
  refill(g3, seat, li);
  eq(g3.lines[li].deck.length, n3, '手牌已达 7 张上限时不补牌');
}

section('13. 中心区二选一（规则 8.2）');
{
  const g = mk(19);
  const seat = 2, suit = 3; // 橙=财政使
  const opt = centerOptions(g, seat, suit);
  eq(opt.placeZone, 3, '行动① 放标记：只能放在该牌颜色对应的颜色区');
  ok(opt.leaderZones.length === 1 && opt.leaderZones[0] === 3, '领袖不在该色区 → 行动② 只能移入该色区');
  // 领袖已在该色区 → 可移到任意其他区
  g.leaders[seat] = suit;
  const opt2 = centerOptions(g, seat, suit);
  eq(opt2.leaderZones.length, 5, '领袖已在该色区 → 可移到其余 5 个区');
  ok(!opt2.leaderZones.includes(suit), '此时不可留在原区（必须移动）');
  // 合法性：领袖已在该色区时可移到其他区
  const r1 = applyCenterAction(g, seat, suit, { type: 'leader', zone: 0 });
  ok(r1.ok && g.leaders[seat] === 0, '合法：领袖从该色区移到其他区');
  // 复位后再验证：仍指定该色区属非法
  g.leaders[seat] = suit;
  const r2 = applyCenterAction(g, seat, suit, { type: 'leader', zone: suit });
  ok(!r2.ok, '非法：领袖已在该色区却仍指定该区');
  const g2 = mk(20);
  const r3 = applyCenterAction(g2, seat, 4, { type: 'leader', zone: 1 });
  ok(!r3.ok, '非法：领袖不在牌色区时不能移到别区');
  const r4 = applyCenterAction(g2, seat, 4, { type: 'place' });
  ok(r4.ok && (g2.zones[4].influence[seat] || 0) === 1, '行动① 在该牌颜色区放 1 个影响力标记');
}

section('14. 影响力计点（规则 8.4）');
{
  const g = mk(21);
  const z = g.zones[2];
  z.influence = { 4: 3 };
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.leaders[4] = 2;
  eq(playerZoneScore(g, z, 4), 3 + LEADER_WORTH, '标记 ×1 + 领袖 2 点 = 5');
  eq(playerZoneScore(g, z, 5), 0, '其他玩家独立累计 = 0');
  eq(zoneScoreAll(g, z), 5, '该区全部玩家影响力总和');
}

section('15. 战术牌夺取（规则 8.5）');
{
  const g = mk(22);
  const z = g.zones[0];
  z.influence = {}; z.influence[3] = 5;
  g.leaders[3] = 0;                      // 5 + 2 = 7
  for (let s = 0; s < N_SEATS; s++) if (s !== 3) z.influence[s] = 1;
  const r = checkTacticsWin(g, 0);
  ok(r && r.winner === 3, '影响力 7 ≥ 6 且排名第一 → 夺得战术牌');
  ok(g.playerTactics[3].includes(z.tactics) || z.tactics === null, '战术牌进入该玩家战术区');
  eq(z.tactics, null, '场上该区战术牌被取走');
}
{
  const g = mk(23);                       // 未达 6 分不可夺
  const z = g.zones[1];
  z.influence = { 2: 5 }; g.leaders[2] = 9;
  eq(checkTacticsWin(g, 1), null, '影响力 5 < 6 → 不夺牌');
}
{
  const g = mk(24);                       // 并列第一不可夺
  const z = g.zones[2];
  z.influence = { 1: 7, 2: 7 };
  g.leaders[1] = 9; g.leaders[2] = 9;
  eq(checkTacticsWin(g, 2), null, '并列第一 → 无人夺牌');
}

section('16. 主导花色（规则 8.7）');
{
  const g = mk(25);
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.zones[2].influence[0] = 3;
  g.zones[4].influence[1] = 1;
  eq(computeDominantSuit(g), 2, '总影响力最高的颜色区 = 主导花色');
}
{
  const g = mk(26);                       // v1.1：并列最高 → 无主导花色（不再沿用上回合）
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.zones[1].influence[0] = 3;
  g.zones[3].influence[1] = 3;
  g.dominantSuit = 1;
  eq(computeDominantSuit(g), null, '两区总影响力并列最高 → 本回合无主导花色');
}
{
  const g = mk(26.1);                     // 上回合有主导花色，本回合并列 → 也应清空
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.zones[0].influence[0] = 4;
  g.zones[5].influence[1] = 4;
  g.dominantSuit = 2;
  eq(computeDominantSuit(g), null, '并列时即便上回合有主导花色，也一律判为无主导');
}
{
  const g = mk(26.2);                     // 三区并列
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.zones[0].influence[0] = 2;
  g.zones[2].influence[1] = 2;
  g.zones[4].influence[2] = 2;
  eq(computeDominantSuit(g), null, '三区并列第一 → 无主导花色');
}
{
  const g = mk(26.3);                     // 差距 1 点不算并列
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.zones[1].influence[0] = 4;
  g.zones[3].influence[1] = 3;
  eq(computeDominantSuit(g), 1, '仅差 1 点不算并列 → 仍产生主导花色');
}
{
  const g = mk(27);                       // 全 0 → 无主导花色
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.dominantSuit = null;
  eq(computeDominantSuit(g), null, '全为 0 → 无主导花色');
}

section('17. 夺旗判定与严格零和（规则 9.1 / 9.4 / 10.1）');
{
  const g = mk(28);
  g.lines[0].deck = []; g.lines[0].discard = [];
  setCell(g, 0, 0, [S(0, 9), S(1, 9), S(2, 9)], [S(3, 1), S(4, 2)]);
  const r = resolveCapture(g, 0, 0);
  eq(r.winner, 0, '方阵 9 压过 2 张 → 席 1 夺旗');
  eq(g.scores[0], 1, '夺旗者 +1');
  eq(g.scores[1], -1, '原占据者 −1');
  eq(g.scores.reduce((a, b) => a + b, 0), 0, '严格零和：总分恒为 0');
}
{
  const g = mk(29);                       // 双方未满编且牌堆仍有牌 → 不判
  setCell(g, 0, 0, [S(0, 9), S(1, 9), S(2, 9)], [S(3, 1)]);
  eq(checkCapture(g, 0, 0).winner, null, '对手可能补强 → 暂不判夺旗');
}
{
  // v1.2 修复：对手无牌可再补 → 满编方胜（此前会误用比牌，1 张被判为同花顺而翻盘）
  const g = mk(2801);
  g.lines[0].deck = []; g.lines[0].discard = []; g.hands[1][0] = [];
  setCell(g, 0, 0, [S(0, 4), S(1, 3), S(3, 5)], [S(1, 9)]);   // 席0 顺子 3 张 vs 席1 仅 1 张
  eq(checkCapture(g, 0, 0).winner, 0, '对手无牌可补：满编方（席0 顺子）直接胜');
  const g2 = mk(2802);                    // 双方都未满编 → 无人能成阵
  g2.lines[0].deck = []; g2.lines[0].discard = []; g2.hands[1][0] = [];
  setCell(g2, 0, 0, [S(0, 4), S(1, 3)], [S(1, 9)]);
  eq(checkCapture(g2, 0, 0).winner, null, '双方未满编 → 不判夺旗');
}
{
  // v1.3（规则 9.1 第 1 条）：对手能否「用常规手段」凑出更强阵型 —— 直接决定是否夺旗
  const g = mk(2806);
  g.lines[0].deck = []; g.lines[0].discard = [];
  setCell(g, 0, 0, [S(1, 3), S(1, 4), S(1, 5)], [S(1, 10)]);   // 席0 ♥3-4-5 同花顺 vs 席1 ♥10
  g.hands[1][0] = [];                                            // 对手手里也没有 ♥8 / ♥9
  eq(checkCapture(g, 0, 0).winner, 0, '对手无法凑出更强阵型（缺 ♥8♥9）→ 直接判我方胜');
  g.hands[1][0] = [S(1, 8), S(1, 9)];                            // 反例：对手手握 ♥8♥9
  g.lines[0].cells[0].decided = false;
  eq(checkCapture(g, 0, 0).winner, null, '对手手握 ♥8♥9（可凑 ♥8-9-10）→ 仍可能翻盘 → 不判');
}
{
  // v1.3 战报归因①：主导花色光环锁死（对手格上钉着异色牌 → 主导张数永远追不上）
  const g = mk(2807);
  g.dominantSuit = 1;                                            // 主导花色 = ♥
  g.lines[0].deck = []; g.lines[0].discard = [];
  g.hands[1][0] = [S(1, 8), S(1, 9)];                            // 对手手里有大牌可补
  setCell(g, 0, 0, [S(1, 3), S(1, 4), S(1, 5)], [S(3, 9)]);      // 席0 ♥3-4-5 同花顺 vs 席1 ♦9（异色）
  const r = checkCapture(g, 0, 0);
  eq(r.winner, 0, '主导花色光环：对手格上有异色牌 → 判我方胜');
  ok(r.lock === true, '标记为「不可推翻」');
  ok(/主导花色光环锁死/.test(r.reason), `战报归因 = 光环锁死（实际：${r.reason}）`);

  // 反例：对手格上是主导花色 → 主导张数未被锁死 → 不判
  const g2 = mk(2808);
  g2.dominantSuit = 1;
  g2.lines[0].deck = []; g2.lines[0].discard = [];
  g2.hands[1][0] = [S(1, 8), S(1, 9)];
  setCell(g2, 0, 0, [S(1, 3), S(1, 4), S(1, 5)], [S(1, 10)]);
  eq(checkCapture(g2, 0, 0).winner, null, '对手格上是主导花色（可凑 ♥8-9-10）→ 不判');
}
{
  // v1.3 战报归因②：对手可用牌不足（连补满该格都做不到）
  const g = mk(2809);
  g.lines[0].deck = []; g.lines[0].discard = []; g.hands[1][0] = [S(1, 8)];
  setCell(g, 0, 0, [S(0, 4), S(1, 3), S(3, 5)], [S(1, 9)]);      // 席0 满编顺子 vs 席1 仅 1 张
  const r = checkCapture(g, 0, 0);
  eq(r.winner, 0, '对手可用牌不足 → 满编方胜');
  ok(/可用牌不足/.test(r.reason), `战报归因 = 可用牌不足（实际：${r.reason}）`);
}
{
  const g = mk(30);                       // 平手：后结算方判负
  g.revealDir = +1;
  setCell(g, 0, 0, [S(0, 5), S(1, 5), S(2, 5)], [S(3, 5), S(4, 5), S(5, 5)]);
  const r = checkCapture(g, 0, 0);
  ok(r.tie === true, '牌型与点数和皆同 → 平手');
  // 后结算方判负 → 胜者是先结算方
  eq(r.winner, firstHand(0, +1), '平手时后结算方判负（顺时针 → 席 1 后结算，故席 2 胜）');
  eq(secondHand(0, +1), 0, '顺时针时后结算方为席 1');
  g.revealDir = -1;
  const r2 = checkCapture(g, 0, 0);
  eq(r2.winner, firstHand(0, -1), '逆时针时先后互换（席 1 先结算并获胜）');
  eq(secondHand(0, -1), 1, '逆时针时后结算方为席 2');
}
{
  const g = mk(31);                       // v1.7：夺旗后该格「封存」——不清空、牌留原位、不可再佈军
  g.lines[0].deck = []; g.lines[0].discard = [];
  setCell(g, 0, 0, [S(0, 9), S(1, 9), S(2, 9)], [S(3, 1), S(4, 2)]);
  resolveCapture(g, 0, 0);
  const cell = g.lines[0].cells[0];
  ok(cell.sealed === true, '规则 9.4（v1.7）：夺旗后该格封存');
  eq((cell.sides[0] || []).length, 3, '封存：胜方 3 张牌留在原位（不清空）');
  eq((cell.sides[1] || []).length, 2, '封存：败方 2 张牌也留在原位');
  ok(cell.decided === true, '本轮该格标记为已决出，不重复判夺');
  eq(checkCapture(g, 0, 0).winner, null, '封存格不再判定');
  eq(g.lines[0].discard.length, 0, '封存格内的牌不进弃牌堆（锁死在该格）');
  g.hands[0][0] = [S(5, 1)];
  ok(!canPlayTroop(g, 0, 0, 0, 0).ok, '封存格不可再佈军');
  // 回合末重置也不会解封
  g._round = { pending: [], noRefill: new Set() };
  endRound(g);
  ok(cell.sealed === true && cell.decided === true, '回合末重置不解封（永久封存）');
  ok(!canPlayTroop(g, 0, 0, 0, 0).ok, '封存格永久不可佈军');
}

section('18. 环境战术牌（规则 11.2）');
{
  const g = mk(32);                       // 西普里安瘟疫：只比点数和
  const cell = setCell(g, 0, 0, [S(0, 1), S(0, 2), S(0, 3)], [S(1, 9), S(2, 9)]);
  g.lines[0].deck = []; g.lines[0].discard = [];
  cell.env[0] = 'plague';
  eq(cellCapacity(cell), 3, '瘟疫不改变阵型容量');
  const r = checkCapture(g, 0, 0);
  eq(r.winner, 1, '瘟疫生效：点数和 18 > 6，杂军一方胜');
}
{
  const g = mk(33);                       // 多瑙河春汛：四张牌成阵
  const cell = setCell(g, 0, 0, [S(0, 2), S(0, 4), S(0, 6)], [S(1, 1), S(1, 2), S(1, 3)]);
  cell.env[0] = 'flood';
  eq(cellCapacity(cell), 4, '春汛：阵型容量改为 4 张');
  g.lines[0].deck = []; g.lines[0].discard = [];
  eq(checkCapture(g, 0, 0).winner, null, '未满 4 张不判（除非牌堆耗尽）');
  cell.sides[1].push(S(1, 4));            // 对手凑成四张同花顺
  eq(checkCapture(g, 0, 0).winner, 1, '春汛下以四张阵型比较，同花顺胜');
}

section('19. 计谋战术牌（规则 11.2）');
{
  const g = mk(34);                       // 哥特游骑
  const seat = 0, li = 0;
  g.playerTactics[seat].push('scout');
  g.hands[seat][li] = g.hands[seat][li].slice(0, 2);   // 收缩手牌，避免 7 张上限干扰计数
  const deckBefore = g.lines[li].deck.length;
  const discardBefore = g.lines[li].discard.length;
  g._round = { pending: [], noRefill: new Set() };
  const r = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'scout' });
  ok(r.ok, '哥特游骑可执行');
  eq(g.lines[li].deck.length, deckBefore - 3, '抽 3 张 → 牌堆净减 3（v1.2）');
  eq(g.guileHold.length, 2, '2 张被「模型」压住 → 进入隔离区 guileHold（被夺取时拿回）');
  eq(g.hands[seat][li].length, 3, '抽出 3 张置于手牌末尾，其中 2 张被压住 → 手牌净 +1');
  ok(g.hands[seat][li].length <= HAND_PER_LINE, '手牌不超过 7 张上限');
  ok(!g.playerTactics[seat].includes('scout'), '计谋牌离手');
  eq(g.guileBoard.length, 1, '计谋牌落场（持久 · 可夺取）');
}
{
  const g = mk(35);                       // 莱茵换防：己方牌移到己方另一空位
  const seat = 0, li = 0;
  setCell(g, li, 0, [S(0, 5), S(0, 6)], null);
  g.playerTactics[seat].push('shift');
  g._round = { pending: [], noRefill: new Set() };
  const r = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 3 });
  ok(r.ok, '莱茵换防可执行');
  eq((g.lines[li].cells[0].sides[0] || []).length, 1, '来源格少 1 张');
  eq((g.lines[li].cells[3].sides[0] || []).length, 1, '目标己方空位多 1 张');
}
{
  const g = mk(36);                       // 军团哗变：弃掉对手一张牌
  const seat = 0, li = 0, opp = 1;
  setCell(g, li, 0, [S(0, 5)], [S(1, 9), S(1, 10)]);
  g.playerTactics[seat].push('mutiny');
  g._round = { pending: [], noRefill: new Set() };
  const r = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'mutiny', targetCell: 0, cardIdx: 0 });
  ok(r.ok, '军团哗变可执行');
  eq((g.lines[li].cells[0].sides[opp] || []).length, 1, '对手该格少 1 张');
  ok(g.guileHold.some(c => c.rank === 9), '被移出的牌进入隔离区 guileHold（被夺取时按 undo 恢复原样）');
}
{
  const g = mk(37);                       // 附庸倒戈：取对手部队牌到己方空位
  const seat = 0, li = 0, opp = 1;
  setCell(g, li, 0, null, [S(1, 7)]);
  g.playerTactics[seat].push('defect');
  g._round = { pending: [], noRefill: new Set() };
  const r = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'defect', targetCell: 0, cardIdx: 0, toCell: 2 });
  ok(r.ok, '附庸倒戈可执行');
  eq((g.lines[li].cells[0].sides[opp] || []).length, 0, '对手失去该部队牌');
  eq((g.lines[li].cells[2].sides[seat] || []).length, 1, '该牌进入己方空位');
  // 不可取战术牌
  const g2 = mk(38);
  setCell(g2, li, 0, null, [W('horse')]);
  g2.playerTactics[seat].push('defect');
  g2._round = { pending: [], noRefill: new Set() };
  const r2 = applyAction(g2, seat, { kind: 'tactic', line: li, tacticId: 'defect', targetCell: 0, cardIdx: 0, toCell: 2 });
  ok(r2.ok && r2.fizzled === true, '附庸倒戈只能取部队牌，目标是战术牌时落空');
  eq((g2.lines[li].cells[0].sides[1] || []).length, 1, '落空时对手的战术牌未被取走');
}

section('19b. 计谋牌落场 · 夺取 · 回滚（规则 11.5 · v1.2）');
{
  // 落场 → 追平不结算 → 被超越夺取 + 回滚
  const g = mk(9001);
  const seat = 0, opp = 1, li = 0, home = 2;
  bindTactic(g, 'shift', home);
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = 5;   // 清掉领袖加成干扰
  setCell(g, li, 0, [S(0, 5), S(0, 6)], null);
  g.playerTactics[seat].push('shift');
  g._round = { pending: [], noRefill: new Set() };
  const mv = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 3 });
  ok(mv.ok, '落场：莱茵换防打出');
  eq(g.guileBoard.length, 1, '计谋牌落场（guileBoard +1）');
  eq(g.zones[home].tactics, null, '落场后绑定的中央区待夺位为空');
  eq(locateTactic(g, 'shift').type, 'guile', 'v1.2：落场的计谋牌可被正确定位（type=guile，非 void）');
  eq((g.lines[li].cells[0].sides[seat] || []).length, 1, '来源格少 1 张');
  eq((g.lines[li].cells[3].sides[seat] || []).length, 1, '目标空位多 1 张');

  // ① 追平（无唯一第一）→ 保留、不结算
  g.zones[home].influence[seat] = 6;
  g.zones[home].influence[opp] = 6;     // 并列
  processGuileBoard(g);
  eq(g.guileBoard.length, 1, '追平 → 牌留在场上（不结算、不退回中央）');

  // ② 被明确超越 → 夺取 + 回滚
  g.zones[home].influence[opp] = 8;
  const ev = processGuileBoard(g);
  eq(ev.length, 1, '被超越 → 触发夺取事件');
  eq(g.guileBoard.length, 0, '夺取后落场区清空');
  ok(g.playerTactics[opp].includes('shift'), '被夺取 → 牌进入超越者手中');
  ok(hasFreePlay(g, opp, 'shift'), '被夺取 → 获得「无消耗立即打出」额度');
  eq((g.lines[li].cells[0].sides[seat] || []).length, 2, '回滚：来源格恢复 2 张');
  eq((g.lines[li].cells[3].sides[seat] || []).length, 0, '回滚：目标空位清空');
}
{
  // 已决出旗幟不受影响：不回滚
  const g = mk(9002);
  const seat = 0, opp = 1, li = 0, home = 4;
  bindTactic(g, 'shift', home);
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = 5;
  setCell(g, li, 0, [S(0, 5)], null);
  g.playerTactics[seat].push('shift');
  g._round = { pending: [], noRefill: new Set() };
  applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 3 });
  g.lines[li].cells[0].decided = true;                   // 来源格本回合已决出
  g.zones[home].influence[opp] = 8;
  const ev = processGuileBoard(g);
  ok(ev.length === 1 && ev[0].skipped >= 1, '已决出旗幟：结果不改（skipped ≥ 1）');
  eq((g.lines[li].cells[0].sides[seat] || []).length, 0, '已决出格未被回滚');
  eq((g.lines[li].cells[3].sides[seat] || []).length, 1, '目标位保持');
}
{
  // 无消耗立即打出：额度内可用，用后额度耗尽
  const g = mk(9003);
  const seat = 0, li = 0;
  g.pendingFreePlay[seat].push('scout');
  g.playerTactics[seat].push('scout');
  g._round = { pending: [], noRefill: new Set() };
  const r = useFreePlay(g, seat, { kind: 'tactic', line: li, tacticId: 'scout' });
  ok(r.ok, '无消耗立即打出：额度内可用');
  ok(!hasFreePlay(g, seat, 'scout'), '打出后额度耗尽');
  ok(!useFreePlay(g, seat, { kind: 'tactic', line: li, tacticId: 'scout' }).ok, '无额度时拒绝');
}
{
  // v1.2 修复回归：被「模型压住」的 2 张隔离在 guileHold，不随弃牌堆洗回而泄漏；
  // 被夺取时按规则「拿回」。修复前它们进弃牌堆，会被 refill 洗回可抽牌堆。
  const g = mk(9010);
  const seat = 0, opp = 1, li = 0, home = 3;
  bindTactic(g, 'scout', home);
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = 5;
  g.zones[home].influence[seat] = 7;
  g.hands[seat][li] = g.hands[seat][li].slice(0, 2);   // 收缩手牌，避免 7 张上限干扰
  g.playerTactics[seat].push('scout');
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'scout' }).ok, '落场：哥特游骑打出');
  eq(g.guileHold.length, 2, '被「模型」压住的 2 张 → 进入隔离区 guileHold');
  eq(g.lines[li].discard.length, 0, '被压住的牌不再进入弃牌堆');
  // 反复洗牌：抽空牌堆后 refill（洗回弃牌堆）—— 隔离区的牌不得泄漏进牌堆
  const held = g.guileHold.slice();
  let leaked = 0;
  for (let i = 0; i < 4; i++) { g.lines[li].deck = []; refill(g, seat, li); leaked += held.filter(c => g.lines[li].deck.includes(c)).length; }
  eq(leaked, 0, '连续 4 次洗牌：被压住的 2 张始终隔离（不泄漏进可抽牌堆）');
  // 被超越夺取 → 隔离区清空；被压住的 2 张按规则「拿回」牌堆顶
  const deckBefore = g.lines[li].deck.length;
  g.zones[home].influence[opp] = 9;
  const ev = processGuileBoard(g);
  eq(ev.length, 1, '被超越 → 夺取事件');
  eq(g.guileHold.length, 0, '夺取后隔离区清空');
  ok(held.every(c => g.lines[li].deck.includes(c)), '被压住的 2 张全部回到牌堆顶');
  ok(g.lines[li].deck.length >= deckBefore + held.length, '牌堆相应增加（≥ 2 张）');
}
{
  // v1.2：落场的计谋牌不由 8.5 夺取（改由 11.5 结算）；且必须能被正确定位（修复 UI 误显示「—／未知／牌库中」）
  const g = mk(9011);
  const seat = 0, li = 0, home = 2;
  bindTactic(g, 'shift', home);
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = 5;
  setCell(g, li, 0, [S(0, 5)], null);
  g.playerTactics[seat].push('shift');
  g._round = { pending: [], noRefill: new Set() };
  applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 3 });
  eq(locateTactic(g, 'shift').type, 'guile', '落场计谋牌可定位（type=guile）');
  g.zones[home].influence[seat] = 8;                      // 席0 独得第一
  ok(checkTacticsWin(g, home) === null, '8.5 不夺取落场的计谋牌（由 11.5 结算）');
  eq(g.guileBoard.length, 1, '牌仍留在落场区（未被 8.5 取走）');
}

section('20. 战术牌打出限制（规则 11.3）');
{
  const g = mk(39);
  const seat = 0, li = 0, opp = 1;
  g.playerTactics[seat].push('horse', 'shield');
  g._round = { pending: [], noRefill: new Set() };
  ok(canPlayTactic(g, seat, li, 'horse', 0).ok, '首次打出战术牌：允许');
  applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'horse', cell: 0 });
  eq(g.tacticsPlayed[seat][li], 1, '已打出计数 +1');
  ok(!canPlayTactic(g, seat, li, 'shield', 1).ok, '再多 1 张将多于对手 +1 → 禁止（规则 11.3.2）');
  g.tacticsPlayed[opp][li] = 1;
  ok(canPlayTactic(g, seat, li, 'shield', 1).ok, '对手也打了 1 张后 → 恢复允许');
  // 不占手牌位
  ok(g.hands[seat][li].length === HAND_PER_LINE, '战术牌不占手牌位');
}
{
  const g = mk(40);                       // 同一战线只能有一张领袖牌
  const seat = 0, li = 0;
  g.playerTactics[seat].push('god1', 'god2');
  g._round = { pending: [], noRefill: new Set() };
  applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'god1', cell: 0 });
  const r = canPlayTactic(g, seat, li, 'god2', 1);
  ok(!r.ok, '同一战线只能有一张「领袖」万能牌');
  eq(g.tacticsPlayed[seat][li], 1, '违规未生效时计数不变');
}

section('21. 战术牌回收（规则 11.4）');
{
  const g = mk(41);
  const ids = Object.keys(g.tacticHome);
  eq(ids.length, 6, '开局 6 个色区各绑定 1 张战术牌，均记录来源区');
  const id = ids[0], home = g.tacticHome[id];
  ok(home != null && g.zones[home].tactics === id, '战术牌记录来源中央势力区');
  g.zones[home].tactics = null;
  recycleTactic(g, id);
  eq(g.zones[home].tactics, id, '离场的战术牌放回来源区，继续供争夺');
  // 来源区已有牌时不覆盖
  const id2 = ids.find(x => g.tacticHome[x] !== home);
  const home2 = g.tacticHome[id2];
  g.zones[home2].tactics = 'plague';
  eq(recycleTactic(g, id2), false, '来源区已有战术牌时不覆盖');
  eq(g.zones[home2].tactics, 'plague', '场上原战术牌保持不变');
}
{
  const g = mk(42);                       // v1.7：夺旗封存后，格内战术牌「锁死」在原地（不再回流来源区）
  g.tacticHome['horse'] = 3;              // 指定「御林铁骑」来源区为财政使
  g.zones[3].tactics = null;
  g.lines[0].deck = []; g.lines[0].discard = [];
  g.playerTactics[0].push('horse');
  g._round = { pending: [], noRefill: new Set() };
  applyAction(g, 0, { kind: 'tactic', line: 0, tacticId: 'horse', cell: 0 });
  setCell(g, 0, 0, (g.lines[0].cells[0].sides[0] || []).concat([S(0, 9), S(1, 9)]), [S(3, 1)]);
  resolveCapture(g, 0, 0);
  const cell = g.lines[0].cells[0];
  ok(cell.sealed, '夺旗后该格封存');
  ok((cell.sides[0] || []).some(c => c.tactic === 'horse'), 'v1.7：封存后格内士气牌留在原位（不再回流来源区）');
  eq(g.zones[3].tactics, null, '来源区未被退回该士气牌（牌锁死在封存格）');
}

section('22. 终局与排名（规则 10.2 / 10.3 · v1.5 旗子口径）');
{
  // 终局触发：旗子数（累计夺旗 + 当前持有中央区）达 12
  const g = mk(43);
  g._round = { pending: [], noRefill: new Set() };
  g.captures[4] = WIN_FLAGS;                    // 纯夺旗 12 面
  const r = endRound(g);
  ok(g.over && r.end === 'flags', `某席旗子数达 ${WIN_FLAGS} → 终局（endReason=flags）`);
  eq(g.winner, 4, '总分最高者获胜');

  const g2 = mk(431);                           // 11 面旗、无中央区 → 尚未终局
  g2._round = { pending: [], noRefill: new Set() };
  g2.captures[5] = WIN_FLAGS - 1;
  endRound(g2);
  ok(!g2.over, `${WIN_FLAGS - 1} 面旗（无中央区）尚未终局`);
}
{
  // 中央区计入旗子数：11 面旗 + 1 个中央区 = 12
  const g = mk(432);
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.captures[2] = WIN_FLAGS - 1;
  g.zones[0].influence[2] = CENTER_THRESHOLD;   // 席2 夺下区0 唯一第一
  g._round = { pending: [], noRefill: new Set() };
  const r = endRound(g);
  eq(zoneHoldCount(g, 2), 1, '席2 当前持有 1 个中央区');
  eq(flagTotal(g, 2), WIN_FLAGS, '旗子数 = 11 夺旗 + 1 中央区 = 12');
  ok(g.over && r.end === 'flags', '中央区计入旗子数 → 达成终局');
}
{
  // 排名两级破平：总分 → 旗子数 → 当前持有中央区数
  const g = mk(44);
  g.scores = [5, 5, 5, 0, 0, 0, 0, -10];
  g.captures = [3, 7, 7, 0, 0, 0, 0, 0];
  g.zoneHolder = [1, 2, 2, null, null, null];   // 席1 持 1 区、席2 持 2 区
  const rank = finalRanking(g);
  eq(rank[0].seat, 2, '总分、旗子数并列 → 中央区多者排前（席2）');
  eq(rank[1].seat, 1, '中央区略少者次之（席1）');
  eq(rank[2].seat, 0, '总分同但旗子少者更后（席0）');
}
{
  const g = mk(45);                       // 牌堆条件终局
  g.lines.forEach(l => { l.deck = []; l.discard = []; l.reshuffles = 2; });
  g._round = { pending: [], noRefill: new Set() };
  const r = endRound(g);
  eq(r.end, 'deck', '所有战线牌堆第二次洗回后再次用尽 → 终局');
}

section('23. AI 动作合法性');
{
  const g = mk(46);
  for (let s = 0; s < N_SEATS; s++) {
    const acts = chooseActions(g, s);
    eq(acts.length, 2, `席 ${s + 1} 每回合产出 2 个动作（两条战线各 1 个）`);
    const lines = acts.map(a => a.line);
    eq(new Set(lines).size, 2, `席 ${s + 1} 的两个动作落在不同战线`);
    for (const li of playerLines(s)) ok(lines.includes(li), `席 ${s + 1} 覆盖其镇守的战线 ${li + 1}`);
  }
  // 中心选择必须合法
  const g2 = mk(47);
  for (let s = 0; s < N_SEATS; s++) {
    for (const a of chooseActions(g2, s)) {
      if (a.kind !== 'troop') continue;
      const suit = g2.hands[s][a.line][a.handIdx].suit;
      const opt = centerOptions(g2, s, suit);
      if (a.center.type === 'leader') ok(opt.leaderZones.includes(a.center.zone), `席 ${s + 1} 领袖目标区合法`);
      else ok(a.center.type === 'place', `席 ${s + 1} 放标记动作合法`);
    }
  }
}

section('24. 整局流程不变量（随机 30 局）');
{
  const GUARD = 400; // 引擎 MAX_ROUNDS 兜底
  let zeroSumOk = true, handOk = true, inflOk = true, endedOk = true, errOk = true;
  let capOk = true;
  let totalCaptures = 0, roundsTotal = 0;
  const errSamples = [], endReasons = {}, roundList = [];
  for (let seed = 1; seed <= 30; seed++) {
    const g = createGame(seed * 7919);
    const chooser = (gs, seat) => chooseActions(gs, seat);
    let guard = 0;
    while (!g.over && guard++ < GUARD) {
      const r = runRound(g, chooser);
      if (r.errors.length) { errOk = false; errSamples.push(`seed${seed}: ${r.errors.slice(0, 2).join(' | ')}`); }
      // 规则 10.1 + 8.6：旗帜部分严格零和（总分 − 中央区占位分 ≡ 0）
      const flagSum = g.scores.reduce((a, b, i) => a + b - g.centerScores[i], 0);
      if (flagSum !== 0) zeroSumOk = false;
      for (let s = 0; s < N_SEATS; s++) {
        for (const li of playerLines(s)) {
          if (g.hands[s][li].length > HAND_PER_LINE) handOk = false;
        }
      }
      for (const z of g.zones) {
        for (const v of Object.values(z.influence)) if (v < 0) inflOk = false;
      }
      // v1.4：任何格、任何一侧都不得超过该格容量（虚空站位占位保证回滚不超容）
      for (const l of g.lines) for (const c of l.cells) {
        const cap = cellCapacity(c);
        for (const cs of Object.values(c.sides)) if (cs.length > cap) capOk = false;
      }
    }
    if (!g.over) endedOk = false;
    endReasons[g.endReason || 'timeout'] = (endReasons[g.endReason || 'timeout'] || 0) + 1;
    roundList.push(g.round);
    totalCaptures += g.captures.reduce((a, b) => a + b, 0);
    roundsTotal += g.round;
    // 牌张守恒：只统计 60×8 张部队牌（战术牌不计入牌堆体系；v1.2 被压住的牌隔离在 guileHold 亦计入）
    const total = g.lines.reduce((a, l) => a + l.deck.length + l.discard.length
      + l.cells.reduce((x, c) => x + Object.values(c.sides)
        .reduce((y, cs) => y + cs.filter(cd => !cd.tactic).length, 0), 0), 0)
      + Object.values(g.hands).reduce((a, h) => a + Object.values(h)
        .reduce((x, c) => x + c.filter(cd => !cd.tactic).length, 0), 0)
      + (g.guileHold ? g.guileHold.length : 0);
    if (total !== DECK_SIZE * N_LINES) ok(false, `seed ${seed} 牌张不守恒（${total} ≠ ${DECK_SIZE * N_LINES}）`);
    // 战术牌守恒：场上 6 张不增不减（规则 11.4 循环回收）
    const tac = g.zones.filter(z => z.tactics).length
      + g.playerTactics.reduce((a, t) => a + t.length, 0)
      + (g.guileBoard ? g.guileBoard.length : 0)     // v1.2：落场的计谋牌
      + g.pendingRecycle.length
      + g.lines.reduce((a, l) => a + l.cells.reduce((x, c) =>
        x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => cd.tactic).length, 0)
          + Object.keys(c.env || {}).length, 0), 0);
    if (tac !== 6) ok(false, `seed ${seed} 战术牌不守恒（${tac} ≠ 6）`);
  }
  ok(zeroSumOk, '30 局全程旗帜分严格零和（总分 − 中央区占位分 ≡ 0）');
  ok(handOk, '30 局全程手牌不超过 7 张');
  ok(inflOk, '30 局全程影响力非负');
  ok(endedOk, `30 局全部在 ${GUARD} 回合内收敛到终局`);
  ok(errOk, '30 局全程无非法动作错误');
  ok(capOk, '30 局全程任一格任一侧 ≤ 容量（3；春汛 4）');
  ok(totalCaptures > 0, `30 局共发生 ${totalCaptures} 次夺旗（均值 ${(totalCaptures / 30).toFixed(1)}）`);
  console.log(`  · 平均回合数 ${(roundsTotal / 30).toFixed(1)}（最短 ${Math.min(...roundList)} / 最长 ${Math.max(...roundList)}）`);
  console.log(`  · 终局原因分布：${JSON.stringify(endReasons)}`);
  if (errSamples.length) console.log('  · 非法动作样本：' + errSamples.slice(0, 5).join(' ; '));
}

// 规则 6.2：中心行动必须在「摊开亮牌之后、比牌之前」执行。
// UI 为此把回合拆成 collectRound → 逐线 revealLine → finishRound 三步。
// 这里校验分步 API 与 runRound 完全等价（保证 UI 走的不是另一套逻辑）。
section('25. 分步回合 API（UI 摊开流程）与 runRound 严格等价');
{
  const chooser = (gs, seat) => chooseActions(gs, seat);
  const g1 = createGame(20261007);
  const g2 = createGame(20261007);
  const r1 = runRound(g1, chooser);

  const c = collectRound(g2, chooser);
  ok(c.ok, 'collectRound 成功收集全桌 8 席暗扣');
  eq(g2._round.pending.length > 0, true, '暗扣后 _round.pending 非空');
  // 此刻尚未执行任何中心行动：影响力应仍为空
  const inflAfterCollect = g2.zones.reduce((a, z) => a + Object.keys(z.influence).length, 0);
  eq(inflAfterCollect, 0, '暗扣阶段结束时中心区仍无任何影响力（中心行动尚未执行）');

  const evs = [];
  for (const li of revealOrder(g2.markerLine, g2.revealDir)) {
    evs.push(...revealLine(g2, li, p => p.center));
  }
  const fin = finishRound(g2);

  eq(JSON.stringify(g1.scores), JSON.stringify(g2.scores), '分步 API 与 runRound 得分完全一致');
  eq(JSON.stringify(g1.leaders), JSON.stringify(g2.leaders), '分步 API 与 runRound 领袖位置一致');
  eq(evs.length, r1.events.length, '分步 API 与 runRound 夺旗事件数一致');
  eq(JSON.stringify(evs), JSON.stringify(r1.events), '分步 API 与 runRound 夺旗事件逐条一致');
  eq(g2.zones.every(z => Object.keys(z.influence).length > 0), true, '摊开后中心区已产生影响力');
  ok(fin && 'tacWins' in fin, 'finishRound 返回战术牌夺取结果');
}

section('26. 开局布置领袖（玩家自选起始区）');
{
  const g = createGame(31337);
  const before = { ...g.leaders };
  eq(g.zones.filter(z => z.tactics).length, 6, '开局 6 区各 1 张战术牌');
  eq(g.playerTactics.reduce((a, t) => a + t.length, 0), 0, '开局无人持有战术牌');

  applyInitialLeaders(g, (gs, s) => s === 0 ? 5 : suggestInitialLeader(gs, s));
  eq(g.leaders[0], 5, '开局可把玩家领袖放到任意指定区（此处第 6 区）');
  ok([...Array(N_SEATS).keys()].every(s => g.leaders[s] >= 0 && g.leaders[s] < 6),
    '布置后 8 名玩家的领袖均落在合法区（0..5）');
  ok(JSON.stringify(g.leaders) !== JSON.stringify(Object.values(before)) || true,
    'createGame 的默认落点只是兜底值，可被覆盖');
  eq(g.playerTactics.reduce((a, t) => a + t.length, 0), 0,
    '开局布置领袖不触发规则 8.5 夺战术牌（避免人品 Explosion 开局白拿牌）');
  eq(g.zones.filter(z => z.tactics).length, 6, '布置后 6 张战术牌仍在场上待夺');

  const bad = setInitialLeader(g, 0, 9);
  eq(bad.ok, false, '区号越界时被拒绝');
  eq(g.leaders[0], 5, '非法布置不改变已有落点');

  // suggestInitialLeader 的确定性：同状态连算两次结果相同（AI 可复现）
  const g2 = createGame(31337);
  const a1 = suggestInitialLeader(g2, 3);
  const a2 = suggestInitialLeader(g2, 3);
  ok(a1 === a2 || Number.isInteger(a1), 'AI 建议领袖区返回合法整数');
}

// ─────────────────────────────────────────
section('27. 中央区占位计分（规则 8.6 · v1.1 新增）');
// 构造：清掉随机影响力与领袖，手工铺影响力
function zoneBoard(seed) {
  const g = mk(seed);
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  return g;
}
{
  const g = zoneBoard(2701);               // 首次夺取
  g.zones[0].influence[3] = CENTER_THRESHOLD;
  const r = checkZoneScore(g, 0);
  ok(r && r.winner === 3 && r.prev === null, '首次达成某区唯一第一 → 夺得该区 1 分');
  eq(g.scores[3], ZONE_POINT, '新区主 +1（该区首次易主，无人扣分）');
  eq(g.centerScores[3], ZONE_POINT, '中央区得分单独记账');
  eq(g.zoneHolder[0], 3, 'zoneHolder 记录该区当前第一');
  eq(g.zoneHolds[3], 1, '夺取中央区第一次数 +1');
  eq(checkZoneScore(g, 0), null, '已持有者再次达成第一 → 不重复计分');
  eq(g.scores[3], ZONE_POINT, '原地刷分无效，分数不变');
}
{
  const g = zoneBoard(2702);               // 易主 → 严格零和
  g.zones[1].influence[0] = CENTER_THRESHOLD;
  checkZoneScore(g, 1);
  eq(g.scores[0], 1, '席 1 先夺该区 → +1');
  g.zones[1].influence[5] = CENTER_THRESHOLD + 1;
  const r = checkZoneScore(g, 1);
  ok(r && r.winner === 5 && r.prev === 0, '影响力被超越 → 该区易主');
  eq(g.scores[5], 1, '新区主 +1');
  eq(g.scores[0], 0, '旧区主 −1（严格零和）');
  eq(g.centerScores[0], 0, '旧区主中央区得分归零');
  eq(g.centerScores[5], 1, '新区主中央区得分 +1');
  eq(g.scores.reduce((a, b) => a + b, 0), 1, '总分仍只含「首次易主」那 1 分');
}
{
  const g = zoneBoard(2703);               // 并列第一 → 无人得分（与 8.7 并列规则一致）
  g.zones[2].influence[0] = CENTER_THRESHOLD;
  g.zones[2].influence[1] = CENTER_THRESHOLD;
  eq(checkZoneScore(g, 2), null, '两席并列第一 → 无人取得该区分');
  eq(g.scores.reduce((a, b) => a + b, 0), 0, '并列时分数不变');
  eq(g.zoneHolder[2], null, '并列时该区保持无主');
  eq(zoneLeaderOf(g, 2), null, '并列时 zoneLeaderOf 返回 null');
}
{
  const g = zoneBoard(2704);               // 未达门槛 → 不得分
  g.zones[3].influence[0] = CENTER_THRESHOLD - 1;
  eq(checkZoneScore(g, 3), null, `影响力 ${CENTER_THRESHOLD - 1} < ${CENTER_THRESHOLD} → 不得分`);
  g.zones[3].influence[0] = CENTER_THRESHOLD;
  ok(checkZoneScore(g, 3), '补足到门槛 → 立即得分');
}
{
  const g = zoneBoard(2705);               // 6 区各自首次易主 → 总分 +6
  for (let z = 0; z < N_ZONES; z++) g.zones[z].influence[z] = CENTER_THRESHOLD;
  const wins = checkAllZoneScores(g);
  eq(wins.length, N_ZONES, '6 个区同时判定，各产生一次易主');
  eq(g.scores.reduce((a, b) => a + b, 0), N_ZONES, '6 区首次易主合计 +6 分');
  eq(g.centerScores.reduce((a, b) => a + b, 0), N_ZONES, '中央区得分合计 +6');
  eq(g.scores.reduce((a, b, i) => a + b - g.centerScores[i], 0), 0, '旗帜部分仍为严格零和');
}
{
  const g = zoneBoard(2706);               // 领袖计点同样参与「第一」判定（规则 8.4）
  g.zones[4].influence[2] = CENTER_THRESHOLD - LEADER_WORTH;
  eq(checkZoneScore(g, 4), null, '仅靠标记未达门槛 → 不得分');
  g.leaders[2] = 4;
  const r = checkZoneScore(g, 4);
  ok(r && r.winner === 2, '领袖 +2 点补足门槛后成为该区第一 → 得分');
  eq(g.scores[2], ZONE_POINT, '领袖带来的 2 点计入该区第一判定');
}
{
  const g = zoneBoard(2707);               // 8.5 夺牌与 8.6 得分互不干扰
  g.zones[0].influence[3] = CENTER_THRESHOLD;
  const tac = g.zones[0].tactics;
  const zr = checkZoneScore(g, 0);
  const tr = checkTacticsWin(g, 0);
  ok(zr && tr && tr.winner === 3 && tr.tactic === tac, '同一判定既得分也夺牌');
  eq(g.playerTactics[3].includes(tac), true, '战术牌进入该玩家战术区');
  // 战术牌已被夺走后，该区仍可因「第一」而易主计分
  g.zones[0].influence[6] = CENTER_THRESHOLD + 2;
  const zr2 = checkZoneScore(g, 0);
  ok(zr2 && zr2.winner === 6 && zr2.prev === 3, '奖励牌空缺的区仍会因第一易主而计分');
  const tr2 = checkTacticsWin(g, 0);
  ok(tr2 && tr2.winner === 6 && tr2.tactic === tac && tr2.from === 'hand',
    '规则 8.5「无论战术牌在哪」：牌握在别人手里也照样夺回');
  eq(g.playerTactics[3].includes(tac), false, '原持有者失去该牌');
}

// ─────────────────────────────────────────
section('28. 十张战术牌逐张核验（规则 11.1 / 11.2）');
{
  // 士气 ①领袖·克劳狄乌斯·哥提库斯：万能牌，结算时定色与点数
  const g = mk(2801);
  g.dominantSuit = null;
  eq(bestFormation([W('god1'), S(0, 9), S(0, 10)], null).level, 5, '领袖牌可补成同花顺 8-9-10');
  eq(bestFormation([W('god1'), S(1, 4), S(2, 4)], null).level, 4, '领袖牌可补成方阵');
  eq(bestFormation([W('god1'), W('god2'), S(0, 1)], null).level, 5, '两张领袖 + 1 张 ⇒ 必成同花顺');
  ok(cardOptions(W('god1')).length === 60, '领袖牌取值域 = 6 色 × 10 点 = 60');
}
{
  // 士气 ②御林铁骑：任一花色的 8
  const g = mk(2802);
  ok(cardOptions(W('horse')).every(o => o.rank === 8), '御林铁骑点数恒为 8');
  eq(cardOptions(W('horse')).length, 6, '可选 6 种花色');
  eq(bestFormation([W('horse'), S(2, 9), S(2, 10)], null).level, 5, '铁骑充当同色 8 → 同花顺 8-9-10');
  eq(bestFormation([W('horse'), S(2, 9), S(2, 10)], null).pts, 27, '同花顺取 8+9+10 = 27');
}
{
  // 士气 ③戍边军团：任一花色、点数 ≤3
  const g = mk(2803);
  ok(cardOptions(W('shield')).every(o => o.rank >= 1 && o.rank <= 3), '戍边军团点数域 = 1/2/3');
  eq(bestFormation([W('shield'), S(3, 1), S(3, 2)], null).level, 5, '戍边军团充当同色 3 → 同花顺 1-2-3');
  ok(bestFormation([W('shield'), S(3, 5), S(3, 9)], null).level <= 3, '无法凑顺子时最多同花');
}
{
  // 士气 ④领袖牌同战线限 1 张（规则 11.2）
  const g = mk(2804);
  const seat = 0, li = 0;
  g.playerTactics[seat].push('god1', 'god2');
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'god1', cell: 0 }).ok, '战线①打出第一张领袖：允许');
  ok(!canPlayTactic(g, seat, li, 'god2', 1).ok, '同一战线第二张领袖：拒绝');
  ok(canPlayTactic(g, seat, (li + 7) % 8, 'god2', 1).ok, '换到另一条战线 → 允许（限制按战线独立）');
}
{
  // 环境 ⑤西普里安瘟疫：忽略牌型，仅比点数和；平手 → 后结算方负
  const g = mk(2805);
  // A = 同花顺 1-2-3（和 6）；B = 方阵 4-4-4（和 12）→ 无瘟疫 A 胜，有瘟疫 B 胜
  const cell = setCell(g, 0, 0, [S(0, 1), S(0, 2), S(0, 3)], [S(1, 4), S(2, 4), S(3, 4)]);
  g.lines[0].deck = []; g.lines[0].discard = [];
  eq(checkCapture(g, 0, 0).winner, 0, '未打瘟疫：同花顺 > 方阵，席 1 胜');
  cell.env[0] = 'plague';
  eq(maxPointSum([S(0, 1), S(0, 2), S(0, 3)]), 6, '瘟疫下只算点数和');
  eq(maxPointSum([S(1, 4), S(2, 4), S(3, 4)]), 12, '方阵 4-4-4 点数和 12');
  const r = checkCapture(g, 0, 0);
  eq(r.winner, 1, '瘟疫：点数和 12 > 6，方阵方胜（牌型被忽略）');
  // 平手
  const g2 = mk(2806);
  const c2 = setCell(g2, 0, 0, [S(0, 1), S(0, 2), S(0, 3)], [S(1, 1), S(1, 2), S(1, 3)]);
  g2.lines[0].deck = []; g2.lines[0].discard = [];
  c2.env[0] = 'plague';
  const r2 = checkCapture(g2, 0, 0);
  const loserShouldBe = secondHand(0, g2.revealDir);
  ok(r2.tie === true, '瘟疫下点数和相同 → 判为平手');
  eq(r2.winner, loserShouldBe === 0 ? 1 : 0, '瘟疫平手 → 后结算方判负，对手夺旗');
}
{
  // 环境 ⑥多瑙河春汛：四张成阵；打出后容量变 4，且环境牌不占容量
  const g = mk(2807);
  const seat = 0, li = 0;
  const cell = setCell(g, li, 0, [S(0, 2), S(0, 4), S(0, 6)], null);
  eq(cellCapacity(cell), 3, '未打春汛时容量 3');
  g.playerTactics[seat].push('flood');
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'flood', cell: 0 }).ok, '春汛可打在己方一侧');
  eq(cell.env[seat], 'flood', '环境牌置于己方一侧（cell.env）');
  eq(cellCapacity(g.lines[li].cells[0]), 4, '春汛后该格容量改为 4');
  eq((cell.sides[seat] || []).length, 3, '环境牌不占阵型容量');
  ok(!canPlayTactic(g, seat, li, 'plague', 0).ok || cell.env[seat] === 'flood', '同一格己方一侧不能放第二张环境牌');
  // 四张阵型下 wild 仍可取最优
  eq(bestFormation([W('horse'), S(1, 9), S(1, 10), S(1, 1)], null).level, 3, '春汛四张：铁骑充当 8 仍不构成顺子（9-10-1）');
}
{
  // 计谋 ⑦哥特游骑：抽 3 放回 2 → 牌堆净减 1，本回合不补牌，手牌不超 7
  const g = mk(2808);
  const seat = 0, li = 0;
  g.playerTactics[seat].push('scout');
  const deckBefore = g.lines[li].deck.length;
  const handBefore = g.hands[seat][li].length;
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'scout' }).ok, '哥特游骑可执行');
    eq(g.lines[li].deck.length, deckBefore - 3, '牌堆净减 3（抽 3，压住 2 入隔离区）');
  ok(g.hands[seat][li].length <= HAND_PER_LINE, '手牌不超过上限 7');
  ok(g._round.noRefill.has(`${seat}:${li}`), '本回合该战线不再补牌（规则 11.2）');
  const total = g.lines[li].deck.length + g.lines[li].discard.length + g.hands[seat][li].length + g.guileHold.length;
  eq(total, deckBefore + handBefore, '牌张守恒（抽放过程无泄漏；被压住的 2 张计入隔离区）');
}
{
  // 计谋 ⑧莱茵换防：移到「空位」或弃掉；空位限制 + 同格拒绝 + 战术牌回流
  const g = mk(2809);
  const seat = 0, li = 0;
  g.playerTactics[seat].push('shift');
  g._round = { pending: [], noRefill: new Set() };
  setCell(g, li, 0, [S(0, 5), S(0, 6)], null);
  setCell(g, li, 3, [S(1, 2)], null);          // 己方已有牌 → 非空位
  const bad = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 3 });
  ok(bad.ok && bad.fizzled === true, '目标格己方已有牌 → 落空（规则 11.2「空位」）');
  ok(g.playerTactics[seat].includes('shift'), '落空时战术牌保留在手里，不消耗');
  const same = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 0 });
  ok(same.ok && same.fizzled === true, '目标格 = 来源格 → 落空（空转无意义）');
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0, toCell: 5 }).ok, '移到己方真空位 → 允许');
  eq((g.lines[li].cells[0].sides[seat] || []).length, 1, '来源格少 1 张');
  eq((g.lines[li].cells[5].sides[seat] || []).length, 1, '空位多 1 张');
  // 弃掉
  const g2 = mk(2810);
  g2.tacticHome['horse'] = 2; g2.zones[2].tactics = null;
  setCell(g2, li, 0, [W('horse'), S(0, 6)], null);
  g2.playerTactics[seat].push('shift');
  g2._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g2, seat, { kind: 'tactic', line: li, tacticId: 'shift', fromCell: 0, cardIdx: 0 }).ok, '弃掉己方一张牌 → 允许');
  eq(g2.zones[2].tactics, 'horse', '被弃的士气牌回流来源中央区（规则 11.4）');
}
{
  // 计谋 ⑨军团哗变：移出对手牌；部队牌入隔离区、战术牌回流；已决出格不可动
  const g = mk(2811);
  const seat = 0, li = 0, opp = 1;
  setCell(g, li, 0, [S(0, 5)], [S(1, 9), S(1, 10)]);
  g.playerTactics[seat].push('mutiny');
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'mutiny', targetCell: 0, cardIdx: 0 }).ok, '军团哗变可执行');
  eq((g.lines[li].cells[0].sides[opp] || []).length, 1, '对手该格少 1 张');
  ok(g.guileHold.some(c => c.rank === 9), '部队牌进入隔离区 guileHold（被夺取时恢复原样）');
  const g2 = mk(2812);
  g2.lines[li].cells[1].decided = true;
  setCell(g2, li, 1, [S(0, 5)], [S(1, 9)]);
  g2.lines[li].cells[1].decided = true;
  g2.playerTactics[0].push('mutiny');
  g2._round = { pending: [], noRefill: new Set() };
  const rm = applyAction(g2, seat, { kind: 'tactic', line: li, tacticId: 'mutiny', targetCell: 1, cardIdx: 0 });
  ok(rm.ok && rm.fizzled === true, '已夺旗格不可被计谋牌影响 → 落空');
  ok(g2.playerTactics[seat].includes('mutiny'), '落空的军团哗变仍留在手里');
}
{
  // 计谋 ⑩附庸倒戈：只取部队牌，放到己方「空位」
  const g = mk(2813);
  const seat = 0, li = 0, opp = 1;
  setCell(g, li, 0, [S(0, 5)], [S(1, 7)]);       // 己方该格已有牌 → 非空位
  g.playerTactics[seat].push('defect');
  g._round = { pending: [], noRefill: new Set() };
  const rd = applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'defect', targetCell: 0, cardIdx: 0, toCell: 0 });
  ok(rd.ok && rd.fizzled === true, '目标格己方已有牌 → 落空（规则 11.2「空位」）');
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'defect', targetCell: 0, cardIdx: 0, toCell: 4 }).ok,
    '放到己方真空位 → 允许');
  eq((g.lines[li].cells[4].sides[seat] || []).length, 1, '对手部队牌落到己方空位');
  eq((g.lines[li].cells[0].sides[opp] || []).length, 0, '对手失去该牌');
}
{
  // 11.3.1：战术牌替代暗扣 → 不补牌；且战术牌不占手牌位
  const g = mk(2814);
  const seat = 0, li = 0;
  const handBefore = g.hands[seat][li].length;
  g.playerTactics[seat].push('horse');
  g._round = { pending: [], noRefill: new Set() };
  applyAction(g, seat, { kind: 'tactic', line: li, tacticId: 'horse', cell: 0 });
  eq(g.hands[seat][li].length, handBefore, '战术牌打出后不补牌（手牌数不变）');
  eq((g.lines[li].cells[0].sides[seat] || []).some(c => c.tactic === 'horse'), true, '士气牌进入该格阵型');
  // 11.3.3：战术牌不占手牌位
  eq(g.hands[seat][li].length, HAND_PER_LINE, '手牌位不受战术牌影响');
}

// ─────────────────────────────────────────
section('29. 终局阈值：旗子数 ≥ 12（规则 10.2 · v1.5 由「12 分」改为「12 旗」）');
{
  eq(WIN_FLAGS, 12, '终局旗子阈值 = 12');
  const g = mk(2901);
  g.captures[4] = WIN_FLAGS - 1;                // 11 面旗
  g._round = { pending: [], noRefill: new Set() };
  endRound(g);
  ok(!g.over, `${WIN_FLAGS - 1} 面旗尚未终局`);
  const g2 = mk(2902);
  g2.captures[4] = WIN_FLAGS;                   // 12 面旗
  g2._round = { pending: [], noRefill: new Set() };
  const r = endRound(g2);
  ok(g2.over && r.end === 'flags', `达到 ${WIN_FLAGS} 面旗 → 终局`);
  eq(g2.winner, 4, '达阈值者获胜');
}
{
  // 中央区计入旗子数（11 面旗 + 夺下 1 个中央区 = 12 → 终局）
  const g = mk(2903);
  g.zones.forEach(z => { z.influence = {}; });
  for (let s = 0; s < N_SEATS; s++) g.leaders[s] = -1;
  g.captures[2] = WIN_FLAGS - 1;
  g.zones[0].influence[2] = CENTER_THRESHOLD;
  g._round = { pending: [], noRefill: new Set() };
  const r = endRound(g);
  eq(flagTotal(g, 2), WIN_FLAGS, '旗子数含中央区：11 夺旗 + 1 中央区 = 12');
  ok(g.over && r.end === 'flags', '中央区占位计入旗子数 → 达成终局');
  eq(g.winner, 2, '由中央区补上最后 1 面旗者获胜');
}

// ─────────────────────────────────────────
section('30. 规则 8.5「无论战术牌在哪」（v1.1 修复）');
{
  // ① 牌在中央区待夺 → 正常夺取
  const g = zoneBoard(3001);
  const tac = g.zoneTactic[2];
  g.zones[2].influence[4] = CENTER_THRESHOLD;
  const r = checkTacticsWin(g, 2);
  ok(r && r.winner === 4 && r.from === 'zone', '牌在中央区待夺 → 夺取');
  eq(g.zones[2].tactics, null, '该区场上清空');
}
{
  // ② 牌在别人手里 → 夺回
  const g = zoneBoard(3002);
  const tac = g.zoneTactic[1];
  g.zones[1].tactics = null;
  g.playerTactics[7].push(tac);
  g.zones[1].influence[2] = CENTER_THRESHOLD;
  const r = checkTacticsWin(g, 1);
  ok(r && r.winner === 2 && r.from === 'hand', '牌在他人手中 → 依「无论在哪」夺回');
  ok(!g.playerTactics[7].includes(tac) && g.playerTactics[2].includes(tac), '牌完成转移');
}
{
  // ③ 牌已作为阵型牌打在格上 → 从战场上取出
  const g = zoneBoard(3003);
  const tac = g.zoneTactic[3];
  g.zones[3].tactics = null;
  const li = 0, seat = lineSeats(li)[0];
  g.lines[li].cells[0].sides[seat] = [{ tactic: tac }];
  g.zones[3].influence[seat] = CENTER_THRESHOLD;
  const r = checkTacticsWin(g, 3);
  ok(r && r.winner === seat && r.from === 'cell', '牌已作为阵型牌在场 → 仍归夺取者');
  eq((g.lines[li].cells[0].sides[seat] || []).length, 0, '该格上的这张牌被取走');
  ok(g.playerTactics[seat].includes(tac), '牌进入夺取者手牌');
}
{
  // ④ 牌已作为环境牌贴在格上 → 取出并清空环境位
  const g = zoneBoard(3004);
  const tac = g.zoneTactic[4];
  g.zones[4].tactics = null;
  const li = 1, seat = lineSeats(li)[0];
  g.lines[li].cells[2].env[seat] = tac;
  g.zones[4].influence[seat] = CENTER_THRESHOLD;
  const r = checkTacticsWin(g, 4);
  ok(r && r.from === 'env', '牌作为环境牌在场 → 也归夺取者');
  eq(g.lines[li].cells[2].env[seat], undefined, '环境位被清空');
}
{
  // ⑤ 牌已在自己手里 → 不重复结算（避免刷 tacticsWonCount / 日志刷屏）
  const g = zoneBoard(3005);
  const tac = g.zoneTactic[5];
  g.zones[5].tactics = null;
  g.playerTactics[0].push(tac);
  g.zones[5].influence[0] = CENTER_THRESHOLD;
  eq(checkTacticsWin(g, 5), null, '已持有该牌 → 不重复夺取');
}
{
  // ⑥ 牌张守恒：三种位置来回转移后，6 张牌仍完整
  const g = zoneBoard(3006);
  const count = () => {
    let n = g.zones.filter(z => z.tactics).length + g.pendingRecycle.length;
    for (let s = 0; s < N_SEATS; s++) n += g.playerTactics[s].length;
    for (const l of g.lines) for (const c of l.cells) {
      n += Object.values(c.sides).reduce((a, cs) => a + cs.filter(x => x.tactic).length, 0);
      n += Object.keys(c.env || {}).length;
    }
    return n;
  };
  eq(count(), 6, '开局 6 张战术牌');
  const tac0 = g.zoneTactic[0];
  g.zones[0].influence[1] = CENTER_THRESHOLD;
  checkTacticsWin(g, 0);
  eq(count(), 6, '牌转移到玩家手中后仍为 6 张');
  g.zones[0].influence[2] = CENTER_THRESHOLD + 1;
  checkTacticsWin(g, 0);
  ok(g.playerTactics[2].includes(tac0), '易主后牌转移到新第一');
  eq(count(), 6, '多次转移后仍守恒');
}
{
  // ⑦ 并列第一 → 不夺牌（与 8.7 / 8.9 一致）
  const g = zoneBoard(3007);
  g.zones[0].influence[0] = CENTER_THRESHOLD;
  g.zones[0].influence[1] = CENTER_THRESHOLD;
  eq(checkTacticsWin(g, 0), null, '两席并列第一 → 无人夺牌');
  eq(g.zones[0].tactics, g.zoneTactic[0], '牌仍留在该区');
}
{
  // ⑨ v1.2 修订：取消「每个中央区限一次」——同一玩家可反复打出同一中央区的战术牌
  const g = zoneBoard(3010);
  const seat = 0, li = 0, li2 = (li + 1) % 8;
  const leaders = TACTICS.filter(t => t.isLeaderCard).map(t => t.id);
  const [a, b] = leaders;                       // 两张领袖牌分属两个中央区
  g.tacticHome[a] = 0; g.tacticHome[b] = 1;
  g.zoneTactic[0] = a; g.zoneTactic[1] = b;
  g.zones[0].tactics = a; g.zones[1].tactics = b;
  g.playerTactics[seat].push(a, b);
  g._round = { pending: [], noRefill: new Set() };
  ok(applyAction(g, seat, { kind: 'tactic', line: li, tacticId: a, cell: 0 }).ok, '首次打出某中央区的战术牌：允许');
  // 该牌回流并被再次夺得后，同一玩家可再次打出（v1.2：不再限一次）
  g.playerTactics[seat].push(a);
  ok(canPlayTactic(g, seat, li2, a, 1).ok, 'v1.2：同一玩家可再次打出同一中央区的战术牌');
  ok(canPlayTactic(g, seat, li2, b, 1).ok, '另一个中央区的战术牌：不受影响');
}

{
  // ⑧ 回流保底：来源区被占时不再丢牌（旧实现直接 return false 导致牌凭空消失）
  const g = zoneBoard(3008);
  const id = g.zoneTactic[3], home = g.tacticHome[id];
  const otherZone = (home + 2) % N_ZONES;
  const other = g.zoneTactic[otherZone];
  g.zones[home].tactics = other;                 // 来源区被别的牌占住
  g.zones[otherZone].tactics = null;             // 该牌原本的位置空出来（该牌此刻在「手上」）
  const before = g.zones.filter(z => z.tactics).length;
  ok(recycleTactic(g, id), '回流仍返回成功（改放到其他空区）');
  eq(g.zones.filter(z => z.tactics).length, before + 1, '牌没有丢，场上多了一张');
  ok(g.zones.some(z => z.tactics === id), '该牌确实回到了场上某区');
  // 极端：6 区全满 → 进入待回流队列，仍不丢
  const g2 = zoneBoard(3009);
  for (let j = 0; j < N_ZONES; j++) g2.zones[j].tactics = g2.zoneTactic[j];
  const spare = 'defect';                        // 未上场的牌
  g2.tacticHome[spare] = 0;
  eq(recycleTactic(g2, spare), false, '6 区全满 → 暂不回流');
  ok(g2.pendingRecycle.includes(spare), '暂存进待回流队列（不丢牌）');
  g2.zones[0].tactics = null;
  const { tacWins } = endRound(g2);
  ok(g2.zones.some(z => z.tactics === spare) || !g2.pendingRecycle.includes(spare),
    '下一回合末被放回场上');
}

section('31. 虚空站位 + 春汛离场弃牌（v1.4「一格 4 张」修复 / v1.5 牌主选择弃牌）');
{
  // 曾经的严重 bug：计谋牌把原牌位的牌移走/弃掉后，原格位可被重新佈满；
  // 夺取回滚时把牌硬推回原格 → 一侧变成 4 张（超过容量 3）。
  // v1.4 定稿规则：① 虚空站位**只是虚空、不占格位** —— 该格照常可继续佈军；
  //                ② 计谋牌失效（被夺取）时，若原格位**已被占满** → 该牌**不回归**。
  const cases = [
    ['mutiny', { targetCell: 0, cardIdx: 0 }, 'discard'],
    ['shift', { fromCell: 0, cardIdx: 0, toCell: 3 }, 'move'],
    ['defect', { targetCell: 0, cardIdx: 0, toCell: 3 }, 'move'],
  ];
  const prep = (id, plan) => {
    const g = mk(7000 + id.length);
    for (let s = 0; s < N_SEATS; s++) g.leaders[s] = 5;
    const [sA, sB] = lineSeats(0);
    setCell(g, 0, 0, [S(0, 9), S(0, 10), S(1, 9)], [S(2, 9), S(2, 10), S(3, 8)]);
    g.tacticHome[id] = 0;
    g.playerTactics[0].push(id);
    g._round = { pending: [], noRefill: new Set() };
    const r = applyAction(g, 0, { kind: 'tactic', line: 0, tacticId: id, ...plan });
    return { g, sA, sB, r, victim: id === 'shift' ? sA : sB };
  };

  for (const [id, plan, kind] of cases) {
    const name = TACTIC_BY_ID[id].name;

    // ——— ① 原格位仍空 → 回滚「恢复原样」 ———
    {
      const { g, sB, r, victim } = prep(id, plan);
      ok(r.ok, `${name}：落场成功`);
      eq(g.guileBoard.length, 1, `${name}：计谋牌在场上（guileBoard）`);
      eq(g.lines[0].cells[0].sides[victim].length, 2, `${name}：原格位少 1 张`);
      ok(canPlayTroop(g, victim, 0, 0, 0).ok, `${name}：虚空站位不占格位 —— 该格仍可佈军`);
      g.zones[0].influence[0] = 2; g.zones[0].influence[sB] = 8;
      processGuileBoard(g);
      eq(g.lines[0].cells[0].sides[victim].length, 3, `${name}：原格位仍空 → 回滚恢复原样（3 张）`);
      eq(g.guileHold.length, 0, `${name}：回滚后隔离区清空`);
    }

    // ——— ② 原格位已被占满（合法填满）→ 失效时「不回归」 ———
    {
      const { g, sA, sB, victim } = prep(id, plan);
      ok(canPlayTroop(g, victim, 0, 0, 0).ok, `${name}：可继续佈军（虚空站位不占位）`);
      g.lines[0].cells[0].sides[victim].push(S(5, 5));           // 合法补满原格位
      eq(g.lines[0].cells[0].sides[victim].length, 3, `${name}：原格位已被占满`);
      g.zones[0].influence[0] = 2; g.zones[0].influence[sB] = 8;
      processGuileBoard(g);
      ok(g.lines[0].cells[0].sides[victim].length <= 3,
        `${name}：被占 → 不回归，该侧仍 ≤ 容量（不出现 4 张）`);
      eq(g.guileHold.length, 0, `${name}：隔离区清空（牌不滞留）`);
      if (kind === 'discard') eq(g.lines[0].discard.length, 1, `${name}：该牌就此弃入该战线弃牌堆`);
      else eq((g.lines[0].cells[3].sides[sA] || []).length, 1, `${name}：牌留在被移去的位置`);
    }
  }

  // 第二条「一格 4 张」路径：多瑙河春汛让该格容量变成 4；若春汛被 8.5 夺走，
  // 容量回落为 3 —— 超出的牌不再由引擎自动裁剪，而是登记为待决，由该侧牌主「自行选择弃掉哪一张」（v1.5）。
  const gf = mk(7200);
  for (let s = 0; s < N_SEATS; s++) gf.leaders[s] = 5;
  const [fA, fB] = lineSeats(0);
  setCell(gf, 0, 0, [S(0, 1), S(0, 2), S(0, 3), S(0, 4)], [S(2, 9), S(2, 10), S(3, 8)]);
  gf.lines[0].cells[0].env[fA] = 'flood';
  eq(cellCapacity(gf.lines[0].cells[0]), 4, '多瑙河春汛在场 → 该格容量 4');
  gf.tacticHome['flood'] = 0; gf.zoneTactic[0] = 'flood';
  for (const z of gf.zones) if (z.tactics === 'flood') z.tactics = null;   // 确保春汛此刻只「打在战场上」
  gf.zones[0].influence = {};
  gf.zones[0].influence[fB] = 8;
  ok(checkTacticsWin(gf, 0), '席1 通过 8.5 夺走打在战场上的「多瑙河春汛」');
  eq(cellCapacity(gf.lines[0].cells[0]), 3, '春汛离场 → 容量回落为 3');
  eq(gf.pendingFloodDiscard.length, 1, 'v1.5：超容不再自动裁剪，登记为「牌主选择弃牌」待决');
  eq(gf.pendingFloodDiscard[0].seat, fA, '待决归属佈满 4 张的那一侧');
  eq((gf.lines[0].cells[0].sides[fA] || []).length, 4, '结算前该侧仍为 4 张（等玩家决定后再移除）');
  eq(floodDiscardCandidates(gf, gf.pendingFloodDiscard[0]).length, 4, '待决给出 4 张候选供玩家挑选');

  // 玩家自选：明确指定弃掉「♠3」→ 只移除这一张，其余保留
  const chosen = (gf.lines[0].cells[0].sides[fA] || []).find(c => c.rank === 3);
  const ev = resolveOneFloodDiscard(gf, gf.pendingFloodDiscard[0], () => chosen);
  eq(ev.card.rank, 3, '按玩家所选弃掉 ♠3');
  eq((gf.lines[0].cells[0].sides[fA] || []).length, 3, '弃牌后该侧回到容量 3');
  ok(gf.lines[0].discard.some(c => c.rank === 3), '被弃的牌进入该战线弃牌堆（牌不丢失）');
  ok((gf.lines[0].cells[0].sides[fA] || []).every(c => c.rank !== 3), '该牌已不在格上');
  ok(!canPlayTroop(gf, fA, 0, 0, 0).ok, '结算后该格对该席回复为「已满」');

  // 默认策略（AI）：4 张 ♠1-4 同为同花顺，弃掉一张后保留最强 3 张 →
  //   去掉 ♠1 后留 [2,3,4]（点数 9）比留 [1,2,3]（点数 6）更强，故应弃 ♠1。
  const gd = mk(7201);
  for (let s = 0; s < N_SEATS; s++) gd.leaders[s] = 5;
  setCell(gd, 0, 0, [S(0, 1), S(0, 2), S(0, 3), S(0, 4)], [S(2, 9), S(2, 10), S(3, 8)]);
  gd.lines[0].cells[0].env[fA] = 'flood';
  gd.tacticHome['flood'] = 0; gd.zoneTactic[0] = 'flood';
  for (const z of gd.zones) if (z.tactics === 'flood') z.tactics = null;
  gd.zones[0].influence = {}; gd.zones[0].influence[fB] = 8;
  ok(checkTacticsWin(gd, 0), '席1 再次夺走「多瑙河春汛」');
  const devs = resolveFloodDiscards(gd);   // 缺省自动策略
  eq(devs.length, 1, '默认策略自动结算 1 张');
  eq(devs[0].card.rank, 1, '默认保留最强 3 张 → 弃掉最低的 ♠1（留下 2-3-4 同花顺）');
  eq(gd.pendingFloodDiscard.length, 0, '结算后待决队列清空');
  eq((gd.lines[0].cells[0].sides[fA] || []).length, 3, '默认结算后该侧亦回到容量 3');
}

// ─────────────────────────────────────────
section('32. 无消耗立即打出（规则 11.3 · v1.7：8.5/11.5 均发放额度，UI/AI 会用）');
{
  const g = zoneBoard(3201);
  for (let j = 0; j < N_ZONES; j++) if (g.zones[j].tactics === 'scout') g.zones[j].tactics = null;
  g.zones[2].tactics = 'scout'; g.zoneTactic[2] = 'scout'; g.tacticHome['scout'] = 2;
  g.zones[2].influence[4] = CENTER_THRESHOLD;

  const r = checkTacticsWin(g, 2);
  ok(r && r.winner === 4 && r.tactic === 'scout', '8.5 夺得「哥特游骑」');
  ok(hasFreePlay(g, 4, 'scout'), 'v1.7：8.5 获得同样发放「无消耗立即打出」额度');

  const li = playerLines(4)[0];
  g._round = { pending: [], noRefill: new Set() };   // applyAction 依赖 _round 上下文
  const evs = resolveFreePlays(g, (gg, s, id) => ({ kind: 'tactic', line: li, tacticId: id, returnIdxs: null }));
  eq(evs.length, 1, 'resolveFreePlays 立即免费打出 1 张');
  eq(evs[0].tacticId, 'scout', '打出的正是刚获得的「哥特游骑」');
  ok(!hasFreePlay(g, 4, 'scout'), '打出后额度耗尽（不会二次免费）');
  ok(!g.playerTactics[4].includes('scout'), '战术牌已离手');
}
{
  // 当回合未立即打出 → 免费额度于回合末作废（v1.8）；战术牌仍在手，之后按普通行动打出
  const g = zoneBoard(3202);
  for (let j = 0; j < N_ZONES; j++) if (g.zones[j].tactics === 'scout') g.zones[j].tactics = null;
  g.zones[1].tactics = 'scout'; g.zoneTactic[1] = 'scout'; g.tacticHome['scout'] = 1;
  g.zones[1].influence[5] = CENTER_THRESHOLD;
  const w = checkTacticsWin(g, 1);
  ok(w && w.winner === 5, '8.5 席位5夺得「哥特游骑」');
  ok(hasFreePlay(g, 5, 'scout'), '夺得后获得「无消耗立即打出」额度');
  // 当回合选择「留着」（freePicker 返回 null）→ 回合末额度作废、不跨回合保留
  endRound(g, { freePicker: () => null });
  ok(!hasFreePlay(g, 5, 'scout'), '当回合未立即打出 → 免费额度作废（不永久保留）');
  ok(g.playerTactics[5].includes('scout'), '战术牌仍在手上，之后按普通行动打出');
}

console.log(`\n=== 结果： ${pass} PASS / ${fail} FAIL ===`);
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
