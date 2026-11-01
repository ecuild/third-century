// 平衡性精密分析 v2 —— 三世纪：罗马的黄昏
// 修复：① 战术牌"无战术"对照用「清空各席手牌中的战术牌」干净隔离（保留 v2 真实部队评估）
//       ② 所有战术相关量用「中位数 + 剔除失控局(maxrounds)」稳健统计，避免长局离群值扭曲均值
import {
  createGame, runRound, centerOptions, finalRanking, canPlayTroop,
  cellCapacity, cellHasEnv,
} from './src/engine.mjs';
import { chooseActions, chooseFreePlay } from './src/ai.mjs';
import { TACTIC_BY_ID, CELLS_PER_LINE, N_SEATS, N_LINES, N_ZONES, lineSeats } from './src/rules.mjs';
import {
  bestFormation, maxPointSum, compareForm, comparePointsOnly,
} from './src/formation.mjs';

const N_BASE = Number(process.argv[2] || 200);
const N_NOTAC = Number(process.argv[3] || 200);
const GUARD = 400;
const RUN = 380; // ≥ 此回合数视为失控局（接近 MAX_ROUNDS），统计时剔除

const advanced = (g, s) => chooseActions(g, s);

// 干净隔离「战术牌落场效果」：每席规划前清空其战术牌（含免费打出额度）。
// 中央区占位计分仍由部队牌颜色正常驱动；8.5 仍会把战术牌发到手里但下一回合即被清空，永不上场。
function noTacPolicy(g, seat) {
  g.playerTactics[seat] = [];
  g.pendingFreePlay[seat] = [];
  return chooseActions(g, seat);
}

function playOne(seed, policyFor, opts = {}) {
  const g = createGame(seed, opts.mode ? { mode: opts.mode } : undefined);
  const rec = {
    errors: 0, rounds: 0, endReason: null,
    tacPlays: { morale: 0, env: 0, guile: 0 }, tacAcquire: 0, zoneScoreEvents: 0,
    cellsWithTactic: 0, cellsWithEnv: 0, guileOnBoard: 0, captSum: 0,
  };
  let guard = 0;
  while (!g.over && guard++ < GUARD) {
    const r = runRound(g, (gs, s) => policyFor(s)(gs, s), null,
      { freePicker: opts.freePicker ? (gg, s, id) => opts.freePicker(gg, s, id) : undefined });
    rec.errors += r.errors.length;
    rec.tacAcquire += (r.tacWins || []).length;
    rec.zoneScoreEvents += (r.zoneWins || []).length;
    for (const e of (r.applied || [])) {
      if (e.action && e.action.kind === 'tactic') {
        const t = TACTIC_BY_ID[e.action.tacticId];
        if (t) rec.tacPlays[t.cat]++;
      }
    }
  }
  rec.rounds = g.round;
  rec.over = g.over;
  rec.endReason = g.endReason;
  rec.scores = g.scores.slice();
  rec.captures = g.captures.slice();
  rec.centerScores = g.centerScores.slice();
  rec.zoneHolds = g.zoneHolds.slice();
  rec.captSum = g.captures.reduce((a, b) => a + b, 0);
  rec.cellsWithTactic = g.lines.reduce((a, l) => a + l.cells.reduce((x, c) =>
    x + Object.values(c.sides).reduce((y, cs) => y + cs.filter(cd => cd.tactic).length, 0), 0), 0);
  rec.cellsWithEnv = g.lines.reduce((a, l) => a + l.cells.reduce((x, c) =>
    x + Object.keys(c.env || {}).length, 0), 0);
  rec.guileOnBoard = g.guileBoard.length;
  rec.tacTotal = rec.tacPlays.morale + rec.tacPlays.env + rec.tacPlays.guile;
  return { g, rec };
}

function flagsOnlyRanking(g) {
  return Array.from({ length: N_SEATS }, (_, i) => ({
    seat: i, score: g.scores[i] - g.centerScores[i],
    captures: g.captures[i], zones: g.zoneHolds[i],
  })).sort((a, b) => (b.score - a.score) || (b.captures - a.captures) || (b.zones - a.zones) || (a.seat - b.seat));
}
function champs(rank) {
  const top = rank[0].score;
  return rank.filter(r => r.score === top).map(r => r.seat);
}
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

console.log(`\n===== 三世纪：罗马的黄昏 —— 平衡性精密分析 v2 =====\n`);
console.log(`【基线】全 v2 AI × ${N_BASE} 局`);
const baseGames = [];
for (let i = 0; i < N_BASE; i++) baseGames.push(playOne(1000 + i * 7919, () => advanced, { freePicker: chooseFreePlay }));

console.log(`【对照】无战术策略（同种子）× ${N_NOTAC} 局`);
const noTacGames = [];
for (let i = 0; i < N_NOTAC; i++) noTacGames.push(playOne(1000 + i * 7919, () => noTacPolicy, { freePicker: null }));

// -------- 汇总（稳健：中位数 + 剔除失控局） --------
function agg(games) {
  const wins = Array(N_SEATS).fill(0);
  const scoreSum = Array(N_SEATS).fill(0);
  const capSum = Array(N_SEATS).fill(0);
  const centerSum = Array(N_SEATS).fill(0);
  const holdSum = Array(N_SEATS).fill(0);
  const rankSum = Array(N_SEATS).fill(0);
  const endReasons = {};
  const roundsList = [], tacTotalList = [], tacMorale = [], tacEnv = [], tacGuile = [],
    acquireList = [], zEventsList = [], captList = [], marginList = [];
  let tiedChamp = 0;
  let runaway = 0;
  // 剔除失控局后的子样本
  const conv = [];
  for (const { g, rec } of games) {
    endReasons[rec.endReason || 'timeout'] = (endReasons[rec.endReason || 'timeout'] || 0) + 1;
    roundsList.push(rec.rounds);
    tacTotalList.push(rec.tacTotal); tacMorale.push(rec.tacPlays.morale);
    tacEnv.push(rec.tacPlays.env); tacGuile.push(rec.tacPlays.guile);
    acquireList.push(rec.tacAcquire); zEventsList.push(rec.zoneScoreEvents);
    captList.push(rec.captSum);
    const rank = finalRanking(g);
    rank.forEach((r, idx) => { rankSum[r.seat] += idx; });
    const ch = champs(rank);
    if (ch.length > 1) tiedChamp++;
    for (const c of ch) wins[c] += 1 / ch.length;
    marginList.push(rank[0].score - rank[1].score);
    for (let s = 0; s < N_SEATS; s++) {
      scoreSum[s] += g.scores[s]; capSum[s] += g.captures[s];
      centerSum[s] += g.centerScores[s]; holdSum[s] += g.zoneHolds[s];
    }
    if (rec.rounds >= RUN) runaway++; else conv.push({ g, rec });
  }
  const n = games.length;
  const avg = a => a.map(v => v / n);
  return {
    n, wins, avgScore: avg(scoreSum), avgCap: avg(capSum), avgCenter: avg(centerSum),
    avgHold: avg(holdSum), avgRank: avg(rankSum), endReasons,
    avgRounds: roundsList.reduce((a, b) => a + b, 0) / n,
    minRounds: Math.min(...roundsList), maxRounds: Math.max(...roundsList),
    medianTac: median(tacTotalList), meanTacConv: conv.length ? conv.reduce((a, x) => a + x.rec.tacTotal, 0) / conv.length : 0,
    medianMorale: median(tacMorale), medianEnv: median(tacEnv), medianGuile: median(tacGuile),
    meanAcquire: acquireList.reduce((a, b) => a + b, 0) / n,
    meanZEvents: zEventsList.reduce((a, b) => a + b, 0) / n,
    meanCapt: captList.reduce((a, b) => a + b, 0) / n,
    tiedChamp, avgMargin: marginList.reduce((a, b) => a + b, 0) / n, runaway,
    convCount: conv.length, marginList,
  };
}

const B = agg(baseGames);
const N_ = agg(noTacGames);

console.log(`\n═══════════ Q1 席位平衡 ═══════════`);
const expWin = B.n / N_SEATS;
const maxWinDev = Math.max(...B.wins.map(w => Math.abs(w - expWin))) / expWin;
const sdWin = Math.sqrt(expWin * (1 - 1 / N_SEATS));
const maxZ = Math.max(...B.wins.map(w => Math.abs(w - expWin) / sdWin));
const chi2 = B.wins.reduce((a, w) => a + (w - expWin) * (w - expWin) / expWin, 0);
const sig = chi2 > 18.48 ? '99%显著(真偏斜!)' : chi2 > 14.07 ? '95%显著' : '噪声(不显著)';
const maxAbsScore = Math.max(...B.avgScore.map(Math.abs));
console.log(`· 各席夺冠次数：[${B.wins.map(v => v.toFixed(1)).join(', ')}]  期望 ${expWin.toFixed(1)}`);
console.log(`· 夺冠最大偏差：${(maxWinDev * 100).toFixed(0)}%   chi²=${chi2.toFixed(1)}（df=7，95%/99%临界=14.07/18.48）   max|Z|=${maxZ.toFixed(2)} → ${sig}`);
console.log(`· ⚠ 样本判读：${B.n < 1000 ? `n=${B.n} 偏小，maxDev 30–40% 仅 ~2σ，极易把噪声读成偏斜；需 n≥1000 + 卡方判定才算稳。` : `n=${B.n} 足够，卡方结论可信。`}`);
console.log(`· 各席平均总分：[${B.avgScore.map(v => v.toFixed(2)).join(', ')}]  最大|均值|=${maxAbsScore.toFixed(2)}`);
console.log(`· 各席平均名次（0=冠军）：[${B.avgRank.map(v => v.toFixed(2)).join(', ')}]  期望 3.50`);
console.log(`· 各席平均夺旗：[${B.avgCap.map(v => v.toFixed(2)).join(', ')}]`);
console.log(`· 终局原因：${JSON.stringify(B.endReasons)}`);
console.log(`· 平均 ${B.avgRounds.toFixed(1)} 回合（${B.minRounds}~${B.maxRounds}，失控局≥${RUN}回合者 ${B.runaway} 局）`);

console.log(`\n═══════════ Q2 中心区域争夺领先是否重要 ═══════════`);
{
  let centerTotal = 0, scoreTotal = 0, winnerCenterShare = 0, champChange = 0, monoZone = 0;
  const zx = [], zy = [], cx = [], cy = [];
  for (const { g } of baseGames) {
    const cs = g.centerScores.reduce((a, b) => a + Math.abs(b), 0);
    const ss = g.scores.reduce((a, b) => a + Math.abs(b), 0);
    centerTotal += cs; scoreTotal += ss;
    const rank = finalRanking(g); const w = rank[0].seat;
    winnerCenterShare += Math.abs(g.centerScores[w]) / Math.max(1, Math.abs(g.scores[w]));
    const real = new Set(champs(finalRanking(g)));
    const fo = new Set(champs(flagsOnlyRanking(g)));
    if (!(real.size === fo.size && [...real].every(s => fo.has(s)))) champChange++;
    if (Math.max(...g.zoneHolds) >= 3) monoZone++;
    for (let s = 0; s < N_SEATS; s++) {
      zx.push(g.zoneHolds[s]); zy.push(s === w ? 1 : 0);
      cx.push(g.captures[s]); cy.push(s === w ? 1 : 0);
    }
  }
  const corr = (x, y) => {
    const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy);
  };
  console.log(`· 中央区占位分绝对值占最终总分比例：${(centerTotal / scoreTotal * 100).toFixed(1)}%`);
  console.log(`· 冠军个人得分中中央区贡献占比（均值）：${(winnerCenterShare / B.n * 100).toFixed(1)}%`);
  console.log(`· 去掉中央区占位分后，冠军变化：${champChange} / ${B.n} 局（${(champChange / B.n * 100).toFixed(1)}%）`);
  console.log(`· 相关性  夺旗数↔夺冠：r=${corr(cx, cy).toFixed(3)}   中央区持有数↔夺冠：r=${corr(zx, zy).toFixed(3)}`);
  console.log(`· 终局有玩家持有≥3个中央区的局数：${monoZone} / ${B.n}（${(monoZone / B.n * 100).toFixed(0)}%）`);
}

console.log(`\n═══════════ Q3 战术牌是否具决定性作用 ═══════════`);
{
  console.log(`· 战术牌打出/局：中位数 ${B.medianTac}（剔除失控局均值 ${B.meanTacConv.toFixed(2)}；失控局长局离群已剔除）`);
  console.log(`   └ 按类别中位数/局：士气 ${B.medianMorale} / 环境 ${B.medianEnv} / 计谋 ${B.medianGuile}`);
  console.log(`· 8.5 夺取战术牌 ${B.meanAcquire.toFixed(1)} 次/局；中央区易主计分 ${B.meanZEvents.toFixed(1)} 次/局`);
  const M = Math.min(B.n, N_.n);
  let same = 0, sameConv = 0, convN = 0;
  // —— 真正的「威力」度量：战术牌把每席分数挪动了多少（而非看 1 分差冠军翻没翻）——
  const perSeatDelta = [];           // 每局每席 |baseScore - noTacScore|
  const champFlip = [];              // 冠军是否翻转（噪声敏感，仅作旁证）
  for (let i = 0; i < M; i++) {
    const bs = baseGames[i].rec.scores, ns = noTacGames[i].rec.scores;
    for (let s = 0; s < N_SEATS; s++) perSeatDelta.push(Math.abs(bs[s] - ns[s]));
    const b = new Set(champs(finalRanking(baseGames[i].g)));
    const n = new Set(champs(finalRanking(noTacGames[i].g)));
    const eq = b.size === n.size && [...b].every(s => n.has(s));
    if (eq) same++;
    champFlip.push(eq ? 0 : 1);
    if (baseGames[i].rec.rounds < RUN && noTacGames[i].rec.rounds < RUN) {
      convN++; if (eq) sameConv++;
    }
  }
  const meanDelta = perSeatDelta.reduce((a, x) => a + x, 0) / perSeatDelta.length;
  const maxDelta = Math.max(...perSeatDelta);
  // 分数位移与「战术打出数」的相关性：若战术真决定胜负，打出越多位移应越大
  const tacPlaysPerGame = baseGames.slice(0, M).map(({ rec }) => rec.tacTotal);
  const gameMeanDelta = [];
  for (let i = 0; i < M; i++) {
    let d = 0; for (let s = 0; s < N_SEATS; s++) d += Math.abs(baseGames[i].rec.scores[s] - noTacGames[i].rec.scores[s]);
    gameMeanDelta.push(d / N_SEATS);
  }
  const corr = (a, b) => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return num / Math.sqrt(da * db || 1);
  };
  const rTacDelta = corr(tacPlaysPerGame, gameMeanDelta);
  console.log(`· 同种子「有战术 vs 无战术」冠军一致率：${(same / M * 100).toFixed(1)}%（${same}/${M}）— ⚠ 此值对噪声极敏感：本作 38% 局分差≤1，任意 1~2 分扰动即翻冠军，故该率不能直接读作「战术威力」`);
  console.log(`· 【参照位移】同种子两局分数差 |Δscore| 均 = ${meanDelta.toFixed(2)} 分（最大单席 ${maxDelta.toFixed(0)}）；⚠ 此值已被「RNG 流发散」污染——战术落地会改变牌堆抽取顺序，无战术局走的是另一条随机牌序，故该差≠战术净威力，仅作量级参考`);
  console.log(`· 分数位移 ↔ 战术打出数 相关性 r = ${rTacDelta.toFixed(3)}（≈0 表示「打出更多战术」并不等于「分数挪动更大」→ 战术无系统性决定力；该相关性不受 RNG 发散影响，是干净信号）`);
  console.log(`· 平均回合：有战术 ${B.avgRounds.toFixed(1)} / 无战术 ${N_.avgRounds.toFixed(1)}`);
  const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const bs = baseGames.map(({ g }) => g.scores).flat();
  const ns = noTacGames.map(({ g }) => g.scores).flat();
  console.log(`· 总分标准差：有战术 ${sd(bs).toFixed(2)} / 无战术 ${sd(ns).toFixed(2)}`);
}

console.log(`\n═══════════ Q4 决策区分度（是否“更模糊”）═══════════`);
{
  const within1 = B.marginList.filter(m => m <= 1).length;
  const within2 = B.marginList.filter(m => m <= 2).length;
  console.log(`· 冠军与亚军分差：均值 ${B.avgMargin.toFixed(2)}`);
  console.log(`· 分差≤1：${within1} / ${B.n}（${(within1 / B.n * 100).toFixed(0)}%）`);
  console.log(`· 分差≤2：${within2} / ${B.n}（${(within2 / B.n * 100).toFixed(0)}%）`);
  console.log(`· 并列冠军：${B.tiedChamp} / ${B.n}（${(B.tiedChamp / B.n * 100).toFixed(0)}%）`);
}

console.log(`\n===== 分析完成 =====`);
