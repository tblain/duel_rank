import { hydrateSession, nextPair } from './ranking.js';

self.onmessage = (event) => {
  const state = hydrateSession(event.data);
  const pair = nextPair(state);
  self.postMessage({ pair, lastPairReason: state.lastPairReason });
};
