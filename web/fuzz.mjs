// 模糊测试：① 畸形 API 输入不应抛异常；② 完全随机（含乱来）动作的整局不应破坏不变量
import {
  createGame, applyAction, applyCenterAction, canPlayTroop, canPlayTactic,
  checkCapture, resolveCapture, checkTacticsWin, checkZoneScore, checkAllTacticsWins,
  refill, endRound, collectRound, revealLine, finishRound, runRound,
  locateTactic, recycleTactic, centerOptions, zoneLeaderOf, playerZoneScore,
  makeRng, cellCapacity,
} from './src/engine.mjs';
import { DECK_SIZE, N_LINES, N_SEATS, N_ZONES, CELLS_PER_LINE, HAND_PER_LINE, playerLines, TACTICS } from './src/rules.mjs';

let pass = 0, fail = 0;
const problems = [];
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; problems.push(name); console.log('  FAIL  ' + name); }
}

// ───────── ① 畸形 API 输入 ─────────
console.log('① 畸形 API 输入模糊测试（3000 次随机调用）');
{
  const rng = makeRng(20261007);
  const g = createGame(777);
  const bad = [-1, 99, NaN, undefined, null, 'x', 1.5, Infinity, {}, []];
  let threw = 0;
  const calls = [
    () => applyAction(g, bad[Math.floor(rng() * bad.length)], null),
    () => applyAction(g, 0, { kind: 'troop', line: bad[Math.floor(rng() * bad.length)], cell: bad[Math.floor(rng() * bad.length)], handIdx: bad[Math.floor(rng() * bad.length)] }),
    () => applyAction(g, 0, { kind: 'tactic', line: 0, tacticId: Math.random() < 0.5 ? '不存在' : TACTICS[Math.floor(rng() * 10)].id, cell: 0 }),
    () => applyAction(g, 0, { kind: 'empty', line: bad[Math.floor(rng() * bad.length)], leaderZone: bad[Math.floor(rng() * bad.length)] }),
    () => canPlayTroop(g, 0, bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)]),
    () => canPlayTactic(g, 0, bad[Math.floor(rng() * bad.length)], 'god1', bad[Math.floor(rng() * bad.length)]),
    () => checkCapture(g, bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)]),
    () => resolveCapture(g, bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)]),
    () => checkTacticsWin(g, bad[Math.floor(rng() * bad.length)]),
    () => checkZoneScore(g, bad[Math.floor(rng() * bad.length)]),
    () => zoneLeaderOf(g, bad[Math.floor(rng() * bad.length)]),
    () => locateTactic(g, Math.random() < 0.5 ? '不存在' : null),
    () => recycleTactic(g, '不存在'),
    () => refill(g, bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)]),
    () => centerOptions(g, bad[Math.floor(rng() * bad.length)], bad[Math.floor(rng() * bad.length)]),
    () => applyCenterAction(g, 0, bad[Math.floor(rng() * bad.length)], { type: 'leader', zone: bad[Math.floor(rng() * bad.length)] }),
    () => applyCenterAction(g, 0, 0, { type: '乱来' }),
  ];
  for (let i = 0; i < 3000; i++) {
    try { calls[Math.floor(rng() * calls.length)](); } catch (e) { threw++; if (threw <= 3) console.log('    抛出：', e.message); }
  }
  ok(threw === 0, `畸形输入 0 次异常（实际 ${threw} 次）`);
}

// ───────── ② 完全随机乱来的整局 ─────────
console.log('② 随机乱来的整局 × 40（含战术牌、skip、无脑暗扣）');
{
  let invViol = 0, nanViol = 0, negInfl = 0, notOver = 0, thrown = 0, cardViol = 0, overViol = 0;
  for (let seed = 1; seed <= 40; seed++) {
    try {
      const g = createGame(seed * 977);
      const rng = makeRng(seed * 31 + 7);
      let guard = 0;
      while (!g.over && guard++ < 400) {
        const r = runRound(g, (gs, s) => {
          const acts = [];
          for (const li of playerLines(s)) {
            const hand = (gs.hands[s] && gs.hands[s][li]) || [];
            const roll = rng();
            if (roll < 0.1 && (gs.playerTactics[s] || []).length) {
              const id = gs.playerTactics[s][Math.floor(rng() * gs.playerTactics[s].length)];
              acts.push({ kind: 'tactic', line: li, tacticId: id, cell: Math.floor(rng() * CELLS_PER_LINE), returnIdxs: null, targetCell: Math.floor(rng() * CELLS_PER_LINE), cardIdx: 0, fromCell: 0, toCell: 1 });
            } else if (roll < 0.15) {
              acts.push({ kind: 'skip', line: li });
            } else if (!hand.length) {
              acts.push({ kind: 'empty', line: li, leaderZone: Math.floor(rng() * N_ZONES) });
            } else {
              acts.push({
                kind: 'troop', line: li,
                cell: Math.floor(rng() * CELLS_PER_LINE),
                handIdx: Math.floor(rng() * hand.length),
                center: rng() < 0.5 ? { type: 'place' } : { type: 'leader', zone: Math.floor(rng() * N_ZONES) },
              });
            }
          }
          return acts;
        });
        if (r.errors && r.errors.length) { /* 随机策略允许出现非法动作，引擎应拒绝而非崩溃 */ }
        const flagSum = g.scores.reduce((a, b, i) => a + b - g.centerScores[i], 0);
        if (flagSum !== 0) invViol++;
        if (g.scores.some(v => !Number.isFinite(v)) || g.centerScores.some(v => !Number.isFinite(v))) nanViol++;
        for (const z of g.zones) for (const v of Object.values(z.influence)) if (v < 0) negInfl++;
        const total = g.lines.reduce((a, l) => a + l.deck.length + l.discard.length
          + l.cells.reduce((x, c) => x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => !cd.tactic).length, 0), 0), 0)
          + Object.values(g.hands).reduce((a, h) => a + Object.values(h).reduce((x, c) => x + c.filter(cd => !cd.tactic).length, 0), 0)
          + (g.guileHold ? g.guileHold.length : 0);
        if (total !== DECK_SIZE * N_LINES) cardViol++;
        for (let s = 0; s < N_SEATS; s++) for (const li of playerLines(s)) {
          if (g.hands[s][li].length > HAND_PER_LINE) invViol++;
        }
        // v1.4：任何格、任何一侧都不得超过该格容量（虚空站位占位保证回滚不超容）
        for (const l of g.lines) for (const c of l.cells) {
          const cap = cellCapacity(c);
          for (const cs of Object.values(c.sides)) if (cs.length > cap) overViol++;
        }
      }
      if (!g.over) notOver++;
    } catch (e) {
      thrown++;
      if (thrown <= 3) console.log('    抛出：', e.message);
    }
  }
  ok(thrown === 0, `随机乱来不崩溃（异常 ${thrown} 局）`);
  ok(invViol === 0, `旗帜分恒零和 & 手牌不超限（违反 ${invViol} 次）`);
  ok(nanViol === 0, `分数无 NaN（违反 ${nanViol} 次）`);
  ok(negInfl === 0, `影响力非负（违反 ${negInfl} 次）`);
  ok(cardViol === 0, `480 张部队牌守恒（违反 ${cardViol} 次）`);
  ok(overViol === 0, `任一格任一侧 ≤ 容量（违反 ${overViol} 次）`);
  ok(notOver === 0, `随机乱来也能收敛（未收敛 ${notOver} 局）`);
}

// ───────── ③ 战术牌守恒（随机乱来下）─────────
console.log('③ 战术牌守恒（随机乱来 × 40）');
{
  let viol = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = createGame(seed * 977);
    const rng = makeRng(seed * 31 + 7);
    let guard = 0;
    while (!g.over && guard++ < 400) {
      runRound(g, (gs, s) => playerLines(s).map(li => {
        const hand = (gs.hands[s] && gs.hands[s][li]) || [];
        if (!hand.length) return { kind: 'empty', line: li, leaderZone: Math.floor(rng() * N_ZONES) };
        return { kind: 'troop', line: li, cell: Math.floor(rng() * CELLS_PER_LINE), handIdx: Math.floor(rng() * hand.length), center: { type: 'place' } };
      }));
      let n = g.zones.filter(z => z.tactics).length + g.pendingRecycle.length;
      for (let s = 0; s < N_SEATS; s++) n += g.playerTactics[s].length;
      for (const l of g.lines) for (const c of l.cells) {
        n += Object.values(c.sides).reduce((a, cs) => a + cs.filter(x => x.tactic).length, 0);
        n += Object.keys(c.env || {}).length;
      }
      if (n !== 6) viol++;
    }
  }
  ok(viol === 0, `6 张战术牌在任何时刻都守恒（违反 ${viol} 次）`);
}

console.log(`\n=== 模糊测试结果： ${pass} PASS / ${fail} FAIL ===`);
if (fail) { console.log('失败项：'); problems.forEach(p => console.log('  - ' + p)); }
