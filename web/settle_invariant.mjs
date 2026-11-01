// 结算不变量模糊测试 —— 三世纪：罗马的黄昏
// 目标：用真实 AI（chooseActions / chooseFreePlay）跑大量整局，每回合末校验结算相关的强不变量。
import {
  createGame, runRound, finalRanking, flagTotal, zoneHoldCount,
} from './src/engine.mjs';
import { chooseActions, chooseFreePlay } from './src/ai.mjs';
import { N_SEATS, N_ZONES, WIN_FLAGS } from './src/rules.mjs';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); console.log('  FAIL  ' + name); } }

// 每回合末校验的不变量
function checkInv(g, ctx) {
  const problems = [];

  // I1: 总分之和 == 中央区分之和 == 被计分过的中央区数
  const sumScore = g.scores.reduce((a, b) => a + b, 0);
  const sumCenter = g.centerScores.reduce((a, b) => a + b, 0);
  const zoneCount = g.zoneHolder.filter(z => z != null).length;
  if (sumScore !== sumCenter) problems.push(`总分和(${sumScore})≠中央区和(${sumCenter}) round=${g.round}`);
  if (sumScore !== zoneCount) problems.push(`总分和(${sumScore})≠已计分中央区数(${zoneCount}) round=${g.round}`);
  if (sumCenter !== zoneCount) problems.push(`中央区和≠已计分中央区数 round=${g.round}`);

  // I2: 每个席 score == (夺旗净胜) + centerScore；夺旗净胜 = captures[seat] - losses[seat]
  // 间接校验：sum(captures) 应等于"发生过夺旗的格数"（每夺旗唯一 winner）
  const capSum = g.captures.reduce((a, b) => a + b, 0);
  // 数一数真正封存的格（每格至多一次夺旗）→ 应 == capSum
  let sealedCount = 0;
  for (const l of g.lines) for (const c of l.cells) if (c.sealed) sealedCount++;
  if (capSum !== sealedCount) problems.push(`captures 总和(${capSum})≠封存格数(${sealedCount}) round=${g.round}`);

  // I3: zoneHolds(累计) >= zoneHoldCount(当前) 每席
  for (let s = 0; s < N_SEATS; s++) {
    if (g.zoneHolds[s] < zoneHoldCount(g, s)) problems.push(`席${s} 累计区数(${g.zoneHolds[s]})<当前区数(${zoneHoldCount(g, s)})`);
  }

  // I4: flagTotal 等于 captures + 当前区数；且 >=0
  for (let s = 0; s < N_SEATS; s++) {
    const ft = flagTotal(g, s);
    if (ft !== g.captures[s] + zoneHoldCount(g, s)) problems.push(`席${s} flagTotal(${ft})≠captures+区数`);
    if (ft < 0) problems.push(`席${s} flagTotal 为负`);
  }

  // I5: 分数有限、影响力非负
  for (let s = 0; s < N_SEATS; s++) {
    if (!Number.isFinite(g.scores[s])) problems.push(`席${s} 总分 NaN/Inf`);
    if (!Number.isFinite(g.centerScores[s])) problems.push(`席${s} 中央区 NaN/Inf`);
  }
  for (const z of g.zones) for (const v of Object.values(z.influence)) if (v < 0) problems.push(`区${z.idx} 影响力为负`);

  // I6: 任何格任一侧不超过容量（含封存的）
  for (const l of g.lines) for (const c of l.cells) {
    const maxc = (Object.keys(c.env || {}).length ? 4 : 3);
    for (const cs of Object.values(c.sides)) {
      if (cs.length > maxc) problems.push(`格(${l.idx},${c.k}) 一侧(${cs.length})>容量(${maxc})`);
    }
  }

  // I7: leader 合法性
  for (let s = 0; s < N_SEATS; s++) {
    if (!Number.isInteger(g.leaders[s]) || g.leaders[s] < 0 || g.leaders[s] >= N_ZONES)
      problems.push(`席${s} leader 非法=${g.leaders[s]}`);
  }

  if (problems.length) {
    console.log(`  [R${g.round}] 不变量违背 ${problems.length} 项:`, problems.slice(0, 4).join(' | '));
    ctx.invViol += problems.length;
    if (ctx.firstFail === null) ctx.firstFail = problems.slice(0, 8);
  }
}

console.log('结算不变量模糊测试：真实 AI 整局 × 200（短游戏 + 长游戏 各 100）');
const ctx = { invViol: 0, firstFail: null, nan: 0, thrown: 0, rankBad: 0, winBad: 0 };
let games = 0;
for (let i = 0; i < 200; i++) {
  const mode = i % 2 === 0 ? 'short' : 'long';
  const g = createGame(100000 + i * 7919, { mode });
  let guard = 0;
  try {
    while (!g.over && guard++ < 500) {
      runRound(g, (gg, s) => chooseActions(gg, s), null, { freePicker: (gg, s, id) => chooseFreePlay(gg, s, id) });
      checkInv(g, ctx);
    }
    games++;
  } catch (e) {
    ctx.thrown++;
    console.log('  抛出:', e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message);
  }

  // 终局不变量
  if (g.over) {
    const rank = finalRanking(g);
    // 排名严格降序（按 score→captures→zones→seat）
    for (let k = 1; k < rank.length; k++) {
      const a = rank[k - 1], b = rank[k];
      const ge = (a.score > b.score) || (a.score === b.score && a.captures > b.captures)
        || (a.score === b.score && a.captures === b.captures && a.zones >= b.zones);
      if (!ge) { ctx.rankBad++; break; }
    }
    const w = g.winner;
    if (w == null || w < 0 || w >= N_SEATS) ctx.winBad++;
    if (!Number.isFinite(g.scores[w])) ctx.winBad++;
    // 终局原因合法
    if (!['flags', 'board', 'hands', 'deck', 'maxrounds'].includes(g.endReason)) ctx.winBad++;
  }
}
ok(ctx.thrown === 0, `整局不崩溃（异常 ${ctx.thrown} 局）`);
ok(ctx.invViol === 0, `结算不变量全程保持（违背 ${ctx.invViol} 次${ctx.firstFail ? '；首例: ' + ctx.firstFail.join(' / ') : ''}）`);
ok(ctx.rankBad === 0, `终局排名严格有序（异常 ${ctx.rankBad} 局）`);
ok(ctx.winBad === 0, `终局赢家合法（异常 ${ctx.winBad} 局）`);

console.log(`\n=== 结算不变量测试： ${pass} PASS / ${fail} FAIL  （跑完 ${games} 局）===`);
if (fail) { console.log('失败项：'); fails.forEach(p => console.log('  - ' + p)); }
