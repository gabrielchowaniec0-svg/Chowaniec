// GIF search for the chat, through GIPHY (needs the GIPHY_API_KEY setting; free key from developers.giphy.com).
// Only G-rated GIFs are offered, and a sent GIF is looked up again on the server so a message can only
// ever point at a real GIPHY GIF.
const GIPHY = 'https://api.giphy.com/v1/gifs';
const RATING = 'g';
const GIF_ID = /^[A-Za-z0-9]{4,40}$/;
const MEDIA_HOST = /^https:\/\/media\d*\.giphy\.com\//;

const key = () => (Netlify.env.get('GIPHY_API_KEY') || '').trim();
export const gifsEnabled = () => !!key();

function clean(g) {
  const im = g.images || {};
  const pick = (r) => (r && r.mp4 && MEDIA_HOST.test(r.mp4) ? r : null);
  const main = pick(im.fixed_width) || pick(im.downsized_small) || pick(im.original);
  const small = pick(im.fixed_width_small) || main;
  if (!main) return null;
  const still = (im.fixed_width_still && MEDIA_HOST.test(im.fixed_width_still.url || '')) ? im.fixed_width_still.url : '';
  return {
    id: g.id,
    title: String(g.title || 'GIF').replace(/\s+GIF(\s+by\s+.*)?$/i, '').slice(0, 80) || 'GIF',
    mp4: main.mp4, width: Number(main.width) || 200, height: Number(main.height) || 200,
    preview: small.mp4, still
  };
}

async function giphy(path, params) {
  const url = new URL(`${GIPHY}${path}`);
  url.searchParams.set('api_key', key());
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error('GIF search isn’t working right now.'), { status: 502 });
  return res.json();
}

// Trending GIFs when `q` is empty.
export async function searchGifs(q, offset = 0) {
  if (!gifsEnabled()) return { enabled: false, gifs: [] };
  const query = String(q || '').trim().slice(0, 50);
  const params = { limit: '24', offset: String(Math.max(0, Math.min(500, Number(offset) || 0))), rating: RATING, bundle: 'messaging_non_clips' };
  const data = query ? await giphy('/search', { ...params, q: query, lang: 'en' }) : await giphy('/trending', params);
  return { enabled: true, gifs: (data.data || []).map(clean).filter(Boolean) };
}

// The GIF to store in a message, looked up by id (and re-checked for its rating).
export async function gifById(id) {
  if (!gifsEnabled()) throw Object.assign(new Error('GIFs aren’t set up yet.'), { status: 400 });
  if (!GIF_ID.test(id || '')) throw Object.assign(new Error('Unknown GIF.'), { status: 400 });
  const data = await giphy(`/${id}`, {});
  const g = data && data.data;
  if (!g || (g.rating && !['g', 'y'].includes(g.rating))) throw Object.assign(new Error('That GIF isn’t available.'), { status: 400 });
  const out = clean(g);
  if (!out) throw Object.assign(new Error('That GIF isn’t available.'), { status: 400 });
  return out;
}
