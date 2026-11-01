// AI 对局模拟测试 —— 8 席全 AI 批量对局
// 运行： node sim.mjs  [局数]
// 校验：不变量（零和 / 手牌上限 / 牌张守恒 / 无非法动作 / 收敛）
//        平衡性（席位无系统性优势）、确定性（同种子可复现）、AI 强度（进阶 vs 随机）
import { createGame, runRound, canPlayTroop, canPlayTactic, finalRanking, cellCapacity } from './src/engine.mjs';
import {
  chooseActions, chooseActionsV1, chooseActionsGreedy, chooseActionsTacticsOnly, AI_V2_DEFAULT, chooseFreePlay,
} from './src/ai.mjs';
import {
  DECK_SIZE, HAND_PER_LINE, N_SEATS, N_LINES, N_ZONES, CELLS_PER_LINE,
  playerLines, lineSeats, TACTIC_BY_ID,
} from './src/rules.mjs';
import { makeRng } from './src/engine.mjs';

const N = Number(process.argv[2] || 200);
const GUARD = 400;

let pass = 0, fail = 0; const failures = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; failures.push(name); console.log('  FAIL  ' + name); }
}

// ---------------- 随机基线策略 ----------------
function randomPolicyFactory(seed) {
  const rng = makeRng(seed);
  return function randomPolicy(g, seat) {
    const out = [];
    for (const lineIdx of playerLines(seat)) {
      const hand = g.hands[seat][lineIdx] || [];
      if (!hand.length) { out.push({ kind: 'empty', line: lineIdx, leaderZone: Math.floor(rng() * N_ZONES) }); continue; }
      const cells = [], hidx = [];
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        for (let hi = 0; hi < hand.length; hi++) if (canPlayTroop(g, seat, lineIdx, k, hi).ok) cells.push([k, hi]);
      }
      if (!cells.length) { out.push({ kind: 'skip', line: lineIdx }); continue; }
      const [k, hi] = cells[Math.floor(rng() * cells.length)];
      out.push({
        kind: 'troop', line: lineIdx, cell: k, handIdx: hi,
        center: rng() < 0.5 ? { type: 'place' } : { type: 'leader', zone: Math.floor(rng() * N_ZONES) },
      });
    }
    return out;
  };
}

const advancedPolicy = (g, seat) => chooseActions(g, seat);

// ---------------- 单局模拟 ----------------
function playOne(seed, policyFor, freeFor = (gg, s, id) => chooseFreePlay(gg, s, id)) {
  const g = createGame(seed);
  const stats = {
    errors: [], zeroSumViolations: 0, handViolations: 0, cardViolations: 0,
    negativeInfluence: 0, tacticsWon: 0, tacticsPlayed: 0, rounds: 0,
    zoneViolations: 0, zoneTakes: 0, zoneChanges: 0, noDomRounds: 0,
    cellOverflow: 0,
  };
  let guard = 0;
  while (!g.over && guard++ < GUARD) {
    const r = runRound(g, (gs, s) => policyFor(s)(gs, s), null, { freePicker: (gg, s, id) => freeFor(gg, s, id) });
    if (r.errors.length) stats.errors.push(...r.errors);
    // 规则 10.1 + 8.6：旗帜部分严格零和（总分 − 中央区占位分 ≡ 0）
    if (g.scores.reduce((a, b, i) => a + b - g.centerScores[i], 0) !== 0) stats.zeroSumViolations++;
    // 中央区占位分只可能来自「各区首次易主」，故总额 ≤ 区数 6
    if (g.centerScores.reduce((a, b) => a + b, 0) > N_ZONES) stats.zoneViolations++;
    if (g.centerScores.some(v => v < -N_ZONES || v > N_ZONES)) stats.zoneViolations++;
    if (g.dominantSuit == null) stats.noDomRounds++;
    for (let s = 0; s < N_SEATS; s++) {
      for (const li of playerLines(s)) if (g.hands[s][li].length > HAND_PER_LINE) stats.handViolations++;
    }
    for (const z of g.zones) for (const v of Object.values(z.influence)) if (v < 0) stats.negativeInfluence++;
    // v1.4：任何格、任何一侧都不得超过该格容量（虚空站位占位保证回滚不超容）
    for (const l of g.lines) for (const c of l.cells) {
      const cap = cellCapacity(c);
      for (const cs of Object.values(c.sides)) if (cs.length > cap) stats.cellOverflow++;
    }
    // 牌张守恒（战术牌不计入 60×8 牌堆体系；v1.2 被计谋牌压住的部队牌隔离在 guileHold，亦计入）
    const total = g.lines.reduce((a, l) => a + l.deck.length + l.discard.length
      + l.cells.reduce((x, c) => x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => !cd.tactic).length, 0), 0), 0)
      + Object.values(g.hands).reduce((a, h) => a + Object.values(h).reduce((x, c) => x + c.filter(cd => !cd.tactic).length, 0), 0)
      + (g.guileHold ? g.guileHold.length : 0);
    if (total !== DECK_SIZE * N_LINES) stats.cardViolations++;
  }
  stats.rounds = g.round;
  stats.over = g.over;
  stats.endReason = g.endReason;
  stats.tacticsWon = g.tacticsPlayed.reduce((a, row) => a + row.reduce((x, n) => x + n, 0), 0);
  stats.tacticsHeld = g.playerTactics.reduce((a, t) => a + t.length, 0);
  stats.scores = g.scores.slice();
  stats.captures = g.captures.slice();
  stats.centerScores = g.centerScores.slice();
  stats.zoneHolds = g.zoneHolds.slice();
  stats.zoneTakes = g.zoneHolds.reduce((a, b) => a + b, 0);         // 易主（含首次）总次数
  stats.zoneFirstTakes = g.centerScores.reduce((a, b) => a + b, 0); // 净增 = 首次易主次数
  stats.roundsPlayed = g.round;
  return { g, stats };
}

// ═════════════ 1. 全进阶 AI 对局 ═════════════
console.log(`\n【1】全进阶 AI 对局 × ${N} 局`);
{
  const wins = Array(N_SEATS).fill(0);
  const scoreSum = Array(N_SEATS).fill(0);
  const capSum = Array(N_SEATS).fill(0);
  const centerScoreSum = Array(N_SEATS).fill(0);
  let totalErrors = 0, zeroSum = 0, hand = 0, card = 0, negInfl = 0, notOver = 0, zone = 0, overflow = 0;
  const endReasons = {}, roundList = [], captureList = [];
  const errSamples = [];
  let zoneTakes = 0, zoneFirst = 0, centerSum = 0;

  for (let i = 0; i < N; i++) {
    const { g, stats } = playOne(1000 + i * 7919, () => advancedPolicy);
    totalErrors += stats.errors.length;
    if (stats.errors.length && errSamples.length < 3) errSamples.push(stats.errors.slice(0, 2).join(' | '));
    zeroSum += stats.zeroSumViolations; hand += stats.handViolations;
    card += stats.cardViolations; negInfl += stats.negativeInfluence; zone += stats.zoneViolations;
    overflow += stats.cellOverflow;
    if (!stats.over) notOver++;
    zoneTakes += stats.zoneTakes; zoneFirst += stats.zoneFirstTakes;
    centerSum += stats.centerScores.reduce((a, b) => a + b, 0);
    endReasons[stats.endReason || 'timeout'] = (endReasons[stats.endReason || 'timeout'] || 0) + 1;
    roundList.push(stats.roundsPlayed);
    captureList.push(g.captures.reduce((a, b) => a + b, 0));
    for (let s = 0; s < N_SEATS; s++) {
      scoreSum[s] += g.scores[s]; capSum[s] += g.captures[s];
      centerScoreSum[s] += g.centerScores[s];
    }
    // 冠军：并列时都记 0.5
    const rank = finalRanking(g);
    const top = rank[0].score;
    const champs = rank.filter(r => r.score === top).map(r => r.seat);
    for (const c of champs) wins[c] += 1 / champs.length;
  }

  ok(totalErrors === 0, `${N} 局全程无非法动作（实际 ${totalErrors} 次）` + (errSamples.length ? `\n      样本：${errSamples.join(' ; ')}` : ''));
  ok(zeroSum === 0, `每回合旗帜分恒为 0（总分 − 中央区占位分，违反 ${zeroSum} 次）`);
  ok(hand === 0, `手牌始终 ≤ ${HAND_PER_LINE} 张（违反 ${hand} 次）`);
  ok(card === 0, `牌张守恒 = ${DECK_SIZE * N_LINES}（违反 ${card} 次）`);
  ok(negInfl === 0, `影响力标记非负（违反 ${negInfl} 次）`);
  ok(zone === 0, `中央区占位分守恒（违反 ${zone} 次）`);
  ok(overflow === 0, `任一格任一侧 ≤ 容量（违反 ${overflow} 次）`);
  ok(notOver === 0, `全部 ${N} 局在 ${GUARD} 回合内收敛（未收敛 ${notOver} 局）`);

  const avgRounds = roundList.reduce((a, b) => a + b, 0) / N;
  const avgCap = captureList.reduce((a, b) => a + b, 0) / N;
  const avgScore = scoreSum.map(v => v / N);
  console.log(`  · 平均 ${avgRounds.toFixed(1)} 回合（最短 ${Math.min(...roundList)} / 最长 ${Math.max(...roundList)}）`);
  console.log(`  · 平均夺旗 ${avgCap.toFixed(1)} 次/局`);
  console.log(`  · 终局原因：${JSON.stringify(endReasons)}`);
  const avgCenter = centerScoreSum.map(v => v / N);
  const avgFlag = scoreSum.map((v, i) => (v - centerScoreSum[i]) / N);
  console.log(`  · 各席平均总分：[${avgScore.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  ·   其中中央区占位分：[${avgCenter.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  ·   其中旗帜分（零和）：[${avgFlag.map(v => v.toFixed(2)).join(', ')}]`);
  console.log(`  · 中央区易主 ${zoneTakes} 次（均值 ${(zoneTakes / N).toFixed(1)}/局），首次易主净增分合计 ${zoneFirst}`);
  console.log(`  · 各席夺冠次数：[${wins.map(v => v.toFixed(1)).join(', ')}]  (期望 ${(N / N_SEATS).toFixed(1)})`);

  ok(zoneTakes > 0, `中央区占位计分机制确实生效（${zoneTakes} 次易主）`);
  ok(zoneFirst <= N_ZONES * N, `中央区净增分不超过「每局 6 区首次易主」上限（${zoneFirst} ≤ ${N_ZONES * N}）`);

  // 平衡性：旗帜分（零和部分）各席均值应接近 0，夺冠次数应接近 N/8
  const maxAbsScore = Math.max(...avgFlag.map(Math.abs));
  ok(maxAbsScore < 1.5, `席位旗帜分无系统性偏斜（最大 |均值| = ${maxAbsScore.toFixed(2)} < 1.5）`);
  const expected = N / N_SEATS;
  const maxWinDev = Math.max(...wins.map(w => Math.abs(w - expected))) / expected;
  ok(maxWinDev < 0.6, `夺冠次数分布均衡（最大偏差 ${(maxWinDev * 100).toFixed(0)}% < 60%）`);
}

// ═════════════ 2. 确定性（同种子可复现）═════════════
console.log(`\n【2】确定性复现`);
{
  const a = playOne(424242, () => advancedPolicy);
  const b = playOne(424242, () => advancedPolicy);
  ok(JSON.stringify(a.stats.scores) === JSON.stringify(b.stats.scores), '同一种子两局得分序列完全一致');
  ok(a.stats.roundsPlayed === b.stats.roundsPlayed, '同一种子回合数一致');
  console.log(`  · seed 424242 → ${a.stats.roundsPlayed} 回合，得分 [${a.stats.scores.join(', ')}]`);
}

// ═════════════ 3. AI 强度：进阶 vs 随机基线 ═════════════
console.log(`\n【3】进阶 AI vs 随机基线（同局混合，偶数席=进阶 / 奇数席=随机）× ${Math.min(N, 100)} 局`);
{
  const M = Math.min(N, 100);
  let advSum = 0, rndSum = 0, advWins = 0, rndWins = 0;
  for (let i = 0; i < M; i++) {
    const policies = [];
    for (let s = 0; s < N_SEATS; s++) {
      policies.push(s % 2 === 0 ? advancedPolicy : randomPolicyFactory(9000 + i * 31 + s));
    }
    const { g } = playOne(5000 + i * 104729, s => policies[s],
      (gg, s, id) => (s % 2 === 0 ? chooseFreePlay(gg, s, id) : null));   // 免费打出仅归进阶席
    for (let s = 0; s < N_SEATS; s++) {
      if (s % 2 === 0) advSum += g.scores[s]; else rndSum += g.scores[s];
    }
    const rank = finalRanking(g);
    const top = rank[0].score;
    const champs = rank.filter(r => r.score === top);
    for (const c of champs) {
      if (c.seat % 2 === 0) advWins += 1 / champs.length; else rndWins += 1 / champs.length;
    }
  }
  const advAvg = advSum / (M * 4), rndAvg = rndSum / (M * 4);
  console.log(`  · 进阶 AI 平均得分 ${advAvg.toFixed(3)} / 随机基线 ${rndAvg.toFixed(3)}`);
  console.log(`  · 夺冠次数：进阶 ${advWins.toFixed(1)} vs 随机 ${rndWins.toFixed(1)}（各 ${M} 局、各占 4 席）`);
  ok(advAvg > rndAvg, `进阶 AI 平均每席得分高于随机基线（${advAvg.toFixed(3)} > ${rndAvg.toFixed(3)}）`);
  ok(advWins > rndWins, `进阶 AI 夺冠次数多于随机基线（${advWins.toFixed(1)} > ${rndWins.toFixed(1)}）`);
}

// ═════════════ 4. 战术牌与中心区流转 ═════════════
console.log(`\n【4】战术牌与中心区流转（30 局）`);
{
  let won = 0, played = 0, onBoard = 0, held = 0, consViol = 0, noDomRounds = 0, roundsAll = 0;
  const domDist = Array(N_ZONES).fill(0); let noDom = 0;
  for (let i = 0; i < 30; i++) {
    const { g, stats } = playOne(777 + i * 6161, () => advancedPolicy);
    noDomRounds += stats.noDomRounds; roundsAll += stats.roundsPlayed;
    won += g.tacticsWonCount;
    played += stats.tacticsWon;                       // 打出（离场）次数
    held += stats.tacticsHeld;
    const board = g.zones.filter(z => z.tactics).length;
    // 已打出但仍附着在旗幟旁的士气牌 / 环境牌（尚未随夺旗结算离场）
    const inCells = g.lines.reduce((a, l) => a + l.cells.reduce((x, c) =>
      x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => cd.tactic).length, 0)
        + Object.keys(c.env || {}).length, 0), 0);
    onBoard += board;
    // 战术牌守恒：场上 6 张既不会凭空增加也不会丢失（规则 11.4 循环回收 + v1.2 落场）
    if (board + stats.tacticsHeld + inCells + g.guileBoard.length + g.pendingRecycle.length !== 6) consViol++;
    if (g.dominantSuit == null) noDom++; else domDist[g.dominantSuit]++;
  }
  console.log(`  · 战术牌被夺取 ${won} 次（均值 ${(won / 30).toFixed(1)}/局，上限 6）`);
  console.log(`  · 战术牌被打出 ${played} 次（均值 ${(played / 30).toFixed(1)}/局）`);
  console.log(`  · 终局时：场上待夺 ${onBoard} + 玩家持有 ${held} = ${onBoard + held}（守恒期望 180 = 6×30）`);
  console.log(`  · 终局主导花色分布 [${domDist.join(', ')}]，终局无主导花色 ${noDom} 局`);
  console.log(`  · 全程 ${roundsAll} 个回合中，${noDomRounds} 个回合无主导花色（并列 / 全场零影响力，占 ${(noDomRounds / roundsAll * 100).toFixed(0)}%）`);
  ok(won > 0, '战术牌在对局中确实被夺取（规则 8.5 非死代码）');
  ok(played > 0, '战术牌确实被打出并生效（规则 11 非死代码）');
  ok(consViol === 0, `战术牌守恒：场上 + 持有恒为 6（违反 ${consViol} 局）`);
  ok(domDist.reduce((a, b) => a + b, 0) + noDom === 30, '主导花色统计自洽');
  ok(noDomRounds > 0, `「并列 / 零影响力 → 无主导花色」确实发生（${noDomRounds} 个回合）`);
}

// ═════════════ 5. 战术牌压力测试（强制高频打出）═════════════
// 常态 AI 每局只打出约 0.7 张战术牌，覆盖不足。这里用「激进用牌策略」
// 把每条战线的暗扣尽量替换成战术牌，验证 10 张牌在真实流程中的效果与不变量。
console.log(`\n【5】战术牌压力测试（激进用牌）× 60 局`);
{
  const TAC = TACTIC_BY_ID;
  // 为一张计谋牌构造合法参数（找不到就返回 null）
  function guileAction(g, seat, li, id) {
    const line = g.lines[li];
    const [sA, sB] = lineSeats(li);
    const opp = seat === sA ? sB : sA;
    if (id === 'scout') return { kind: 'tactic', line: li, tacticId: id, returnIdxs: null };
    if (id === 'mutiny') {
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const c = line.cells[k];
        if (!c.decided && (c.sides[opp] || []).length) return { kind: 'tactic', line: li, tacticId: id, targetCell: k, cardIdx: 0 };
      }
      return null;
    }
    if (id === 'shift') {
      let from = -1;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const c = line.cells[k];
        if (!c.decided && (c.sides[seat] || []).length) { from = k; break; }
      }
      if (from < 0) return null;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        if (k === from) continue;
        const c = line.cells[k];
        if (!c.decided && !(c.sides[seat] || []).length) {
          return { kind: 'tactic', line: li, tacticId: id, fromCell: from, cardIdx: 0, toCell: k };
        }
      }
      return { kind: 'tactic', line: li, tacticId: id, fromCell: from, cardIdx: 0 };   // 无空位 → 弃掉
    }
    if (id === 'defect') {
      let tgt = -1, idx = -1;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const cs = line.cells[k].sides[opp] || [];
        const j = cs.findIndex(c => !c.tactic);
        if (j >= 0 && !line.cells[k].decided) { tgt = k; idx = j; break; }
      }
      if (tgt < 0) return null;
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const c = line.cells[k];
        if (!c.decided && !(c.sides[seat] || []).length) {
          return { kind: 'tactic', line: li, tacticId: id, targetCell: tgt, cardIdx: idx, toCell: k };
        }
      }
      return null;
    }
    return null;
  }

  function aggressivePolicy(g, seat) {
    const acts = chooseActions(g, seat);
    // 常态 AI 自己规划的战术牌也要计入去重，否则两条战线会选中同一张
    const used = new Set(acts.filter(a => a && a.kind === 'tactic').map(a => a.tacticId));
    return acts.map(a => {
      if (!a || a.kind !== 'troop') return a;
      for (const id of (g.playerTactics[seat] || [])) {
        if (used.has(id)) continue;
        const t = TAC[id];
        if (!t) continue;
        if (!canPlayTactic(g, seat, a.line, id, undefined).ok) continue;
        if (t.cat === 'guile') {
          const act = guileAction(g, seat, a.line, id);
          if (act) { used.add(id); return act; }
        } else {
          for (let k = 0; k < CELLS_PER_LINE; k++) {
            if (canPlayTactic(g, seat, a.line, id, k).ok) {
              used.add(id);
              return { kind: 'tactic', line: a.line, tacticId: id, cell: k };
            }
          }
        }
      }
      return a;
    });
  }

  const M = 60;
  let errs = 0, zero = 0, card = 0, handV = 0, zoneV = 0, consV = 0, notOver = 0, overflowV = 0;
  let played = 0, rounds = 0;
  const errSamples = [];
  for (let i = 0; i < M; i++) {
    const { g, stats } = playOne(31337 + i * 7717, () => aggressivePolicy);
    errs += stats.errors.length;
    if (stats.errors.length && errSamples.length < 3) errSamples.push(stats.errors.slice(0, 2).join(' | '));
    zero += stats.zeroSumViolations; card += stats.cardViolations;
    handV += stats.handViolations; zoneV += stats.zoneViolations;
    overflowV += stats.cellOverflow;
    if (!stats.over) notOver++;
    played += stats.tacticsWon; rounds += stats.roundsPlayed;
    // 战术牌守恒：场上待夺 + 玩家持有 + 附着在格上的 = 6
    const inCells = g.lines.reduce((a, l) => a + l.cells.reduce((x, c) =>
      x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => cd.tactic).length, 0)
        + Object.keys(c.env || {}).length, 0), 0);
    // v1.2：落场计谋牌（guileBoard）与暂存回流队列也计入守恒
    if (g.zones.filter(z => z.tactics).length + stats.tacticsHeld + inCells
      + g.guileBoard.length + g.pendingRecycle.length !== 6) consV++;
  }
  console.log(`  · 战术牌打出 ${played} 次（均值 ${(played / M).toFixed(1)}/局，常态策略约 0.7）`);
  console.log(`  · 平均 ${(rounds / M).toFixed(1)} 回合/局`);
  console.log(`  · 不变量：旗帜零和违反 ${zero}、牌张守恒违反 ${card}、手牌违反 ${handV}、中区违反 ${zoneV}、战术牌守恒违反 ${consV}`);
  ok(errs === 0, `激进用牌下无非法动作（实际 ${errs} 次）` + (errSamples.length ? `\n      样本：${errSamples.join(' ; ')}` : ''));
  ok(zero === 0, '激进用牌下旗帜分仍严格零和');
  ok(card === 0, '激进用牌下 480 张部队牌守恒');
  ok(handV === 0, '激进用牌下手牌不超过 7 张');
  ok(zoneV === 0, '激进用牌下中央区占位分守恒');
  ok(consV === 0, `激进用牌下 6 张战术牌守恒（违反 ${consV} 局）`);
  ok(overflowV === 0, `激进用牌下任一格任一侧 ≤ 容量（违反 ${overflowV} 次）`);
  ok(notOver === 0, `全部 ${M} 局收敛（未收敛 ${notOver}）`);
  ok(played / M > 3, `战术牌被高频打出（${(played / M).toFixed(1)} 次/局 > 3），机制非死代码`);
}

// ═════════════ 6. AI 强度：配对差分法 + 组件归因 ═════════════
// 方法（经三轮方法学修正后确定）：
//   对每个 (种子, 席位) 跑两局 —— 实验局该席用 X、对照局全席用 Y（含该席）。
//   两局共享同一副发牌，唯一差别是「该席用 X 还是 Y」→ 配对差分，方差远小于独立对照；
//   自检（X === Y）时差值恒为 0，可直接验证测量无偏。
//   早期用过并已废弃的两种设计：① 4v4 偶/奇席分组（同策略也会显示 ±1.4 分/席假差异）；
//   ② 1v7 但每局换种子（席位与种子混淆，自检也能偏到 +0.79）。
console.log(`\n【6】AI 强度：配对差分 × ${Math.min(N, 40)} 种子 × 8 席`);
{
  function mkRun(seed, expSeat, expFn, baseFn) {
    const g = createGame(seed);
    let guard = 0;
    while (!g.over && guard++ < GUARD) {
      runRound(g, (gs, s) => (s === expSeat ? expFn : baseFn)(gs, s));
    }
    let best = -Infinity;
    for (let s = 0; s < N_SEATS; s++) best = Math.max(best, g.scores[s]);
    return { scores: g.scores.slice(), best };
  }
  function paired(M, xFn, yFn) {
    let sum = 0, n = 0, wx = 0, wy = 0;
    for (let k = 0; k < M; k++) {
      const seed = 61000 + k * 7919;
      for (let s = 0; s < N_SEATS; s++) {
        const r1 = mkRun(seed, s, xFn, yFn);
        const r2 = mkRun(seed, s, yFn, yFn);
        sum += r1.scores[s] - r2.scores[s];
        n++;
        if (r1.scores[s] === r1.best) wx++;
        if (r2.scores[s] === r2.best) wy++;
      }
    }
    return { d: sum / n, wrX: wx / n, wrY: wy / n, n };
  }
  const M = Math.max(12, Math.min(N, 40));
  const greedy = (gs, s) => chooseActionsGreedy(gs, s);
  const rows = [
    ['自检（贪心 vs 贪心）', greedy, greedy],
    ['① 战术牌改进', (gs, s) => chooseActionsTacticsOnly(gs, s), greedy],
    ['② + 概率搜索', (gs, s) => chooseActions(gs, s, { centerW: 0 }), greedy],
    ['③ 全量 v2（+中区长视）', advancedPolicy, greedy],
  ];
  let selfD = null, fullD = null;
  for (const [label, x, y] of rows) {
    const r = paired(M, x, y);
    console.log(`  · ${label.padEnd(22)} Δ ${r.d >= 0 ? '+' : ''}${r.d.toFixed(3)} 分/席   夺冠率 ${(r.wrX * 100).toFixed(1)}%（基线 ${(r.wrY * 100).toFixed(1)}%）`);
    if (label.includes('自检')) selfD = r.d;
    if (label.includes('全量')) fullD = r;
  }
  console.log(`  · 样本：${M} 种子 × 8 席 = ${M * 8} 对（每对 2 局，共 ${M * 16} 局）`);
  console.log(`  · v2 参数：${JSON.stringify(AI_V2_DEFAULT)}`);
  ok(Math.abs(selfD) < 1e-9, `配对法自检恒为 0（实际 ${selfD}）`);
  ok(fullD.d > 0.3, `全量 v2 相对纯贪心基线有显著正增益（+${fullD.d.toFixed(3)} 分/席）`);
  ok(fullD.wrX > fullD.wrY, `v2 夺冠率高于基线（${(fullD.wrX * 100).toFixed(1)}% > ${(fullD.wrY * 100).toFixed(1)}%）`);
}

console.log(`\n=== 模拟测试结果： ${pass} PASS / ${fail} FAIL ===`);
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
