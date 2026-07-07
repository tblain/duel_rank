const CONFIG_KEY = 'duelrank-v5-supabase-config';

let clientPromise = null;

export function getBackendConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setBackendConfig(config) {
  const clean = {
    url: String(config.url || '').trim(),
    anonKey: String(config.anonKey || '').trim(),
  };
  if (!clean.url || !clean.anonKey) throw new Error('URL Supabase et anon key requises.');
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  clientPromise = null;
  return clean;
}

export function clearBackendConfig() {
  localStorage.removeItem(CONFIG_KEY);
  clientPromise = null;
}

export async function catalogClient() {
  if (clientPromise) return clientPromise;
  const config = getBackendConfig();
  if (!config?.url || !config?.anonKey) throw new Error('Configure Supabase dans l onglet Catalogue.');
  clientPromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => createClient(config.url, config.anonKey));
  return clientPromise;
}

export async function currentUser() {
  const client = await catalogClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user || null;
}

export async function sendMagicLink(email) {
  const client = await catalogClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = await catalogClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function listCatalogs(search = '') {
  const client = await catalogClient();
  let query = client
    .from('catalogs')
    .select('id,name,object_type,item_count,missing_count,created_at,updated_at,last_used_at')
    .order('updated_at', { ascending: false });
  if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getCatalog(id) {
  const client = await catalogClient();
  const { data, error } = await client.from('catalogs').select('*').eq('id', id).single();
  if (error) throw error;
  await client.from('catalogs').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  return data;
}

export async function saveCatalog(payload) {
  const client = await catalogClient();
  const user = await currentUser();
  if (!user) throw new Error('Connecte-toi avant de sauvegarder dans le catalogue.');
  const record = {
    user_id: user.id,
    name: payload.name,
    object_type: payload.objectType || '',
    csv_json: payload.items,
    item_count: payload.items.length,
    missing_count: payload.missingCount,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('catalogs').insert(record).select().single();
  if (error) throw error;
  return data;
}

export async function updateCatalog(id, payload) {
  const client = await catalogClient();
  const record = {
    name: payload.name,
    object_type: payload.objectType || '',
    csv_json: payload.items,
    item_count: payload.items.length,
    missing_count: payload.missingCount,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('catalogs').update(record).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCatalog(id) {
  const client = await catalogClient();
  const { error } = await client.from('catalogs').delete().eq('id', id);
  if (error) throw error;
}
