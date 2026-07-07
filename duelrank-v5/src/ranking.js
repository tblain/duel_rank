import { pairKey } from './utils.js';

export const sessionVersion = 5;

export function createSession(items, options) {
  const normalized = items.map((item, index) => ({
    ...item,
    id: item.id ?? index + 1,
    wins: item.wins || 0,
    losses: item.losses || 0,
    ties: item.ties || 0,
    checks: item.checks || 0,
    rating: item.rating ?? 0,
    rd: item.rd ?? 1.8,
    duels: item.duels || 0,
    exposure: item.exposure || 0,
    tierLocked: item.tierLocked || '',
  }));
  const ranking = spreadItems(normalized).map((item) => item.id);
  return {
    version: sessionVersion,
    items: normalized,
    itemIndex: null,
    phase: 'active',
    objective: options.objective || 'global',
    stopMode: options.stopMode || 'budget',
    activeBudget: options.activeBudget || 500,
    calibrationTarget: options.calibrationTarget ?? 1,
    repeatMax: options.repeatMax || 3,
    repeatWindow: options.repeatWindow || 10,
    tiers: options.tiers || [],
    rankView: 'list',
    history: [],
    decisions: [],
    comparisons: {},
    recentIds: [],
    ranking,
    result: null,
    duels: 0,
    contradictions: [],
    tierChanges: [],
    dashboard: {},
    currentPair: null,
    lastPairReason: '',
  };
}

export function hydrateSession(state) {
  state.version = sessionVersion;
  state.items = state.items || [];
  state.itemIndex = new Map(state.items.map((item) => [item.id, item]));
  state.history = state.history || [];
  state.decisions = state.decisions || [];
  state.comparisons = state.comparisons || {};
  state.recentIds = state.recentIds || [];
  state.ranking = state.ranking?.length ? state.ranking : currentOrder(state);
  state.contradictions = state.contradictions || [];
  state.tierChanges = state.tierChanges || [];
  state.dashboard = state.dashboard || {};
  for (const item of state.items) {
    item.wins ??= 0;
    item.losses ??= 0;
    item.ties ??= 0;
    item.checks ??= 0;
    item.rating ??= 0;
    item.rd ??= 1.8;
    item.duels ??= (item.wins || 0) + (item.losses || 0) + (item.ties || 0);
    item.exposure ??= item.duels || 0;
    item.tierLocked ??= '';
  }
  return state;
}

export function cloneForHistory(state) {
  return {
    items: structuredClone(state.items),
    ranking: state.ranking.slice(),
    result: state.result ? state.result.slice() : null,
    comparisons: structuredClone(state.comparisons),
    decisions: structuredClone(state.decisions),
    recentIds: state.recentIds.slice(),
    duels: state.duels,
    contradictions: structuredClone(state.contradictions),
    tierChanges: structuredClone(state.tierChanges),
    currentPair: state.currentPair ? { ...state.currentPair } : null,
    phase: state.phase,
  };
}

export function restoreHistory(state, snapshot) {
  Object.assign(state, snapshot);
  hydrateSession(state);
}

export function persistableState(state) {
  const copy = { ...state, history: [], itemIndex: null, currentPair: null };
  return copy;
}

export function item(state, id) {
  if (!state.itemIndex) hydrateSession(state);
  return state.itemIndex.get(id);
}

export function currentOrder(state) {
  if (state.phase === 'done' && state.result) return state.result.slice();
  return state.items.slice().sort((a, b) => b.rating - a.rating || a.rd - b.rd || a.id - b.id).map((x) => x.id);
}

export function reorder(state) {
  state.ranking = currentOrder({ ...state, phase: 'active', result: null });
  applyTierProposals(state);
  return state.ranking;
}

export function btProb(left, right) {
  return 1 / (1 + Math.exp(right.rating - left.rating));
}

export function confidenceFor(item) {
  const exposure = Math.min(1, (item.duels || 0) / 8);
  const certainty = Math.max(0, Math.min(1, 1 - ((item.rd ?? 1.8) - 0.25) / 1.55));
  return Math.round((0.42 * exposure + 0.58 * certainty) * 100);
}

export function tierIndexForRank(position, total, tiers) {
  if (!tiers.length) return 0;
  return Math.min(tiers.length - 1, Math.floor(position * tiers.length / Math.max(1, total)));
}

export function applyTierProposals(state) {
  const order = currentOrder(state);
  const tiers = state.tiers || [];
  const previous = new Map(state.items.map((x) => [x.id, x.tierProposal || '']));
  order.forEach((id, index) => {
    const obj = item(state, id);
    const proposed = tiers[tierIndexForRank(index, order.length, tiers)]?.name || '';
    const next = obj.tierLocked || proposed;
    obj.tierProposal = next;
    obj.tierConfidence = obj.tierLocked ? 'verrouille' : confidenceFor(obj) >= 72 ? 'fort' : confidenceFor(obj) >= 45 ? 'moyen' : 'faible';
    const old = previous.get(id);
    if (old && old !== next) state.tierChanges.unshift({ at: state.duels, text: `${obj.nom}: ${old} -> ${next}` });
  });
  state.tierChanges = state.tierChanges.slice(0, 8);
}

export function setTierLock(state, id, tierName) {
  const obj = item(state, id);
  obj.tierLocked = obj.tierLocked === tierName ? '' : tierName;
  applyTierProposals(state);
}

export function stopInfo(state) {
  const confidences = state.items.map(confidenceFor);
  const avg = confidences.reduce((a, b) => a + b, 0) / Math.max(1, confidences.length);
  const topCount = Math.min(10, state.items.length);
  const topAvg = currentOrder(state).slice(0, topCount).map((id) => confidenceFor(item(state, id))).reduce((a, b) => a + b, 0) / Math.max(1, topCount);
  const tierStable = state.items.filter((obj) => confidenceFor(obj) >= 58 || obj.tierLocked).length / Math.max(1, state.items.length);
  const budgetHit = state.duels >= state.activeBudget;
  const smartHit = state.stopMode === 'confidence' && avg >= 72
    || state.stopMode === 'top' && topAvg >= 78 && state.duels >= state.items.length
    || state.stopMode === 'tiers' && tierStable >= 0.9 && state.duels >= state.items.length;
  return { budgetHit, smartHit, avg, topAvg, tierStable, shouldStop: budgetHit || smartHit };
}

export function nextPair(state) {
  hydrateSession(state);
  if (stopInfo(state).shouldStop) return null;
  const underCalibrated = state.items.filter((obj) => (obj.exposure || 0) < (state.calibrationTarget || 0));
  if (underCalibrated.length) {
    const pair = calibrationPair(state, underCalibrated);
    if (pair) return pair;
  }
  const pair = bestPair(state, false) || bestPair(state, true);
  state.currentPair = pair;
  return pair;
}

function calibrationPair(state, underCalibrated) {
  const counts = recentCounts(state);
  const left = underCalibrated.slice().sort((a, b) => (a.exposure || 0) - (b.exposure || 0) || a.id - b.id)[0];
  const order = currentOrder(state);
  const position = Math.max(0, order.indexOf(left.id));
  const candidates = order.map((id, index) => ({ obj: item(state, id), distance: Math.abs(index - position) }))
    .filter(({ obj }) => obj.id !== left.id)
    .sort((a, b) => a.distance - b.distance || (a.obj.exposure || 0) - (b.obj.exposure || 0));
  const match = candidates.find(({ obj }) => pairAllowed(state, left.id, obj.id, counts, false)) || candidates[0];
  return match ? makePair(state, left.id, match.obj.id, 'calibration', 999, 'calibration: chaque objet doit apparaitre au moins une fois') : null;
}

function bestPair(state, relaxed) {
  const order = currentOrder(state);
  const counts = recentCounts(state);
  const candidates = [];
  const tiers = state.tiers || [];
  const n = order.length;
  const objective = state.objective || 'global';
  const maxGap = objective === 'complete' ? Math.ceil(Math.sqrt(n) * 2) : objective === 'top' ? Math.ceil(n / 3) : Math.ceil(Math.sqrt(n) + 4);
  const topLimit = objective === 'top' ? Math.min(n, 20) : n;
  const targetZone = zoneTarget(state, n);
  for (let i = 0; i < topLimit; i++) {
    for (let gap = 1; gap <= maxGap; gap++) {
      if (i + gap >= n) continue;
      const a = item(state, order[i]);
      const b = item(state, order[i + gap]);
      if (!relaxed && !pairAllowed(state, a.id, b.id, counts, false)) continue;
      if (relaxed && !pairAllowed(state, a.id, b.id, counts, true)) continue;
      const cand = scoreCandidate(state, a, b, i, i + gap, gap, targetZone, tiers, relaxed);
      candidates.push(cand);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.gap - b.gap);
  const best = candidates[0];
  return best ? makePair(state, best.left, best.right, best.reason, best.score, best.explain) : null;
}

function scoreCandidate(state, a, b, ia, ib, gap, targetZone, tiers, relaxed) {
  const p = btProb(a, b);
  const uncertainty = p * (1 - p) * 4;
  const rdBoost = ((a.rd ?? 1) + (b.rd ?? 1)) / 2;
  const avgExposure = state.items.reduce((sum, obj) => sum + (obj.exposure || 0), 0) / Math.max(1, state.items.length);
  const underExposure = Math.max(0, avgExposure + 1 - (a.exposure || 0)) + Math.max(0, avgExposure + 1 - (b.exposure || 0));
  const exposureBoost = 1 + underExposure * 0.35;
  const pairSeen = comparisonCount(state, a.id, b.id);
  const pairPenalty = 1 / (1 + pairSeen * 2.8);
  const gapWeight = 1 / Math.sqrt(gap);
  const zone = Math.floor(((ia + ib) / 2) / Math.max(1, state.items.length) * Math.max(1, Math.ceil(Math.sqrt(state.items.length))));
  const zoneSpread = 1 / (1 + Math.abs(zone - targetZone) * 0.9);
  const tierBoundary = tiers.length && tierIndexForRank(ia, state.items.length, tiers) !== tierIndexForRank(ib, state.items.length, tiers) ? 1.75 : 1;
  const contradiction = contradictionBoost(state, a.id, b.id);
  const objective = objectiveBoost(state, ia, ib, tierBoundary);
  const relaxedPenalty = relaxed ? 0.25 : 1;
  const score = uncertainty * rdBoost * exposureBoost * pairPenalty * gapWeight * zoneSpread * tierBoundary * contradiction * objective * relaxedPenalty;
  const reason = contradiction > 1.2 ? 'contradiction' : tierBoundary > 1 ? 'frontiere de tier' : uncertainty > 0.9 ? 'incertitude forte' : 'information attendue';
  return { left: a.id, right: b.id, score, gap, reason, explain: `${reason} · score ${score.toFixed(3)}` };
}

function objectiveBoost(state, ia, ib, tierBoundary) {
  if (state.objective === 'tiers') return tierBoundary > 1 ? 2.1 : 0.85;
  if (state.objective === 'top') return ib < 20 ? 1.8 : ia < 20 ? 1.2 : 0.45;
  if (state.objective === 'complete') return 1.15;
  return 1;
}

function contradictionBoost(state, a, b) {
  const involved = state.contradictions.filter((cycle) => cycle.ids.includes(a) && cycle.ids.includes(b)).length;
  return 1 + involved * 0.8;
}

function zoneTarget(state, n) {
  const zones = Math.max(1, Math.ceil(Math.sqrt(n)));
  const step = coprimeStep(zones);
  return (state.duels * step) % zones;
}

function makePair(state, left, right, reason, score, explain) {
  const pair = { left, right, kind: reason, score, explain };
  state.currentPair = pair;
  state.lastPairReason = explain || reason;
  return pair;
}

function recentCounts(state) {
  const counts = {};
  for (const id of state.recentIds.slice(-(state.repeatWindow || 10) * 2)) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

function pairAllowed(state, a, b, counts, relaxed) {
  const max = state.repeatMax || 3;
  if (relaxed) return (counts[a] || 0) <= max + 1 && (counts[b] || 0) <= max + 1;
  return (counts[a] || 0) < max && (counts[b] || 0) < max;
}

function comparisonRecord(state, a, b) {
  const key = pairKey(a, b);
  state.comparisons[key] ??= { a: Math.min(a, b), b: Math.max(a, b), aWins: 0, bWins: 0, ties: 0, count: 0 };
  return state.comparisons[key];
}

function comparisonCount(state, a, b) {
  return state.comparisons[pairKey(a, b)]?.count || 0;
}

export function choose(state, outcome) {
  const pair = state.currentPair || nextPair(state);
  if (!pair) return null;
  state.history.push(cloneForHistory(state));
  state.history = state.history.slice(-30);
  const left = item(state, pair.left);
  const right = item(state, pair.right);
  if (outcome === 'tie') {
    applyTie(left, right);
    left.ties++;
    right.ties++;
  } else {
    const win = outcome === 'left' ? left : right;
    const lose = outcome === 'left' ? right : left;
    applyWin(win, lose);
    win.wins++;
    lose.losses++;
  }
  left.duels++;
  right.duels++;
  left.exposure++;
  right.exposure++;
  left.checks++;
  right.checks++;
  state.duels++;
  state.recentIds = [...state.recentIds, left.id, right.id].slice(-(state.repeatWindow || 10) * 2);
  const record = comparisonRecord(state, left.id, right.id);
  if (outcome === 'tie') record.ties++;
  else if ((outcome === 'left' && record.a === left.id) || (outcome === 'right' && record.a === right.id)) record.aWins++;
  else record.bWins++;
  record.count++;
  state.decisions.unshift({
    at: state.duels,
    left: left.id,
    right: right.id,
    outcome,
    text: outcome === 'tie' ? `${left.nom} = ${right.nom}` : `${outcome === 'left' ? left.nom : right.nom} bat ${outcome === 'left' ? right.nom : left.nom}`,
  });
  state.decisions = state.decisions.slice(0, 80);
  reorder(state);
  detectContradictions(state);
  state.currentPair = null;
  return nextPair(state);
}

function applyWin(win, lose) {
  const p = btProb(win, lose);
  const surprise = 1 - p;
  const k = Math.min(0.85, 0.18 + 0.24 * ((win.rd ?? 1) + (lose.rd ?? 1)));
  win.rating += k * surprise;
  lose.rating -= k * surprise;
  win.rd = Math.max(0.22, (win.rd ?? 1.8) * (0.9 - 0.08 * surprise));
  lose.rd = Math.max(0.22, (lose.rd ?? 1.8) * (0.92 - 0.06 * surprise));
}

function applyTie(left, right) {
  const mid = (left.rating + right.rating) / 2;
  left.rating = left.rating * 0.86 + mid * 0.14;
  right.rating = right.rating * 0.86 + mid * 0.14;
  left.rd = Math.max(0.25, (left.rd ?? 1.8) * 0.93);
  right.rd = Math.max(0.25, (right.rd ?? 1.8) * 0.93);
}

function detectContradictions(state) {
  const beats = new Map();
  for (const obj of state.items) beats.set(obj.id, new Set());
  for (const record of Object.values(state.comparisons)) {
    if (record.aWins > record.bWins + record.ties) beats.get(record.a)?.add(record.b);
    if (record.bWins > record.aWins + record.ties) beats.get(record.b)?.add(record.a);
  }
  const cycles = [];
  for (const a of state.items.map((x) => x.id)) {
    for (const b of beats.get(a) || []) {
      for (const c of beats.get(b) || []) {
        if (beats.get(c)?.has(a)) cycles.push({ ids: [a, b, c], at: state.duels });
      }
    }
  }
  const seen = new Set();
  state.contradictions = cycles.filter((cycle) => {
    const key = cycle.ids.slice().sort((a, b) => a - b).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export function dashboard(state) {
  const confidences = state.items.map(confidenceFor);
  const info = stopInfo(state);
  const unseen = state.items.filter((obj) => !obj.duels).length;
  const uncertain = state.items.slice().sort((a, b) => confidenceFor(a) - confidenceFor(b)).slice(0, 5).map((x) => x.nom);
  return {
    avgConfidence: Math.round(info.avg),
    topConfidence: Math.round(info.topAvg),
    tierStable: Math.round(info.tierStable * 100),
    unseen,
    uncertain,
    contradictions: state.contradictions.length,
  };
}

function spreadItems(items) {
  const n = items.length;
  if (n < 3) return items.slice();
  const step = coprimeStep(n);
  const out = [];
  for (let i = 0; i < n; i++) out.push(items[(i * step) % n]);
  return out;
}

function coprimeStep(n) {
  if (n <= 2) return 1;
  let step = Math.max(1, Math.floor(n * 0.618));
  while (gcd(step, n) !== 1) step++;
  return step % n || 1;
}

function gcd(a, b) {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return Math.abs(a);
}
