import { youtubeId } from './utils.js';

const presets = {
  youtube: 'video youtube',
  movie: 'film',
  album: 'album',
  game: 'jeu video',
  restaurant: 'restaurant',
  article: 'article',
  product: 'produit',
  custom: '',
};

export function presetText(value) {
  return presets[value] ?? presets.custom;
}

export function missingCount(items) {
  return items.reduce((sum, item) => sum + (!item.description ? 1 : 0) + (!item.lien ? 1 : 0) + (!item.image ? 1 : 0), 0);
}

export function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function placeholderImage(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${(hash % 0xffffff).toString(16).padStart(6, '0')}&color=ffffff&size=512&bold=true`;
}

export async function youtubeCandidates(query, apiKey, regionCode = 'FR', maxResults = 5) {
  if (!apiKey) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: String(maxResults),
    order: 'relevance',
    regionCode,
    q: query,
    key: apiKey,
  });
  const response = await fetch(url);
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch {}
    throw new Error(`YouTube API ${response.status}${detail}`);
  }
  const data = await response.json();
  return (data.items || []).filter((hit) => hit.id?.videoId).map((hit) => ({
    id: hit.id.videoId,
    title: hit.snippet?.title || query,
    description: hit.snippet?.description || '',
    channel: hit.snippet?.channelTitle || '',
    link: `https://www.youtube.com/watch?v=${hit.id.videoId}`,
    image: hit.snippet?.thumbnails?.high?.url || hit.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${hit.id.videoId}/hqdefault.jpg`,
  }));
}

export async function candidatesFor(item, options) {
  const query = `${item.nom} ${options.type}`.trim();
  const isYoutube = /youtube|youtu\.?be|video/i.test(options.type);
  if (isYoutube) {
    try {
      const candidates = await youtubeCandidates(query, options.youtubeKey, options.region);
      if (candidates.length) return candidates;
    } catch (error) {
      return [{
        id: '',
        title: `Recherche YouTube: ${item.nom}`,
        description: `La recherche API a echoue (${error.message}). L'objet reçoit un lien de recherche YouTube a verifier.`,
        channel: 'YouTube',
        link: youtubeSearchUrl(query),
        image: placeholderImage(item.nom),
        warning: true,
        warningMessage: error.message,
      }];
    }
    return [{
      id: '',
      title: `Recherche YouTube: ${item.nom}`,
      description: 'Ajoute une cle API YouTube pour obtenir des candidats exacts.',
      channel: 'YouTube',
      link: youtubeSearchUrl(query),
      image: placeholderImage(item.nom),
      warning: !options.youtubeKey,
      warningMessage: options.youtubeKey ? '' : 'Aucune cle API YouTube: lien de recherche cree.',
    }];
  }
  return [{
    id: '',
    title: `${options.type}: ${item.nom}`,
    description: `Recherche web pour ${item.nom}.`,
    channel: 'Web',
    link: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    image: placeholderImage(item.nom),
  }];
}

export function applyCandidate(item, candidate, overwrite = false) {
  if (overwrite || !item.lien || !youtubeId(item.lien)) {
    item.lien = candidate.link;
    item.auto.lien = true;
  }
  if (overwrite || !item.image) {
    item.image = candidate.image;
    item.auto.image = true;
  }
  if (overwrite || !item.description) {
    item.description = [candidate.title, candidate.channel, candidate.description].filter(Boolean).join('\n');
    item.auto.description = true;
  }
}

export async function autoFill(items, options, onProgress = () => {}) {
  const report = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.autoError = '';
    if (item.description && item.lien && item.image) {
      item.autoStatus = 'ok';
      report.push({ id: item.id, status: 'ok', message: 'Deja complet.' });
      continue;
    }
    onProgress(i + 1, items.length, item);
    try {
      const list = await candidatesFor(item, options);
      if (!list.length) throw new Error('Aucun candidat trouve.');
      applyCandidate(item, list[0]);
      item.autoStatus = list[0].warning ? 'warning' : 'ok';
      item.autoCandidate = list[0].title;
      item.autoWarning = list[0].warningMessage || '';
      report.push({ id: item.id, status: item.autoStatus, message: item.autoWarning || list[0].title });
    } catch (error) {
      item.autoStatus = 'error';
      item.autoError = error.message || 'Erreur inconnue pendant la recherche.';
      report.push({ id: item.id, status: 'error', message: item.autoError });
    }
  }
  return report;
}
