// 游戏状态与回合流程引擎 —— 严格对齐 rules.html 客户版
import {
  SUITS, FACTIONS, TACTICS, TACTIC_BY_ID,
  CELLS_PER_LINE, DECK_SIZE, HAND_PER_LINE,
  CENTER_THRESHOLD, LEADER_WORTH, WIN_FLAGS, ZONE_POINT, RESHUFFLES_TO_END, MAX_ROUNDS,
  N_SEATS, N_LINES, N_ZONES, setRingSize,
  lineSeats, playerLines, firstHand, secondHand, revealOrder, initialFlags,
} from './rules.mjs';
import { compareForm, comparePointsOnly, bestFormation, maxPointSum, formationLevel, pointSum, formationValue } from './formation.mjs';

// ---------------- 随机 ----------------
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function buildDeck() {
  const d = [];
  for (let s = 0; s < 6; s++) for (let r = 1; r <= 10; r++) d.push({ suit: s, rank: r });
  return d;
}

// ---------------- 建局 ----------------
export function createGame(seed = 12345, opts) {
  // 少人数局（规则 3.1「战场数 = 人数」）：建局前切换环型规模（默认 8 不受影响）
  if (opts && opts.nSeats != null) setRingSize(opts.nSeats);
  const rng = makeRng(seed);
  const flagAssign = initialFlags();

  const lines = [];
  for (let i = 0; i < N_LINES; i++) {
    lines.push({
      idx: i,
      deck: shuffle(buildDeck(), rng),
      discard: [],
      reshuffles: 0,
      cells: Array.from({ length: CELLS_PER_LINE }, (_, k) => ({
        k,
        sides: {},               // seat -> [card]
        env: {},                 // seat -> envTacticId（规则 11.2 置于己方一侧）
        owner: flagAssign[i][k], // 旗幟当前归属（规则 3.5 开局即有主）
        decided: false,          // 本轮摊开中是否已判过（规则 9.3 不重复判夺）
        sealed: false,           // v1.7：夺旗后封存（牌留原位、不可再佈军、战术牌不可再影响）
      })),
    });
  }

  // 手牌：hands[seat][lineIdx] = [card]
  const hands = Array.from({ length: N_SEATS }, () => ({}));
  for (let seat = 0; seat < N_SEATS; seat++) {
    for (const li of playerLines(seat)) {
      const h = [];
      for (let k = 0; k < HAND_PER_LINE; k++) h.push(lines[li].deck.pop());
      hands[seat][li] = h;
    }
  }

  // 中心区：6 格，开局各随机 1 张战术牌（规则 2.1 / 8.1）
  const tacDeck = shuffle(TACTICS.map(t => t.id), rng);
  const zones = SUITS.map((s, i) => ({
    idx: i, suit: s.id, name: s.name, color: s.color,
    tactics: tacDeck[i] || null,
    influence: {},                 // seat -> count
  }));
  // 战术牌的来源区（规则 11.4：离场后放回来源中央势力区循环使用）
  const tacticHome = {};
  const zoneTactic = Array(N_ZONES).fill(null);   // 反查：中央区 -> 该区绑定的战术牌（规则 8.5）
  for (let i = 0; i < N_ZONES; i++) {
    if (tacDeck[i]) { tacticHome[tacDeck[i]] = i; zoneTactic[i] = tacDeck[i]; }
  }

  // 领袖：每人 1（规则 2.1）
  const leaders = {};
  for (let seat = 0; seat < N_SEATS; seat++) leaders[seat] = seat % N_ZONES;

  return {
    seed, rng,
    nSeats: N_SEATS,               // 环型规模（规则 3.1：战场数 = 人数；createGame opts.nSeats 可设 2..8）
    mode: (opts && opts.mode) || 'short',   // 'short'（默认，web 版：12 旗终局）/ 'long'（忽略 12 旗）
    lines, hands, zones, leaders, tacticHome, zoneTactic,
    markerLine: 0,                 // 规则 4.3 开局钉在战线 ①
    revealDir: +1,                 // 规则 6.3b 方向指示器，首回合顺时针
    dominantSuit: null,            // 规则 8.7 每回合末刷新（并列则为 null）
    scores: Array(N_SEATS).fill(0),     // 总分 = 旗帜分 + 中央区占位分
    centerScores: Array(N_SEATS).fill(0), // 规则 8.6 中央区占位得分（含负分）
    zoneHolder: Array(N_ZONES).fill(null), // 各中央区当前「第一」归属
    zoneHolds: Array(N_SEATS).fill(0),  // 各席夺取中央区第一的累计次数
    captures: Array(N_SEATS).fill(0),   // 夺旗次数（规则 10.3 平局判定）
    // v1.2：取消「每个中央区限一次」——字段保留以兼容旧序列化，但不再用于拦截
    zoneTacticPlayed: Array.from({ length: N_SEATS }, () => Array(N_ZONES).fill(0)),
    playerTactics: Array.from({ length: N_SEATS }, () => []),
    // v1.2：落场的计谋牌（持久 · 可夺取 · 可回滚）。每项：
    //   { seat, tacticId, home, line, undo:[...], marks:[...] }
    guileBoard: [],
    // v1.2：被计谋牌「模型压住 / 移出」的部队牌的隔离区。
    //   这些牌不参与 line.discard 的洗牌循环，只有其计谋牌被夺取（回滚）时才回到牌堆顶 / 原位；
    //   因此不会被 refill 洗回可抽牌堆，符合「模型压住」语义（修复 v1.2 初版泄漏 bug）。
    guileHold: [],
    // v1.2：获得战术牌后的「无消耗立即打出」额度（席 → [tacticId]）
    pendingFreePlay: Array.from({ length: N_SEATS }, () => []),
    tacticsPlayed: Array.from({ length: N_SEATS }, () => Array(N_LINES).fill(0)),
    round: 1,
    tacticsWonCount: 0,            // 累计被夺取的战术牌次数（规则 8.5）
    pendingRecycle: [],            // 6 区全满时暂存待回流的战术牌（保底，防丢牌）
    // v1.5：春汛离场后「超容弃牌」待决队列。每项 { line, cell, seat, excess }：
    //   某格因「多瑙河春汛」容量 4→3 时，若某侧仍佈满 4 张，则由该侧玩家自行选择弃掉一张
    //   （规则 11.5）。真正移除在 resolveFloodDiscards 完成，UI 可中途拦截让人类选牌。
    pendingFloodDiscard: [],
    log: [],
    over: false,
    winner: null,
    endReason: null,
    _round: null,                  // 本回合临时数据
  };
}

// ---------------- 查询 ----------------
// 以下读取类接口对「非法区 / 缺失对象」一律返回安全值，不抛异常（健壮性：模糊测试要求）
export function zoneInfluence(g, zone, seat) { return (zone && zone.influence[seat]) || 0; }
export function zoneTotal(g, zone) {
  return zone ? Object.values(zone.influence).reduce((a, b) => a + b, 0) : 0;
}
// 某玩家在某区的总影响力（标记 ×1 + 领袖 2，规则 8.4）—— 纯函数，无副作用
export function playerZoneScore(g, zone, seat) {
  if (!zone) return 0;
  let v = zone.influence[seat] || 0;
  if (g.leaders[seat] === zone.idx) v += LEADER_WORTH;
  return v;
}
// 某区全部玩家影响力总和（规则 8.7）
export function zoneScoreAll(g, zone) {
  if (!zone) return 0;
  let tot = 0;
  for (let s = 0; s < N_SEATS; s++) tot += playerZoneScore(g, zone, s);
  return tot;
}

// 单元格阵型容量：常规 3 张；「多瑙河春汛」4 张（规则 11.2）
export function cellCapacity(cell) {
  if (!cell) return 3;
  let cap = 3;
  for (const id of Object.values(cell.env || {})) {
    if (TACTIC_BY_ID[id] && TACTIC_BY_ID[id].env === 'four') cap = 4;
  }
  return cap;
}
export function cellHasEnv(cell, kind) {
  if (!cell) return false;
  for (const id of Object.values(cell.env || {})) {
    const t = TACTIC_BY_ID[id];
    if (t && t.env === kind) return true;
  }
  return false;
}

// 规则 8.7：主导花色 = 回合末总影响力最高的颜色。
// v1.1 修订：若有两区（及以上）并列第一，则本回合不产生主导花色（返回 null），
// 不再沿用上回合结果 —— 明确「并列即无主导」。
export function computeDominantSuit(g) {
  let best = -1, bestVal = -1, tie = false;
  for (let z = 0; z < N_ZONES; z++) {
    const val = zoneScoreAll(g, g.zones[z]);
    if (val > bestVal) { bestVal = val; best = z; tie = false; }
    else if (val === bestVal && val > 0) { tie = true; }
  }
  if (bestVal <= 0) return null;
  if (tie) return null;
  return best;
}

// ---------------- 合法性校验 ----------------
// 规则 7.2：暗扣必须选线 → 选格 → 扣牌；已决出的格不可再投入新牌
export function canPlayTroop(g, seat, lineIdx, cellIdx, handIdx) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= N_SEATS) return { ok: false, why: '席号非法' };
  const hand = g.hands[seat]?.[lineIdx];
  if (!hand || hand.length === 0) return { ok: false, why: '该战线手牌为 0' };
  if (handIdx < 0 || handIdx >= hand.length) return { ok: false, why: '手牌索引无效' };
  const cell = g.lines[lineIdx]?.cells?.[cellIdx];
  if (!cell) return { ok: false, why: '格位无效' };
  if (cell.decided) return { ok: false, why: '该格本轮已决出，不可再投入新牌' };
  if (cell.sealed) return { ok: false, why: '该格已封存（夺旗后不可再用）' };
  const cap = cellCapacity(cell);
  if ((cell.sides[seat] || []).length >= cap) return { ok: false, why: `该格己方已满 ${cap} 张` };
  return { ok: true };
}

// 规则 11.3：战术牌可替代暗扣。返回是否允许
export function canPlayTactic(g, seat, lineIdx, tacticId, cellIdx) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= N_SEATS) return { ok: false, why: '席号非法' };
  const t = TACTIC_BY_ID[tacticId];
  if (!t) return { ok: false, why: '未知战术牌' };
  if (!(g.playerTactics[seat] || []).includes(tacticId)) return { ok: false, why: '你未持有该战术牌' };
  // v1.2：取消「每个中央区限一次」——同一区的战术牌可反复夺得并再次打出。
  // 计谋牌落场后参数在执行时校验，不要求格位
  const cell = g.lines[lineIdx]?.cells?.[cellIdx];
  if (t.cat !== 'guile') {
    if (!cell) return { ok: false, why: '格位无效' };
    if (cell.sealed) return { ok: false, why: '该格已封存（夺旗后不可再用）' };
    if (cell.decided) return { ok: false, why: '该格本轮已决出' };
  }

  // 规则 11.3.2：每战线独立，己方已打出战术牌数不得多于对手 +1
  const [sA, sB] = lineSeats(lineIdx);
  const opp = seat === sA ? sB : sA;
  const mine = g.tacticsPlayed[seat][lineIdx];
  const theirs = g.tacticsPlayed[opp][lineIdx];
  // 打出后为 mine+1，须满足 mine+1 ≤ theirs+1，即 mine ≤ theirs
  if (mine > theirs) return { ok: false, why: '本战线战术牌数将多于对手 +1（规则 11.3.2）' };

  if (t.cat === 'morale') {
    // 规则 11.2：每名玩家在同一战线只能有一张「领袖」万能牌
    if (t.isLeaderCard) {
      const has = (cell.sides[seat] || []).some(c => {
        const ct = TACTIC_BY_ID[c.tactic];
        return ct && ct.isLeaderCard;
      });
      if (has) return { ok: false, why: '同一格己方已有一张领袖牌' };
      for (let k = 0; k < CELLS_PER_LINE; k++) {
        const cs = g.lines[lineIdx].cells[k].sides[seat] || [];
        if (cs.some(c => { const ct = TACTIC_BY_ID[c.tactic]; return ct && ct.isLeaderCard; })) {
          return { ok: false, why: '同一战线己方只能有一张领袖牌' };
        }
      }
    }
    if ((cell.sides[seat] || []).length >= cellCapacity(cell)) return { ok: false, why: '该格己方已满' };
    return { ok: true };
  }
  if (t.cat === 'env') {
    // 规则 11.2：置于某未夺旗幟己方一侧；一格己方一侧只放一张环境牌
    if (cell.env[seat]) return { ok: false, why: '该格己方一侧已有环境牌' };
    return { ok: true };
  }
  return { ok: true }; // guile：即时结算，参数在执行时校验
}

// ---------------- 动作执行 ----------------
// action 形态：
//   { kind:'troop',  line, cell, handIdx, center:{type:'place'}|{type:'leader', zone} }
//   { kind:'tactic', line, tacticId, cell?, ...guile 参数 }
//   { kind:'empty',  line, leaderZone }   // 规则 8.3 打空手牌时的领袖放置
export function applyAction(g, seat, action) {
  if (!action) return { ok: false, why: '空动作' };
  if (!Number.isInteger(seat) || seat < 0 || seat >= N_SEATS) return { ok: false, why: '席号非法' };
  if (action.kind === 'troop') return playTroop(g, seat, action);
  if (action.kind === 'tactic') return playTactic(g, seat, action);
  if (action.kind === 'empty') return playEmpty(g, seat, action);
  // 兜底：该战线所有格己方均已满编，无任何合法暗扣点
  if (action.kind === 'skip') {
    g.log.push(`${FACTIONS[seat].name} 战线${action.line + 1} 无合法暗扣点，本回合跳过`);
    return { ok: true, skipped: true };
  }
  return { ok: false, why: '未知动作类型' };
}

// 暗扣一张部队牌（规则 7.2 第 3 步）。中心行动延后到摊开时执行（规则 8.2）
function playTroop(g, seat, action) {
  const { line: lineIdx, cell: cellIdx, handIdx } = action;
  const chk = canPlayTroop(g, seat, lineIdx, cellIdx, handIdx);
  if (!chk.ok) return chk;
  const hand = g.hands[seat][lineIdx];
  const [card] = hand.splice(handIdx, 1);
  const cell = g.lines[lineIdx].cells[cellIdx];
  if (!cell.sides[seat]) cell.sides[seat] = [];
  cell.sides[seat].push(card);
  g._round.pending.push({
    seat, lineIdx, cellIdx, kind: 'troop', card, center: action.center || { type: 'place' },
  });
  return { ok: true, card };
}

// 规则 7.4：战术牌替代暗扣，打出后不补牌。
// 规则 8.2 的中心行动以「打出的牌的颜色」为前提，而战术牌在打出时并无固有颜色
// （士气牌的颜色要到该格结算时才确定），故战术牌不触发中心行动、也不补牌。
function playTactic(g, seat, action) {
  const { line: lineIdx, tacticId, cell: cellIdx } = action;
  const chk = canPlayTactic(g, seat, lineIdx, tacticId, cellIdx);
  if (!chk.ok) return chk;
  const t = TACTIC_BY_ID[tacticId];

  if (t.cat === 'morale') {
    const cell = g.lines[lineIdx].cells[cellIdx];
    if (!cell.sides[seat]) cell.sides[seat] = [];
    cell.sides[seat].push({ tactic: tacticId });
    consumeTactic(g, seat, lineIdx, tacticId);
    return { ok: true, tactic: t };
  }
  if (t.cat === 'env') {
    const cell = g.lines[lineIdx].cells[cellIdx];
    cell.env[seat] = tacticId;
    consumeTactic(g, seat, lineIdx, tacticId);
    return { ok: true, tactic: t };
  }
  // guile：v1.2 落场持久化（不再即时离场回流）。
  //   打出后绑定其来源中央区；在受影响的牌位留下「虚空站位 + 模型」标记（marks）；
  //   回合末中心结算时若该区唯一第一易主 → 被夺取，按 undo 回滚（已决出旗幟不受影响）。
  const res = execGuile(g, seat, lineIdx, tacticId, action);
  if (!res.ok) return res;
  if (res.fizzled) {
    // 落空：动作不生效、战术牌保留（不消耗、不落场）
    g.log.push(`${FACTIONS[seat].name} 在战线${lineIdx + 1} 的计谋「${t.name}」落空：${res.why}（战术牌保留）`);
    return { ok: true, fizzled: true, why: res.why, tactic: t };
  }
  consumeTactic(g, seat, lineIdx, tacticId);
  const entry = {
    seat, tacticId, home: g.tacticHome[tacticId] ?? null, line: lineIdx,
    undo: res.undo || [], marks: res.marks || [],
  };
  g.guileBoard.push(entry);
  const hn = entry.home != null ? g.zones[entry.home].name : '—';
  g.log.push(`${FACTIONS[seat].name} 在战线${lineIdx + 1} 打出计谋「${t.name}」→ 落场（绑定中央区「${hn}」）`);
  return { ok: true, tactic: t, board: entry };
}

function consumeTactic(g, seat, lineIdx, tacticId) {
  const i = g.playerTactics[seat].indexOf(tacticId);
  if (i >= 0) g.playerTactics[seat].splice(i, 1);
  g.tacticsPlayed[seat][lineIdx] += 1;
  // v1.2：若该牌正处于「无消耗立即打出」额度中，一并消耗额度
  const q = g.pendingFreePlay?.[seat];
  if (q) { const k = q.indexOf(tacticId); if (k >= 0) q.splice(k, 1); }
}

// 规则 8.3：该战线手牌为 0 时无法暗扣，改为把领袖放到任意 6 色区
function playEmpty(g, seat, action) {
  const { line: lineIdx, leaderZone } = action;
  const hand = g.hands[seat]?.[lineIdx] || [];
  if (hand.length > 0) return { ok: false, why: '该战线仍有手牌，不能触发领袖放置' };
  const z = leaderZone ?? g.leaders[seat];
  // 注意：不能用 z < 0 || z >= N_ZONES 判 NaN / 对象（比较恒为 false 会漏过）
  if (!Number.isInteger(z) || z < 0 || z >= N_ZONES) return { ok: false, why: '目标区无效' };
  g.leaders[seat] = z;
  g.log.push(`${FACTIONS[seat].name} 战线${lineIdx + 1} 手牌为 0 → 领袖放置于「${g.zones[z].name}」（规则 8.3）`);
  return { ok: true };
}

// 规则 11.2 计谋牌即时效果
// 注意：全桌「同时暗扣」（6.2），本席规划目标时看到的局面，到结算时可能已被
// 对手同回合的动作改变（例如瞄准的牌被对手的哗变先弃掉）。这类「目标在结算时
// 已不存在」属于并发竞态，判为 fizzle（落空）：动作不生效、战术牌保留，
// 不计为非法动作。真正的违规（无此牌 / 超数量限制）仍返回 ok:false。
const FIZZLE = why => ({ ok: true, fizzled: true, why });

function execGuile(g, seat, lineIdx, tacticId, action) {
  const line = g.lines[lineIdx];
  const [sA, sB] = lineSeats(lineIdx);
  const opp = seat === sA ? sB : sA;

  if (tacticId === 'scout') {
    // v1.2：抽 3 张置于手牌末尾（用本战术牌在末尾隔开）；其中 2 张「被模型压住」＝暂弃入弃牌堆，
    //       并在 undo 中记录，供被夺取时「拿回」；余下未被使用的抽出牌在被夺取时放回牌堆顶。
    const drawn = [];
    for (let i = 0; i < 3; i++) {
      if (!line.deck.length) {
        if (!line.discard.length) break;
        line.deck = shuffle(line.discard, g.rng); line.discard = []; line.reshuffles += 1;
      }
      drawn.push(line.deck.pop());
    }
    if (!drawn.length) return FIZZLE('牌堆与弃牌堆皆空，无法抽牌');
    const hand = g.hands[seat][lineIdx];
    const handBase = hand.length;
    hand.push(...drawn);                       // 置于手牌末尾
    const need = Math.min(2, drawn.length);
    let uniq;
    if (Array.isArray(action.returnIdxs) && action.returnIdxs.length >= need) {
      // 只允许从「新抽的 3 张」里指定（索引 ≥ handBase）
      uniq = [...new Set(action.returnIdxs)].filter(i => i >= handBase && i < hand.length);
      if (uniq.length < need) uniq = drawn.map((_, i) => handBase + i).slice(0, need);
      uniq = uniq.slice(0, need);
    } else {
      // 未指定时默认「压住」点数最小的 2 张（AI 默认策略）
      uniq = drawn.map((c, i) => [handBase + i, c.rank || 0])
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, need).map(x => x[0]);
    }
    const covered = [];
    uniq.sort((a, b) => b - a).forEach(i => {
      const [c] = hand.splice(i, 1);
      g.guileHold.push(c);                     // 被「模型」压住 → 隔离区（不参与洗牌，被夺取时拿回）
      covered.push(c);
    });
    // 规则 7.3 手牌上限
    enforceHandCap(g, seat, lineIdx);
    g._round.noRefill.add(`${seat}:${lineIdx}`);
    return {
      ok: true,
      undo: [{ type: 'scout', line: lineIdx, seat, drawn: drawn.slice(), covered }],
      marks: covered.map(c => ({ kind: 'cover', line: lineIdx, seat, card: c })),
    };
  }

  if (tacticId === 'shift') {
    // 将己方某未夺旗幟旁的一张牌，移到己方另一空位，或弃掉
    const from = action.fromCell, idx = action.cardIdx;
    const cell = line.cells[from];
    if (!cell || cell.decided) return FIZZLE('来源格在结算时已决出或无效');
    const cards = cell.sides[seat] || [];
    if (idx < 0 || idx >= cards.length) return FIZZLE('来源牌在结算时已不在该格');
    const [card] = cards.splice(idx, 1);
    if (action.toCell == null) {
      if (!card.tactic) g.guileHold.push(card);   // 被模型压住 → 隔离区（被夺取时按 undo 恢复原样）
      else recycleTactic(g, card.tactic);
      return {
        ok: true,
        // 部队牌被弃 → 记位置，供被夺取时「恢复原样」；战术牌已回流，无法回滚
        undo: card.tactic ? [] : [{ type: 'discard', line: lineIdx, cell: from, seat, card }],
        marks: [{ kind: 'model', line: lineIdx, seat, card, fromCell: from, toCell: null }],
      };
    }
    if (action.toCell === from) {
      cards.splice(idx, 0, card);            // 回滚：同格空转无意义
      return FIZZLE('目标格与来源格相同');
    }
    const dst = line.cells[action.toCell];
    if (!dst || dst.decided) { cards.splice(idx, 0, card); return FIZZLE('目标格在结算时已决出'); }
    // 规则 11.2：「空位」= 该格己方一侧尚未佈军
    // v1.4：「虚空站位」只是虚空，不占格位 —— 该格仍可继续佈军；
    //       若因此被填满，则计谋牌失效（被夺取）时该牌不再回归（见 rollbackGuile）。
    if ((dst.sides[seat] || []).length > 0) {
      cards.splice(idx, 0, card);
      return FIZZLE('目标格己方一侧在结算时已非「空位」');
    }
    if (!dst.sides[seat]) dst.sides[seat] = [];
    dst.sides[seat].push(card);
    return {
      ok: true,
      undo: [{ type: 'move', line: lineIdx, fromCell: from, toCell: action.toCell, fromSeat: seat, toSeat: seat, card }],
      marks: [{ kind: 'model', line: lineIdx, seat, card, fromCell: from, toCell: action.toCell }],
    };
  }

  if (tacticId === 'mutiny') {
    // 将对手某未夺旗幟旁的一张牌移出并弃掉
    const cell = line.cells[action.targetCell];
    if (!cell || cell.decided) return FIZZLE('目标格在结算时已决出或无效');
    const cards = cell.sides[opp] || [];
    const idx = action.cardIdx;
    if (idx < 0 || idx >= cards.length) return FIZZLE('目标牌在结算时已不在该格');
    const [card] = cards.splice(idx, 1);
    if (!card.tactic) g.guileHold.push(card);   // 被模型压住 → 隔离区（被夺取时按 undo 恢复原样）
    else recycleTactic(g, card.tactic);
    return {
      ok: true,
      undo: card.tactic ? [] : [{ type: 'discard', line: lineIdx, cell: action.targetCell, seat: opp, card }],
      marks: [{ kind: 'model', line: lineIdx, seat: opp, card, fromCell: action.targetCell, toCell: null }],
    };
  }

  if (tacticId === 'defect') {
    // 取对手某未夺旗幟旁的一张部队牌（不含战术牌），放到己方一个空位
    const cell = line.cells[action.targetCell];
    if (!cell) return { ok: false, why: '目标格无效' };
    // 与哗变/换防一致：目标格「结算时已决出」是同时暗扣的竞态 → 落空（保留牌不消耗）；
    //   仅「格位本身非法」才是硬失败（规则 11.2 落空条款）。
    if (cell.decided) return FIZZLE('目标格在结算时已决出');
    const cards = cell.sides[opp] || [];
    const idx = action.cardIdx;
    if (idx < 0 || idx >= cards.length) return FIZZLE('目标牌在结算时已不在该格');
    if (cards[idx].tactic) return FIZZLE('目标牌在结算时已变为战术牌');
    const dst = line.cells[action.toCell];
    if (!dst || dst.decided) return FIZZLE('己方目标格在结算时已决出或无效');
    // 规则 11.2：「空位」= 该格己方一侧尚未佈军（v1.4：虚空站位不占格位，仍可佈军）
    if ((dst.sides[seat] || []).length > 0) {
      return FIZZLE('己方目标格在结算时已非「空位」');
    }
    const [card] = cards.splice(idx, 1);
    if (!dst.sides[seat]) dst.sides[seat] = [];
    dst.sides[seat].push(card);
    return {
      ok: true,
      undo: [{ type: 'move', line: lineIdx, fromCell: action.targetCell, toCell: action.toCell, fromSeat: opp, toSeat: seat, card }],
      marks: [{ kind: 'model', line: lineIdx, seat: opp, card, fromCell: action.targetCell, toCell: action.toCell }],
    };
  }
  return { ok: false, why: '该计谋牌尚未实现' };
}

function enforceHandCap(g, seat, lineIdx) {
  const line = g.lines[lineIdx];
  const hand = g.hands[seat][lineIdx];
  while (hand.length > HAND_PER_LINE) line.discard.push(hand.pop());
}

// ---------------- 中心区（规则 8.2）----------------
// 打出的牌颜色决定可选行动：
//   ① 放标记：只能放在该牌颜色对应区
//   ② 移动领袖：领袖已在该色区 → 可移到任意其他区；否则只能移入该色区
export function centerOptions(g, seat, cardSuit) {
  if (!Number.isInteger(cardSuit) || cardSuit < 0 || cardSuit >= N_ZONES) return null;   // 非法花色
  const cur = g.leaders[seat];
  const leaderZones = cur === cardSuit
    ? [...Array(N_ZONES).keys()].filter(z => z !== cardSuit)
    : [cardSuit];
  return { placeZone: cardSuit, leaderZones };
}

export function applyCenterAction(g, seat, cardSuit, choice) {
  const opt = centerOptions(g, seat, cardSuit);
  if (!opt) return { ok: false, why: `中心行动花色非法（${cardSuit}）` };
  if (!choice || choice.type === 'place') {
    g.zones[opt.placeZone].influence[seat] = (g.zones[opt.placeZone].influence[seat] || 0) + 1;
    return { ok: true, did: 'place', zone: opt.placeZone };
  }
  if (choice.type === 'leader') {
    const z = choice.zone;
    if (!opt.leaderZones.includes(z)) {
      return { ok: false, why: `领袖不能移至该区（可选：${opt.leaderZones.join(',')}）` };
    }
    g.leaders[seat] = z;
    return { ok: true, did: 'leader', zone: z };
  }
  return { ok: false, why: '未知中心行动' };
}

// ---------------- 补牌（规则 7.3）----------------
export function refill(g, seat, lineIdx) {
  const line = g.lines[lineIdx];
  if (!line || !g.hands[seat] || !g.hands[seat][lineIdx]) return false;
  if (line.deck.length === 0) {
    if (line.discard.length === 0) return false;
    line.deck = shuffle(line.discard, g.rng);
    line.discard = [];
    line.reshuffles += 1;
    g.log.push(`战线${lineIdx + 1} 牌堆耗尽，洗回弃牌堆（${line.deck.length} 张，第 ${line.reshuffles} 次）`);
  }
  if ((g.hands[seat][lineIdx] || []).length >= HAND_PER_LINE) return false;
  g.hands[seat][lineIdx].push(line.deck.pop());
  return true;
}

// ---------------- 夺旗判定（规则 9）----------------
// v1.3（规则 9.1 第 1 条）：对手用「常规手段」还能否凑出 ≥ 我方的阵型？
//   池 = 对手手牌 + 该线牌堆 + 弃牌堆（仅取可入阵型的牌：部队牌 / 士气万能牌；
//   环境 / 计谋牌不参与阵型，它们对本格的影响已体现在当前格局上）。
//   只要存在一种「补满后不弱于我方」的组合 → 认为「对手仍可能翻盘」（平手也算，保守）。
//   返回 { could, poolShort, domCap }：
//     could     —— 对手是否仍可能翻盘
//     poolShort —— 对手连「补满」都做不到（手牌+牌堆+弃牌堆已不足）
//     domCap    —— 对手「主导花色张数」可达上限（格上已有的异色牌会永久锁死它；万能牌可变主导色故不算异色）
function opponentBeatCheck(g, lineIdx, cellIdx, oppSeat, myCards, cap, dominantSuit) {
  const line = g.lines[lineIdx];
  const oppCards = line.cells[cellIdx].sides[oppSeat] || [];
  const need = cap - oppCards.length;
  // 格上「确定异色」的牌（非万能牌且花色 ≠ 主导花色）→ 永久占据格位，主导张数被锁死
  let offSuit = 0;
  if (dominantSuit != null) {
    for (const c of oppCards) {
      if (c && c.tactic == null && c.suit !== dominantSuit) offSuit += 1;
    }
  }
  const domCap = cap - offSuit;
  if (need <= 0) return { could: true, poolShort: false, domCap };   // 已满编：交给比牌处理
  const pool = [], seen = new Set();
  const push = c => {
    if (!c) return;
    if (c.tactic) { const t = TACTIC_BY_ID[c.tactic]; if (!t || t.cat !== 'morale') return; }
    const key = c.tactic ? 'T' + c.tactic : `${c.suit}:${c.rank}`;
    if (seen.has(key)) return;
    seen.add(key); pool.push(c);
  };
  for (const c of (g.hands[oppSeat]?.[lineIdx] || [])) push(c);
  for (const c of line.deck) push(c);
  for (const c of line.discard) push(c);
  if (pool.length < need) return { could: false, poolShort: true, domCap };  // 连补满都做不到 → 稳胜
  pool.sort((a, b) => (b.rank || 0) - (a.rank || 0));  // 大牌先试，尽早命中

  const pick = [];
  let scanned = 0;
  const LIMIT = 30000;                               // 组合爆炸保护：超限按「仍可能」保守处理
  const rec = (start, left) => {
    if (left === 0) { scanned++; return compareForm(myCards, oppCards.concat(pick), dominantSuit) <= 0; }
    for (let i = start; i <= pool.length - left; i++) {
      pick.push(pool[i]);
      if (rec(i + 1, left - 1)) return true;
      pick.pop();
      if (scanned > LIMIT) return true;
    }
    return false;
  };
  return { could: rec(0, need), poolShort: false, domCap };
}

// v1.3：夺旗判定的「归因」——战报要说明为什么判 / 为什么不判（规则 9.1）
//   ① 对手可用牌不足（连补满都做不到）
//   ② 主导花色光环锁死（对手主导张数上限 < 我方主导张数 → 第 2 级比较上永远追不上）
//   ③ 其它：对手已无法凑出更强阵型
function lockReason(myCards, chk, cap, dominantSuit) {
  if (chk.poolShort) return '对手可用牌不足（手牌+牌堆+弃牌堆已凑不满该格）';
  if (dominantSuit != null && chk.domCap < cap) {
    const myDom = bestFormation(myCards, dominantSuit).dom;
    if (myDom > chk.domCap) {
      return `主导花色光环锁死：对手主导张数上限 ${chk.domCap} < 我方 ${myDom}`;
    }
  }
  return '对手已无法凑出更强阵型';
}

export function checkCapture(g, lineIdx, cellIdx) {
  const line = g.lines[lineIdx];
  const cell = line && line.cells[cellIdx];
  if (!cell) return { winner: null, reason: '格位无效' };
  if (cell.sealed) return { winner: null, reason: '该格已封存' };   // v1.7：封存格不再判定
  const [sA, sB] = lineSeats(lineIdx);
  const cardsA = cell.sides[sA] || [];
  const cardsB = cell.sides[sB] || [];
  if (cardsA.length === 0 && cardsB.length === 0) return { winner: null, reason: '空格' };
  if (cell.decided) return { winner: null, reason: '本轮已决出' };

  const cap = cellCapacity(cell);
  const deckEmpty = line.deck.length === 0 && line.discard.length === 0;
  const pointsOnly = cellHasEnv(cell, 'points');   // 西普里安瘟疫：忽略牌型，仅比点数和
  if (cardsA.length < cap || cardsB.length < cap) {
    if (pointsOnly) {
      // 瘟疫：忽略牌型、不要求满编，仅比点数和 → 仍需牌堆有牌可补，否则落到下方点数比较
      if (!deckEmpty) return { winner: null, reason: '对手可能补强' };
    } else {
      // 常规阵型：满编方是否已「稳胜」→ 取决于对手用剩余常规牌能否凑出 ≥ 我方的阵型
      if (cardsA.length >= cap) {
        const chk = opponentBeatCheck(g, lineIdx, cellIdx, sB, cardsA, cap, g.dominantSuit);
        return chk.could
          ? { winner: null, reason: '对手可能补强' }
          : { winner: sA, reason: lockReason(cardsA, chk, cap, g.dominantSuit), lock: true };
      }
      if (cardsB.length >= cap) {
        const chk = opponentBeatCheck(g, lineIdx, cellIdx, sA, cardsB, cap, g.dominantSuit);
        return chk.could
          ? { winner: null, reason: '对手可能补强' }
          : { winner: sB, reason: lockReason(cardsB, chk, cap, g.dominantSuit), lock: true };
      }
      return { winner: null, reason: '双方未满编' };
    }
  }

  let cmp;
  if (pointsOnly) cmp = comparePointsOnly(cardsA, cardsB);
  else cmp = compareForm(cardsA, cardsB, g.dominantSuit);

  if (cmp > 0) return { winner: sA, reason: '压过对手' };
  if (cmp < 0) return { winner: sB, reason: '压过对手' };
  // 规则 5.1 第 3 条 / 9.1：牌型与点数和皆同 → 后结算方判负
  const loser = secondHand(lineIdx, g.revealDir);
  const winner = loser === sA ? sB : sA;
  return { winner, reason: '平手：后结算方判负', tie: true };
}

// 执行夺旗：严格零和（规则 9.4 / 10.1）
export function resolveCapture(g, lineIdx, cellIdx) {
  const res = checkCapture(g, lineIdx, cellIdx);
  if (res.winner == null) return res;
  const line = g.lines[lineIdx];
  const cell = line.cells[cellIdx];
  if (!cell) return res;
  const [sA, sB] = lineSeats(lineIdx);
  const loser = res.winner === sA ? sB : sA;

  g.scores[res.winner] += 1;
  g.scores[loser] -= 1;
  g.captures[res.winner] += 1;
  cell.owner = res.winner;
  cell.decided = true; // 本轮不再重复判夺（规则 9.3）
  // v1.7：夺旗后该格「封存」——牌留在原位、归属定格；此后不可再佈军，战术牌也不可再影响这组牌。
  //   （旧规则 9.4 的「清空后重新佈军、可反复夺回」已废除。）
  cell.sealed = true;
  g.log.push(`战线${lineIdx + 1} 第${cellIdx + 1}格：${FACTIONS[res.winner].name} 夺旗（${res.reason}${res.lock ? ' · 常规手段下不可推翻' : ''}）· ${FACTIONS[res.winner].name}+1 / ${FACTIONS[loser].name}-1 · 该格封存`);
  return res;
}

// 规则 11.4：战术牌离场后放回来源中央势力区，继续供争夺。
// 保底：若来源区已被占（极端情形），放进任意空区 —— 绝不丢牌（曾因「来源区有牌就丢弃」
// 造成战术牌凭空消失）。
export function recycleTactic(g, tacticId) {
  const home = g.tacticHome[tacticId];
  if (home == null) return false;
  if (g.zones[home].tactics == null) { g.zones[home].tactics = tacticId; return true; }
  if (g.zones[home].tactics === tacticId) return false;   // 该牌本就在场上（不该发生）
  for (let j = 0; j < N_ZONES; j++) {
    if (j !== home && g.zones[j].tactics == null) { g.zones[j].tactics = tacticId; return true; }
  }
  // 6 区全满（理论上不可能：只有 6 张牌且本张正在离场）→ 挂到队列，下一回合末再试
  g.pendingRecycle.push(tacticId);
  return false;
}

// ---------------- 中央区「第一位」（规则 8.5 / 8.6 共用判定）----------------
// 某区唯一第一（影响力 ≥ 门槛且无并列）→ 返回 {seat, val}；否则 null。
// 并列第一既不能夺牌（8.5），也不能取得该区分数（8.6）。
export function zoneLeaderOf(g, zoneIdx) {
  const z = g.zones[zoneIdx];
  if (!z) return null;
  let best = null, bestVal = -1, tie = false;
  for (let seat = 0; seat < N_SEATS; seat++) {
    const v = playerZoneScore(g, z, seat);
    if (v > bestVal) { bestVal = v; best = seat; tie = false; }
    else if (v === bestVal && v > 0) tie = true;
  }
  if (best == null || tie || bestVal < CENTER_THRESHOLD) return null;
  return { seat: best, val: bestVal };
}

// 规则 8.5「无论战术牌在哪」：定位某张战术牌当前的位置
//   zone: 某个中央区待夺 | hand: 某玩家手中 | guile: 已落场（绑定来源中央区的计谋牌）
//   cell: 作为阵型牌附在某格 | env: 作为环境牌附在某格 | void: 不在任何位置（异常）
export function locateTactic(g, tacticId) {
  for (let j = 0; j < N_ZONES; j++) if (g.zones[j].tactics === tacticId) return { type: 'zone', zone: j };
  for (let s = 0; s < N_SEATS; s++) if (g.playerTactics[s].includes(tacticId)) return { type: 'hand', seat: s };
  // v1.2：落场的计谋牌（持久 · 可被夺取）——由 11.5 结算夺取，8.5 不夺取；但必须能定位，
  //       否则 UI 会把「已落场」误显示为「—／未知／牌库中」。
  const gb = (g.guileBoard || []).find(e => e.tacticId === tacticId);
  if (gb) return { type: 'guile', zone: gb.home, seat: gb.seat };
  for (let li = 0; li < N_LINES; li++) {
    const line = g.lines[li];
    for (let k = 0; k < line.cells.length; k++) {
      const cell = line.cells[k];
      for (const key of Object.keys(cell.sides)) {
        if ((cell.sides[key] || []).some(c => c.tactic === tacticId)) {
          return { type: 'cell', line: li, cell: k, seat: +key };
        }
      }
      for (const key of Object.keys(cell.env || {})) {
        if (cell.env[key] === tacticId) return { type: 'env', line: li, cell: k, seat: +key };
      }
    }
  }
  return { type: 'void' };
}

// 从定位到的位置把战术牌取出（不改变归属，只做移除）
function takeTacticFrom(g, tacticId, where) {
  if (where.type === 'zone') { g.zones[where.zone].tactics = null; return true; }
  if (where.type === 'hand') {
    const arr = g.playerTactics[where.seat];
    const i = arr.indexOf(tacticId);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  }
  if (where.type === 'cell') {
    const cell = g.lines[where.line].cells[where.cell];
    if (cell.sealed) return false;          // v1.7：封存格内的战术牌锁死，8.5 不可取走
    const arr = cell.sides[where.seat] || [];
    const i = arr.findIndex(c => c.tactic === tacticId);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  }
  if (where.type === 'env') {
    const cell = g.lines[where.line].cells[where.cell];
    if (cell.sealed) return false;          // v1.7：封存格的环境牌锁死，8.5 不可取走
    if (cell.env && cell.env[where.seat] === tacticId) {
      delete cell.env[where.seat];
      // v1.5：「多瑙河春汛」离场（被 8.5 夺走 / 结算回收）→ 该格容量由 4 回落到 3。
      // 超容的牌不再由引擎自动裁剪，而是登记为「待决」，由该侧玩家自行选择弃掉哪一张
      // （规则 11.5）。真正移除在 resolveFloodDiscards 完成，以保证「格内 ≤ 容量」不变量
      // 在本回合结算完毕前恢复；UI 可在其中途弹窗让人类决策，AI 侧用默认策略即时结算。
      const cap = cellCapacity(cell);
      let pendingCount = 0;
      for (const key of Object.keys(cell.sides)) {
        const arr = cell.sides[key];
        if (arr && arr.length > cap) {
          g.pendingFloodDiscard.push({ line: where.line, cell: where.cell, seat: +key, excess: arr.length - cap });
          pendingCount += arr.length - cap;
        }
      }
      if (pendingCount) {
        g.log.push(`「多瑙河春汛」离场：战线${where.line + 1} 第${where.cell + 1}格容量回落为 ${cap}，`
          + `超出容量 ${pendingCount} 张，由牌主选择弃掉（部队牌入弃牌堆 / 战术牌回来源区）`);
      }
      return true;
    }
    return false;
  }
  // guile（已落场的计谋牌）：夺取由 11.5 processGuileBoard 结算，8.5 不在此处直接取走
  return false;
}

// ---------------- v1.5 春汛离场「超容弃牌」待决（规则 11.5）----------------
// 春汛被 8.5 夺走（或结算离场）时该格容量 4→3，超出的牌由牌主玩家自行选择弃掉一张。
// 引擎把每个「某侧仍 > 容量」的格子登记为待决任务（见 takeTacticFrom），等
// resolveFloodDiscards 真正移除：部队牌 → 该战线弃牌堆；战术牌 → 规则 11.4 回流来源区
// （都不凭空消失）。UI 可逐个拦截让人类选牌，AI 侧用默认策略即时结算。
export function floodDiscardCandidates(g, task) {
  const cell = g.lines[task.line]?.cells?.[task.cell];
  if (!cell) return [];
  return (cell.sides[task.seat] || []).slice();
}

// 默认策略（AI）：从 4 张里去掉一张后，使剩余阵型（等级 > 主导张数 > 点数和）最强。
function autoFloodPicker(g, task, cards) {
  const dom = g.dominantSuit;
  let best = null, bestCard = cards[cards.length - 1];
  for (let i = 0; i < cards.length; i++) {
    const rest = cards.slice(0, i).concat(cards.slice(i + 1));
    const v = formationValue(rest, dom);
    if (!best || v.level > best.level
      || (v.level === best.level && v.dom > best.dom)
      || (v.level === best.level && v.dom === best.dom && v.pts > best.pts)) {
      best = v; bestCard = cards[i];
    }
  }
  return bestCard;
}

// 结算单个待决任务：pickFn(g, task, cards) → 要弃掉的牌（对象或下标）；缺省用 autoFloodPicker。
// 返回 { seat, line, cell, card }；该侧已满足容量则返回 null。
export function resolveOneFloodDiscard(g, task, pickFn) {
  const cell = g.lines[task.line]?.cells?.[task.cell];
  if (!cell) return null;
  const arr = cell.sides[task.seat] || [];
  if (arr.length <= cellCapacity(cell)) return null;      // 已满足，无需再弃
  let card = (pickFn || autoFloodPicker)(g, task, arr.slice());
  if (typeof card === 'number') card = arr[card];
  if (!card || arr.indexOf(card) < 0) card = arr[arr.length - 1];   // 兜底：弃最后一张
  arr.splice(arr.indexOf(card), 1);
  if (card.tactic) recycleTactic(g, card.tactic);
  else g.lines[task.line].discard.push(card);
  return { seat: task.seat, line: task.line, cell: task.cell, card };
}

// 结算全部待决（runRound / finishRound 的默认自动路径）。
export function resolveFloodDiscards(g, pickFn) {
  const events = [];
  const queue = g.pendingFloodDiscard || [];
  g.pendingFloodDiscard = [];
  for (const task of queue) {
    let guard = 0;
    while (guard++ < 8) {
      const ev = resolveOneFloodDiscard(g, task, pickFn);
      if (!ev) break;
      events.push(ev);
    }
  }
  return events;
}

// ---------------- 战术牌夺取（规则 8.5）----------------
// 规则原文要点：「他获得该区上那张战术牌进入手牌」+「无论战术牌在哪 …… 也归其手牌」。
// 因此判定不看「该区此刻有没有牌」，而是看「该区绑定的那张牌现在在哪」：
//   在别的区待夺 / 在别人手里 / 已作为阵型牌或环境牌打在场上 —— 一律取出交给夺牌者。
export function checkTacticsWin(g, zoneIdx) {
  const z = g.zones[zoneIdx];
  if (!z) return null;
  const L = zoneLeaderOf(g, zoneIdx);
  if (!L) return null;
  const tac = g.zoneTactic[zoneIdx] ?? z.tactics;
  if (!tac) return null;
  if (g.playerTactics[L.seat].includes(tac)) return null;   // 已在该玩家手中，不重复结算
  const where = locateTactic(g, tac);
  if (!takeTacticFrom(g, tac, where)) return null;
  g.playerTactics[L.seat].push(tac);
  // v1.7：8.5 获得战术牌同样发放「无消耗立即打出」额度（规则 11.3：8.5 / 11.5 皆可）
  g.pendingFreePlay[L.seat].push(tac);
  g.tacticsWonCount += 1;
  const fromTxt = where.type === 'zone' ? '中央区待夺'
    : where.type === 'hand' ? `从 ${FACTIONS[where.seat].name} 手中`
      : '从战场上（已打出）';
  g.log.push(`中心区「${z.name}」：${FACTIONS[L.seat].name} 影响力 ${L.val} ≥ ${CENTER_THRESHOLD} 且排名第一，夺得战术牌「${TACTIC_BY_ID[tac].name}」（${fromTxt}）`);
  return { winner: L.seat, tactic: tac, zone: zoneIdx, from: where.type };
}
export function checkAllTacticsWins(g) {
  const out = [];
  for (let z = 0; z < N_ZONES; z++) {
    const r = checkTacticsWin(g, z);
    if (r) out.push(r);
  }
  return out;
}

// ---------------- 中央区占位计分（规则 8.6）----------------
// 每个中央区是一个可易主的 1 分得分点：
//   新区主 +1；若该区原有主，则旧主 −1（严格零和）。
//   开局各区无主，首次夺取只 +1、无人扣分（唯一一次非零和）。
//   已持有该区者再次达成第一不重复计分（防止原地刷分）。
export function checkZoneScore(g, zoneIdx) {
  if (!g.zones[zoneIdx]) return null;
  const L = zoneLeaderOf(g, zoneIdx);
  if (!L) return null;
  const prev = g.zoneHolder[zoneIdx];
  if (prev === L.seat) return null;
  g.zoneHolder[zoneIdx] = L.seat;
  g.scores[L.seat] += ZONE_POINT;
  g.centerScores[L.seat] += ZONE_POINT;
  g.zoneHolds[L.seat] += 1;
  if (prev != null) {
    g.scores[prev] -= ZONE_POINT;
    g.centerScores[prev] -= ZONE_POINT;
  }
  g.log.push(`中心区「${g.zones[zoneIdx].name}」第一：${FACTIONS[L.seat].name} 影响力 ${L.val}`
    + `${prev == null ? '（该区首次易主，+1）' : `，取代 ${FACTIONS[prev].name}（+1 / −1）`}`);
  return { zone: zoneIdx, winner: L.seat, prev, val: L.val };
}
export function checkAllZoneScores(g) {
  const out = [];
  for (let z = 0; z < N_ZONES; z++) {
    const r = checkZoneScore(g, z);
    if (r) out.push(r);
  }
  return out;
}

// ---------------- v1.2 计谋牌落场：夺取 / 回滚（规则 11.5）----------------
// 按「模型 + 牌位」把一次计谋效果恢复原样。已决出（decided）的旗幟不受影响（规则 11.5 第 3 条）。
//
// v1.4（用户定稿）：「虚空站位」只是虚空，**不占格位** —— 原格位可以照常继续佈军。
//   因此当计谋牌失效（被夺取）需要回滚时：
//     · 原格位**还有空位** → 牌回归原样；
//     · 原格位**已被占满**（或战场本回合已结算）→ 该牌**不回归**：
//         弃型（哗变 / 换防弃牌）→ 就此弃入该战线弃牌堆；
//         移型（换防移动 / 倒戈）  → 留在被移去的位置。
//   这条规则同时保证了「一格任一侧 ≤ 容量」这一硬不变量（否则回滚会推出 4 张）。
function rollbackGuile(g, entry) {
  let reverted = 0, skipped = 0, blocked = 0;   // blocked：虚空站位已被占 → 不回归
  for (const u of entry.undo || []) {
    if (u.type === 'move') {
      const src = g.lines[u.line]?.cells?.[u.fromCell];
      const dstCell = g.lines[u.line]?.cells?.[u.toCell];
      const dstArr = dstCell?.sides?.[u.toSeat] || [];
      const i = dstArr.indexOf(u.card);
      if (i < 0) { skipped++; continue; }                     // 牌已随目标格结算离场 → 无需再动
      // 来源格本回合已结算（已清空）→ 按「已完成夺旗的战场不改结果」不回滚；牌留在现处
      if (!src || src.decided) { skipped++; continue; }
      // 目标格已决出 / 已封存 → 该牌已随这面旗定格：规则 11.5 第 4 条「已分出胜负的
      //   旗幟不受影响」+ 11.2「已夺旗幟上的牌不可被任何计谋影响」→ 不得把牌从封存格
      //   里取回（曾因漏此检查，换防/倒戈移到对手 lock 格里的牌被回滚拽出封存格）。
      if (!dstCell || dstCell.decided || dstCell.sealed) { skipped++; continue; }
      // v1.4：虚空站位被占（原格位已无空位）→ 不回归，牌留在被移去的位置
      if ((src.sides[u.fromSeat] || []).length >= cellCapacity(src)) { blocked++; continue; }
      dstArr.splice(i, 1);
      if (!src.sides[u.fromSeat]) src.sides[u.fromSeat] = [];
      src.sides[u.fromSeat].push(u.card);
      reverted++;
    } else if (u.type === 'discard') {
      const src = g.lines[u.line]?.cells?.[u.cell];
      const i = g.guileHold.indexOf(u.card);     // 从隔离区取回被「模型压住」的牌
      if (i < 0) { skipped++; continue; }
      if (!src || src.decided || (src.sides[u.seat] || []).length >= cellCapacity(src)) {
        // v1.4：虚空站位被占 / 战场本回合已结算 → 不回归；该牌就此弃入本战线弃牌堆
        //       （原本就是被弃的牌），既不会凭空消失，也不会把格位挤到容量以上。
        g.guileHold.splice(i, 1);
        g.lines[u.line].discard.push(u.card);
        if (src && !src.decided) blocked++; else skipped++;
        continue;
      }
      g.guileHold.splice(i, 1);
      if (!src.sides[u.seat]) src.sides[u.seat] = [];
      src.sides[u.seat].push(u.card);
      reverted++;
    } else if (u.type === 'scout') {
      const line = g.lines[u.line];
      const hand = g.hands[u.seat][u.line] || [];
      for (const c of u.drawn) {                 // 未被使用的抽出牌 → 回牌堆顶
        const i = hand.indexOf(c);
        if (i >= 0) { hand.splice(i, 1); line.deck.push(c); reverted++; }
      }
      for (const c of u.covered) {                // 被模型压住的 2 张 → 从隔离区拿回牌堆顶
        const di = g.guileHold.indexOf(c);
        if (di >= 0) { g.guileHold.splice(di, 1); line.deck.push(c); reverted++; }
      }
    }
  }
  return { reverted, skipped, blocked };
}

// 回合末中心结算：处理所有落场计谋牌（v1.2 简化：只有「被超越」才结算）
//   · 仍为该区唯一第一 → 保留
//   · 该区无唯一第一（被追平 / 未达门槛）→ 保留（不结算、不退回中央）
//   · 该区唯一第一易主（被超越）→ 被新领先者夺取：回滚 + 卡归其手（附「无消耗立即打出」额度）
export function processGuileBoard(g) {
  const events = [];
  const remain = [];
  for (const e of g.guileBoard) {
    const L = e.home != null ? zoneLeaderOf(g, e.home) : null;
    // 「被追平」（无唯一第一）不结算：牌留在场上、效果不撤销，便于结算；
    // 只有被明确超越（存在唯一第一且非原持有者）才夺取。
    if (!L || L.seat === e.seat) { remain.push(e); continue; }
    const rb = rollbackGuile(g, e);
    const zname = e.home != null ? g.zones[e.home].name : '—';
    const tname = TACTIC_BY_ID[e.tacticId] ? TACTIC_BY_ID[e.tacticId].name : e.tacticId;
    g.playerTactics[L.seat].push(e.tacticId);
    g.pendingFreePlay[L.seat].push(e.tacticId);
    g.tacticsWonCount += 1;
    g.log.push(`中央区「${zname}」领先被超越：${FACTIONS[L.seat].name} 直接夺取计谋牌「${tname}」`
      + `（原持有 ${FACTIONS[e.seat].name}；效果按模型/牌位回滚 ${rb.reverted} 处`
      + `${rb.blocked ? `，${rb.blocked} 处因虚空站位已被占而未回归` : ''}`
      + `${rb.skipped ? `，${rb.skipped} 处因旗幟已决出而未回滚` : ''}）`);
    events.push({
      type: 'guile-captured', zone: e.home, from: e.seat, to: L.seat, tactic: e.tacticId,
      reverted: rb.reverted, skipped: rb.skipped, blocked: rb.blocked,
    });
  }
  g.guileBoard = remain;
  return events;
}

// ---------------- v1.2 无消耗立即打出 ----------------
// 通过 8.5 / 夺取获得的战术牌，可在持有额度内「零行动消耗」立即打出一次。
export function hasFreePlay(g, seat, tacticId) {
  return (g.pendingFreePlay?.[seat] || []).includes(tacticId);
}
export function useFreePlay(g, seat, action) {
  const id = action && action.tacticId;
  if (!hasFreePlay(g, seat, id)) return { ok: false, why: '该战术牌无「无消耗立即打出」额度' };
  return applyAction(g, seat, action);
}

// v1.7：结算「无消耗立即打出」待决。获得战术牌的当下（8.5 / 11.5），持有者可选零行动消耗立即打出。
//   pickFn(g, seat, tacticId) → 返回一个 action（立即打出）或 null（留着，之后按 11.3 花一次暗扣行动打出）。
// v1.8：结算起始席按回合轮换（g.round % N_SEATS），消除「固定 0→7」对先手席的系统性偏斜——
//   多席同回合持有免费打出额度时，原先恒为席位号小者先结算，造成 seat0 结构性占优。
let FREEPLAY_FAIR_ORDER = true;
export function setFreePlayFair(v) { FREEPLAY_FAIR_ORDER = !!v; }
export function resolveFreePlays(g, pickFn) {
  const events = [];
  if (!pickFn) return events;
  const order = [];
  if (FREEPLAY_FAIR_ORDER) {
    const start = ((g.round || 0) % N_SEATS + N_SEATS) % N_SEATS;   // 每回合轮换起始席
    for (let k = 0; k < N_SEATS; k++) order.push((start + k) % N_SEATS);
  } else {
    for (let seat = 0; seat < N_SEATS; seat++) order.push(seat);    // 旧行为：固定 0→7
  }
  for (const seat of order) {
    const ids = (g.pendingFreePlay[seat] || []).slice();
    for (const id of ids) {
      if (!g.pendingFreePlay[seat].includes(id)) continue;    // 已被消耗
      let action = null;
      try { action = pickFn(g, seat, id); } catch (e) { action = null; }
      if (!action) continue;                                  // 选择留着
      const r = useFreePlay(g, seat, action);
      if (r && r.ok) events.push({ seat, tacticId: id, action });
    }
  }
  return events;
}

// ---------------- 回合流程（规则 6.1）----------------
// 摊开：从标记线起沿指示器方向逐线结算
// centerPicker(pending) → 该行动的中心行动选择。缺省时用暗扣时提交的 p.center（AI 提交式）。
// UI 可用它让玩家在「亮牌之后、比牌之前」才决定（规则 6.2 第 2 条）。
export function revealLine(g, lineIdx, centerPicker) {
  const events = [];
  // 8.2 中心行动：本线本回合打出的部队牌，按牌色二选一
  for (const p of g._round.pending) {
    if (p.lineIdx !== lineIdx || p.kind !== 'troop') continue;
    const choice = centerPicker ? centerPicker(p) || p.center : p.center;
    applyCenterAction(g, p.seat, p.card.suit, choice);
  }
  // 9 夺旗判定
  for (let k = 0; k < CELLS_PER_LINE; k++) {
    const r = resolveCapture(g, lineIdx, k);
    if (r.winner != null) events.push({ line: lineIdx, cell: k, winner: r.winner, reason: r.reason, tie: !!r.tie, lock: !!r.lock });
  }
  // 7.3 补牌：本线打出部队牌者各补 1 张（战术牌替代暗扣不补牌，规则 7.4）
  for (const p of g._round.pending) {
    if (p.lineIdx !== lineIdx || p.kind !== 'troop') continue;
    if (g._round.noRefill.has(`${p.seat}:${lineIdx}`)) continue;
    refill(g, p.seat, lineIdx);
  }
  return events;
}

export function revealAll(g, centerPicker) {
  const events = [];
  const order = revealOrder(g.markerLine, g.revealDir);
  for (const li of order) events.push(...revealLine(g, li, centerPicker));
  return events;
}

// 规则 10.2（v1.5）：某玩家「旗子数」= 累计夺得的旗幟格数 + 当前持有的中央区数
// （中央区每区算 1 面旗）。用于终局触发与排名破平。
export function zoneHoldCount(g, seat) {
  let n = 0;
  for (let z = 0; z < N_ZONES; z++) if (g.zoneHolder[z] === seat) n++;
  return n;
}
export function flagTotal(g, seat) {
  return (g.captures[seat] || 0) + zoneHoldCount(g, seat);
}

// 规则 10.2：终局条件（g.mode：'short' 短游戏 / 'long' 长游戏）
function checkEnd(g) {
  // 短游戏：任一玩家旗子数达 12 → 终局（长游戏忽略此条）
  if (g.mode !== 'long' && g.captures.some((_, s) => flagTotal(g, s) >= WIN_FLAGS)) {
    g.over = true;
    g.winner = topSeat(g);            // 按 总分 → 旗子数 → 中央区数 排名
    g.endReason = 'flags';
    return 'flags';
  }
  // 棋盘封满——所有格位均已封存（无处可再佈军）→ 终局（短 / 长皆可）
  if (g.lines.every(l => l.cells.every(c => c.sealed))) {
    g.over = true; g.endReason = 'board'; g.winner = topSeat(g); return 'board';
  }
  // 长游戏：所有玩家「打空所有手牌」→ 终局
  if (g.mode === 'long'
    && g.hands.every(h => Object.values(h).every(a => !a || a.length === 0))) {
    g.over = true; g.endReason = 'hands'; g.winner = topSeat(g); return 'hands';
  }
  const allExhausted = g.lines.every(
    l => l.deck.length === 0 && l.discard.length === 0 && l.reshuffles >= RESHUFFLES_TO_END
  );
  if (allExhausted) { g.over = true; g.endReason = 'deck'; g.winner = topSeat(g); return 'deck'; }
  if (g.round > MAX_ROUNDS) { g.over = true; g.endReason = 'maxrounds'; g.winner = topSeat(g); return 'maxrounds'; }
  return null;
}

function topSeat(g) {
  return finalRanking(g)[0].seat;
}

// 回合末（规则 6.1 ③④⑤）
// opts.deferFlood=true：春汛离场「超容弃牌」保留为待决，交由界面逐个让玩家选择；
//                       否则默认即时结算（AI 策略）。
export function endRound(g, opts) {
  const o = opts || {};
  // v1.2：计谋牌落场结算（夺取 / 回滚）——必须排在清除「已决出」标记之前，
  // 以保留「已完成夺旗的战场不改变结果」的判定依据（规则 11.5）。
  const guileEvents = processGuileBoard(g);
  // 清掉本轮「已决出」标记：规则 9.4 清空后的格可重新佈军再战
  for (const l of g.lines) for (const c of l.cells) c.decided = !!c.sealed;   // v1.7：封存格永久保持「已决出」
  // 回流队列（保底）：把暂存的战术牌放回场上，确保 6 张牌始终可被争夺
  if (g.pendingRecycle.length) {
    const queue = g.pendingRecycle;
    g.pendingRecycle = [];
    for (const id of queue) recycleTactic(g, id);
  }
  // ③ 中心结算：主导花色 + 战术牌夺取 + 占位计分（规则 8.5 / 8.6 / 8.7）
  g.dominantSuit = computeDominantSuit(g);
  const tacWins = checkAllTacticsWins(g);   // 春汛若被夺走，会在此登记「超容弃牌」待决
  const zoneWins = checkAllZoneScores(g);
  // v1.7：「无消耗立即打出」——获得战术牌的当下可零消耗立即打出。
  //   必须在 g._round 清空前处理（applyAction 的计谋牌分支依赖 _round 上下文）。
  //   UI 传 freePicker 以交互/策略决定；未传则保留额度、留到之后按普通行动打出。
  let freePlays = null;
  if (o.freePicker) freePlays = resolveFreePlays(g, o.freePicker);
  // v1.8：免费打出额度「当回合不用即作废」——8.5 / 11.5 在回合末发放，本回合
  //   resolveFreePlays 未使用的额度，回合结束时清空，不跨回合保留。
  //   战术牌本身仍留在该玩家手牌，之后按规则 11.3 花一次暗扣行动正常打出即可。
  for (let s = 0; s < N_SEATS; s++) g.pendingFreePlay[s] = [];
  // ④ 方向指示器翻面 + 标记逆时针迁移
  g.revealDir = -g.revealDir;
  g.markerLine = (g.markerLine - 1 + N_LINES) % N_LINES;
  g.round += 1;
  g._round = null;
  // ⑤ 终局检查
  const end = checkEnd(g);
  // v1.5：春汛离场「超容弃牌」——默认自动结算（保留最强 3 张）；deferFlood 时留给 UI。
  let floodDiscards = null;
  if ((g.pendingFloodDiscard || []).length && !o.deferFlood) {
    floodDiscards = resolveFloodDiscards(g, o.floodPicker);
  }
  // v1.7：「无消耗立即打出」已在上文（g._round 清空前）处理。
  return { tacWins, zoneWins, guileEvents, end, floodDiscards, freePlays };
}

// 完整一个回合：① 暗扣 → ② 摊开 → ③ 中心结算 → ④ 标记迁移 → ⑤ 终局
// chooser(g, seat) → 该席本回合的动作数组（其两条战线各至多 1 个）
// 分步 UI 可改为：collectRound → 逐线 revealLine（可中断等待玩家选中心行动）→ finishRound
export function collectRound(g, chooser) {
  if (g.over) return { ok: false, why: '游戏已结束' };
  g._round = { pending: [], noRefill: new Set() };
  const applied = [];
  const errors = [];

  // ① 暗扣：规则 6.2 明确「全桌同时暗扣」。
  // 必须先把全部 8 席的决策收集完，再统一落子 —— 否则按席号顺序执行会让后手席位
  // 观察到先手已扣的牌，造成席 0 恒处于信息劣势、席 7 恒占优的系统性偏斜。
  const plans = [];
  for (let seat = 0; seat < N_SEATS; seat++) {
    plans.push({ seat, acts: (chooser(g, seat) || []).slice(0, 2) });
  }

  for (const { seat, acts } of plans) {
    const seen = new Set();
    for (const a of acts) {
      if (seen.has(a.line)) { errors.push(`席${seat} 在战线${a.line + 1} 重复行动`); continue; }
      seen.add(a.line);
      const r = applyAction(g, seat, a);
      applied.push({ seat, action: a, result: r });
      if (!r.ok) errors.push(`席${seat}: ${r.why}`);
    }
  }
  return { ok: true, applied, errors };
}

// 规则 6.1 ③④⑤：中心结算（主导花色 / 夺战术牌）+ 指示器翻面 + 标记迁移 + 终局检查
export function finishRound(g, opts) { return endRound(g, opts); }

export function runRound(g, chooser, centerPicker, opts) {
  let r = collectRound(g, chooser);
  if (!r.ok) return r;
  const events = revealAll(g, centerPicker);
  // freePlays 必须传出：UI 自动模式（index.src.html logRound）靠它播「无消耗立即打出」，
  //   探针也靠它区分常规行动 / 8.5 免费打出两条执行路径（曾因丢字段而不可见）。
  const { tacWins, zoneWins, guileEvents, end, floodDiscards, freePlays } = finishRound(g, opts);
  return { ok: true, applied: r.applied, events, tacWins, zoneWins, guileEvents, end, floodDiscards, freePlays, errors: r.errors };
}

// ---------------- 开局布置领袖 ----------------
// 规则依据：2.1「领袖模型 每人 1 个，用于中心区域移动」。规则书未规定初始位置，
// 故 createGame 给的默认落点只是兜底值；正式开局应由每位玩家自选起始区
// （轮流次序沿用 8.3「按战场标记顺时针」）。此环节不触发 8.5 夺牌检查。
export function setInitialLeader(g, seat, zone) {
  if (!Number.isInteger(zone) || zone < 0 || zone >= N_ZONES) return { ok: false, why: '区号无效' };
  g.leaders[seat] = zone;
  return { ok: true };
}
export function applyInitialLeaders(g, pickFn) {
  for (let s = 0; s < N_SEATS; s++) setInitialLeader(g, s, pickFn(g, s));
  return true;
}
// AI 启发式：把自己两条战线的主色区作为起始落点（同分时用 rng 扰动，保持可复现）
export function suggestInitialLeader(g, seat) {
  const counts = Array(N_ZONES).fill(0);
  for (const li of playerLines(seat)) {
    for (const c of g.hands[seat][li] || []) if (!c.tactic) counts[c.suit] += 1;
  }
  const max = Math.max(...counts);
  const best = counts.map((v, i) => [v, i]).filter(([v]) => v === max).map(([, i]) => i);
  if (best.length === 1) return best[0];
  return best[Math.min(best.length - 1, Math.floor(g.rng() * best.length))];
}

// 规则 10.3（v1.5）：总分最高者胜；同分比旗子总数；仍同比当前持有的中央区数；再同则并列。
//   （「旗子」在此指累计夺得的旗幟格数 captures；中央区单独作为第二级破平，与 10.2 的合计口径区分。）
export function finalRanking(g) {
  return Array.from({ length: N_SEATS }, (_, i) => ({
    seat: i, score: g.scores[i], captures: g.captures[i], zones: zoneHoldCount(g, i),
  })).sort((a, b) => (b.score - a.score) || (b.captures - a.captures) || (b.zones - a.zones) || (a.seat - b.seat));
}
