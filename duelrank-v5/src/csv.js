const aliases = {
  nom: ['nom', 'name', 'titre', 'title', 'label', 'objet'],
  description: ['description', 'desc', 'resume', 'notes'],
  lien: ['lien', 'link', 'url', 'source'],
  image: ['image', 'img', 'cover', 'thumbnail', 'miniature'],
};

export function parseRows(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const delimiter = [',', ';', '\t'].map((char) => ({
    char,
    count: (sample.match(new RegExp(char === '\t' ? '\\t' : `\\${char}`, 'g')) || []).length,
  })).sort((a, b) => b.count - a.count)[0].char;
  const rows = [];
  let row = [];
  let field = '';
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (quote) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quote = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quote = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { delimiter, rows: rows.filter((line) => line.some((cell) => String(cell).trim())) };
}

export function detectMapping(headers) {
  const lower = headers.map((x) => String(x).trim().toLowerCase());
  const mapping = {};
  for (const [key, names] of Object.entries(aliases)) mapping[key] = lower.findIndex((head) => names.includes(head));
  return mapping;
}

export function rowsToItems(rows, mapping) {
  if (rows.length < 2) throw new Error('Le CSV ne contient aucune donnee.');
  if (mapping.nom < 0) throw new Error('Colonne "nom" introuvable.');
  return rows.slice(1).filter((row) => row.some((cell) => String(cell).trim())).map((row, index) => ({
    id: index + 1,
    nom: String(row[mapping.nom] || '').trim(),
    description: mapping.description >= 0 ? String(row[mapping.description] || '').trim() : '',
    lien: mapping.lien >= 0 ? String(row[mapping.lien] || '').trim() : '',
    image: mapping.image >= 0 ? String(row[mapping.image] || '').trim() : '',
    wins: 0,
    losses: 0,
    ties: 0,
    checks: 0,
    rating: 0,
    rd: 1.8,
    duels: 0,
    exposure: 0,
    auto: {},
  })).filter((item) => item.nom);
}

export function parseCSV(text) {
  const parsed = parseRows(text);
  const headers = parsed.rows[0] || [];
  const mapping = detectMapping(headers);
  return { ...parsed, headers, mapping, items: rowsToItems(parsed.rows, mapping) };
}

export function validateItems(items) {
  const issues = [];
  const names = new Map();
  for (const item of items) {
    const key = item.nom.trim().toLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
    for (const field of ['lien', 'image']) {
      if (item[field]) {
        try {
          const url = new URL(item[field]);
          if (!['http:', 'https:'].includes(url.protocol)) issues.push({ level: 'bad', text: `${item.nom}: ${field} non http(s).` });
        } catch {
          issues.push({ level: 'warn', text: `${item.nom}: ${field} invalide.` });
        }
      }
    }
  }
  const duplicates = [...names.entries()].filter(([, count]) => count > 1);
  if (duplicates.length) issues.push({ level: 'warn', text: `${duplicates.length} nom(s) en doublon detecte(s).` });
  const missing = items.reduce((sum, item) => sum + (!item.description ? 1 : 0) + (!item.lien ? 1 : 0) + (!item.image ? 1 : 0), 0);
  if (missing) issues.push({ level: 'warn', text: `${missing} champ(s) optionnel(s) vide(s).` });
  if (!issues.some((issue) => issue.level === 'bad')) issues.unshift({ level: 'good', text: `${items.length} objets prets a classer.` });
  return { issues, missing };
}
