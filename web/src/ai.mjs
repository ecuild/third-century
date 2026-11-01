// 进阶 AI：对手建模 + 两步预判 + 中心区策略
// 每席每回合在其镇守的两条战线各产出 1 个动作（规则 7.2）
import {
  FACTIONS, CELLS_PER_LINE, HAND_PER_LINE, CENTER_THRESHOLD,
  LEADER_WORTH, TACTIC_BY_ID, N_ZONES, N_SEATS, WIN_FLAGS,
  lineSeats, playerLines, secondHand,
} from './rules.mjs';
import { bestFormation, maxPointSum, compareForm, comparePointsOnly } from './formation.mjs';
import {
  canPlayTroop, canPlayTactic, cellCapacity, cellHasEnv,
  playerZoneScore, centerOptions, makeRng, flagTotal,
} from './engine.mjs';

// ---------- 单张牌在手牌中的价值 ----------
function cardValue(card, hand) {
  let v = 0.35;
  v += (card.rank / 10) * 0.25;
  v += hand.filter(c => c.suit === card.suit).length * 0.12;
  v += hand.filter(c => Math.abs(c.rank - card.rank) === 1 && c.suit === card.suit).length * 0.10;
  v += hand.filter(c => Math.abs(c.rank - card.rank) === 1).length * 0.05;
  v += hand.filter(c => c.rank === card.rank).length * 0.10;
  return Math.min(1, v);
}

// ---------- 终局意识（v1.9 候选，由 o.endgameW 加权；默认 0 = 关闭）----------
// 终局由「旗子数（累计夺旗 + 持有中央区）≥ 12」触发，但胜负按总分定（规则 10.2）。
// 探针依据（200 局全席 v2）：91% 对局由 12 旗终局；终局时最大旗子数 100% ≥ 10；
//   59% 的局冠亚军分差 ≤ 2 分；7.7% 的局「触发者反而输」——最后几面旗的争夺经常
//   直接决定胜负，而默认 AI 对此毫无意识（夺旗/防守收益都是固定值，与局势无关）。
// 策略：距终局 ≤ 5 面旗时启动（near 0..1）：
//   总分领先 → 在「夺旗类」收益上追加加速分 acc（尽早触发终局锁定优势）；
//   总分落后 → 在「避损类」收益上追加拖延分 den（晚一轮终局 = 多一轮追分）。
//  v1 乘法版（对子集项 ×1.6 以内）实测 2008 个决策点零 argmax 翻转——候选间边际差
//   远大于这点缩放，故改为加式：幅度 = near × min(|分差|,3)/2，最大 +1.5，与夺旗项
//   （+2.0）同量级，才可能真正改变决策。
function endgameBoost(g, seat) {
  if (g.mode === 'long') return { acc: 0, den: 0 };   // 长游戏无 12 旗终局
  let maxFlags = 0, maxOther = -Infinity;
  for (let s = 0; s < N_SEATS; s++) {
    const f = flagTotal(g, s);
    if (f > maxFlags) maxFlags = f;
    if (s !== seat && g.scores[s] > maxOther) maxOther = g.scores[s];
  }
  const rem = WIN_FLAGS - maxFlags;
  if (rem > 5) return { acc: 0, den: 0 };             // 距终局还早，不启动
  const near = Math.min(1, (6 - rem) / 6);
  const lead = g.scores[seat] - maxOther;
  const mag = Math.min(Math.abs(lead), 3) / 2;        // 分差 3 分即满幅
  if (lead > 0) return { acc: near * mag, den: 0 };
  if (lead < 0) return { acc: 0, den: near * mag };
  return { acc: 0, den: 0 };
}

// ---------- 出牌位置评估 ----------
function evalPlay(g, seat, lineIdx, cellIdx, handIdx, o) {
  const line = g.lines[lineIdx];
  const cell = line.cells[cellIdx];
  const [sA, sB] = lineSeats(lineIdx);
  const opp = seat === sA ? sB : sA;
  const hand = g.hands[seat][lineIdx];
  const card = hand[handIdx];
  const cap = cellCapacity(cell);
  const mine = (cell.sides[seat] || []).concat([card]);
  const theirs = cell.sides[opp] || [];
  const dom = g.dominantSuit;
  // 终局意识附加分（o.endgameW > 0 时启用；默认 0 时完全不计算，行为与旧版一致）
  //   acc：领先方的「加速夺旗」附加分；den：落后方的「拖延避损」附加分
  const eg = o && o.endgameW ? endgameBoost(g, seat) : null;
  const acc = eg ? eg.acc * o.endgameW : 0;
  const den = eg ? eg.den * o.endgameW : 0;

  let score = 0;
  // 旗幟归属：夺下对手的旗更有价值（规则 10.1 零和）
  score += cell.owner === seat ? 0.15 : 0.65 + acc * 0.5;

  if (cellHasEnv(cell, 'points')) {
    // 瘟疫：只比点数和
    const my = maxPointSum(mine), th = maxPointSum(theirs);
    score += (my - th) * 0.05;
    // 修正：原写 `mine > th`（数组 vs 数字，恒为 false），使「满编且点数和领先」的
    // +2 奖励成为死代码；应为点数和比较 `my > th`。
    if (mine.length === cap && my > th) score += 2 + acc * 2;
  } else {
    const myV = bestFormation(mine, dom);
    const thV = bestFormation(theirs, dom);
    score += myV.level * 0.45;
    if (dom != null) score += (myV.dom - thV.dom) * 0.18;
    score += (myV.pts - thV.pts) * 0.015;

    if (mine.length === cap) {
      if (theirs.length === cap) {
        const cmp = compareForm(mine, theirs, dom);
        if (cmp > 0) score += 2.0 + acc * 2;
        else if (cmp < 0) score -= 1.6 + den * 2;
        else {
          // 平手：后结算方判负（规则 5.1 第 3 条）
          const iLose = secondHand(lineIdx, g.revealDir) === seat;
          score += iLose ? -(1.2 + den * 1.5) : 1.2 + acc * 1.5;
        }
      } else {
        score += 1.0 + acc * 0.5; // 施压：对手未成编
      }
    } else if (mine.length === cap - 1) {
      score += 0.5; // 再一张即成阵
    }
    // 对手已成型的威胁
    if (theirs.length === cap) {
      const cmp = compareForm(mine, theirs, dom);
      if (cmp < 0) score -= 0.9 + den * 1.5;
    }
  }
  score += cardValue(card, hand) * 0.25;
  return score;
}

// ---------- 中心区二选一（规则 8.2）----------
function isTopInZone(g, zoneIdx, seat, value) {
  for (let s = 0; s < N_SEATS; s++) {
    if (s === seat) continue;
    if (playerZoneScore(g, g.zones[zoneIdx], s) >= value) return false;
  }
  return true;
}

// 规则 8.6：本席在 zoneIdx 影响力 +delta 后成为「唯一第一」能拿到的分值：
//   0 = 拿不到；1 = 该区首次易主（+1，无人扣分）；2 = 从对手手里抢（我 +1 且对手 −1，净差 2）
function zonePointGain(g, seat, zoneIdx, delta) {
  const z = g.zones[zoneIdx];
  const after = playerZoneScore(g, z, seat) + delta;
  if (after < CENTER_THRESHOLD) return 0;
  if (!isTopInZone(g, zoneIdx, seat, after)) return 0;
  const holder = g.zoneHolder[zoneIdx];
  if (holder === seat) return 0;          // 已持有，再达成也不加分
  return holder == null ? 1 : 2;
}

const TACTIC_BONUS = 1.5;

function centerChoice(g, seat, suit) {
  const opt = centerOptions(g, seat, suit);
  const z = g.zones[suit];
  const cur = playerZoneScore(g, z, seat);
  const leaderThere = g.leaders[seat] === suit;

  // 领袖不在该色区：移入即 +2 影响力 → 若能达成该区第一（规则 8.6 直接得分）或能夺牌 → 移入
  if (!leaderThere) {
    const withLeader = cur + LEADER_WORTH;
    const gain = zonePointGain(g, seat, suit, LEADER_WORTH);
    if (gain > 0 && withLeader >= CENTER_THRESHOLD) return { type: 'leader', zone: suit };
    if (z.tactics && withLeader >= CENTER_THRESHOLD && isTopInZone(g, suit, seat, withLeader)) {
      return { type: 'leader', zone: suit };
    }
  }
  // 领袖已在该色区：可移到任意其他区 → 选最有价值的一个
  if (leaderThere) {
    let best = null, bestV = -Infinity;
    for (const tz of opt.leaderZones) {
      const v = playerZoneScore(g, g.zones[tz], seat) + LEADER_WORTH
        + (g.zones[tz].tactics ? TACTIC_BONUS : 0)
        + (g.zoneHolder[tz] === seat ? 0.8 : 0)
        + zonePointGain(g, seat, tz, LEADER_WORTH) * 3
        + centerSuitValue(g, seat, tz) * 1.2;      // 长远：把领袖停在对未来最有利的区
      if (v > bestV) { bestV = v; best = tz; }
    }
    // 留在原地 = 放 1 枚标记（+1 影响力）
    const stayValue = cur + 1 + (z.tactics ? TACTIC_BONUS : 0)
      + (g.zoneHolder[suit] === seat ? 0.8 : 0)
      + zonePointGain(g, seat, suit, 1) * 3
      + centerSuitValue(g, seat, suit) * 1.2;
    if (best != null && bestV > stayValue + 0.5) return { type: 'leader', zone: best };
  }
  // 默认：放影响力标记（规则 8.2 行动①）
  return { type: 'place' };
}

// ---------- 战术牌使用 ----------
// o（可选）：{ moraleStrict, useGuile } —— 用于同批种子的前后对照实验
function tacticPlan(g, seat, lineIdx, used, o) {
  const line = g.lines[lineIdx];
  const [sA, sB] = lineSeats(lineIdx);
  const opp = seat === sA ? sB : sA;
  const held = g.playerTactics[seat];
  if (!held.length) return null;

  for (const id of held) {
    const t = TACTIC_BY_ID[id];
    if (!t) continue;
    if (used && used.has(id)) continue;   // 同一张牌不能在本回合两条线重复使用
    if (o && o.onlyTactic && id !== o.onlyTactic) continue;   // v1.7：仅评估指定那张（免费打出用）
    // 规则 11.3.2：本战线已打出战术牌数不得多于对手 +1（计谋牌即时生效，同样受限）
    // 注意：士气 / 环境牌需要具体格位，不能拿 undefined 去校验 —— 否则会被误判为
    // 「格位无效」而永远用不出去（曾经的实际 bug：AI 从不使用士气/环境牌）。
    if (t.cat === 'guile') {
      if (!canPlayTactic(g, seat, lineIdx, id, undefined).ok) continue;
    } else {
      let anyCell = false;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        if (canPlayTactic(g, seat, lineIdx, id, k).ok) { anyCell = true; break; }
      }
      if (!anyCell) continue;
    }

    if (t.cat === 'morale') {
      if (o && o.moraleStrict === false) {
        // 旧逻辑：只要找到 cap-1 的格就补（不预判胜负）
        for (let k = 0; k < CELLS_PER_LINE; k++) {
          const cell = line.cells[k];
          const mine = cell.sides[seat] || [];
          if (mine.length !== cellCapacity(cell) - 1) continue;
          if (!canPlayTactic(g, seat, lineIdx, id, k).ok) continue;
          return { kind: 'tactic', line: lineIdx, tacticId: id, cell: k };
        }
      }
      // 在「己方 cap-1 张」的格里挑最好的一个补上成型：
      // 用 compareForm 预判补上后的胜负，只在能赢（或至少不输）时才花这张牌，
      // 且优先补「能压过对手 / 能抢下对方旗」的格。
      let bestK = -1, bestV = -Infinity;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const cell = line.cells[k];
        const mine = cell.sides[seat] || [];
        if (mine.length !== cellCapacity(cell) - 1) continue;
        if (!canPlayTactic(g, seat, lineIdx, id, k).ok) continue;
        const withCard = mine.concat([{ tactic: id }]);
        const theirs = cell.sides[opp] || [];
        const cmp = theirs.length ? compareForm(withCard, theirs, g.dominantSuit) : 1;
        const v = (cmp > 0 ? 3 : cmp === 0 ? 0.4 : -1.5)
          + (cell.owner === seat ? 0 : 0.6)          // 能夺对方的旗更值
          + (theirs.length >= cellCapacity(cell) ? 0.4 : 0);
        if (v > bestV) { bestV = v; bestK = k; }
      }
      if (bestK >= 0 && bestV > 0) return { kind: 'tactic', line: lineIdx, tacticId: id, cell: bestK };
    }

    if (t.cat === 'env') {
      if (id === 'plague') {
        // 我方点数和领先、但牌型落后 → 用瘟疫抹平牌型差距
        for (let k = 0; k < CELLS_PER_LINE; k++) {
          const cell = line.cells[k];
          if (cell.decided || cellHasEnv(cell, 'points')) continue;
          const mine = cell.sides[seat] || [], theirs = cell.sides[opp] || [];
          if (mine.length < 2 || theirs.length < 2) continue;
          if (maxPointSum(mine) > maxPointSum(theirs)
            && compareForm(mine, theirs, g.dominantSuit) < 0
            && canPlayTactic(g, seat, lineIdx, id, k).ok) {
            return { kind: 'tactic', line: lineIdx, tacticId: id, cell: k };
          }
        }
      }
      if (id === 'flood') {
        // 我方牌型已成型且对手未满 → 拖到 4 张，让对手更难凑阵
        for (let k = 0; k < CELLS_PER_LINE; k++) {
          const cell = line.cells[k];
          if (cell.decided || cellHasEnv(cell, 'four')) continue;
          const mine = cell.sides[seat] || [], theirs = cell.sides[opp] || [];
          if (mine.length === 3 && theirs.length < 3 && canPlayTactic(g, seat, lineIdx, id, k).ok) {
            return { kind: 'tactic', line: lineIdx, tacticId: id, cell: k };
          }
        }
      }
    }

    if (t.cat === 'guile') {
      // freeRelax：免费打出零行动消耗，门槛应低于普通打出——手牌 ≤ 6 时侦察净赚
      //   （抽 3 张、2 张被模型压住，手牌仍 ≤ 7 上限，不触发弃牌）。
      // 牌堆与弃牌堆皆空（后期牌全锁进封存格/手牌）→ 引擎按落空契约处理、牌保留，
      //   但暗扣行动已花掉——探针实测 100 局 8 人档 1130 次侦察全部因此落空，故加闸。
      // freeScout（chooseFreePlay 默认开）：零成本打出不设手牌门槛，只要求牌堆非空——
      //   实测授予时刻手牌≤4 与牌堆非空互斥（0/255 次授予满足旧门槛），去掉门槛后
      //   228/255 可打出，否则侦察对 AI 是死牌（_scout_probe.mjs Part 1/2/3）。
      if (id === 'scout' && line.deck.length + line.discard.length > 0
        && (o && o.freeScout || g.hands[seat][lineIdx].length <= (o && o.freeRelax ? 6 : 4))) {
        return { kind: 'tactic', line: lineIdx, tacticId: id, returnIdxs: null };
      }
      if (id === 'mutiny') {
        // 弃掉对手某未决出格中「破坏力最大」的一张。
        // 修正：原用 `theirs[ci].rank` 估值 —— 士气 / 环境牌（{ tactic }）没有 rank，
        //   该项为 undefined → 整式变 NaN → 战术牌目标永远选不中，白白丢掉
        //   「拆掉对手士气牌」这一高价值打法（引擎 execGuile 允许弃战术牌，会回流中央区）。
        // 现改为按「移除该牌后对手阵型掉级多少」衡量伤害，并兼容瘟疫格（只比点数和）。
        let best = null, bestV = -Infinity;
        for (let k = 0; k < CELLS_PER_LINE; k++) {
          const cell = line.cells[k];
          if (cell.decided) continue;
          const theirs = cell.sides[opp] || [];
          if (!theirs.length) continue;
          const envPoints = cellHasEnv(cell, 'points');
          const measure = arr => (envPoints ? maxPointSum(arr) : bestFormation(arr, g.dominantSuit).level);
          const before = measure(theirs);
          for (let ci = 0; ci < theirs.length; ci++) {
            const after = theirs.filter((_, i) => i !== ci);
            const dmg = (before - measure(after)) * (envPoints ? 1 : 10);
            const v = dmg + (theirs[ci].rank || 0) * 0.1;   // 同伤害时优先弃大牌
            if (v > bestV) { bestV = v; best = { k, ci }; }
          }
        }
        if (best && bestV > 0) return { kind: 'tactic', line: lineIdx, tacticId: id, targetCell: best.k, cardIdx: best.ci };
      }
      if (id === 'defect' && !(o && o.useGuile === false)) {
        // 取对手「最伤」的一张部队牌：拿走它能让对手该格阵型掉级最多；
        // 对手满编的格额外加分（拿走其一 = 直接废掉对手一次成型）。
        let best = null, bestV = -Infinity;
        for (let k = 0; k < CELLS_PER_LINE; k++) {
          const cell = line.cells[k];
          if (cell.decided) continue;
          const theirs = cell.sides[opp] || [];
          if (!theirs.length) continue;
          const before = bestFormation(theirs, g.dominantSuit).level;
          for (let ci = 0; ci < theirs.length; ci++) {
            if (theirs[ci].tactic) continue;          // 规则：附庸倒戈只能取部队牌
            const after = theirs.filter((_, i) => i !== ci);
            const afterLv = bestFormation(after, g.dominantSuit).level;
            const v = (before - afterLv) * 10
              + (theirs.length >= cellCapacity(cell) ? 5 : 0)
              + theirs[ci].rank * 0.2;
            if (v > bestV) { bestV = v; best = { k, ci }; }
          }
        }
        // freeRelax：零成本拿走对手任意部队牌都是正收益（其阵型掉级 ≥ 0 且该牌
        //   易主到我方空位），无需「掉级 ≥ 5」的普通行动门槛。
        if (best && bestV >= (o && o.freeRelax ? 0 : 5)) {
          const to = emptyCellFor(g, line, seat);
          if (to >= 0) {
            return { kind: 'tactic', line: lineIdx, tacticId: id, targetCell: best.k, cardIdx: best.ci, toCell: to };
          }
        }
      }
      if (id === 'shift' && !(o && o.useGuile === false)) {
        // 把己方「必输格」里的一张牌，挪到「对手已开始佈军、我方还空着」的格，
        // 把废牌变成有效资源（弃掉一张牌本身没有收益）。
        const to = (() => {
          for (let k = 0; k < CELLS_PER_LINE; k++) {
            const c = line.cells[k];
            if (c.decided) continue;
            if (!(c.sides[seat] || []).length && (c.sides[opp] || []).length > 0) return k;
          }
          return -1;
        })();
        if (to >= 0) {
          for (let k = 0; k < CELLS_PER_LINE; k++) {
            const c = line.cells[k];
            if (c.decided || k === to) continue;
            if (!(c.sides[seat] || []).length) continue;
            const hopeless = (c.sides[opp] || []).length >= cellCapacity(c)
              && compareForm(c.sides[seat] || [], c.sides[opp] || [], g.dominantSuit) < 0;
            if (hopeless && canPlayTactic(g, seat, lineIdx, id, k).ok) {
              return { kind: 'tactic', line: lineIdx, tacticId: id, fromCell: k, cardIdx: 0, toCell: to };
            }
          }
        }
      }
    }
  }
  return null;
}

// 该战线上「己方一侧还没佈军的未决格」（规则 11.2 的「空位」）
function emptyCellFor(g, line, seat) {
  for (let k = 0; k < line.cells.length; k++) {
    const c = line.cells[k];
    if (!c.decided && !(c.sides[seat] || []).length) return k;
  }
  return -1;
}

// ══════════════════════════════════════════════════════════════════
// v1：纯贪心 + 启发式（保留作对照组，用于量化比较）
// ══════════════════════════════════════════════════════════════════
export function chooseActionsV1(g, seat) {
  const out = [];
  const usedTactics = new Set();   // 同一张战术牌本回合只能使用一次
  for (const lineIdx of playerLines(seat)) {
    const hand = g.hands[seat][lineIdx] || [];

    // 规则 8.3：手牌为 0 → 触发领袖放置
    if (hand.length === 0) {
      out.push({ kind: 'empty', line: lineIdx, leaderZone: bestLeaderZone(g, seat) });
      continue;
    }

    // 战术牌替代暗扣（规则 7.4）
    const tp = tacticPlan(g, seat, lineIdx, usedTactics);
    if (tp) { usedTactics.add(tp.tacticId); out.push(tp); continue; }

    // 选格 + 选牌
    let best = null;
    for (let k = 0; k < CELLS_PER_LINE; k++) {
      for (let hi = 0; hi < hand.length; hi++) {
        if (!canPlayTroop(g, seat, lineIdx, k, hi).ok) continue;
        const score = evalPlay(g, seat, lineIdx, k, hi);
        if (!best || score > best.score) best = { lineIdx, cell: k, handIdx: hi, score };
      }
    }
    // 手牌非空但所有格己方均已满编 —— 无合法暗扣点
    if (!best) { out.push({ kind: 'skip', line: lineIdx }); continue; }
    out.push({
      kind: 'troop',
      line: lineIdx,
      cell: best.cell,
      handIdx: best.handIdx,
      center: centerChoice(g, seat, hand[best.handIdx].suit),
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
// v2：贪心候选 + 蒙特卡洛概率搜索（对手手牌未知 → 采样补全后模拟对局结果）
//   核心思想：静态估值只看「现在这张牌放上去长什么样」，不知道对手手里还有
//   什么、牌堆里还剩什么。v2 从「不可见牌池」随机采样对手手牌与未来补牌，
//   把该格模拟到满编后统计胜率，用「期望分数变动」代替启发式打分。
//   全部采样使用由 (seed, 回合, 格位, 牌) 派生的确定性 PRNG → 同种子可复现。
// ══════════════════════════════════════════════════════════════════
function hashSeed(...vals) {
  let h = 2166136261 >>> 0;
  for (const v of vals) h = Math.imul(h ^ (((v | 0) + 0x9e3779b9) >>> 0), 16777619) >>> 0;
  return h >>> 0;
}

// 本战线的「不可见牌池」：60 张（6 色 × 1-10）减去已摊出的牌、弃牌堆、我的手牌。
// 剩下的就是「牌堆 + 对手手牌」，即我无从得知的部分。
function unseenPool(g, lineIdx, seat) {
  const cnt = new Uint8Array(60).fill(1);
  const dec = c => {
    if (!c || c.tactic) return;
    const i = c.suit * 10 + (c.rank - 1);
    if (i >= 0 && i < 60 && cnt[i] > 0) cnt[i] -= 1;
  };
  const line = g.lines[lineIdx];
  for (const cell of line.cells) for (const side of Object.values(cell.sides)) for (const c of side) dec(c);
  for (const c of line.discard) dec(c);
  for (const c of (g.hands[seat]?.[lineIdx] || [])) dec(c);
  return cnt;
}
function poolTotal(cnt) {
  let t = 0;
  for (let i = 0; i < 60; i++) t += cnt[i];
  return t;
}
function drawFromPool(cnt, rng) {
  const total = poolTotal(cnt);
  if (total <= 0) return null;
  let k = Math.floor(rng() * total);
  for (let i = 0; i < 60; i++) {
    k -= cnt[i];
    if (k < 0) { cnt[i] -= 1; return { suit: (i / 10) | 0, rank: (i % 10) + 1 }; }
  }
  return null;
}

// 把该格模拟到满编，统计我方胜率。
// 返回「期望分数变动」：夺旗是我 +1 / 对手 −1（净 +2），失守是净 −2。
// 注意：随机种子刻意不包含 myCard —— 同一格的所有候选共用同一批随机样本
// （common random numbers），这样「打这张 / 不打这张」的差值是降噪后的边际值。
export function cellWinExpectation(g, lineIdx, cellIdx, seat, myCard, samples = 16) {
  const line = g.lines[lineIdx];
  const cell = line.cells[cellIdx];
  const [sA, sB] = lineSeats(lineIdx);
  const opp = seat === sA ? sB : sA;
  const cap = cellCapacity(cell);
  const mineBase = (cell.sides[seat] || []).concat(myCard ? [myCard] : []);
  const oppBase = cell.sides[opp] || [];
  const envPoints = cellHasEnv(cell, 'points');
  const rng = makeRng(hashSeed(g.seed, g.round, lineIdx, cellIdx, seat));
  const loserOnDraw = secondHand(lineIdx, g.revealDir);
  const pool0 = unseenPool(g, lineIdx, seat);   // 建一次，每次采样只做 60 字节拷贝
  const dom = g.dominantSuit;
  let win = 0, draw = 0;
  for (let it = 0; it < samples; it++) {
    const cnt = pool0.slice();
    const mine = mineBase.slice(), opp = oppBase.slice();
    // 我方会积极补满此格（我在意这一格）
    while (mine.length < cap) { const c = drawFromPool(cnt, rng); if (!c) break; mine.push(c); }
    // 对手是「理性对手」：落后时高概率继续投，领先/无关时多半收手。
    // （把对手一律当成会补满，会系统性低估我在强势格上的胜率 —— 这是上一版失真的主因）
    while (opp.length < cap) {
      const cur = envPoints ? comparePointsOnly(mine, opp) : compareForm(mine, opp, dom);
      const p = cur < 0 ? 0.85 : 0.30;
      if (rng() > p) break;
      const c = drawFromPool(cnt, rng);
      if (!c) break;
      opp.push(c);
    }
    const cmp = envPoints ? comparePointsOnly(mine, opp) : compareForm(mine, opp, dom);
    if (cmp > 0) win++;
    else if (cmp === 0) draw++;
  }
  // 规则 5.1 第 3 条：完全平手时「后结算方判负」
  const winOnDraw = loserOnDraw === seat ? 0 : 1;
  const pWin = (win + draw * winOnDraw) / samples;
  return 2 * pWin - 2 * (1 - pWin);
}

// 「这张牌的边际价值」= 打它之后的期望分 − 不打它的期望分。
// 直接比期望分会让 AI 把牌浪费在「本来就已经赢定」的格上；比较边际值才能
// 把牌投到真正能改变胜负的地方（这是 v2 第一版输给 v1 的根因）。
export function cellDeltaEV(g, lineIdx, cellIdx, seat, myCard, samples) {
  const withCard = cellWinExpectation(g, lineIdx, cellIdx, seat, myCard, samples);
  const without = cellWinExpectation(g, lineIdx, cellIdx, seat, null, samples);
  return withCard - without;
}

// ---------- 中央区的长远价值（规则 8.6 / 8.9，「更长远的中区贪心」）----------
// 打出的牌的颜色决定中心行动落在哪个区（规则 8.2 行动①只能放该色区），
// 因此「选哪张牌」等价于「往哪个中央区投资」。中央区是第二得分轴，
// 这里按「离门槛多近 / 该区第一归谁 / 对手是否逼近 / 奖励牌是否还在」定价。
export function centerSuitValue(g, seat, suit) {
  const z = g.zones[suit];
  if (!z) return 0;
  const cur = playerZoneScore(g, z, seat);
  const after = Math.min(cur + 1, CENTER_THRESHOLD);
  let v = (after / CENTER_THRESHOLD) * 0.9;      // 越接近 6 越值钱（长期推力）
  if (after >= CENTER_THRESHOLD) v += 0.6;       // 本回合即可达标
  const holder = g.zoneHolder[suit];
  if (holder === seat) v += 0.35;                // 守住自己的区分
  else if (holder != null) v += 1.0;             // 抢别人的区分（净差 2 分）
  else v += 0.6;                                 // 首次夺取 +1
  let oppMax = 0;
  for (let s = 0; s < N_SEATS; s++) if (s !== seat) oppMax = Math.max(oppMax, playerZoneScore(g, z, s));
  if (oppMax >= CENTER_THRESHOLD - 1) v += 0.5;  // 对手逼近 → 防守要紧
  if (z.tactics) v += 0.35;                      // 该区还有奖励牌可夺
  return v;
}

// ---------- v2 主决策：本席两条战线各 1 个动作 ----------
const DEF_OPTS = {
  // 只对静态分最高的 K 个候选做概率搜索。
  // 经配对差分标定（两组独立样本）：6→12 为显著正增益（Δ +0.676 / t=2.78，+0.732 / t=2.85，
  //   夺冠率 17.6~17.9% vs 基线 15.2~15.6%）；18 / 24 反而不显著（更多边际候选只带来 MC 噪声）。
  topK: 12,
  samples: 48,    // 每个候选的采样次数（16 次时胜率的标准误 ~0.12，噪声盖过信号）
  // MC 边际期望分权重。经五轮配对差分标定（32~64 种子 × 8 席，多套独立种子）：
  //   1.0→1.5 显著（t=2.10）；继续上行 2.0~8.0 在四套种子上 Δ 全部为正、夺冠率全部
  //   不低于基线；4→6 头对头显著（t=2.07）、4→8 不显著（t=1.79）、6→8 头对头
  //   Δ≈0（t=−0.03，夺冠率 16.0% vs 13.9%）→ 6 与 8 统计等价，取更保守的 6
  //   （mcW→∞ 会退化为纯 MC argmax，静态/中区项被完全淹没，6 仍保留其余量）。
  mcW: 6.0,       // 边际期望分（−4..+4，通常 −2..+2）的权重
  staticW: 1.0,   // 静态启发式分的权重
  // 中央区长远价值权重。经 40 种子 × 8 席配对差分标定：
  //   centerW=0 → Δ+0.934 / 0.2 → Δ+1.684 / 0.8 → Δ+1.193 分/席（相对纯贪心基线）
  // 权重过大会为了中区牺牲战线（中区全程只值 6 分，战线才是主战场），0.2 附近最优。
  centerW: 0.2,
  // 终局意识权重（0 = 关闭）。临近 12 旗终局时按总分领先/落后追加夺旗加速/避损拖延分。
  // 已实测否决：乘法版（×1.6 以内）2008 个决策点零 argmax 翻转；加式版 W=1（t=1.00）、
  //   W=2（t=0.00）均不显著——AI 原本的「完成必胜格/回避必输格」偏好已与终局正确
  //   策略同向，附加分只微调、无统计可测收益。保留开关供后续实验，默认关闭。
  endgameW: 0,
  moraleStrict: true,   // 士气牌只在「补上后能赢」时才打（false = 旧逻辑：凑够张数就打）
  useGuile: true,       // 是否使用附庸倒戈 / 莱茵换防策略
};
export const AI_V2_DEFAULT = { ...DEF_OPTS };

// 纯贪心基线（关掉概率搜索、中区项与两项战术改进）：v2 的可控对照
export function chooseActionsGreedy(g, seat) {
  return chooseActions(g, seat, { mcW: 0, topK: 0, centerW: 0, moraleStrict: false, useGuile: false });
}
// 只开战术改进（不开 MC / 中区项）：用于把增益归因到具体组件
export function chooseActionsTacticsOnly(g, seat) {
  return chooseActions(g, seat, { mcW: 0, topK: 0, centerW: 0 });
}

export function chooseActions(g, seat, opts) {
  const o = opts ? { ...DEF_OPTS, ...opts } : DEF_OPTS;
  const out = [];
  const usedTactics = new Set();
  for (const lineIdx of playerLines(seat)) {
    const hand = g.hands[seat][lineIdx] || [];
    if (hand.length === 0) {
      out.push({ kind: 'empty', line: lineIdx, leaderZone: bestLeaderZone(g, seat) });
      continue;
    }
    const tp = tacticPlan(g, seat, lineIdx, usedTactics, o);
    if (tp) { usedTactics.add(tp.tacticId); out.push(tp); continue; }

    // ① 贪心枚举全部合法候选并排序
    const cands = [];
    for (let k = 0; k < CELLS_PER_LINE; k++) {
      for (let hi = 0; hi < hand.length; hi++) {
        if (!canPlayTroop(g, seat, lineIdx, k, hi).ok) continue;
        cands.push({ k, hi, s: evalPlay(g, seat, lineIdx, k, hi, o) });
      }
    }
    if (!cands.length) { out.push({ kind: 'skip', line: lineIdx }); continue; }
    cands.sort((a, b) => b.s - a.s);

    // ② 概率搜索：仅当该格「值得算」（对手已有牌，或我方一张即成型）才花采样预算；
    //    判据是边际期望值 ΔEV，而不是绝对期望值。
    const [sA, sB] = lineSeats(lineIdx);
    const oppSeat = seat === sA ? sB : sA;
    let best = cands[0], bestV = -Infinity;
    const baseEV = new Map();      // 每格「不打这张」的基准期望，同格多个候选只算一次
    for (const c of cands.slice(0, o.topK)) {
      const cell = g.lines[lineIdx].cells[c.k];
      const oppLen = (cell.sides[oppSeat] || []).length;
      const myLen = (cell.sides[seat] || []).length + 1;
      const worthIt = oppLen > 0 || myLen >= cellCapacity(cell) - 1;
      let v = c.s * o.staticW;
      if (worthIt) {
        if (!baseEV.has(c.k)) baseEV.set(c.k, cellWinExpectation(g, lineIdx, c.k, seat, null, o.samples));
        const delta = cellWinExpectation(g, lineIdx, c.k, seat, hand[c.hi], o.samples) - baseEV.get(c.k);
        v += delta * o.mcW;
      }
      // 中央区长远价值：这张牌的颜色会把中心行动引向某个区
      if (o.centerW) v += centerSuitValue(g, seat, hand[c.hi].suit) * o.centerW;
      if (v > bestV) { bestV = v; best = c; }
    }
    out.push({
      kind: 'troop',
      line: lineIdx,
      cell: best.k,
      handIdx: best.hi,
      center: centerChoice(g, seat, hand[best.hi].suit),
    });
  }
  return out;
}

// 领袖放置（规则 8.3 / 8.0）：选「有奖励牌 + 我方影响力高 + 能抢下或守住该区第一」的区
function bestLeaderZone(g, seat) {
  let best = g.leaders[seat], bestV = -Infinity;
  for (let z = 0; z < N_ZONES; z++) {
    const delta = g.leaders[seat] === z ? 0 : LEADER_WORTH;
    const v = playerZoneScore(g, g.zones[z], seat) + delta
      + (g.zones[z].tactics ? 1.0 : 0)
      + (g.zoneHolder[z] === seat ? 1.2 : 0)
      + zonePointGain(g, seat, z, delta) * 2;
    if (v > bestV) { bestV = v; best = z; }
  }
  return best;
}

// 兼容旧签名：UI/测试可只取第一个动作
export function chooseAction(g, seat) { return chooseActions(g, seat)[0] || null; }

// v1.7：「无消耗立即打出」策略 —— 仅评估刚获得的那张战术牌；找到有价值的用法即立即打出
//   （零行动消耗，故只要能用就用），否则返回 null（留着之后按普通行动打出）。
// opts.freeRelax：免费打出零行动消耗，接受门槛低于 tacticPlan 的普通行动门槛
//   （附庸倒戈去掉「掉级 ≥ 5」、侦察手牌上限 4 → 6）；v1.8 额度当回合不用即作废，
//   用行动级标准衡量一个零成本机会，等于把白送的额度浪费掉。
export function chooseFreePlay(g, seat, tacticId, opts) {
  // v1.11：freeScout 默认真——零成本打出的评估标准必须与「花一次行动」区分：侦察只要牌堆
  //   非空就净赚（过滤得 1 张 + 隔离 2 张封锁），不设手牌门槛（tacticPlan 侦察分支注释有实测）。
  //   opts.freeScout:false 可关（A/B 对照用）。
  const o = { ...AI_V2_DEFAULT, freeScout: true, ...(opts || {}), onlyTactic: tacticId };
  for (const li of playerLines(seat)) {
    const tp = tacticPlan(g, seat, li, null, o);
    if (tp && tp.tacticId === tacticId) return tp;
  }
  return null;
}

export function explainAction(g, seat, action) {
  if (!action) return '无动作';
  if (action.kind === 'troop') {
    return `战线${action.line + 1} 第${action.cell + 1}格 暗扣部队牌`;
  }
  if (action.kind === 'tactic') {
    return `战线${action.line + 1} 打出战术牌「${TACTIC_BY_ID[action.tacticId]?.name || '?'}」`;
  }
  if (action.kind === 'empty') return `战线${action.line + 1} 手牌为 0，领袖放置`;
  return '无动作';
}
