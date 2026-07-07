import { $, clampInt, esc, safeUrl, youtubeId, parseTierText, expectedMergeSortComparisons, saveTextFile } from './utils.js';
import { parseCSV, rowsToItems, validateItems } from './csv.js';
import { presetText, missingCount, autoFill, candidatesFor, applyCandidate } from './autocomplete.js';
import { saveLocal, loadLocal, clearLocal, migrateSession } from './storage.js';
import { createSession, hydrateSession, nextPair, choose as choosePair, currentOrder, item, applyTierProposals, confidenceFor, dashboard, stopInfo, restoreHistory, setTierLock, persistableState } from './ranking.js';
import { exportCsv, exportTiers, exportMarkdown, exportHtml, exportSession, sessionJson } from './exporters.js';

let imported = [];
let parsed = null;
let state = null;
let saveTimer = null;
let worker = null;
let autocompleteReport = [];

function show(id) {
  ['importView', 'duelView', 'resultView'].forEach((name) => $('#' + name).classList.toggle('hidden', name !== id));
}

function scheduleSave() {
  if (!state) return;
  $('#saveStatus').textContent = 'sauvegarde locale...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await saveLocal(persistableState(state));
    $('#saveStatus').textContent = ok ? `sauvegarde locale · ${state.duels || 0} duels` : 'sauvegarde locale indisponible';
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
  $('#fillBox').classList.toggle('hidden', validation.missing === 0);
  $('#itemCount').textContent = imported.length;
  $('#budgetEstimate').textContent = $('#comparisonBudget').value || '500';
  $('#exactEstimate').textContent = '≈ ' + expectedMergeSortComparisons(imported.length);
  $('#qualityEstimate').textContent = $('#objective').selectedOptions[0]?.textContent || '-';
  renderMapping();
  renderPreview();
  renderValidation(validation.issues);
  renderAutocompletePreview();
}

function renderMapping() {
  if (!parsed) return;
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
  if (!parsed) return;
  const rows = parsed.rows.slice(0, 6);
  $('#preview').innerHTML = `<table>${rows.map((row, index) => `<tr>${row.map((cell) => index ? `<td>${esc(cell)}</td>` : `<th>${esc(cell)}</th>`).join('')}</tr>`).join('')}</table>`;
}

function renderValidation(issues) {
  $('#validation').innerHTML = issues.map((issue) => `<div class="check ${issue.level}">${esc(issue.text)}</div>`).join('');
}

function rebuildImportedFromMapping() {
  const mapping = { ...parsed.mapping };
  document.querySelectorAll('[data-map]').forEach((select) => {
    mapping[select.dataset.map] = parseInt(select.value, 10);
  });
  parsed.mapping = mapping;
  imported = rowsToItems(parsed.rows, mapping);
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
      renderImportInfo();
    } catch (error) {
      alert(error.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function getAutoOptions() {
  return {
    type: $('#objectType').value.trim() || 'objet',
    youtubeKey: $('#youtubeKey').value.trim(),
    region: ($('#searchRegion').value.trim() || 'FR').toUpperCase(),
  };
}

async function renderCandidateReview() {
  const target = imported.find((obj) => !obj.description || !obj.lien || !obj.image);
  if (!target) {
    $('#candidatePanel').classList.add('hidden');
    $('#fillStatus').textContent = 'Tous les objets ont deja leurs champs optionnels.';
    return;
  }
  $('#fillStatus').textContent = `Recherche de candidats pour ${target.nom}...`;
  const candidates = await candidatesFor(target, getAutoOptions());
  $('#candidatePanel').classList.remove('hidden');
  $('#candidatePanel').innerHTML = `<h2>${esc(target.nom)}</h2>` + candidates.map((candidate, index) => `
    <div class="candidate">
      <img src="${esc(candidate.image)}" alt="">
      <div><b>${esc(candidate.title)}</b><span>${esc(candidate.channel || '')}</span><p class="muted">${esc(candidate.description || '')}</p></div>
      <button class="btn small secondary" data-candidate="${index}">Choisir</button>
    </div>
  `).join('');
  $('#candidatePanel').querySelectorAll('[data-candidate]').forEach((button) => {
    button.onclick = () => {
      applyCandidate(target, candidates[parseInt(button.dataset.candidate, 10)], true);
      $('#fillStatus').textContent = `${target.nom} mis a jour.`;
      renderImportInfo();
    };
  });
}

async function startRanking() {
  if (imported.length < 2) return alert('Il faut au moins 2 objets.');
  if (missingCount(imported) > 0) {
    $('#fillBox').classList.remove('hidden');
    $('#fillStatus').textContent = 'Autocompletion obligatoire avant de commencer le ranking.';
    await runAutoFill();
    const errors = imported.filter((obj) => obj.autoStatus === 'error');
    if (errors.length || missingCount(imported) > 0) {
      $('#fillStatus').textContent = `${errors.length || missingCount(imported)} probleme(s) a corriger avant de commencer.`;
      renderAutocompletePreview();
      return;
    }
  }
  state = hydrateSession(createSession(structuredClone(imported), optionsFromUi()));
  show('duelView');
  renderDuel();
}

function renderAutocompletePreview() {
  const box = $('#autoPreview');
  if (!box) return;
  if (!imported.length) {
    box.innerHTML = '';
    $('#autoSummary').textContent = '';
    return;
  }
  const touched = imported.filter((obj) => obj.autoStatus || obj.auto?.description || obj.auto?.lien || obj.auto?.image || obj.autoError);
  const errors = imported.filter((obj) => obj.autoStatus === 'error');
  const warnings = imported.filter((obj) => obj.autoStatus === 'warning');
  const complete = imported.filter((obj) => obj.description && obj.lien && obj.image).length;
  $('#autoSummary').textContent = `Autocompletion: ${complete}/${imported.length} objets complets${warnings.length ? ` · ${warnings.length} avertissement(s)` : ''}${errors.length ? ` · ${errors.length} erreur(s)` : ''}.`;
  box.innerHTML = (touched.length ? touched : imported.slice(0, 12)).map((obj) => {
    const status = obj.autoStatus === 'error' ? 'error' : obj.autoStatus === 'warning' ? 'warning' : (obj.description && obj.lien && obj.image ? 'ok' : 'pending');
    const label = status === 'error' ? 'Erreur' : status === 'warning' ? 'A verifier' : status === 'ok' ? 'Complet' : 'A completer';
    const message = obj.autoError || obj.autoWarning || obj.autoCandidate || obj.description || 'En attente de recherche.';
    return `<div class="auto-card ${status}">
      <img src="${esc(safeUrl(obj.image) || '')}" alt="">
      <div><b>${esc(obj.nom)}</b><span class="status">${label}</span><p>${esc(message)}</p></div>
    </div>`;
  }).join('');
}

async function runAutoFill() {
  $('#autoFill').disabled = true;
  $('#start').disabled = true;
  autocompleteReport = [];
  renderAutocompletePreview();
  try {
    autocompleteReport = await autoFill(imported, getAutoOptions(), (index, total, obj) => {
      $('#fillStatus').textContent = `Recherche ${index}/${total}: ${obj.nom}`;
      renderAutocompletePreview();
    });
    const errors = autocompleteReport.filter((entry) => entry.status === 'error');
    const warnings = autocompleteReport.filter((entry) => entry.status === 'warning');
    $('#fillStatus').textContent = errors.length
      ? `Autocompletion terminee avec ${errors.length} erreur(s). Corrige ou relance avant le ranking.`
      : warnings.length
        ? `Autocompletion terminee avec ${warnings.length} avertissement(s). Les liens de recherche YouTube sont utilisables mais a verifier.`
        : 'Autocompletion terminee. Tu peux visualiser les objets ci-dessous avant de commencer.';
    renderImportInfo();
  } catch (error) {
    $('#fillStatus').textContent = `Erreur generale: ${error.message}`;
    renderAutocompletePreview();
  } finally {
    $('#autoFill').disabled = false;
    $('#start').disabled = false;
  }
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
  const done = state.duels;
  const total = state.activeBudget;
  $('#bar').style.width = Math.min(99, Math.round(done / Math.max(1, total) * 100)) + '%';
  $('#progressLabel').textContent = `${done} duels · budget ${total} · ${Math.max(0, total - done)} restants`;
  $('#liveBudget').value = total;
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
    if (mode === 'debug') {
      return `<div class="mini-row ${focused.has(id) ? 'focus' : ''}"><span>#${index + 1}</span><b>${esc(obj.nom)}</b><span class="tag">${obj.rating.toFixed(2)} · rd ${obj.rd.toFixed(2)}</span></div>`;
    }
    return `<div class="mini-row ${focused.has(id) ? 'focus' : ''}"><span>#${index + 1}</span><b>${esc(obj.nom)}</b><span class="tag ${obj.tierLocked ? 'locked' : ''}">${esc(obj.tierProposal || '?')} · ${confidenceFor(obj)}%</span></div>`;
  }).join('');
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
  show('resultView');
  const stop = stopInfo(state);
  $('#summary').textContent = `${state.duels} duels pour ${state.items.length} objets. Budget cible ${state.activeBudget}.`;
  $('#quality').textContent = `Confiance globale ${Math.round(stop.avg)}%, top ${Math.round(stop.topAvg)}%, tiers stables ${Math.round(stop.tierStable * 100)}%.`;
  $('#resultBudget').value = state.activeBudget;
  renderResult();
  scheduleSave();
}

function renderResult() {
  const ids = state.result || currentOrder(state);
  $('#ranking').innerHTML = `<div class="tier-board">${tierBoardHtml(ids)}</div>` + ids.map((id, index) => {
    const obj = item(state, id);
    return `<div class="rank-row"><div class="rank-num">${index + 1}</div><div><b>${esc(obj.nom)}</b><div class="record">${esc(obj.description || '')}</div></div><div class="record">Tier ${esc(obj.tierProposal || '?')} · confiance ${confidenceFor(obj)}% · score ${obj.rating.toFixed(2)}</div></div>`;
  }).join('');
}

function continueRanking() {
  const wanted = clampInt($('#resultBudget').value, 20, 10000, state.activeBudget + 100);
  state.activeBudget = wanted <= state.duels ? Math.min(10000, state.duels + 100) : wanted;
  state.phase = 'active';
  state.result = null;
  state.currentPair = null;
  show('duelView');
  renderDuel();
}

function loadSessionText(text) {
  try {
    state = hydrateSession(migrateSession(JSON.parse(text)));
    if (state.phase === 'done') finish();
    else renderDuel();
    saveLocal(persistableState(state));
  } catch (error) {
    alert(error.message);
  }
}

function resetToImport() {
  state = null;
  imported = [];
  parsed = null;
  $('#importInfo').classList.add('hidden');
  show('importView');
}

function wireEvents() {
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
  $('#objectPreset').onchange = () => {
    const text = presetText($('#objectPreset').value);
    if (text) $('#objectType').value = text;
  };
  $('#autoFill').onclick = runAutoFill;
  $('#reviewCandidates').onclick = renderCandidateReview;
  $('#start').onclick = startRanking;
  $('#benchmark').onclick = runBenchmark;
  $('#clearImport').onclick = resetToImport;
  $('#leftCard').onclick = (event) => handleCardClick(event, 'left');
  $('#rightCard').onclick = (event) => handleCardClick(event, 'right');
  $('#tie').onclick = () => chooseAndRender('tie');
  $('#compactMode').onclick = () => document.body.classList.toggle('compact');
  $('#undo').onclick = () => {
    if (!state.history.length) return;
    restoreHistory(state, state.history.pop());
    show('duelView');
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
  $('#quit').onclick = () => show('importView');
  $('#continueRanking').onclick = continueRanking;
  $('#exportCurrent').onclick = () => exportCsv(state);
  $('#exportTiers').onclick = () => exportTiers(state);
  $('#exportMarkdown').onclick = () => exportMarkdown(state);
  $('#exportHtml').onclick = () => exportHtml(state);
  $('#exportSessionDuel').onclick = () => exportSession(state);
  $('#exportSessionResult').onclick = () => exportSession(state);
  $('#saveSessionFile').onclick = () => saveTextFile('session-duelrank-v4.json', sessionJson(state), 'application/json');
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
  $('#resume').onclick = async () => {
    const saved = await loadLocal();
    if (saved) {
      state = hydrateSession(migrateSession(saved));
      if (state.phase === 'done') finish();
      else renderDuel();
    }
  };
  $('#forget').onclick = async () => {
    await clearLocal();
    $('#resume').classList.add('hidden');
    $('#forget').classList.add('hidden');
  };
  $('#zoomMedia').onclick = () => openMediaDialog();
  $('#closeDialog').onclick = () => $('#mediaDialog').close();
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
  choosePair(state, outcome);
  renderDuel();
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
  renderImportInfo();
}

init();
