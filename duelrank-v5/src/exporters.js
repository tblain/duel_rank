import { currentOrder, item, applyTierProposals, persistableState } from './ranking.js';
import { downloadText, nowIso } from './utils.js';

function quote(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function csvText(state) {
  const ids = currentOrder(state);
  applyTierProposals(state);
  const rows = [
    ['rang', 'tier', 'confiance', 'nom', 'description', 'lien', 'image', 'victoires', 'defaites', 'egalites', 'score', 'incertitude'],
    ...ids.map((id, index) => {
      const obj = item(state, id);
      return [index + 1, obj.tierProposal, obj.tierConfidence, obj.nom, obj.description, obj.lien, obj.image, obj.wins, obj.losses, obj.ties, obj.rating.toFixed(4), obj.rd.toFixed(4)];
    }),
  ];
  return '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

export function tierCsvText(state) {
  const ids = currentOrder(state);
  applyTierProposals(state);
  const rows = [['tier', 'nom'], ...ids.map((id) => {
    const obj = item(state, id);
    return [obj.tierProposal, obj.nom];
  })];
  return '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

export function markdownText(state) {
  const ids = currentOrder(state);
  applyTierProposals(state);
  const groups = new Map((state.tiers || []).map((tier) => [tier.name, []]));
  ids.forEach((id) => {
    const obj = item(state, id);
    if (!groups.has(obj.tierProposal)) groups.set(obj.tierProposal, []);
    groups.get(obj.tierProposal).push(obj.nom);
  });
  return ['# DuelRank', '', ...[...groups.entries()].flatMap(([tier, names]) => [`## ${tier}`, '', ...names.map((name) => `- ${name}`), ''])].join('\n');
}

export function htmlText(state) {
  const ids = currentOrder(state);
  applyTierProposals(state);
  const groups = new Map((state.tiers || []).map((tier) => [tier.name, []]));
  ids.forEach((id) => {
    const obj = item(state, id);
    if (!groups.has(obj.tierProposal)) groups.set(obj.tierProposal, []);
    groups.get(obj.tierProposal).push(obj);
  });
  const sections = [...groups.entries()].map(([tier, list]) => `
    <section><h2>${escapeHtml(tier)}</h2><ul>${list.map((obj) => `<li>${escapeHtml(obj.nom)}</li>`).join('')}</ul></section>
  `).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>DuelRank export</title><style>body{font:16px system-ui;margin:32px;background:#111;color:#f7f7f7}section{border:1px solid #333;border-radius:8px;padding:16px;margin:12px 0}h1,h2{margin-top:0}</style></head><body><h1>DuelRank</h1>${sections}</body></html>`;
}

export function sessionJson(state) {
  return JSON.stringify({ app: 'DuelRank', version: 5, exportedAt: nowIso(), state: persistableState(state) }, null, 2);
}

export function exportCsv(state) {
  downloadText('classement-duelrank-v5.csv', 'text/csv;charset=utf-8', csvText(state));
}

export function exportTiers(state) {
  downloadText('tiers-duelrank-v5.csv', 'text/csv;charset=utf-8', tierCsvText(state));
}

export function exportMarkdown(state) {
  downloadText('classement-duelrank-v5.md', 'text/markdown;charset=utf-8', markdownText(state));
}

export function exportHtml(state) {
  downloadText('classement-duelrank-v5.html', 'text/html;charset=utf-8', htmlText(state));
}

export function exportSession(state) {
  downloadText('session-duelrank-v5.json', 'application/json;charset=utf-8', sessionJson(state));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
