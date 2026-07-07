import assert from 'node:assert/strict';
import { autoFill, missingCount } from '../src/autocomplete.js';

{
  const items = [{ id: 1, nom: 'Alpha', description: '', lien: '', image: '', auto: {} }];
  const report = await autoFill(items, { type: 'video youtube', youtubeKey: '', region: 'FR' });
  assert.equal(report[0].status, 'warning');
  assert.equal(missingCount(items), 0);
  assert.match(items[0].lien, /youtube\.com\/results/);
}

{
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  const items = [{ id: 2, nom: 'Beta', description: '', lien: '', image: '', auto: {} }];
  const report = await autoFill(items, { type: 'video youtube', youtubeKey: 'bad-key', region: 'FR' });
  globalThis.fetch = oldFetch;
  assert.equal(report[0].status, 'warning');
  assert.match(items[0].autoWarning, /YouTube API 403/);
  assert.equal(missingCount(items), 0);
  assert.match(items[0].lien, /youtube\.com\/results/);
}

console.log('autocomplete tests ok');
