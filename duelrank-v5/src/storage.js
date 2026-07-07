const DB = 'duelrank-v5-db';
const STORE = 'sessions';
const KEY = 'active';
const SCHEMA = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, SCHEMA);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLocal(state) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: new Date().toISOString(), state }, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (error) {
    console.warn('Sauvegarde locale impossible', error);
    return false;
  }
}

export async function loadLocal() {
  try {
    const db = await openDB();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value?.state || null;
  } catch {
    return null;
  }
}

export async function clearLocal() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function migrateSession(input) {
  const data = input.state || input;
  if (!data.items) throw new Error('Session DuelRank invalide.');
  data.version = 5;
  data.objective ||= 'global';
  data.stopMode ||= 'budget';
  data.calibrationTarget ??= 1;
  data.decisions ||= [];
  data.contradictions ||= [];
  data.tierChanges ||= [];
  data.rankView ||= 'list';
  for (const item of data.items) {
    item.ties ??= 0;
    item.tierLocked ??= '';
  }
  return data;
}
