// 牌型判定与比较 —— 严格对齐 rules.html 5.1 / 5.2 / 9 / 11.2
import { FORM, TACTIC_BY_ID, SUITS } from './rules.mjs';

const ALL_SUITS = SUITS.map(s => s.id);
const ALL_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// 万能牌组合爆炸保护（同格最多 3~4 张，极端情况回退贪心）
const MAX_COMBOS = 20000;

export function isTacticCard(card) {
  return !!card && card.tactic != null;
}

// 某张牌的候选（花色, 点数）取值域。普通部队牌只有唯一取值。
export function cardOptions(card) {
  if (!isTacticCard(card)) return [{ suit: card.suit, rank: card.rank }];
  const t = TACTIC_BY_ID[card.tactic];
  if (!t || !t.wild) return [{ suit: card.suit ?? 0, rank: card.rank ?? 0 }];
  const suits = t.wild.suits || ALL_SUITS;
  const ranks = t.wild.ranks || ALL_RANKS;
  const out = [];
  for (const s of suits) for (const r of ranks) out.push({ suit: s, rank: r });
  return out;
}

// 枚举一叠牌（含万能牌）所有具体化组合
export function expandCards(cards) {
  let combos = [[]];
  for (const c of cards) {
    const opts = cardOptions(c);
    const next = [];
    for (const combo of combos) {
      if (next.length >= MAX_COMBOS) break;
      for (const o of opts) next.push(combo.concat([o]));
    }
    combos = next;
    if (combos.length >= MAX_COMBOS) break;
  }
  return combos;
}

// 判定 n 张牌的阵型等级（规则 5.1；n=4 用于「多瑙河春汛」）
// 同花顺(5) > 方阵(4) > 同花(3) > 顺子(2) > 杂军(1)
export function formationLevel(cards) {
  if (!cards || cards.length === 0) return 0;
  const n = cards.length;
  // 阵型需至少 3 张（规则 5.1）。不足 3 张时「同花 / 连续」会空真成立，
  // 会把 1~2 张误判为同花顺（等级 5，最强）——故 n<3 一律视为未成阵（杂军）。
  if (n < 3) return FORM.SCRAP;
  const suits = cards.map(c => c.suit);
  const ranks = cards.map(c => c.rank).slice().sort((a, b) => a - b);
  const sameSuit = suits.every(s => s === suits[0]);
  let consecutive = true;
  for (let i = 1; i < n; i++) if (ranks[i] !== ranks[i - 1] + 1) { consecutive = false; break; }
  const sameRank = n >= 2 && ranks.every(r => r === ranks[0]);

  if (sameSuit && consecutive) return FORM.STRAIGHT_FLUSH; // 同花顺
  if (sameRank) return FORM.THREE_KIND;                    // 方阵
  if (sameSuit) return FORM.FLUSH;                         // 同花
  if (consecutive) return FORM.STRAIGHT;                   // 顺子
  return FORM.SCRAP;                                       // 杂军
}

export function pointSum(cards) {
  return cards.reduce((s, c) => s + (c.rank || 0), 0);
}

// 主导花色张数（三级优先度的第 2 级，规则 5.2）
export function dominantCount(cards, dominantSuit) {
  if (dominantSuit == null) return 0;
  return cards.filter(c => c.suit === dominantSuit).length;
}

// 阵型的比较向量：牌型等级 > 主导花色张数 > 点数和
export function formationValue(cards, dominantSuit) {
  return {
    level: formationLevel(cards),
    dom: dominantCount(cards, dominantSuit),
    pts: pointSum(cards),
  };
}

// 万能牌取最优：按 ①等级 ②主导花色张数 ③点数和 字典序最大化
export function bestFormation(cards, dominantSuit) {
  if (cards.every(c => !isTacticCard(c))) return formationValue(cards, dominantSuit);
  let best = null;
  for (const combo of expandCards(cards)) {
    const v = formationValue(combo, dominantSuit);
    if (!best || v.level > best.level ||
      (v.level === best.level && v.dom > best.dom) ||
      (v.level === best.level && v.dom === best.dom && v.pts > best.pts)) {
      best = v;
    }
  }
  return best || formationValue(cards, dominantSuit);
}

// 万能牌取最大点数和（用于「西普里安瘟疫」只比点数）
export function maxPointSum(cards) {
  if (cards.every(c => !isTacticCard(c))) return pointSum(cards);
  let best = 0;
  for (const combo of expandCards(cards)) {
    const s = pointSum(combo);
    if (s > best) best = s;
  }
  return best;
}

// 比较两个阵型。返回 >0 表示 a 胜，<0 表示 b 胜，0 表示平手
// 规则 5.2：① 牌型等级 ② 主导花色张数 ③ 点数和
// 万能牌各自取对自己最有利的取值（规则 11.2：结算时才确定）
export function compareForm(aCards, bCards, dominantSuit) {
  const A = bestFormation(aCards, dominantSuit);
  const B = bestFormation(bCards, dominantSuit);
  if (A.level !== B.level) return A.level > B.level ? 1 : -1;
  if (A.dom !== B.dom) return A.dom > B.dom ? 1 : -1;
  if (A.pts !== B.pts) return A.pts > B.pts ? 1 : -1;
  return 0; // 平手 → 由调用方按「后结算方判负」裁决
}

// 环境牌「西普里安瘟疫」：忽略牌型，仅比点数和（规则 11.2）
export function comparePointsOnly(aCards, bCards) {
  const A = maxPointSum(aCards), B = maxPointSum(bCards);
  if (A !== B) return A > B ? 1 : -1;
  return 0;
}

// 格中某玩家的牌
export function playerCardsAt(cell, seat) {
  return (cell.sides && cell.sides[seat]) || [];
}
