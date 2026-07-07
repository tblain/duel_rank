import assert from 'node:assert/strict';
import { parseCSV } from '../src/csv.js';
import { createSession, hydrateSession, nextPair, choose, currentOrder, stopInfo } from '../src/ranking.js';

function items(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    nom: `Objet ${index + 1}`,
    description: '',
    lien: '',
    image: '',
  }));
}

function run(state, chooser = 'left', guard = 2000) {
  hydrateSession(state);
  let pair = nextPair(state);
  while (pair && guard-- > 0) {
    choose(state, typeof chooser === 'function' ? chooser(pair, state) : chooser);
    pair = nextPair(state);
  }
  assert.ok(guard > 0, 'ranking loop guard exhausted');
  return state;
}

{
  const parsed = parseCSV('titre;url\nA;https://example.com/a\nB;https://example.com/b\n');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].nom, 'A');
  assert.equal(parsed.items[0].lien, 'https://example.com/a');
}

{
  const state = createSession(items(171), {
    objective: 'global',
    stopMode: 'budget',
    activeBudget: 500,
    calibrationTarget: 1,
    repeatMax: 3,
    repeatWindow: 10,
    tiers: [{ name: 'S' }, { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  });
  run(state, (pair) => pair.left < pair.right ? 'left' : 'right');
  assert.equal(state.duels, 500);
  assert.equal(currentOrder(state).length, 171);
  const recentCounts = {};
  for (const id of state.recentIds.slice(-20)) recentCounts[id] = (recentCounts[id] || 0) + 1;
  assert.ok(Math.max(...Object.values(recentCounts)) <= 4, 'anti repetition fallback should stay bounded');
}

{
  const state = createSession(items(30), {
    objective: 'tiers',
    stopMode: 'budget',
    activeBudget: 20,
    calibrationTarget: 1,
    repeatMax: 3,
    repeatWindow: 10,
    tiers: [{ name: 'S' }, { name: 'A' }, { name: 'B' }],
  });
  run(state, 'left');
  assert.equal(state.duels, 20);
  assert.ok(stopInfo(state).budgetHit);
  state.phase = 'active';
  state.result = null;
  state.activeBudget = 30;
  run(state, 'right');
  assert.equal(state.duels, 30);
}

{
  const state = createSession(items(5), {
    objective: 'global',
    stopMode: 'budget',
    activeBudget: 5,
    calibrationTarget: 1,
    repeatMax: 3,
    repeatWindow: 10,
    tiers: [{ name: 'A' }, { name: 'B' }],
  });
  nextPair(state);
  choose(state, 'tie');
  assert.equal(state.items.reduce((sum, item) => sum + item.ties, 0), 2);
}

console.log('engine tests ok');
