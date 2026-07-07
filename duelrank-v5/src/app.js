import { $, clampInt, esc, safeUrl, youtubeId, parseTierText, expectedMergeSortComparisons, saveTextFile, downloadText } from './utils.js';
import { parseCSV, rowsToItems, validateItems } from './csv.js';
import { saveLocal, loadLocal, clearLocal, migrateSession } from './storage.js';
import { createSession, hydrateSession, nextPair, choose as choosePair, currentOrder, item, applyTierProposals, confidenceFor, dashboard, stopInfo, restoreHistory, setTierLock, persistableState } from './ranking.js';
import { exportCsv, exportTiers, exportMarkdown, exportHtml, exportSession, sessionJson } from './exporters.js';
import { getBackendConfig, setBackendConfig, clearBackendConfig, currentUser, sendMagicLink, signOut, listCatalogs, getCatalog, saveCatalog, updateCatalog, deleteCatalog } from './catalogBackend.js';

let imported = [];
let parsed = null;
let state = null;
let saveTimer = null;
let worker = null;
let catalogRows = [];
let loadedCatalogId = null;

function activate(view) {
  const map = { import: 'importView', catalog: 'catalogView', duel: 'duelView', result: 'resultView' };
  Object.values(map).forEach((id) => $('#' + id).classList.toggle('hidden', id !== map[view]));
  $('#tabImport').classList.toggle('active', view === 'import');
  $('#tabCatalog').classList.toggle('active', view === 'catalog');
  $('#tabDuel').classList.toggle('active', view === 'duel');
  $('#tabResult').classList.toggle('active', view === 'result');
}

function scheduleSave() {
  if (!state) return;
  $('#saveStatus').textContent = 'sauvegarde locale...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await saveLocal(persistableState(state));
    $('#saveStatus').textContent = ok ? `sauvegarde locale · ${state.duels || 0} duels` : 'sauvegarde locale indisponible';
    $('#resume').classList.toggle('hidden', !ok);
    $('#forget').classList.toggle('hidden', !ok);
  }, 120);
}

function optionsFromUi() {
  return {
    objective: $('#objective').value,
    stopMode: $('#stopMode').value,
    activeBudget: clampInt($('#comparisonBudget').value, 20, 10000, 500),
    calibrationTarget: clampInt($('#calibrationTarget').value, 0, 5, 1),
    repeatMax: clampInt($('#repeatMax').value, 1, 10, 3),
    repeatWindow: clampInt($('#repeatWindow').value, 2, 50, 10),
    tiers: parseTierText($('#tierInput').value),
  };
}

function missingCount(items) {
  return items.reduce((sum, obj) => sum + (!obj.description ? 1 : 0) + (!obj.lien ? 1 : 0) + (!obj.image ? 1 : 0), 0);
}

function renderImportInfo() {
  if (!imported.length && !parsed) {
    $('#itemCount').textContent = '0';
    $('#budgetEstimate').textContent = $('#comparisonBudget').value || '500';
    $('#exactEstimate').textContent = '0';
    $('#qualityEstimate').textContent = $('#objective').selectedOptions[0]?.textContent || '-';
    return;
  }
  const validation = validateItems(imported);
  $('#importInfo').classList.remove('hidden');
  $('#itemCount').textContent = imported.length;
  $('#budgetEstimate').textContent = $('#comparisonBudget').value || '500';
  $('#exactEstimate').textContent = '≈ ' + expectedMergeSortComparisons(imported.length);
  $('#qualityEstimate').textContent = $('#objective').selectedOptions[0]?.textContent || '-';
  renderMapping();
  renderPreview();
  renderValidation(validation.issues);
}

function importItemsFromState(sourceState) {
  imported = (sourceState.items || []).map(({ id, nom, description, lien, image }) => ({
    id,
    nom,
    description: description || '',
    lien: lien || '',
    image: image || '',
    wins: 0,
    losses: 0,
    ties: 0,
    checks: 0,
    rating: 0,
    rd: 1.8,
    duels: 0,
    exposure: 0,
    auto: {},
  })).filter((obj) => obj.nom);
  parsed = null;
  loadedCatalogId = null;
  renderImportInfo();
}

function renderMapping() {
  if (!parsed) {
    $('#mapping').innerHTML = '<p class="muted">Liste chargee depuis le catalogue.</p>';
    return;
  }
  const fields = ['nom', 'description', 'lien', 'image'];
  $('#mapping').innerHTML = fields.map((field) => `
    <label>${field}
      <select data-map="${field}">
        <option value="-1">Ignorer</option>
        ${parsed.headers.map((head, index) => `<option value="${index}" ${parsed.mapping[field] === index ? 'selected' : ''}>${esc(head || 'Colonne ' + (index + 1))}</option>`).join('')}
      </select>
    </label>
  `).join('');
}

function renderPreview() {
  const rows = parsed ? parsed.rows.slice(0, 6) : [['nom', 'description', 'lien', 'image'], ...imported.slice(0, 5).map((x) => [x.nom, x.description, x.lien, x.image])];
  $('#preview').innerHTML = `<table>${rows.map((row, index) => `<tr>${row.map((cell) => index ? `<td>${esc(cell)}</td>` : `<th>${esc(cell)}</th>`).join('')}</tr>`).join('')}</table>`;
}

function renderValidation(issues) {
  $('#validation').innerHTML = issues.map((issue) => `<div class="check ${issue.level}">${esc(issue.text)}</div>`).join('');
}

function rebuildImportedFromMapping() {
  if (!parsed) return;
  const mapping = { ...parsed.mapping };
  document.querySelectorAll('[data-map]').forEach((select) => {
    mapping[select.dataset.map] = parseInt(select.value, 10);
  });
  parsed.mapping = mapping;
  imported = rowsToItems(parsed.rows, mapping);
  loadedCatalogId = null;
  renderImportInfo();
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        loadSessionText(reader.result);
        return;
      }
      parsed = parseCSV(reader.result);
      imported = parsed.items;
      loadedCatalogId = null;
      activate('import');
      renderImportInfo();
    } catch (error) {
      alert(error.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function startRanking() {
  if (imported.length < 2) return alert('Il faut au moins 2 objets.');
  state = hydrateSession(createSession(structuredClone(imported), optionsFromUi()));
  activate('duel');
  renderDuel();
}

async function computePair() {
  if (state.currentPair) return state.currentPair;
  if (!worker && 'Worker' in window) {
    try {
      worker = new Worker(new URL('./scoring-worker.js', import.meta.url), { type: 'module' });
    } catch {
      worker = false;
    }
  }
  if (worker) {
    try {
      const pair = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timeout')), 900);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          state.lastPairReason = event.data.lastPairReason || '';
          resolve(event.data.pair);
        };
        worker.onerror = reject;
        worker.postMessage(persistableState(state));
      });
      state.currentPair = pair;
      return pair;
    } catch {
      worker = false;
    }
  }
  return nextPair(state);
}

async function renderDuel() {
  hydrateSession(state);
  const pair = await computePair();
  if (!pair) {
    finish();
    return;
  }
  applyTierProposals(state);
  renderDashboard();
  const order = currentOrder(state);
  const ranks = new Map(order.map((id, index) => [id, index + 1]));
  $('#leftCard').innerHTML = cardHtml(item(state, pair.left), ranks.get(pair.left), 'left');
  $('#rightCard').innerHTML = cardHtml(item(state, pair.right), ranks.get(pair.right), 'right');
  $('#pairReason').textContent = state.lastPairReason || pair.explain || '';
  $('#bar').style.width = Math.min(99, Math.round(state.duels / Math.max(1, state.activeBudget) * 100)) + '%';
  $('#progressLabel').textContent = `${state.duels} duels · budget ${state.activeBudget} · ${Math.max(0, state.activeBudget - state.duels)} restants`;
  $('#liveBudget').value = state.activeBudget;
  $('#undo').disabled = !state.history.length;
  renderLive([pair.left, pair.right]);
  renderHistory();
  scheduleSave();
}

function mediaHtml(obj) {
  const id = youtubeId(obj.lien);
  if (id) return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0" title="${esc(obj.nom)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  const image = safeUrl(obj.image);
  if (image) return `<img src="${esc(image)}" alt="">`;
  return `<div class="placeholder">${esc(obj.nom[0]?.toUpperCase() || '?')}</div>`;
}

function cardHtml(obj, rank, side) {
  const link = safeUrl(obj.lien);
  const confidence = confidenceFor(obj);
  const lockButtons = (state.tiers || []).map((tier) => `<button class="btn small secondary" data-lock-tier="${esc(tier.name)}" data-id="${obj.id}">${esc(tier.name)}</button>`).join('');
  return `
    <div class="media">${mediaHtml(obj)}</div>
    <div class="content">
      <span class="rank-badge">#${rank || '?'} actuel</span>
      <span class="tag ${obj.tierLocked ? 'locked' : ''}">Tier ${esc(obj.tierProposal || '?')} · ${esc(obj.tierConfidence || 'faible')}</span>
      <h3>${esc(obj.nom)}</h3>
      <div class="desc">${esc(obj.description || 'Aucune description')}</div>
      <div class="confidence"><i style="width:${confidence}%"></i></div>
      <p class="record">Confiance ${confidence}% · ${obj.wins} V · ${obj.losses} D · ${obj.ties} E</p>
      ${link && !youtubeId(obj.lien) ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a>` : ''}
      <div class="actions">${lockButtons}</div>
      <button class="btn choose">${side === 'left' ? '← Choisir' : 'Choisir →'}</button>
    </div>`;
}

function renderDashboard() {
  const data = dashboard(state);
  const stop = stopInfo(state);
  $('#dashboard').innerHTML = [
    ['Confiance globale', `${data.avgConfidence}%`],
    ['Top', `${data.topConfidence}%`],
    ['Tiers stables', `${data.tierStable}%`],
    ['Jamais vus', data.unseen],
    ['Contradictions', data.contradictions],
    ['Arret', stop.smartHit ? 'objectif atteint' : stop.budgetHit ? 'budget atteint' : 'en cours'],
  ].map(([label, value]) => `<div class="dash"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
}

function renderLive(focus = []) {
  const order = currentOrder(state);
  applyTierProposals(state);
  const focused = new Set(focus);
  const mode = state.rankView || 'list';
  $('#rankModeList').classList.toggle('active', mode === 'list');
  $('#rankModeTiers').classList.toggle('active', mode === 'tiers');
  $('#rankModeDebug').classList.toggle('active', mode === 'debug');
  if (mode === 'tiers') {
    $('#liveRanking').className = 'tier-board';
    $('#liveRanking').innerHTML = tierBoardHtml(order, focus);
    return;
  }
  $('#liveRanking').className = 'mini-list';
  $('#liveRanking').innerHTML = order.map((id, index) => {
    const obj = item(state, id);
    const tools = `<span class="mini-tools"><button data-move="up" data-id="${id}" title="Monter">↑</button><button data-move="down" data-id="${id}" title="Descendre">↓</button></span>`;
    if (mode === 'debug') return `<div class="mini-row ${focused.has(id) ? 'focus' : ''}" draggable="true" data-rank-id="${id}"><span>#${index + 1}</span><b>${esc(obj.nom)}</b><span class="tag">${obj.rating.toFixed(2)} · rd ${obj.rd.toFixed(2)}</span></div>`;
    return `<div class="mini-row ${focused.has(id) ? 'focus' : ''}" draggable="true" data-rank-id="${id}"><span>#${index + 1}</span><b>${esc(obj.nom)}</b>${tools}</div>`;
  }).join('');
}

function applyManualOrder(order) {
  const n = order.length;
  order.forEach((id, index) => {
    const obj = item(state, id);
    obj.rating = (n - index) * 0.035;
    obj.rd = Math.max(0.35, obj.rd ?? 1.2);
  });
  state.ranking = order.slice();
  state.result = state.phase === 'done' ? order.slice() : null;
  state.manualRanking = true;
  state.decisions.unshift({ at: state.duels, text: 'Classement modifie manuellement', outcome: 'manual' });
  state.decisions = state.decisions.slice(0, 80);
  applyTierProposals(state);
  state.currentPair = null;
  scheduleSave();
}

function moveRankItem(sourceId, targetId) {
  sourceId = Number(sourceId);
  targetId = Number(targetId);
  if (!sourceId || !targetId || sourceId === targetId) return;
  const order = currentOrder(state);
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  applyManualOrder(order);
  if (state.phase === 'done') renderResult();
  else renderDuel();
}

function nudgeRankItem(id, direction) {
  id = Number(id);
  const order = currentOrder(state);
  const from = order.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  applyManualOrder(order);
  if (state.phase === 'done') renderResult();
  else renderDuel();
}

function tierBoardHtml(order = currentOrder(state), focus = []) {
  const focused = new Set(focus);
  const groups = new Map((state.tiers || []).map((tier) => [tier.name, []]));
  order.forEach((id) => {
    const obj = item(state, id);
    if (!groups.has(obj.tierProposal)) groups.set(obj.tierProposal, []);
    groups.get(obj.tierProposal).push(obj);
  });
  return (state.tiers || []).map((tier) => `
    <div class="tier-group">
      <div class="tier-head" style="background:${esc(tier.color)}">${esc(tier.name)}</div>
      <div class="tier-items">${(groups.get(tier.name) || []).map((obj) => `<span class="tier-chip ${focused.has(obj.id) ? 'focus' : ''}">${esc(obj.nom)}</span>`).join('') || '<span class="record">En attente</span>'}</div>
    </div>
  `).join('');
}

function renderHistory() {
  $('#historyList').innerHTML = state.decisions.slice(0, 12).map((decision, index) => `
    <div class="history-row"><span>${esc(decision.at)} · ${esc(decision.text)}</span><button class="btn small secondary" data-restore="${index}">Annuler ici</button></div>
  `).join('') || '<p class="muted">Aucun duel pour le moment.</p>';
}

function extendBudget(delta) {
  state.activeBudget = Math.min(10000, Math.max(state.duels + 1, (state.activeBudget || state.duels) + delta));
  $('#liveBudget').value = state.activeBudget;
  $('#resultBudget').value = state.activeBudget;
  if (state.phase === 'done') continueRanking();
  else renderDuel();
}

function setBudget(value) {
  state.activeBudget = clampInt(value, Math.max(20, state.duels + 1), 10000, Math.max(state.duels + 100, state.activeBudget || 500));
  renderDuel();
}

function finish() {
  state.phase = 'done';
  state.result = currentOrder(state);
  applyTierProposals(state);
  activate('result');
  const stop = stopInfo(state);
  $('#summary').textContent = `${state.duels} duels pour ${state.items.length} objets. Budget cible ${state.activeBudget}.`;
  $('#quality').textContent = `Confiance globale ${Math.round(stop.avg)}%, top ${Math.round(stop.topAvg)}%, tiers stables ${Math.round(stop.tierStable * 100)}%.`;
  $('#resultBudget').value = state.activeBudget;
  renderResult();
  scheduleSave();
}

function renderResult() {
  const ids = state.result || currentOrder(state);
  applyTierProposals(state);
  const stop = stopInfo(state);
  const done = state.phase === 'done';
  $('#summary').textContent = done
    ? `${state.duels} duels pour ${state.items.length} objets. Budget cible ${state.activeBudget}.`
    : `Classement courant apres ${state.duels} duels sur ${state.items.length} objets. Budget cible ${state.activeBudget}.`;
  $('#quality').textContent = `${done ? 'Resultat final' : 'Apercu en cours'} · confiance globale ${Math.round(stop.avg)}%, top ${Math.round(stop.topAvg)}%, tiers stables ${Math.round(stop.tierStable * 100)}%.`;
  $('#resultBudget').value = state.activeBudget;
  $('#continueRanking').textContent = done ? 'Continuer' : 'Retour aux duels';
  $('#ranking').innerHTML = `<div class="tier-board">${tierBoardHtml(ids)}</div>` + ids.map((id, index) => {
    const obj = item(state, id);
    return `<div class="rank-row"><div class="rank-num">${index + 1}</div><div><b>${esc(obj.nom)}</b><div class="record">${esc(obj.description || '')}</div></div><div class="record">Tier ${esc(obj.tierProposal || '?')} · confiance ${confidenceFor(obj)}% · score ${obj.rating.toFixed(2)}</div></div>`;
  }).join('');
}

function continueRanking() {
  if (state.phase !== 'done') {
    activate('duel');
    renderDuel();
    return;
  }
  const wanted = clampInt($('#resultBudget').value, 20, 10000, state.activeBudget + 100);
  state.activeBudget = wanted <= state.duels ? Math.min(10000, state.duels + 100) : wanted;
  state.phase = 'active';
  state.result = null;
  state.currentPair = null;
  activate('duel');
  renderDuel();
}

function loadSessionText(text) {
  try {
    state = hydrateSession(migrateSession(JSON.parse(text)));
    importItemsFromState(state);
    if (state.phase === 'done') finish();
    else {
      activate('duel');
      renderDuel();
    }
    saveLocal(persistableState(state));
  } catch (error) {
    alert(error.message);
  }
}

async function resumeSavedSession() {
  try {
    const saved = await loadLocal();
    if (!saved) {
      $('#saveStatus').textContent = 'aucune sauvegarde locale trouvee';
      $('#resume').classList.add('hidden');
      $('#forget').classList.add('hidden');
      return;
    }
    state = hydrateSession(migrateSession(saved));
    importItemsFromState(state);
    state.currentPair = null;
    if (state.phase === 'done') finish();
    else {
      activate('duel');
      renderDuel();
    }
    $('#saveStatus').textContent = `sauvegarde reprise · ${state.duels || 0} duels`;
  } catch (error) {
    $('#saveStatus').textContent = `reprise impossible: ${error.message}`;
  }
}

function resetToImport() {
  state = null;
  imported = [];
  parsed = null;
  loadedCatalogId = null;
  $('#importInfo').classList.add('hidden');
  activate('import');
  renderImportInfo();
}

function loadItemsIntoImport(items, sourceName = '') {
  imported = structuredClone(items).map((obj, index) => ({
    id: index + 1,
    nom: obj.nom || obj.name || '',
    description: obj.description || '',
    lien: obj.lien || obj.link || obj.url || '',
    image: obj.image || obj.img || '',
    wins: 0,
    losses: 0,
    ties: 0,
    checks: 0,
    rating: 0,
    rd: 1.8,
    duels: 0,
    exposure: 0,
    auto: {},
  })).filter((obj) => obj.nom);
  parsed = null;
  activate('import');
  renderImportInfo();
  $('#saveStatus').textContent = sourceName ? `liste chargee · ${sourceName}` : 'liste chargee';
}

async function refreshBackendStatus() {
  const config = getBackendConfig();
  $('#supabaseUrl').value = config?.url || '';
  $('#supabaseAnonKey').value = config?.anonKey || '';
  if (!config) {
    $('#backendStatus').textContent = 'Backend non configure.';
    $('#authStatus').textContent = 'Configure Supabase avant de te connecter.';
    return;
  }
  $('#backendStatus').textContent = 'Backend configure.';
  try {
    const user = await currentUser();
    $('#authStatus').textContent = user ? `Connecte: ${user.email}` : 'Non connecte.';
  } catch (error) {
    $('#authStatus').textContent = error.message;
  }
}

async function refreshCatalog() {
  $('#catalogList').innerHTML = '<p class="muted">Chargement...</p>';
  try {
    catalogRows = await listCatalogs($('#catalogSearch').value || '');
    renderCatalog();
  } catch (error) {
    $('#catalogList').innerHTML = `<div class="check bad">${esc(error.message)}</div>`;
  }
}

function renderCatalog() {
  if (!catalogRows.length) {
    $('#catalogList').innerHTML = '<p class="muted">Aucune liste sauvegardee.</p>';
    return;
  }
  $('#catalogList').innerHTML = catalogRows.map((row) => `
    <article class="catalog-card">
      <div>
        <h3>${esc(row.name)}</h3>
        <p class="muted">${row.item_count} objets · ${row.missing_count} champs optionnels vides · ${esc(row.object_type || 'sans type')}</p>
        <p class="record">Maj ${new Date(row.updated_at).toLocaleString()}${row.last_used_at ? ` · utilise ${new Date(row.last_used_at).toLocaleString()}` : ''}</p>
      </div>
      <div class="actions no-margin">
        <button class="btn small" data-use="${row.id}">Utiliser</button>
        <button class="btn small secondary" data-export="${row.id}">Exporter JSON</button>
        <button class="btn small danger" data-delete="${row.id}">Supprimer</button>
      </div>
    </article>
  `).join('');
}

async function saveCurrentCatalog() {
  if (!imported.length) return alert('Importe ou charge une liste avant de sauvegarder.');
  const currentName = catalogRows.find((row) => row.id === loadedCatalogId)?.name;
  const name = prompt('Nom de la liste dans le catalogue', currentName || imported[0]?.nom || 'Nouvelle liste');
  if (!name) return;
  const payload = {
    name,
    objectType: '',
    items: imported.map(({ nom, description, lien, image }) => ({ nom, description, lien, image })),
    missingCount: missingCount(imported),
  };
  try {
    const saved = loadedCatalogId ? await updateCatalog(loadedCatalogId, payload) : await saveCatalog(payload);
    loadedCatalogId = saved.id;
    $('#saveStatus').textContent = `catalogue sauvegarde · ${saved.name}`;
    await refreshCatalog();
  } catch (error) {
    alert(error.message);
  }
}

async function useCatalog(id) {
  try {
    const record = await getCatalog(id);
    loadedCatalogId = record.id;
    loadItemsIntoImport(record.csv_json || [], record.name);
  } catch (error) {
    alert(error.message);
  }
}

async function exportCatalogRecord(id) {
  try {
    const record = await getCatalog(id);
    downloadText(`catalogue-${record.name}.json`, 'application/json;charset=utf-8', JSON.stringify(record, null, 2));
  } catch (error) {
    alert(error.message);
  }
}

function wireEvents() {
  $('#tabImport').onclick = () => activate('import');
  $('#tabCatalog').onclick = () => {
    activate('catalog');
    refreshBackendStatus();
    refreshCatalog();
  };
  $('#tabDuel').onclick = () => state ? activate('duel') : activate('import');
  $('#tabResult').onclick = () => {
    if (!state) return activate('import');
    renderResult();
    activate('result');
  };

  $('#drop').onclick = () => $('#file').click();
  $('#file').onchange = (event) => event.target.files[0] && readFile(event.target.files[0]);
  $('#importSession').onclick = () => $('#sessionFile').click();
  $('#sessionFile').onchange = (event) => event.target.files[0] && readFile(event.target.files[0]);
  ['dragenter', 'dragover'].forEach((name) => $('#drop').addEventListener(name, (event) => {
    event.preventDefault();
    $('#drop').classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((name) => $('#drop').addEventListener(name, (event) => {
    event.preventDefault();
    $('#drop').classList.remove('drag');
  }));
  $('#drop').addEventListener('drop', (event) => event.dataTransfer.files[0] && readFile(event.dataTransfer.files[0]));
  $('#mapping').onchange = rebuildImportedFromMapping;
  ['comparisonBudget', 'objective', 'stopMode'].forEach((id) => $('#' + id).oninput = renderImportInfo);
  $('#start').onclick = startRanking;
  $('#saveCatalog').onclick = saveCurrentCatalog;
  $('#benchmark').onclick = runBenchmark;
  $('#clearImport').onclick = resetToImport;

  $('#saveBackendConfig').onclick = async () => {
    try {
      setBackendConfig({ url: $('#supabaseUrl').value, anonKey: $('#supabaseAnonKey').value });
      await refreshBackendStatus();
    } catch (error) {
      $('#backendStatus').textContent = error.message;
    }
  };
  $('#clearBackendConfig').onclick = () => {
    clearBackendConfig();
    refreshBackendStatus();
  };
  $('#signIn').onclick = async () => {
    try {
      await sendMagicLink($('#authEmail').value);
      $('#authStatus').textContent = 'Lien envoye. Ouvre ton email puis reviens ici.';
    } catch (error) {
      $('#authStatus').textContent = error.message;
    }
  };
  $('#signOut').onclick = async () => {
    try {
      await signOut();
      await refreshBackendStatus();
    } catch (error) {
      $('#authStatus').textContent = error.message;
    }
  };
  $('#refreshCatalog').onclick = refreshCatalog;
  $('#catalogSearch').oninput = () => refreshCatalog();
  $('#catalogList').onclick = async (event) => {
    const use = event.target.closest('[data-use]');
    const del = event.target.closest('[data-delete]');
    const exp = event.target.closest('[data-export]');
    if (use) await useCatalog(use.dataset.use);
    if (exp) await exportCatalogRecord(exp.dataset.export);
    if (del && confirm('Supprimer cette liste du catalogue backend ?')) {
      await deleteCatalog(del.dataset.delete);
      await refreshCatalog();
    }
  };

  $('#leftCard').onclick = (event) => handleCardClick(event, 'left');
  $('#rightCard').onclick = (event) => handleCardClick(event, 'right');
  $('#tie').onclick = () => chooseAndRender('tie');
  $('#compactMode').onclick = () => document.body.classList.toggle('compact');
  $('#undo').onclick = () => {
    if (!state.history.length) return;
    restoreHistory(state, state.history.pop());
    activate('duel');
    renderDuel();
  };
  $('#historyList').onclick = (event) => {
    const button = event.target.closest('[data-restore]');
    if (!button) return;
    const index = parseInt(button.dataset.restore, 10);
    const snapshot = state.history[state.history.length - 1 - index];
    if (snapshot) {
      restoreHistory(state, snapshot);
      renderDuel();
    }
  };
  $('#rankModeList').onclick = () => { state.rankView = 'list'; renderLive(); };
  $('#rankModeTiers').onclick = () => { state.rankView = 'tiers'; renderLive(); };
  $('#rankModeDebug').onclick = () => { state.rankView = 'debug'; renderLive(); };
  $('#liveBudget').onchange = () => setBudget($('#liveBudget').value);
  $('#extend50').onclick = () => extendBudget(50);
  $('#extend100').onclick = () => extendBudget(100);
  $('#extend250').onclick = () => extendBudget(250);
  $('#quit').onclick = () => activate('import');
  $('#continueRanking').onclick = continueRanking;
  $('#exportCurrent').onclick = () => exportCsv(state);
  $('#exportTiers').onclick = () => exportTiers(state);
  $('#exportMarkdown').onclick = () => exportMarkdown(state);
  $('#exportHtml').onclick = () => exportHtml(state);
  $('#exportSessionDuel').onclick = () => exportSession(state);
  $('#exportSessionResult').onclick = () => exportSession(state);
  $('#saveSessionFile').onclick = () => saveTextFile('session-duelrank-v5.json', sessionJson(state), 'application/json');
  $('#restart').onclick = () => {
    imported = state.items.map(({ id, nom, description, lien, image }) => ({ id, nom, description, lien, image, wins: 0, losses: 0, ties: 0, checks: 0, rating: 0, rd: 1.8, duels: 0, exposure: 0, auto: {} }));
    $('#comparisonBudget').value = state.activeBudget;
    $('#tierInput').value = state.tiers.map((tier) => tier.name).join('\n');
    startRanking();
  };
  $('#newList').onclick = async () => {
    await clearLocal();
    resetToImport();
  };
  $('#resume').onclick = resumeSavedSession;
  $('#forget').onclick = async () => {
    await clearLocal();
    $('#resume').classList.add('hidden');
    $('#forget').classList.add('hidden');
  };
  $('#zoomMedia').onclick = () => openMediaDialog();
  $('#closeDialog').onclick = () => $('#mediaDialog').close();
  $('#liveRanking').addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-rank-id]');
    if (!row) return;
    event.dataTransfer.setData('text/plain', row.dataset.rankId);
    event.dataTransfer.effectAllowed = 'move';
  });
  $('#liveRanking').addEventListener('dragover', (event) => {
    const row = event.target.closest('[data-rank-id]');
    if (!row) return;
    event.preventDefault();
    row.classList.add('drag-over');
  });
  $('#liveRanking').addEventListener('dragleave', (event) => {
    event.target.closest('[data-rank-id]')?.classList.remove('drag-over');
  });
  $('#liveRanking').addEventListener('drop', (event) => {
    const row = event.target.closest('[data-rank-id]');
    if (!row) return;
    event.preventDefault();
    row.classList.remove('drag-over');
    moveRankItem(event.dataTransfer.getData('text/plain'), row.dataset.rankId);
  });
  $('#liveRanking').addEventListener('click', (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    event.stopPropagation();
    nudgeRankItem(button.dataset.id, button.dataset.move);
  });
  document.addEventListener('keydown', (event) => {
    if ($('#duelView').classList.contains('hidden')) return;
    if (event.key === 'ArrowLeft') chooseAndRender('left');
    if (event.key === 'ArrowRight') chooseAndRender('right');
    if (event.key.toLowerCase() === 'e') chooseAndRender('tie');
    if (event.key.toLowerCase() === 'u') $('#undo').click();
  });
}

function handleCardClick(event, side) {
  const lock = event.target.closest('[data-lock-tier]');
  if (lock) {
    event.stopPropagation();
    setTierLock(state, parseInt(lock.dataset.id, 10), lock.dataset.lockTier);
    renderDuel();
    return;
  }
  if (event.target.closest('a,iframe,button[data-lock-tier]')) return;
  chooseAndRender(side);
}

function chooseAndRender(outcome) {
  const before = state.duels || 0;
  choosePair(state, outcome);
  if (Math.floor(before / 50) < Math.floor((state.duels || 0) / 50)) showConfetti();
  renderDuel();
}

function showConfetti() {
  const layer = $('#confettiLayer');
  if (!layer) return;
  const colors = ['#d7ff5f', '#79d7ff', '#ff7f7f', '#ffc65c', '#b99cff', '#67e39a'];
  layer.classList.remove('hidden');
  layer.innerHTML = Array.from({ length: 90 }, (_, index) => {
    const left = Math.random() * 100;
    const x = `${Math.random() * 220 - 110}px`;
    const r = `${Math.random() * 720 - 360}deg`;
    const delay = Math.random() * 240;
    const color = colors[index % colors.length];
    return `<i class="confetti" style="left:${left}%;background:${color};--x:${x};--r:${r};animation-delay:${delay}ms"></i>`;
  }).join('');
  setTimeout(() => {
    layer.classList.add('hidden');
    layer.innerHTML = '';
  }, 1800);
}

function openMediaDialog() {
  if (!state?.currentPair) return;
  const left = item(state, state.currentPair.left);
  const right = item(state, state.currentPair.right);
  $('#dialogMedia').innerHTML = `<div class="duel"><div class="card"><div class="media">${mediaHtml(left)}</div><div class="content"><h3>${esc(left.nom)}</h3></div></div><div class="vs">VS</div><div class="card"><div class="media">${mediaHtml(right)}</div><div class="content"><h3>${esc(right.nom)}</h3></div></div></div>`;
  $('#mediaDialog').showModal();
}

function runBenchmark() {
  $('#importInfo').classList.remove('hidden');
  const sample = Array.from({ length: 171 }, (_, index) => ({
    id: index + 1,
    nom: `Objet ${index + 1}`,
    description: '',
    lien: '',
    image: '',
  }));
  const bench = hydrateSession(createSession(sample, {
    ...optionsFromUi(),
    activeBudget: 500,
    stopMode: 'budget',
  }));
  let pair = nextPair(bench);
  let guard = 1000;
  while (pair && guard-- > 0) {
    choosePair(bench, pair.left < pair.right ? 'left' : 'right');
    pair = nextPair(bench);
  }
  const data = dashboard(bench);
  $('#itemCount').textContent = '171';
  $('#budgetEstimate').textContent = '500';
  $('#exactEstimate').textContent = '≈ ' + expectedMergeSortComparisons(171);
  $('#qualityEstimate').textContent = 'benchmark';
  renderValidation([
    { level: bench.duels <= 500 ? 'good' : 'bad', text: `Benchmark: ${bench.duels} duels pour 171 objets.` },
    { level: 'good', text: `Confiance globale simulee: ${data.avgConfidence}%.` },
    { level: bench.contradictions.length ? 'warn' : 'good', text: `${bench.contradictions.length} contradiction(s) detectee(s).` },
  ]);
}

async function init() {
  wireEvents();
  const saved = await loadLocal();
  $('#resume').classList.toggle('hidden', !saved);
  $('#forget').classList.toggle('hidden', !saved);
  await refreshBackendStatus();
  renderImportInfo();
  activate('import');
}

init();
