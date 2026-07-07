export const tierColors = ['#ff7f7f', '#ffc65c', '#f4f46b', '#8fe388', '#7fd6ff', '#b99cff', '#ff9bd4', '#b8c1cc'];

export function $(selector) {
  return document.querySelector(selector);
}

export function clampInt(value, min, max, fallback) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/')[1] || '';
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || '';
      return url.searchParams.get('v') || '';
    }
  } catch {}
  return '';
}

export function defaultTiers() {
  return ['S', 'A', 'B', 'C', 'D'];
}

export function parseTierText(text) {
  const names = String(text || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  return (names.length ? names : defaultTiers()).slice(0, 12).map((name, index) => ({
    name,
    color: tierColors[index % tierColors.length],
  }));
}

export function expectedMergeSortComparisons(n) {
  function estimate(size) {
    if (size < 2) return 0;
    const left = Math.floor(size / 2);
    const right = size - left;
    return estimate(left) + estimate(right) + left + right - left / (right + 1) - right / (left + 1);
  }
  return Math.round(estimate(n));
}

export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function downloadText(name, type, text) {
  const blob = new Blob([text], { type });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export async function saveTextFile(name, text, type = 'application/json') {
  if ('showSaveFilePicker' in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: 'DuelRank', accept: { [type]: ['.json'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  }
  downloadText(name, type, text);
  return false;
}
