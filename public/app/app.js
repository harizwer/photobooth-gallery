/* =====================================================================
   Photobooth Studio — one website for the tablet (Booth) and the laptop
   (Admin board + printing). Data lives in Supabase.
   ===================================================================== */
const SUPABASE_URL = 'https://dqeyaimxfkursttbdmyp.supabase.co';
const PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZXlhaW14Zmt1cnN0dGJkbXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyODc2NTQsImV4cCI6MjEwODg2MzY1NH0.T5tHvHVpNzNHwxYFASy8WO6xr1bvfBko9gxHCoxVQSc';
const SITE = location.origin + location.pathname.replace(/app\/?(index\.html)?$/, '');
const APP_URL = SITE + 'app/';
const sb = (window.__SB_FAKE__ || window.supabase).createClient(SUPABASE_URL, PUBLIC_KEY);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('pb.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pb.' + k, JSON.stringify(v)); } catch (e) {} },
};
const deviceId = store.get('device', null) || (() => { const id = 'd' + Math.random().toString(36).slice(2, 10); store.set('device', id); return id; })();
const fileUrl = path => path ? `${SUPABASE_URL}/storage/v1/object/public/photos/${path}` : '';
const token = (n = 12) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const timeOf = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function check(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }
function qr(el, text, size) { el.innerHTML = ''; if (window.QRCode) new QRCode(el, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M }); else el.textContent = text; }
function qrCanvas(text, size) { const d = document.createElement('div'); new QRCode(d, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M }); return d.querySelector('canvas'); }
const shareLink = p => `${SITE}?p=${p.share_token}`;
const albumLink = e => `${SITE}?album=${e.album_token}`;
const toBlob = (c, type = 'image/jpeg', q = .92) => new Promise(r => c.toBlob(r, type, q));
function scaled(src, max) {
  const w0 = src.width || src.videoWidth, h0 = src.height || src.videoHeight;
  const s = Math.min(1, max / Math.max(w0, h0)); const o = document.createElement('canvas');
  o.width = Math.round(w0 * s); o.height = Math.round(h0 * s); o.getContext('2d').drawImage(src, 0, 0, o.width, o.height); return o;
}
async function copyText(text, input) { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch (e) { if (input) input.select(); toast('Select the link and copy it'); } }
function download(blobOrUrl, name) { const a = document.createElement('a'); a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

/* ---------------- Studio settings ---------------- */
const STUDIO_DEFAULT = {
  brand: 'Photobooth Studio', guestFooter: '', logo: '',
  printQr: { on: false, pos: 'br' },
  bg: { kind: 'color', color: '#ff5a26', src: '', dim: 45, sub: '' },
  modes: { photo: true, gif: true, boom: true, video: false },
  capture: { res: '4k', camera: 'user', mirror: true, quality: 95, countdown: 3, gap: 2, videoSec: 10, maxCopies: 3 },
  types: [],
};
let S = structuredClone(STUDIO_DEFAULT);
function mergeStudio(d) {
  const o = structuredClone(STUDIO_DEFAULT); d = d || {};
  for (const k of Object.keys(d)) o[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? { ...o[k], ...d[k] } : d[k];
  return o;
}
const cachedStudio = store.get('studio', null); if (cachedStudio) S = mergeStudio(cachedStudio);
const DEFAULT_LOGO = sz => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="#ff5a26" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3l3 7M21 12l-7 3M12 21l-3-7M3 12l7-3"/></svg>`;
function applyBrand() {
  const name = S.brand || 'Photobooth Studio';
  $$('[data-brand]').forEach(el => el.textContent = name); document.title = name;
  $$('[data-logo]').forEach(el => { const sz = +el.dataset.size || 24; el.innerHTML = S.logo ? `<img src="${esc(S.logo)}" alt="" style="width:${Math.round(sz * 1.25)}px;height:${Math.round(sz * 1.25)}px">` : DEFAULT_LOGO(sz); });
  const lp = $('#logoPrev'); if (lp) lp.innerHTML = S.logo ? `<img src="${esc(S.logo)}" alt="Your logo">` : DEFAULT_LOGO(40);
}
applyBrand();

/* ---------------- Layouts, templates and drawing ---------------- */
// Built-in layouts (used when an event type has no templates yet). Areas are fractions of the page.
const BUILTIN = [
  { id: 'b-strip3', name: '3-photo strip', paper: 'strip', w: 600, h: 1800, areas: [[40, 40, 520, 466], [40, 536, 520, 466], [40, 1032, 520, 466]], footer: [40, 1520, 520, 250] },
  { id: 'b-grid4', name: '4-photo grid', paper: 'portrait', w: 1200, h: 1800, areas: [[45, 45, 535, 700], [620, 45, 535, 700], [45, 785, 535, 700], [620, 785, 535, 700]], footer: [45, 1500, 1110, 270] },
  { id: 'b-single', name: '1 photo landscape', paper: 'landscape', w: 1800, h: 1200, areas: [[50, 50, 1700, 940]], footer: [50, 1000, 1700, 170] },
].map(b => ({ ...b, builtin: true, fit: 'cover', output_long: 3600, frame_url: '', areas: b.areas.map(([x, y, w, h]) => ({ x: x / b.w, y: y / b.h, w: w / b.w, h: h / b.h })), footer: b.footer.map((v, i) => v / (i % 2 ? b.h : b.w)) }));
const FILTERS = [['none', 'Original', 'none'], ['bw', 'Black & White', 'grayscale(1) contrast(1.15)'], ['vintage', 'Vintage', 'sepia(.35) contrast(.92) brightness(1.08) saturate(.8)'], ['warm', 'Warm', 'saturate(1.25) sepia(.15) brightness(1.04)'], ['vivid', 'Vivid', 'saturate(1.5) contrast(1.1)'], ['soft', 'Soft', 'brightness(1.1) contrast(.9) saturate(1.05)']];
const FILTER_OK = (() => { try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'grayscale(1)'; return c.filter === 'grayscale(1)'; } catch (e) { return false; } })();
function manualFilter(x, key, sx, sy, sw, sh) {
  if (key === 'none') return;
  const d = x.getImageData(sx, sy, sw, sh), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], g = p[i + 1], b = p[i + 2]; const l = .299 * r + .587 * g + .114 * b;
    if (key === 'bw') r = g = b = (l - 128) * 1.15 + 128;
    else if (key === 'vintage') { const k = .35; r = r * (1 - k) + (l * 1.07 + 20) * k; g = g * (1 - k) + (l * .95 + 8) * k; b = b * (1 - k) + l * .78 * k; }
    else if (key === 'vivid' || key === 'warm') { const s = key === 'vivid' ? 1.5 : 1.25; r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s; if (key === 'warm') { r += 10; b -= 8; } }
    else if (key === 'soft') { r = (r - 128) * .9 + 140; g = (g - 128) * .9 + 140; b = (b - 128) * .9 + 140; }
    p[i] = r; p[i + 1] = g; p[i + 2] = b;
  }
  x.putImageData(d, sx, sy);
}
const imgCache = {};
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache[src]) imgCache[src] = new Promise(r => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => r(i); i.onerror = () => { delete imgCache[src]; r(null); }; i.src = src; });
  return imgCache[src];
}
function drawInto(x, img, dx, dy, dw, dh, fit = 'cover') {
  const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
  if (fit === 'contain') { const s = Math.min(dw / iw, dh / ih), w = iw * s, h = ih * s; x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h); return; }
  const s = Math.max(dw / iw, dh / ih), sw = dw / s, sh = dh / s;
  x.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
}
function fitText(x, text, maxW, size, font, weight = '') { do { x.font = `${weight} ${size}px ${font}`; size -= 2; } while (x.measureText(text).width > maxW && size > 10); }
function designSize(d) { const long = Math.min(4000, d.output_long || 3600), s = long / Math.max(d.w, d.h); return [Math.round(d.w * s), Math.round(d.h * s)]; }
// Compose the finished photo: guest shots in the areas, the PNG frame on top, optional small QR.
async function compose(d, shots, filter = 'none', opts = {}) {
  const [W, H] = designSize(d); const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = d.builtin ? '#f4efe6' : '#ffffff'; x.fillRect(0, 0, W, H);
  const f = (FILTERS.find(z => z[0] === filter) || FILTERS[0]);
  d.areas.forEach((a, i) => {
    const ax = Math.round(a.x * W), ay = Math.round(a.y * H), aw = Math.round(a.w * W), ah = Math.round(a.h * H);
    const shot = shots && shots[i];
    if (shot) { x.save(); x.beginPath(); x.rect(ax, ay, aw, ah); x.clip(); if (FILTER_OK) x.filter = f[2]; drawInto(x, shot, ax, ay, aw, ah, d.fit); x.restore(); if (!FILTER_OK) manualFilter(x, filter, ax, ay, aw, ah); }
    else { x.fillStyle = '#c9c9d1'; x.fillRect(ax, ay, aw, ah); x.fillStyle = '#8a8a96'; x.font = `bold ${Math.min(aw, ah) * .28}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), ax + aw / 2, ay + ah / 2); }
  });
  const frame = await loadImg(d.frame_url); if (frame) x.drawImage(frame, 0, 0, W, H);
  if (d.builtin) {
    const [fx, fy, fw, fh] = [d.footer[0] * W, d.footer[1] * H, d.footer[2] * W, d.footer[3] * H];
    const name = (opts.name || '').trim(), date = (opts.date || '').trim();
    x.fillStyle = '#5b4a33'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const font = '"Playfair Display", Georgia, serif';
    if (name) { fitText(x, name, fw * .86, Math.round(fh * (date ? .34 : .46)), font, 'italic 600'); x.fillText(name, fx + fw / 2, fy + fh * (date ? .4 : .5)); }
    if (date) { fitText(x, date, fw * .8, Math.round(fh * .15), 'Geist, system-ui, sans-serif'); x.fillText(date, fx + fw / 2, fy + fh * .74); }
  }
  if (opts.qrText) drawPrintQr(x, W, H, d, opts.qrText);
  return c;
}
function drawPrintQr(x, W, H, d, text) {
  const side = Math.round(Math.min(W, H) * (d.paper === 'strip' ? .2 : .11)), m = Math.round(side * .18), pad = Math.round(side * .08);
  const qx = S.printQr.pos === 'bl' ? m : W - side - m, qy = H - side - m;
  x.fillStyle = '#fff'; x.fillRect(qx - pad, qy - pad, side + pad * 2, side + pad * 2);
  const q = qrCanvas(text, 256); x.imageSmoothingEnabled = false; x.drawImage(q, qx, qy, side, side); x.imageSmoothingEnabled = true;
}
// What goes on the 4x6 sheet: strips are printed twice side by side.
function printCanvas(d, design) {
  if (d.paper !== 'strip') return design;
  const c = document.createElement('canvas'); c.width = design.width * 2; c.height = design.height;
  const x = c.getContext('2d'); x.drawImage(design, 0, 0); x.drawImage(design, design.width, 0); return c;
}
function tplToDesign(t) { return { ...t, w: t.width || 600, h: t.height || 1800, areas: (t.areas || []).length ? t.areas : [{ x: .05, y: .05, w: .9, h: .7 }] }; }

/* ---------- Sample photos (template preview) ---------- */
const TINTS = [['#c9bda8', '#6e675e'], ['#b8c4cc', '#5d6670'], ['#d1c2b6', '#74685e'], ['#bfcab8', '#5e6a58'], ['#d4bfc6', '#6d5a61']];
function samplePhoto(i) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d'), t = TINTS[i % 5];
  const g = x.createLinearGradient(0, 0, 1200, 900); g.addColorStop(0, t[0]); g.addColorStop(1, t[1]); x.fillStyle = g; x.fillRect(0, 0, 1200, 900);
  x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(600, 380, 150, 0, 7); x.fill(); x.beginPath(); x.ellipse(600, 860, 300, 240, 0, 0, 7); x.fill();
  return c;
}
const samples = n => Array.from({ length: n }, (_, i) => samplePhoto(i));

/* ---------- Automatic photo-area detection (transparent regions in a PNG) ---------- */
function detectAreas(img) {
  const W = img.naturalWidth, H = img.naturalHeight, s = Math.min(1, 400 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h, mask = new Uint8Array(n), seen = new Uint8Array(n), stack = new Int32Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] < 40 ? 1 : 0;
  const boxes = [];
  for (let p = 0; p < n; p++) {
    if (!mask[p] || seen[p]) continue;
    let top = 0, count = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; stack[top++] = p; seen[p] = 1;
    while (top) {
      const q = stack[--top], qx = q % w, qy = (q / w) | 0; count++;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1; }
      if (qx < w - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1; }
      if (qy > 0 && mask[q - w] && !seen[q - w]) { seen[q - w] = 1; stack[top++] = q - w; }
      if (qy < h - 1 && mask[q + w] && !seen[q + w]) { seen[q + w] = 1; stack[top++] = q + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (count > n * 0.01 && bw * bh < n * 0.92) boxes.push({ x: x0 / w, y: y0 / h, w: bw / w, h: bh / h });
  }
  return boxes.sort((a, b) => (Math.abs(a.y - b.y) < .05 ? a.x - b.x : a.y - b.y));
}

/* ---------------- Account, data, live connection ---------------- */
let USER = null, PROFILE = null, EVENTS = [], ACTIVE = null, TEMPLATES = [], STATION = null, ROLE = null, chan = null, jobChan = null, devices = {};
const DEFAULT_TYPES = ['Wedding', 'Birthday', 'Corporate', 'Raya'];
const evType = e => (e && e.settings && e.settings.type) || 'Wedding';
const allTypes = () => [...new Set([...DEFAULT_TYPES, ...(S.types || []), ...TEMPLATES.map(t => t.event_type), ...EVENTS.map(evType)])];
function allDesigns() { return [...TEMPLATES.filter(t => t.frame_url).map(tplToDesign), ...BUILTIN]; }
// The layouts guests can choose on the tablet: the ones picked for this event, else all templates of its type, else the standard ones.
function designsFor(ev) {
  const pick = ev && ev.settings && ev.settings.templates;
  if (Array.isArray(pick) && pick.length) { const all = allDesigns(), d = pick.map(id => all.find(x => x.id === id)).filter(Boolean); if (d.length) return d; }
  const t = TEMPLATES.filter(x => x.event_type === evType(ev) && x.frame_url); return t.length ? t.map(tplToDesign) : BUILTIN;
}

async function loadEvents() {
  EVENTS = check(await sb.from('events').select('*').eq('owner', USER.id).order('created_at', { ascending: false }));
  if (!EVENTS.length) {
    const ev = check(await sb.from('events').insert({ id: 'e' + Date.now().toString(36), name: 'My First Event', event_date: today(), settings: { type: 'Wedding' }, is_active: true, album_token: token() }).select().single());
    EVENTS = [ev];
  }
  ACTIVE = EVENTS.find(e => e.is_active) || EVENTS[0];
}
async function loadStudio() {
  const r = await sb.from('studio').select('data').eq('owner', USER.id).maybeSingle();
  S = mergeStudio(r.data && r.data.data); store.set('studio', S); applyBrand();
}
async function saveStudio() {
  check(await sb.from('studio').upsert({ owner: USER.id, data: S, updated_at: new Date().toISOString() }));
  store.set('studio', S); applyBrand(); announce();
}
async function loadTemplates() { TEMPLATES = check(await sb.from('templates').select('*').eq('owner', USER.id).order('created_at', { ascending: true })); }
async function loadStation() {
  const r = await sb.from('station_settings').select('*').eq('owner', USER.id).maybeSingle();
  STATION = r.data;
  if (!STATION) { const ins = await sb.from('station_settings').insert({}).select().single(); STATION = ins.data || { media_capacity: 700, printed_since_reset: 0, staff_pin: '1234' }; }
}
async function loadAll() { await Promise.all([loadEvents(), loadStudio(), loadTemplates(), loadStation()]); }

const printerOn = () => ROLE === 'admin' && store.get('printer', false);
function track() {
  if (!chan) return;
  chan.track({ role: ROLE || 'home', printer: printerOn(), label: ROLE === 'booth' ? 'Tablet (Booth)' : ROLE === 'admin' ? 'Laptop (Admin board)' : 'Device', at: Date.now() }).catch(() => {});
}
function connectLive() {
  if (chan) return;
  chan = sb.channel('booth-' + USER.id, { config: { presence: { key: deviceId }, broadcast: { self: false } } });
  chan.on('presence', { event: 'sync' }, () => { devices = chan.presenceState(); onDevices(); })
    .on('broadcast', { event: 'event-updated' }, () => onEventUpdated())
    .on('broadcast', { event: 'show-qr' }, m => { if (ROLE === 'booth') boothShowQr(m.payload || {}); })
    .subscribe(status => { if (status === 'SUBSCRIBED') track(); });
  jobChan = sb.channel('jobs-' + USER.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs', filter: `owner=eq.${USER.id}` }, p => onJobChange(p.new || p.old))
    .subscribe();
}
const others = () => Object.entries(devices).filter(([k]) => k !== deviceId).map(([, v]) => v[0]).filter(Boolean);
const printerOnline = () => Object.values(devices).some(v => v[0] && v[0].printer);
function onDevices() { if (ROLE === 'booth') boothStatus(); if (ROLE === 'admin') renderDevices(); }
function onEventUpdated() { if (ROLE === 'booth') { if (B.session) B.pendingReload = true; else boothLoad(); } }
function onJobChange(job) { if (!job) return; if (ROLE === 'booth') boothJob(job); if (ROLE === 'admin') { if (secOn('printer')) renderQueue(); queueBadge(); runPrinter(); } }
function announce() { if (chan) chan.send({ type: 'broadcast', event: 'event-updated', payload: {} }).catch(() => {}); }

let wakeLock = null;
async function keepAwake() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ROLE) keepAwake(); });

/* ---------------- Views & login ---------------- */
function show(id) { $$('.view').forEach(v => v.classList.toggle('on', v.id === id)); $('#v-booth').classList.toggle('on', id === 'v-booth'); }
$('#lEye').onclick = () => { const i = $('#lPass'); i.type = i.type === 'password' ? 'text' : 'password'; };
async function loginRequest(username, password) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY, Authorization: 'Bearer ' + PUBLIC_KEY }, body: JSON.stringify({ username, password }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not log in');
  check(await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token }));
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const u = $('#lUser').value.trim().toLowerCase(), p = $('#lPass').value, msg = $('#lMsg');
  if (!u || !p) { msg.style.color = '#ff8a80'; msg.textContent = 'Enter your username and password.'; return; }
  $('#lSubmit').disabled = true; msg.style.color = ''; msg.textContent = 'Logging in…';
  try { await loginRequest(u, p); msg.textContent = ''; store.set('lastUser', u); }
  catch (err) { msg.style.color = '#ff8a80'; msg.textContent = /fetch|network/i.test(err.message) ? 'No internet connection. Check the WiFi and try again.' : err.message; }
  finally { $('#lSubmit').disabled = false; }
};
$('#lUser').value = store.get('lastUser', '');
async function signOut() {
  try { if (chan) await chan.untrack(); } catch (e) {}
  stopCamera(); store.set('role', null);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  await sb.auth.signOut(); location.hash = ''; location.reload();
}
document.addEventListener('click', e => { if (e.target.closest('[data-logout]')) { e.preventDefault(); signOut(); } });

async function enter(user) {
  USER = user;
  try { await loadAll(); } catch (e) { toast('Could not load your data: ' + e.message, 5000); }
  try { PROFILE = (await sb.from('profiles').select('*').eq('user_id', USER.id).maybeSingle()).data; } catch (e) {}
  const uname = PROFILE ? PROFILE.username : (user.email || '');
  $('#whoami').textContent = uname; $('#avatar').textContent = (uname[0] || '?').toUpperCase();
  connectLive();
  const role = store.get('role', null);
  if (role === 'booth') startBooth(); else if (role === 'admin') startAdmin(); else { ROLE = null; show('v-devices'); track(); }
}
$('#roleBooth').onclick = () => { store.set('role', 'booth'); startBooth(); };
$('#roleAdmin').onclick = () => { store.set('role', 'admin'); startAdmin(); };
$('#swDevice').onclick = () => { store.set('role', null); ROLE = null; show('v-devices'); track(); };

/* =====================================================================
   BOOTH (tablet)
   ===================================================================== */
const B = { session: null, pendingReload: false, stream: null, reviewT: null, doneT: null, mode: 'photo' };
let actx;
const ac = () => actx || (actx = new (window.AudioContext || window.webkitAudioContext)());
function beep(f = 880, d = .12) { try { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.setValueAtTime(.25, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + d); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + d); } catch (e) {} }
function shutter() { try { const a = ac(), n = a.sampleRate * .18, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); const s = a.createBufferSource(), g = a.createGain(); g.gain.value = .5; s.buffer = b; s.connect(g).connect(a.destination); s.start(); } catch (e) {} }
function bscreen(id) { $$('#v-booth .bs').forEach(s => s.classList.toggle('on', s.id === id)); }
const MODE_INFO = { photo: ['Photo', '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'], gif: ['GIF', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h3v3M14 9v6M17 9h-3M17 12h-2"/>'], boom: ['Boomerang', '<path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5"/><path d="M18 3v4h-4M6 21v-4h4"/>'], video: ['Video', '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>'] };
const enabledModes = () => Object.keys(MODE_INFO).filter(k => S.modes[k]);

async function startBooth() {
  ROLE = 'booth'; show('v-booth'); bscreen('b-attract'); track(); keepAwake();
  await boothLoad();
  await startCamera();
}
function bgMarkup(bg) {
  if (bg.kind === 'color' || !bg.src) return { html: '', css: `radial-gradient(70% 70% at 50% 45%,${bg.color || '#ff5a26'}59 0%,rgba(0,0,0,0) 70%),linear-gradient(160deg,#2a2a2e,#0e0e10)` };
  return { html: bg.kind === 'video' ? `<video src="${esc(bg.src)}" autoplay muted loop playsinline></video>` : `<img src="${esc(bg.src)}" alt="">`, css: '#0e0e10' };
}
function paintBg(layer, shade, bg) { const m = bgMarkup(bg); if (layer.dataset.k !== m.html + m.css) { layer.innerHTML = m.html; layer.style.background = m.css; layer.dataset.k = m.html + m.css; } shade.style.opacity = (bg.dim ?? 45) / 100; }
async function boothLoad() {
  try { await loadAll(); } catch (e) {}
  $('#bTitle').textContent = ACTIVE ? ACTIVE.name : '';
  $('#bSub').textContent = S.bg.sub || 'Tap to make memories';
  paintBg($('#boothBgLayer'), $('#boothShade'), S.bg);
  const modes = enabledModes(); const list = modes.length ? modes : ['photo'];
  $('#bModes').innerHTML = list.length === 1
    ? `<button class="bmode first" data-mode="${list[0]}">Touch to start</button>`
    : list.map((m, i) => `<button class="bmode ${i === 0 ? 'first' : ''}" data-mode="${m}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${MODE_INFO[m][1]}</svg>${MODE_INFO[m][0]}</button>`).join('');
  $('#live').classList.toggle('mirror', !!S.capture.mirror); $('#dslrView').classList.toggle('mirror', false);
  boothStatus();
}
function boothStatus() {
  $('#bStatus').innerHTML = (printerOnline() ? '<span class="dot"></span>Printer ready' : '<span class="dot warn"></span>Printer laptop not connected') + ` · ${dslr && dslr.running ? 'Canon DSLR' : 'Tablet camera'}` + (UPLOADS.size ? ` · Uploading ${UPLOADS.size}…` : '');
}
$('#bModes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) startFlow(b.dataset.mode); });

/* ---------- Camera: tablet camera or Canon DSLR over USB ---------- */
const RES = { '4k': [3840, 2160], '1440': [2560, 1440], '1080': [1920, 1080] };
let dslr = null; // { cam, canvas, running }
function stopCamera() { if (B.stream) B.stream.getTracks().forEach(t => t.stop()); B.stream = null; }
async function startCamera() {
  if (dslr && dslr.running) { showDslrView(); return; }   // a connected Canon always wins
  stopCamera();
  if (S.capture.camera === 'dslr') {
    if (await dslrAutoConnect()) return;
    if (!dslrCrashed) toast('Canon DSLR not connected. Using the tablet camera. Open Staff → Camera to connect it.', 5000);
  }
  const pref = S.capture.camera === 'dslr' ? 'user' : (store.get('camDevice', '') || S.capture.camera || 'user');
  const [w, h] = RES[S.capture.res] || RES['4k'];
  const base = pref === 'user' || pref === 'environment' ? { facingMode: pref } : { deviceId: { exact: pref } };
  try {
    B.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, width: { ideal: w }, height: { ideal: h } } });
  } catch (e) {
    try { B.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
    catch (e2) { return showErr('Cannot open the camera', 'Allow camera access for this website in the browser settings, then tap Try again.', () => startCamera(), () => {}); }
  }
  const v = $('#live'); v.hidden = false; $('#dslrView').hidden = true; v.srcObject = B.stream; await v.play().catch(() => {});
  if (ROLE === 'booth') boothStatus();
}
function showDslrView() { stopCamera(); $('#live').hidden = true; $('#dslrView').hidden = false; if (ROLE === 'booth') boothStatus(); }
function dslrSupported() { return !!navigator.usb && window.crossOriginIsolated; }
// The camera library can only hold ONE connection per page. After it crashes, only a page reload clears it.
let dslrLib = null, dslrBusy = null, dslrCrashed = false;
const isWindows = /Windows/i.test(navigator.userAgent), isAndroid = /Android/i.test(navigator.userAgent);
function dslrHelp(e) {
  const m = String(e && e.message || e);
  const crash = (e && e.constructor && e.constructor.name === 'RuntimeError') || /memory access|out of bounds|unreachable|table index/i.test(m);
  if (crash) dslrCrashed = true;
  if (/No device selected|NotFoundError/i.test(m)) return 'No camera was chosen. Tap Connect again and pick the Canon in the list.';
  const steps = isWindows
    ? 'On a Windows laptop the camera needs the WinUSB driver first: install Zadig (zadig.akeo.ie), choose the Canon EOS 750D, pick WinUSB, click Replace Driver. Then reload this page.'
    : 'Close any other app that grabbed the camera (Gallery, Photos, a "USB: File transfer" pop-up — choose "Cancel" or "No data transfer"). On the camera: turn Wi-Fi off, set the dial to P or M (not video), and make sure a lens is on.';
  return (crash ? 'The camera connection crashed. ' : 'Could not connect to the camera (' + m + '). ') + 'Unplug the USB cable, switch the camera off and on, plug it back in, reload this page, then tap Connect once. ' + steps;
}
async function dslrConnect(pick) {
  if (!navigator.usb) throw new Error('This browser cannot use USB devices. Use Chrome on an Android tablet (iPad is not supported).');
  if (!window.crossOriginIsolated) throw new Error('Open the booth from the Cloudflare address of this website to use the DSLR.');
  if (dslrCrashed) throw new Error('Reload this page first (the camera connection crashed earlier), then tap Connect once.');
  if (dslr && dslr.running) { showDslrView(); return dslr.cam; }   // already connected: never open a second connection
  if (dslrBusy) return dslrBusy;                       // a connect is already in progress
  dslrBusy = (async () => {
    if (!dslrLib) dslrLib = await import('../vendor/gphoto2/camera.js');
    if (pick) { try { await dslrLib.Camera.showPicker(); } catch (e) { throw new Error(dslrHelp(e)); } }
    const cam = new dslrLib.Camera();
    try { await cam.connect(); await cam.capturePreviewAsBlob(); }
    catch (e) { try { await cam.disconnect(); } catch (_) {} throw new Error(dslrHelp(e)); }
    dslr = { cam, canvas: $('#dslrView'), running: true, lastFrame: Date.now() };
    showDslrView();
    dslr.loopDone = dslrLoop(dslr);
    // Remember the choice so the booth reconnects to the Canon next time
    if (S.capture.camera !== 'dslr') { S.capture.camera = 'dslr'; saveStudio().catch(() => {}); }
    try { if (sessionStorage.getItem('pb.dslrRecovering')) { sessionStorage.removeItem('pb.dslrRecovering'); setTimeout(() => toast('Canon reconnected'), 500); } } catch (e) {}
    return cam;
  })();
  try { return await dslrBusy; } finally { dslrBusy = null; }
}
// Stop the live view and wait for it to finish before closing, so the library never uses a closed connection.
async function dslrDisconnect() { const d = dslr; dslr = null; if (!d) return; d.running = false; try { await d.loopDone; } catch (e) {} try { await d.cam.disconnect(); } catch (e) {} }
async function dslrAutoConnect() {
  try { if (!dslrSupported() || dslrCrashed) return false; const list = await navigator.usb.getDevices(); if (!list.length) return false; await dslrConnect(false); return true; } catch (e) { return false; }
}
async function dslrLoop(d) {
  const x = d.canvas.getContext('2d'); let fails = 0;
  while (d.running && dslr === d) {
    if (d.pause) { await sleep(60); continue; }
    try {
      const bmp = await createImageBitmap(await d.cam.capturePreviewAsBlob()); fails = 0; d.lastFrame = Date.now();
      if (d.canvas.width !== bmp.width) { d.canvas.width = bmp.width; d.canvas.height = bmp.height; }
      x.drawImage(bmp, 0, 0); bmp.close && bmp.close();
      await sleep(document.hidden ? 500 : 25);
    } catch (e) {
      const msg = dslrHelp(e);
      if (dslrCrashed || ++fails > 10) { if (dslr === d) dslrFallback(msg); return; }   // camera lost: keep the booth working
      await sleep(300);
    }
  }
}
/* ---------- Keeping the Canon working during an event ----------
   The camera library can get stuck if the Canon stops answering (most often it cannot focus).
   Then: finish the session with the tablet camera, and once the guest is done, reload the page,
   which reconnects the Canon automatically (at most 3 times in 5 minutes). */
const dslrHealthy = () => !!(dslr && dslr.running && Date.now() - (dslr.lastFrame || 0) < 4000);
function dslrFallback(reason) {
  const d = dslr; if (!d) return Promise.resolve();
  dslr = null; d.running = false; dslrCrashed = true; B.recoverDslr = true;
  toast('The Canon stopped responding. This session uses the tablet camera; the Canon reconnects by itself after it.' + (reason ? ' ' + reason : ''), 9000);
  return ROLE === 'booth' ? startCamera() : Promise.resolve();
}
function dslrRecover() {
  let tries = []; try { tries = JSON.parse(sessionStorage.getItem('pb.dslrReloads') || '[]').filter(t => Date.now() - t < 5 * 60e3); } catch (e) {}
  if (tries.length >= 3) { toast('The Canon keeps stopping. Switch it off and on, check the cable and focus (MF), then choose Canon DSLR in Staff → Camera. Using the tablet camera for now.', 15000); B.recoverDslr = false; return; }
  tries.push(Date.now()); try { sessionStorage.setItem('pb.dslrReloads', JSON.stringify(tries)); sessionStorage.setItem('pb.dslrRecovering', '1'); } catch (e) {}
  if (UPLOADS.size) { tries.pop(); try { sessionStorage.setItem('pb.dslrReloads', JSON.stringify(tries)); } catch (e) {} return; }   // wait for uploads, the watchdog tries again
  busy('Reconnecting the Canon…'); setTimeout(() => location.reload(), 400);
}
// Idle watchdog: if the Canon freezes while nobody is using the booth, reconnect it right away.
setInterval(() => {
  if (ROLE !== 'booth' || B.session) return;
  if (dslr && !dslr.pause && !dslrHealthy()) { dslrFallback(); }
  if (B.recoverDslr && !B.session && $('#b-attract').classList.contains('on')) dslrRecover();
}, 3000);
// One frame from the live preview, at most `max` px on the long edge.
function grabFrame(max = 4000) {
  const src = dslr ? dslr.canvas : $('#live');
  const w = src.videoWidth || src.width, h = src.videoHeight || src.height;
  if (!w || !h) throw new Error('The camera is not ready yet.');
  const s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const x = c.getContext('2d');
  if (!dslr && S.capture.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0, c.width, c.height); return c;
}
function withTimeout(promise, ms, msg) { let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); }
const DSLR_SHOT_HELP = 'The Canon did not take the photo in time. Usually it could not focus: add more light, or focus once and switch the lens to MF. Also set the camera to JPEG (not RAW) and make sure an SD card is in.';
// Full-quality Canon photo, shrunk to 4K. Never waits more than 12 s: if the Canon hangs, the live view frame is used instead.
async function dslrFullPhoto(d) {
  const f = await withTimeout(d.cam.captureImageAsFile(), 10000, DSLR_SHOT_HELP);
  let bmp;
  try { bmp = await createImageBitmap(f, { resizeWidth: 4000, resizeQuality: 'high' }); }
  catch (e) { throw new Error('The Canon sent a file the browser cannot read. Set Image quality on the camera to a JPEG setting (not RAW).'); }
  const c = scaled(bmp, 4000); bmp.close && bmp.close(); return c;
}
async function capturePhoto() {
  if (dslr && !dslrHealthy()) { await dslrFallback(); await sleep(700); }
  const d = dslr;
  if (d) {
    d.pause = true; $('#shotInfo').textContent = 'Hold still…';
    try { return await dslrFullPhoto(d); }
    catch (e) {
      const live = grabFrame();                       // last Canon live view frame, taken at the right moment
      if (/did not take the photo in time/.test(e.message)) await dslrFallback(e.message);   // the library is stuck now
      else toast(e.message, 9000);
      return live;
    }
    finally { d.pause = false; }
  }
  return grabFrame();
}
function liveStream() { return dslr ? dslr.canvas.captureStream(24) : B.stream; }

/* ---------- Session flow ---------- */
function goHome() {
  B.session = null; clearInterval(B.reviewT); clearInterval(B.doneT);
  $('#b-count').textContent = ''; $('#busy').hidden = true; $('#bErr').hidden = true;
  bscreen('b-attract');
  if (B.recoverDslr) return dslrRecover();
  if (B.pendingReload) { B.pendingReload = false; boothLoad(); }
}
function startFlow(mode) {
  ac(); keepAwake();
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  B.mode = mode || 'photo';
  if (B.mode !== 'photo') return startSession(null);
  const ds = designsFor(ACTIVE);
  if (ds.length === 1) return startSession(ds[0]);
  $('#pickList').innerHTML = '';
  ds.forEach(async (d, i) => {
    const b = document.createElement('button'); b.className = 'role'; b.style.cssText = 'align-items:center;padding:16px;gap:8px;width:200px';
    b.innerHTML = `<img alt="" style="height:200px;max-width:170px;object-fit:contain;border-radius:3px;background:#2a2a2e"><b style="font-size:15px">${esc(d.name)}</b>`;
    b.onclick = () => startSession(d); $('#pickList').appendChild(b);
    const c = await compose({ ...d, output_long: 600 }, samples(d.areas.length), 'none', { name: ACTIVE.name, date: ACTIVE.event_date });
    b.querySelector('img').src = c.toDataURL('image/jpeg', .7);
  });
  bscreen('b-pick');
}
async function countdown(me, label) {
  const el = $('#b-count'); $('#shotInfo').textContent = label;
  for (let n = Math.max(1, S.capture.countdown || 3); n > 0; n--) { if (B.session !== me) return false; el.textContent = n; beep(n === 1 ? 1320 : 880); await sleep(1000); }
  if (B.session !== me) return false;
  el.textContent = 'Smile!'; await sleep(250); return true;
}
function flash() { shutter(); const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
async function startSession(design) {
  clearInterval(B.reviewT); clearInterval(B.doneT);
  const me = B.session = { mode: B.mode, design, shots: [], filter: 'none', copies: 1, saved: null, printed: false, jobId: null };
  if (dslr && !dslrHealthy()) { await dslrFallback(); await sleep(800); }
  bscreen('b-shoot');
  try {
    if (me.mode === 'photo') {
      const n = design.areas.length;
      for (let i = 0; i < n; i++) {
        if (!(await countdown(me, `Photo ${i + 1} of ${n}`))) return;
        flash(); const c = await capturePhoto(); if (B.session !== me) return;
        me.shots.push(c); $('#b-count').textContent = '';
        if (i < n - 1) {   // pause between photos, showing the one just taken
          const g = +S.capture.gap, gap = (Number.isFinite(g) ? Math.max(0, g) : 1) * 1000;
          if (gap) { $('#shotPrev').src = scaled(c, 900).toDataURL('image/jpeg', .8); $('#shotPrev').hidden = false; $('#shotInfo').textContent = `Next photo in a moment…`; await sleep(gap); $('#shotPrev').hidden = true; }
          if (B.session !== me) return;
        }
      }
    } else if (me.mode === 'gif') {
      if (!(await countdown(me, 'GIF · get ready to move!'))) return;
      $('#b-count').textContent = ''; $('#shotInfo').innerHTML = '<span class="recdot"></span>Recording GIF';
      for (let i = 0; i < 10; i++) { if (B.session !== me) return; me.shots.push(grabFrame(720)); beep(1500, .03); await sleep(200); }
    } else if (me.mode === 'boom') {
      if (!(await countdown(me, 'Boomerang · keep moving!'))) return;
      $('#b-count').textContent = ''; $('#shotInfo').innerHTML = '<span class="recdot"></span>Recording boomerang';
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) { if (B.session !== me) return; me.shots.push(grabFrame(1280)); await sleep(70); }
    } else if (me.mode === 'video') {
      if (!(await countdown(me, 'Video · say something nice!'))) return;
      $('#b-count').textContent = '';
      me.blob = await recordStream(liveStream(), (S.capture.videoSec || 10) * 1000, me, s => { $('#shotInfo').innerHTML = `<span class="recdot"></span>Recording · ${s}s left`; $('#b-count').textContent = s; });
      if (B.session !== me) return;
      me.poster = grabFrame(1920);
    }
  } catch (e) { return showErr('Camera problem', e.message, () => startSession(design), goHome); }
  $('#b-count').textContent = '';
  await openReview();
}
function recMime() { const c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']; return c.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || ''; }
function recordStream(stream, ms, me, tick) {
  return new Promise((res, rej) => {
    if (!window.MediaRecorder) return rej(new Error('This browser cannot record video.'));
    const mime = recMime(), chunks = [];
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : { videoBitsPerSecond: 12e6 });
    r.ondataavailable = e => e.data.size && chunks.push(e.data);
    r.onstop = () => res(new Blob(chunks, { type: (r.mimeType || mime || 'video/webm').split(';')[0] }));
    r.start(250);
    let left = Math.round(ms / 1000); tick && tick(left);
    const t = setInterval(() => { left--; if (B.session !== me || left <= 0) { clearInterval(t); r.stop(); } else tick && tick(left); }, 1000);
  });
}
// Boomerang: play the frames forward and back twice, recorded to a video file.
async function makeBoomerang(frames) {
  const c = document.createElement('canvas'); c.width = frames[0].width; c.height = frames[0].height; const x = c.getContext('2d');
  x.drawImage(frames[0], 0, 0);
  const seq = []; for (let k = 0; k < 2; k++) { seq.push(...frames, ...frames.slice(1, -1).reverse()); }
  const stream = c.captureStream(30), mime = recMime(), chunks = [];
  const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10e6 } : {});
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => r.onstop = res);
  r.start(250);
  for (const f of seq) { x.drawImage(f, 0, 0); await sleep(1000 / 24); }
  await sleep(120); r.stop(); await done;
  return new Blob(chunks, { type: (r.mimeType || mime || 'video/webm').split(';')[0] });
}
async function makeGif(frames) {
  const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc.esm.js');
  const gif = GIFEncoder(), w = frames[0].width, h = frames[0].height;
  const seq = [...frames, ...frames.slice(1, -1).reverse()];
  for (const f of seq) {
    const data = f.getContext('2d').getImageData(0, 0, w, h).data;
    const pal = quantize(data, 256), idx = applyPalette(data, pal);
    gif.writeFrame(idx, w, h, { palette: pal, delay: 120 }); await sleep(0);
  }
  gif.finish(); return new Blob([gif.bytes()], { type: 'image/gif' });
}
async function renderSession() {
  const s = B.session, box = $('#reviewMedia');
  if (s.mode === 'photo') {
    const prev = await compose({ ...s.design, output_long: 1400 }, s.shots, s.filter, { name: ACTIVE.name, date: ACTIVE.event_date });
    box.innerHTML = `<img class="media ${s.design.paper === 'landscape' ? 'wide' : ''}" alt="Your photo" src="${prev.toDataURL('image/jpeg', .85)}">`;
  } else {
    if (!s.media) {
      busy(s.mode === 'gif' ? 'Making your GIF…' : s.mode === 'boom' ? 'Making your boomerang…' : 'Preparing your video…');
      try {
        if (s.mode === 'gif') { s.media = await makeGif(s.shots); s.poster = s.shots[0]; }
        else if (s.mode === 'boom') { s.media = await makeBoomerang(s.shots); s.poster = s.shots[0]; }
        else s.media = s.blob;
      } finally { busy(false); }
    }
    const url = URL.createObjectURL(s.media);
    box.innerHTML = s.mode === 'gif' ? `<img class="media wide" alt="Your GIF" src="${url}">` : `<video class="media wide" src="${url}" autoplay loop muted playsinline></video>`;
  }
}
async function openReview() {
  const s = B.session;
  try { await renderSession(); } catch (e) { return showErr('Something went wrong', e.message, () => openReview(), goHome); }
  const isPhoto = s.mode === 'photo';
  $('#filterWrap').hidden = !isPhoto;
  $('#bFilters').innerHTML = FILTERS.map(f => `<button class="${f[0] === s.filter ? 'on' : ''}" data-fl="${f[0]}">${f[1]}</button>`).join('');
  const maxC = Math.max(1, S.capture.maxCopies || 1);
  s.copies = 1; $('#cNum').textContent = 1; $('#copiesWrap').hidden = !isPhoto || maxC <= 1;
  $('#printBtn').hidden = !isPhoto; $('#printBtn').disabled = false;
  $('#doneBtn').textContent = isPhoto ? 'Done' : 'Save & get QR';
  bscreen('b-review');
  let left = 60; const tick = () => $('#reviewTimer').textContent = `Back to the start screen in ${left}s`;
  tick(); clearInterval(B.reviewT);
  B.reviewT = setInterval(() => { left--; tick(); if (left <= 0) { clearInterval(B.reviewT); finish(); } }, 1000);
  $('#b-review').onpointerdown = () => { left = 60; tick(); };
}
$('#bFilters').addEventListener('click', async e => {
  const b = e.target.closest('[data-fl]'); if (!b || !B.session) return;
  B.session.filter = b.dataset.fl; $$('#bFilters button').forEach(x => x.classList.toggle('on', x === b)); await renderSession();
});
$('#cMinus').onclick = () => { if (!B.session) return; B.session.copies = Math.max(1, B.session.copies - 1); $('#cNum').textContent = B.session.copies; };
$('#cPlus').onclick = () => { if (!B.session) return; B.session.copies = Math.min(S.capture.maxCopies || 1, B.session.copies + 1); $('#cNum').textContent = B.session.copies; };
function busy(msg) { $('#busy').hidden = !msg; if (msg) $('#busyMsg').textContent = msg; }
async function upload(path, blob, type) { check(await sb.storage.from('photos').upload(path, blob, { contentType: type, upsert: true })); }
/* ---------- Saving: the guest gets the QR at once; files upload in the background ---------- */
const UPLOADS = new Set();   // saves still running (they keep retrying if the internet drops)
function uploadsChanged() { if (ROLE === 'booth') boothStatus(); }
window.addEventListener('beforeunload', e => { if (UPLOADS.size) { e.preventDefault(); e.returnValue = ''; } });
async function retry(fn, label) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= 2 && !/fetch|network|Failed|timeout|5\d\d/i.test(String(e.message))) throw e; await sleep(Math.min(15000, 1500 * (i + 1))); }
  }
}
const jpeg = (c, q) => toBlob(c, 'image/jpeg', q);
// Starts saving the session (once) and returns its row straight away; s.savePromise finishes when everything is uploaded.
function startSave(s) {
  if (s.row) return s.row;
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ev = ACTIVE.id, evName = ACTIVE.name, evDate = ACTIVE.event_date;
  const row = s.row = { id, event_id: ev, kind: s.mode, share_token: token(), print_token: token(), path: `${ev}/${id}.jpg`, thumb_path: `${ev}/${id}-thumb.jpg`, layout: s.design ? s.design.name : s.mode };
  if (s.mode === 'photo') row.print_path = `${ev}/${id}-print.jpg`;
  const q = (S.capture.quality || 95) / 100, qrOn = !!S.printQr.on;
  const job = (async () => {
    await sleep(30);   // let the "Thank you" screen appear first
    let full; const work = [];
    if (s.mode === 'photo') {
      full = await compose(s.design, s.shots, s.filter, { name: evName, date: evDate });
      let sheet = full;
      if (qrOn) { sheet = document.createElement('canvas'); sheet.width = full.width; sheet.height = full.height; const x = sheet.getContext('2d'); x.drawImage(full, 0, 0); drawPrintQr(x, full.width, full.height, s.design, `${SITE}?q=${row.print_token}`); }
      const printBlob = await jpeg(printCanvas(s.design, sheet), q);
      work.push(retry(() => upload(row.print_path, printBlob, 'image/jpeg')));
    } else {
      full = s.poster;
      const ext = s.media.type === 'image/gif' ? 'gif' : s.media.type === 'video/mp4' ? 'mp4' : 'webm';
      row.media_path = `${ev}/${id}.${ext}`;
      work.push(retry(() => upload(row.media_path, s.media, s.media.type)));
    }
    const [fullBlob, thumbBlob] = await Promise.all([jpeg(full, q), jpeg(scaled(full, 520), .78)]);
    work.push(retry(() => upload(row.path, fullBlob, 'image/jpeg')), retry(() => upload(row.thumb_path, thumbBlob, 'image/jpeg')));
    await Promise.all(work);                                   // uploads run side by side
    await retry(async () => { const r = await sb.from('photos').insert(row); if (r.error && !/duplicate/i.test(r.error.message)) throw new Error(r.error.message); });
    s.shots = null;                                            // free memory
    return row;
  })();
  UPLOADS.add(job); uploadsChanged();
  s.savePromise = job.finally(() => { UPLOADS.delete(job); uploadsChanged(); });
  s.savePromise.catch(e => toast('A photo could not be saved: ' + e.message, 8000));
  return row;
}
function netMsg(e) { const m = String(e && e.message || e); return /fetch|network|Failed/i.test(m) ? 'The tablet has no internet connection. Check the WiFi, then tap Try again.' : m; }
async function doPrint() {
  const s = B.session; if (!s || s.printed) return;
  s.printed = true; $('#printBtn').disabled = true; clearInterval(B.reviewT);
  startSave(s);
  openDone('Getting your print ready…', true);
  const copies = s.copies, label = `${ACTIVE.name} · ${s.design.name}`, ev = ACTIVE.id;
  try {
    const row = await s.savePromise;
    const job = await retry(async () => check(await sb.from('print_jobs').insert({ event_id: ev, photo_id: row.id, path: row.print_path || row.path, copies, label }).select().single()));
    s.jobId = job.id;
    if (B.session === s && $('#b-done').classList.contains('on')) { $('#printMsg').textContent = printerOnline() ? 'Sending to the printer…' : 'Your print is in the queue. It starts when the printer laptop is connected.'; $('#printBar').style.width = '30%'; }
  } catch (e) { if (B.session === s) $('#printMsg').textContent = 'Could not send the print. Please call the attendant.'; }
}
function finish() {
  clearInterval(B.reviewT);
  const s = B.session; if (!s) return;
  startSave(s);
  openDone(s.mode === 'photo' ? 'Your photo is saved.' : 'Saved!', false);
}
function openDone(status, printing) {
  const s = B.session; clearInterval(B.reviewT);
  $('#printMsg').textContent = status; $('#printBarWrap').hidden = !printing; $('#printBar').style.width = printing ? '10%' : '0';
  $('#gqrBox').hidden = !(s && s.row);
  if (s && s.row) qr($('#guestQr'), shareLink(s.row), 200);
  bscreen('b-done');
  let left = 30; const tick = () => $('#doneTimer').textContent = `Going back automatically in ${left}s`;
  tick(); clearInterval(B.doneT); B.doneT = setInterval(() => { left--; tick(); if (left <= 0) goHome(); }, 1000);
}
function boothJob(job) {
  const s = B.session; if (!s || job.id !== s.jobId || !$('#b-done').classList.contains('on')) return;
  const txt = { waiting: printerOnline() ? 'Sending to the printer…' : 'Waiting for the printer laptop…', printing: 'Printing… collect your photo at the printer.', done: 'Done! Collect your photo at the printer.', failed: 'Printer problem — please call the attendant.', cancelled: 'Print cancelled.' }[job.status];
  if (txt) $('#printMsg').textContent = txt;
  $('#printBar').style.width = { waiting: '15%', printing: '60%', done: '100%' }[job.status] || '100%';
}
function boothShowQr(p) {
  if (B.session || !p.url) return;
  B.session = { mode: 'show' };
  $('#printMsg').textContent = p.label || 'Scan to get your photo'; $('#printBarWrap').hidden = true; $('#gqrBox').hidden = false;
  qr($('#guestQr'), p.url, 200); bscreen('b-done');
  let left = 45; const tick = () => $('#doneTimer').textContent = `Going back automatically in ${left}s`;
  tick(); clearInterval(B.doneT); B.doneT = setInterval(() => { left--; tick(); if (left <= 0) goHome(); }, 1000);
}
function showErr(title, msg, onRetry, onCancel) {
  busy(false); $('#errTitle').textContent = title; $('#errMsg').textContent = msg; $('#bErr').hidden = false;
  $('#errRetry').onclick = () => { $('#bErr').hidden = true; onRetry && onRetry(); };
  $('#errCancel').onclick = () => { $('#bErr').hidden = true; (onCancel || goHome)(); };
}
$('#printBtn').onclick = doPrint; $('#doneBtn').onclick = finish; $('#backStart').onclick = goHome;
$('#retakeBtn').onclick = () => { const s = B.session; if (s) { B.mode = s.mode; startSession(s.design); } };
$('#pickBack').onclick = goHome; $('#cancelShoot').onclick = goHome;

/* ---------- Staff: PIN → menu (back, camera, admin board, log out) ---------- */
let pin = '';
function openPin() {
  pin = ''; drawPins(); $('#pinMsg').textContent = ''; $('#pinMsg').style.color = '';
  $('#staffMenu').hidden = true; $('#pinPad').hidden = false; bscreen('b-pin');
}
$('#staffBtn').onclick = openPin;
$('#keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map(k => `<button data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k === '✓' ? 'Confirm' : k}">${k}</button>`).join('');
function drawPins() { $$('#pins i').forEach((p, i) => p.classList.toggle('f', i < pin.length)); }
$('#keys').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
  if (k === '⌫') pin = pin.slice(0, -1); else if (k === '✓') return checkPin(); else if (pin.length < 4) pin += k;
  drawPins(); if (pin.length === 4) setTimeout(checkPin, 150);
});
async function checkPin() {
  const want = String((STATION && STATION.staff_pin) || '1234');
  if (pin === want) { $('#pinPad').hidden = true; $('#staffMenu').hidden = false; fillCamMenu(); }
  else { $('#pinMsg').textContent = 'Wrong PIN. Try again.'; $('#pinMsg').style.color = '#ff8a80'; pin = ''; drawPins(); }
}
async function fillCamMenu() {
  let opts = '<option value="user">Front camera</option><option value="environment">Back camera</option>';
  try { (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').forEach((d, i) => opts += `<option value="${esc(d.deviceId)}">${esc(d.label || 'Camera ' + (i + 1))}</option>`); } catch (e) {}
  if (navigator.usb) opts += '<option value="dslr">Canon DSLR (USB)</option>';
  $('#bCamSel').innerHTML = opts; $('#bCamSel').value = dslr ? 'dslr' : (store.get('camDevice', '') || (S.capture.camera === 'dslr' ? 'user' : S.capture.camera));
  $('#bMirror').checked = !!S.capture.mirror;
  const v = $('#live'); $('#bCamInfo').textContent = dslr ? 'Canon DSLR connected (USB)' : v.videoWidth ? `Camera: ${v.videoWidth} × ${v.videoHeight}` : '';
}
$('#bCamSel').onchange = async () => {
  if ($('#bCamSel').value === 'dslr' && dslrCrashed) { try { sessionStorage.removeItem('pb.dslrReloads'); } catch (e) {} S.capture.camera = 'dslr'; await saveStudio().catch(() => {}); return dslrRecover(); }
  if ($('#bCamSel').value === 'dslr') { $('#bCamInfo').textContent = 'Connecting…'; try { await dslrConnect(true); toast('Canon DSLR connected'); } catch (e) { $('#bCamInfo').textContent = e.message; return; } boothStatus(); return fillCamMenu(); }
  store.set('camDevice', $('#bCamSel').value); await dslrDisconnect(); S.capture.camera = /^(user|environment)$/.test($('#bCamSel').value) ? $('#bCamSel').value : 'user'; saveStudio().catch(() => {}); startCamera().then(fillCamMenu); };
$('#bMirror').onchange = () => { S.capture.mirror = $('#bMirror').checked; $('#live').classList.toggle('mirror', S.capture.mirror); saveStudio().catch(() => {}); };
$('#bDslr').onclick = async () => { if (dslrCrashed) { try { sessionStorage.removeItem('pb.dslrReloads'); } catch (e) {} S.capture.camera = 'dslr'; await saveStudio().catch(() => {}); return dslrRecover(); } const b = $('#bDslr'); b.disabled = true; $('#bCamInfo').textContent = 'Connecting…'; try { await dslrConnect(true); toast('Canon DSLR connected'); fillCamMenu(); } catch (e) { $('#bCamInfo').textContent = e.message; } b.disabled = false; };
$('#pinCancel').onclick = goHome; $('#mBack').onclick = goHome;
$('#mAdmin').onclick = () => { dslrDisconnect(); stopCamera(); store.set('role', 'admin'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); startAdmin(); };
$('#mOut').onclick = signOut;
// Hold the top-right corner for 3 seconds also opens the PIN screen
{ const hot = document.createElement('div'); hot.className = 'hot'; $('#b-attract').appendChild(hot); let t; hot.addEventListener('pointerdown', () => { t = setTimeout(openPin, 3000); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(n => hot.addEventListener(n, () => clearTimeout(t))); }
document.addEventListener('keydown', e => {
  if (ROLE !== 'booth') return;
  const on = id => $('#' + id).classList.contains('on'), k = e.key.toLowerCase();
  if (k === 'escape' && !on('b-pin')) return goHome();
  if (on('b-attract') && (k === ' ' || k === 'enter')) { e.preventDefault(); startFlow(enabledModes()[0] || 'photo'); }
  else if (on('b-review')) { if (k === 'p') doPrint(); else if (k === 'enter') finish(); }
  else if (on('b-done') && (k === ' ' || k === 'enter')) { e.preventDefault(); goHome(); }
});

/* =====================================================================
   ADMIN BOARD (laptop)
   ===================================================================== */
const SECS = ['home', 'events', 'templates', 'media', 'gallery', 'printer', 'studio', 'accounts', 'guest'];
const CRUMB = { home: 'Home', events: 'Events', templates: 'Template editor', media: 'Capture & media', gallery: 'Gallery & share', printer: 'Printer', studio: 'Studio settings', accounts: 'Accounts & PIN', guest: 'Guest view' };
const secOn = n => $('#s-' + n).classList.contains('on');
async function startAdmin() {
  ROLE = 'admin'; show('v-admin'); track(); keepAwake();
  $('#prnOn').checked = store.get('printer', false); printerUi();
  $('#kioskCmd').textContent = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${APP_URL}`;
  const start = (location.hash || '').slice(1);
  go(SECS.includes(start) ? start : 'home');
  runPrinter(); queueBadge();
}
function go(name) {
  if (ROLE !== 'admin') return;
  if (!SECS.includes(name)) name = 'home';
  $$('.nav').forEach(b => b.classList.toggle('on', b.dataset.go === name));
  $$('.sec').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  $('#crumb').textContent = CRUMB[name];
  try { history.replaceState(null, '', '#' + name); } catch (e) {}
  if (name !== 'media') camTestOff();
  ({ home: renderHome, events: renderEvents, templates: renderTemplates, media: renderMedia, gallery: () => renderGallery(), printer: () => { renderQueue(); renderPaper(); }, studio: renderStudio, accounts: renderAccounts, guest: renderGuestPreview })[name]();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g && ROLE === 'admin') { e.preventDefault(); go(g.dataset.go); return; }
  if (e.target.closest('[data-act="newEvent"]')) openEventModal(null);
});
$('#cmd').addEventListener('change', () => {
  const v = $('#cmd').value.trim().toLowerCase(); $('#cmd').value = '';
  const sec = SECS.find(k => CRUMB[k].toLowerCase() === v || k === v); if (sec) return go(sec);
  const ev = EVENTS.find(e => e.name.toLowerCase() === v || e.name.toLowerCase().includes(v)); if (ev) { galEvent = ev.id; go('gallery'); }
});
function fillCmd() { $('#cmdList').innerHTML = [...SECS.map(k => CRUMB[k]), ...EVENTS.map(e => e.name)].map(v => `<option value="${esc(v)}">`).join(''); }

/* ---- Home ---- */
let STATS = [];
async function loadStats() { STATS = check(await sb.from('photos').select('id,kind,created_at,event_id').eq('owner', USER.id).order('created_at', { ascending: false }).limit(10000)); }
async function renderHome() {
  try { await Promise.all([loadEvents(), loadTemplates(), loadStation(), loadStats()]); } catch (e) { toast(e.message, 4000); }
  fillCmd();
  const per = id => STATS.filter(p => p.event_id === id).length;
  $('#hTotal').textContent = STATS.length.toLocaleString('en-GB');
  const kinds = { photo: 'Photos', gif: 'GIF', boom: 'Boomerang', video: 'Video' };
  $('#hKinds').innerHTML = Object.entries(kinds).map(([k, l]) => `<span>${l} ${STATS.filter(p => (p.kind || 'photo') === k).length}</span>`).join('');
  $('#evCount').textContent = EVENTS.length;
  $('#homeEvents').innerHTML = EVENTS.slice(0, 3).map(e => `
    <div class="card evcard">
      <div class="row" style="justify-content:space-between"><div class="row" style="font-size:13px;font-weight:600"><span class="typeicon">${esc(evType(e)[0])}</span>${esc(evType(e))}</div>${e.id === ACTIVE.id ? '<span class="chip">Active</span>' : ''}</div>
      <div style="font-size:13px;color:#c8c8cc;margin-top:14px">${esc(e.name)}</div>
      <div class="mono num" style="margin-top:4px">${per(e.id)}</div>
      <div class="lbl" style="font-size:12px">sessions · ${TEMPLATES.filter(t => t.event_type === evType(e)).length || 'standard'} templates</div>
    </div>`).join('') + `<button class="card evcard add" data-act="newEvent"><span style="width:32px;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,.2);display:inline-flex;align-items:center;justify-content:center">+</span><span style="font-size:13.5px;line-height:1.45">Add another event, like Graduation or Engagement.</span></button>`;
  // Captures by hour for the active event
  const act = STATS.filter(p => p.event_id === ACTIVE.id), hours = Array(24).fill(0);
  act.forEach(p => hours[new Date(p.created_at).getHours()]++);
  $('#activeName').textContent = ACTIVE.name; $('#hActive').textContent = act.length;
  const used = hours.map((v, h) => [h, v]).filter(([, v]) => v);
  const lo = used.length ? Math.max(0, used[0][0] - 1) : 18, hi = used.length ? Math.min(23, used[used.length - 1][0] + 1) : 23;
  const span = hours.slice(lo, hi + 1), mx = Math.max(1, ...span);
  const pts = span.map((v, i) => [span.length > 1 ? i / (span.length - 1) * 600 : 300, 150 - v / mx * 130]);
  $('#hourChart').innerHTML = `<path d="M${pts.map(p => p.join(' ')).join(' L')}" fill="none" stroke="#ff4d1f" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#ff4d1f"/>`).join('');
  const hl = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  const peakH = hours.indexOf(Math.max(...hours));
  $('#hourLbls').innerHTML = span.map((_, i) => `<span class="${lo + i === peakH && act.length ? 'on' : ''}">${hl(lo + i)}</span>`).join('');
  $('#hPeak').hidden = !act.length; $('#hPeak').textContent = `Peak ${hl(peakH)}`;
  // Last 7 days
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); return d; });
  const cnt = days.map(d => STATS.filter(p => { const t = new Date(p.created_at); return t >= d && t < new Date(d.getTime() + 864e5); }).length);
  const wmx = Math.max(1, ...cnt), wpk = cnt.indexOf(Math.max(...cnt));
  $('#hWeek').textContent = cnt.reduce((a, b) => a + b, 0);
  $('#bars').innerHTML = days.map((d, i) => `<div class="bar ${i === wpk && cnt[i] ? 'peak' : ''}"><div class="tr"><div class="fill" style="height:${cnt[i] / wmx * 100}%"></div></div><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span></div>`).join('');
  // Busy hours heat map: 7 days of the week × 12 PM–11 PM
  const heat = Array.from({ length: 7 }, () => Array(12).fill(0));
  STATS.forEach(p => { const t = new Date(p.created_at), h = t.getHours(); if (h >= 12) heat[t.getDay()][h - 12]++; });
  const hmx = Math.max(1, ...heat.flat());
  $('#heat').innerHTML = heat.flat().map(v => { const r = v / hmx; return `<i style="background:${r > .7 ? '#f2f2f3' : r > .4 ? '#9a9aa0' : r > 0 ? '#4a4a50' : '#222225'}"></i>`; }).join('');
  const colSum = Array.from({ length: 12 }, (_, c) => heat.reduce((a, r) => a + r[c], 0)), pc = colSum.indexOf(Math.max(...colSum));
  $('#heatPeak').hidden = !STATS.length; $('#heatPeak').textContent = `Peak ${hl(pc + 12)}–${hl(pc + 13)}`;
  // Activity
  const icons = { photo: MODE_INFO.photo[1], gif: MODE_INFO.gif[1], boom: MODE_INFO.boom[1], video: MODE_INFO.video[1] };
  const evName = id => (EVENTS.find(e => e.id === id) || {}).name || '';
  $('#activity').innerHTML = STATS.slice(0, 5).map(p => `<div class="act"><span class="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${icons[p.kind || 'photo']}</svg></span><div style="flex:1;min-width:0"><div style="font-size:13.5px">${MODE_INFO[p.kind || 'photo'][0]}</div><div class="lbl" style="font-size:12px">${esc(evName(p.event_id))} · ${shortDate(p.created_at)} ${timeOf(p.created_at)}</div></div></div>`).join('') || '<p class="lbl">No sessions yet. Open the booth on your tablet.</p>';
  renderDevices(); renderPaper();
}
function renderDevices() {
  const list = others(), tab = list.find(d => d.role === 'booth');
  $('#sideDot').className = 'dot' + (tab ? '' : ' off'); $('#sideDev').textContent = tab ? 'Tablet connected' : 'Tablet not connected';
  $('#sidePrn').textContent = printerOn() ? 'Booth · printing here' : 'Printing off on this laptop';
  const el = $('#hDevices'); if (!el) return;
  el.innerHTML = `<div class="devrow"><span class="dot${printerOn() ? '' : ' warn'}"></span>This laptop${printerOn() ? ' · prints' : ' · printing off'}</div>` + (list.length ? list.map(d => `<div class="devrow"><span class="dot"></span>${esc(d.label)}${d.printer ? ' · prints' : ''}</div>`).join('') : '<div class="devrow"><span class="dot off"></span>No tablet yet. Log in on the tablet and choose Booth.</div>');
}

/* ---- Events ---- */
function renderEvents() {
  fillCmd(); $('#evCount').textContent = EVENTS.length;
  const per = id => STATS.filter(p => p.event_id === id).length;
  $('#evTable').innerHTML = EVENTS.map(e => `<tr><td><b>${esc(e.name)}</b> ${e.id === ACTIVE.id ? '<span class="chip" style="margin-left:6px">Active on tablet</span>' : ''}</td><td>${esc(evType(e))}</td><td class="mono">${esc(e.event_date || '')}</td><td>${designsFor(e).map(d => esc(d.name)).join(', ')}</td><td class="mono">${per(e.id)}</td>
    <td><div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:wrap">${e.id === ACTIVE.id ? '' : `<button class="btn sm" data-activate="${e.id}">Make active</button>`}<button class="btn sm" data-edit="${e.id}">Edit</button><button class="btn sm" data-tpl="${e.id}">Templates</button><button class="btn sm" data-gal="${e.id}">Gallery</button></div></td></tr>`).join('');
}
$('#evTable').addEventListener('click', async e => {
  const a = e.target.closest('[data-activate]'), ed = e.target.closest('[data-edit]'), t = e.target.closest('[data-tpl]'), g = e.target.closest('[data-gal]');
  try {
    if (a) { await setActive(a.dataset.activate); toast('Event is now active on the tablet'); renderEvents(); }
    if (ed) openEventModal(EVENTS.find(x => x.id === ed.dataset.edit));
    if (t) { curType = evType(EVENTS.find(x => x.id === t.dataset.tpl)); curTpl = null; go('templates'); }
    if (g) { galEvent = g.dataset.gal; go('gallery'); }
  } catch (err) { toast(err.message, 4000); }
});
async function setActive(id) {
  check(await sb.from('events').update({ is_active: false }).eq('owner', USER.id).neq('id', id));
  check(await sb.from('events').update({ is_active: true }).eq('id', id));
  await loadEvents(); announce();
}
function modal(html, width = 440) {
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box" style="width:min(${width}px,100%)">${html}</div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
  return m;
}
function openEventModal(ev) {
  const m = modal(`<form style="display:flex;flex-direction:column;gap:14px"><h3 style="margin:0">${ev ? 'Edit event' : 'New event'}</h3>
    <label class="field" for="neName">Event name<input class="in" id="neName" required maxlength="80" value="${esc(ev ? ev.name : '')}" placeholder="e.g. Iman &amp; Danial"></label>
    <label class="field" for="neType">Event type<select class="in" id="neType">${allTypes().map(t => `<option ${ev && evType(ev) === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label class="field" for="neDate">Date (printed on the standard layouts)<input class="in" id="neDate" maxlength="40" value="${esc(ev ? ev.event_date || '' : today())}"></label>
    <div class="field">Layouts guests can choose on the tablet<div id="neTpls" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto"></div></div>
    <p class="lbl" style="margin:0">Tick one or more. With more than one, guests pick their strip before the photos. Add new frames in the Template editor.</p>
    <div class="row" style="justify-content:space-between;flex-wrap:wrap">${ev ? '<button type="button" class="btn" id="neDel" style="color:#ff8a80">Delete event</button>' : '<span></span>'}<div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">${ev ? 'Save' : 'Create event'}</button></div></div></form>`);
  m.querySelector('#neName').focus();
  let chosen = ev ? designsFor(ev).map(d => d.id) : null;
  const drawTpls = () => {
    const type = m.querySelector('#neType').value, box = m.querySelector('#neTpls');
    const mine = TEMPLATES.filter(t => t.frame_url).map(tplToDesign).sort((a, b) => (b.event_type === type) - (a.event_type === type));
    const list = [...mine, ...BUILTIN];
    if (!chosen) { const t = mine.filter(d => d.event_type === type); chosen = (t.length ? t : BUILTIN).map(d => d.id); }
    const paper = { strip: '2x6 strip', portrait: '4x6 portrait', landscape: '4x6 landscape' };
    box.innerHTML = list.map(d => `<label class="tog" style="justify-content:flex-start;gap:10px;padding:6px 10px;border-radius:10px;background:#1a1a1c;border:1px solid var(--line);color:var(--fg)"><input type="checkbox" value="${esc(d.id)}" ${chosen.includes(d.id) ? 'checked' : ''}>${d.frame_url ? `<img src="${esc(d.frame_url)}" alt="" crossorigin="anonymous" style="height:40px;width:28px;object-fit:contain;background:#2a2a2e;border-radius:3px">` : ''}<span><b style="font-size:13px">${esc(d.name)}</b><br><span class="lbl" style="font-size:11.5px">${d.builtin ? 'Standard' : esc(d.event_type)} · ${paper[d.paper]} · ${d.areas.length} photo${d.areas.length === 1 ? '' : 's'}</span></span></label>`).join('');
  };
  drawTpls();
  m.querySelector('#neTpls').addEventListener('change', () => { chosen = [...m.querySelectorAll('#neTpls input:checked')].map(i => i.value); });
  m.querySelector('#neType').addEventListener('change', () => { if (!ev) chosen = null; drawTpls(); });
  m.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault(); const name = m.querySelector('#neName').value.trim(); if (!name) return;
    const picked = [...m.querySelectorAll('#neTpls input:checked')].map(i => i.value);
    if (!picked.length) return toast('Tick at least one layout');
    const settings = { ...(ev ? ev.settings || {} : {}), type: m.querySelector('#neType').value, templates: picked }, event_date = m.querySelector('#neDate').value.trim();
    try {
      if (ev) check(await sb.from('events').update({ name, event_date, settings, updated_at: new Date().toISOString() }).eq('id', ev.id));
      else check(await sb.from('events').insert({ id: 'e' + Date.now().toString(36), name, event_date, settings, album_token: token() }));
      await loadEvents(); announce(); m.remove(); go('events'); toast(ev ? 'Event saved' : 'Event created');
    } catch (err) { toast(err.message, 4000); }
  });
  const del = m.querySelector('#neDel');
  if (del) del.onclick = async () => {
    if (EVENTS.length <= 1) return toast('You need at least one event.');
    if (!confirm(`Delete “${ev.name}” and all of its photos? This cannot be undone.`)) return;
    try {
      const photos = check(await sb.from('photos').select('path,thumb_path,media_path,print_path').eq('event_id', ev.id));
      const paths = photos.flatMap(p => [p.path, p.thumb_path, p.media_path, p.print_path]).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) await sb.storage.from('photos').remove(paths.slice(i, i + 100));
      check(await sb.from('events').delete().eq('id', ev.id));
      await loadEvents(); if (!EVENTS.some(x => x.is_active)) await setActive(EVENTS[0].id);
      m.remove(); go('events'); toast('Event deleted');
    } catch (err) { toast(err.message, 4000); }
  };
}

/* ---- Template editor ---- */
let curType = 'Wedding', curTpl = null, draft = null, pendingFrame = null, drawing = false;
function newDraft() { return { id: null, name: 'New template', event_type: curType, frame_url: '', width: 0, height: 0, areas: [], paper: 'strip', output_long: 3840, fit: 'cover' }; }
async function renderTemplates() {
  try { await loadTemplates(); } catch (e) {}
  const types = allTypes(); if (!types.includes(curType)) curType = types[0];
  $('#typeList').innerHTML = types.map(t => `<button class="type ${t === curType ? 'on' : ''}" data-type="${esc(t)}">${esc(t)}<span class="mono lbl" style="font-size:11px">${TEMPLATES.filter(x => x.event_type === t).length}</span></button>`).join('');
  $('#tplHead').textContent = curType + ' templates';
  const list = TEMPLATES.filter(t => t.event_type === curType);
  $('#tplList').innerHTML = list.length ? list.map(t => `<button class="tpl ${draft && draft.id === t.id ? 'on' : ''}" data-id="${t.id}"><img src="${esc(t.frame_url)}" alt="" crossorigin="anonymous"><span><b style="font-size:13.5px">${esc(t.name)}</b><br><span class="lbl" style="font-size:12px">${{ strip: '2x6 strip', portrait: '4x6 portrait', landscape: '4x6 landscape' }[t.paper]} · ${(t.areas || []).length} photo${(t.areas || []).length === 1 ? '' : 's'}</span></span></button>`).join('')
    : '<p class="lbl" style="margin:0">No templates yet. The booth uses the standard layouts (3-photo strip, 4-photo grid, 1 photo) until you add one.</p>';
  $('#tType').innerHTML = types.map(t => `<option>${esc(t)}</option>`).join('');
  $('#tplQrOn').checked = !!S.printQr.on;
  if (!draft || (draft.event_type !== curType && draft.id)) { const first = list[0]; draft = first ? structuredClone(first) : newDraft(); pendingFrame = null; }
  loadDraft();
}
function loadDraft() {
  $('#tName').value = draft.name; $('#tPaper').value = draft.paper; $('#tRes').value = String(draft.output_long); $('#tFit').value = draft.fit; $('#tType').value = draft.event_type;
  $('#tDelete').hidden = !draft.id;
  $$('#tplList .tpl').forEach(b => b.classList.toggle('on', b.dataset.id === draft.id));
  $('#tplQr').hidden = !S.printQr.on; $('#tplQr').classList.toggle('bl', S.printQr.pos === 'bl');
  const img = $('#frameImg');
  const src = pendingFrame ? pendingFrame.url : draft.frame_url;
  $('#frameName').textContent = pendingFrame ? pendingFrame.file.name : draft.frame_url ? draft.frame_url.split('/').pop() : '';
  if (!src) { img.removeAttribute('src'); img.hidden = true; drawAreas(); $('#detectMsg').className = 'banner warn'; $('#detectMsg').innerHTML = '<span><b>Upload a PNG frame.</b> Make the photo areas fully transparent in Canva and export as PNG with “Transparent background”.</span>'; return; }
  img.hidden = false; img.onload = () => { drawAreas(); areaMsg(); }; img.src = src;
}
function areaSize() { const img = $('#frameImg'); return [img.naturalWidth || draft.width || 1, img.naturalHeight || draft.height || 1]; }
function placeArea(el, a) { el.style.cssText = `left:${a.x * 100}%;top:${a.y * 100}%;width:${a.w * 100}%;height:${a.h * 100}%`; }
function drawAreas() {
  $$('#frameWrap .area').forEach(a => a.remove());
  draft.areas.forEach((a, i) => {
    const el = document.createElement('div'); el.className = 'area'; el.dataset.i = i; el.tabIndex = 0;
    el.setAttribute('aria-label', `Photo area ${i + 1}. Drag to move, drag a corner to resize, or use the arrow keys (Shift + arrows to resize).`);
    placeArea(el, a);
    el.innerHTML = `<span>Area ${i + 1}</span><button type="button" data-rm="${i}" aria-label="Remove area ${i + 1}">✕</button>` + ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(h => `<i class="hdl ${h}" data-h="${h}"></i>`).join('');
    $('#frameWrap').appendChild(el);
  });
  const [W, H] = areaSize();
  $('#areaList').innerHTML = draft.areas.map((a, i) => `<div class="arow" style="flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><b>Area ${i + 1} · Photo ${i + 1}</b><button class="btn sm" data-rm-row="${i}" style="height:26px;padding:0 8px">Remove</button></div>
    <div class="anum">${[['x', 'X', W], ['y', 'Y', H], ['w', 'Width', W], ['h', 'Height', H]].map(([k, l, S]) => `<label>${l}<input class="in mono" type="number" data-ai="${i}" data-k="${k}" value="${Math.round(a[k] * S)}" min="0" max="${S}"></label>`).join('')}</div></div>`).join('') || '<p class="lbl" style="margin:0">None yet.</p>';
}
function updateAreaRow(i) {
  const [W, H] = areaSize(), a = draft.areas[i];
  $$(`#areaList [data-ai="${i}"]`).forEach(inp => { inp.value = Math.round(a[inp.dataset.k] * (inp.dataset.k === 'x' || inp.dataset.k === 'w' ? W : H)); });
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function fixArea(a) { a.w = clamp(a.w, .02, 1); a.h = clamp(a.h, .02, 1); a.x = clamp(a.x, 0, 1 - a.w); a.y = clamp(a.y, 0, 1 - a.h); return a; }
// Type exact pixel values
$('#areaList').addEventListener('input', e => {
  const inp = e.target.closest('[data-ai]'); if (!inp) return;
  const i = +inp.dataset.ai, k = inp.dataset.k, [W, H] = areaSize(), v = +inp.value;
  if (!Number.isFinite(v)) return;
  draft.areas[i][k] = v / (k === 'x' || k === 'w' ? W : H); fixArea(draft.areas[i]);
  const el = $(`#frameWrap .area[data-i="${i}"]`); if (el) placeArea(el, draft.areas[i]);
});
$('#areaList').addEventListener('change', e => { if (e.target.closest('[data-ai]')) updateAreaRow(+e.target.dataset.ai); });
$('#areaList').addEventListener('click', e => { const b = e.target.closest('[data-rm-row]'); if (b) { draft.areas.splice(+b.dataset.rmRow, 1); drawAreas(); areaMsg(); } });
// Drag to move, drag a corner or edge to resize
{
  let drag = null; const wrap = $('#frameWrap');
  wrap.addEventListener('pointerdown', e => {
    if (drawing) return;
    const el = e.target.closest('.area'); if (!el || e.target.closest('button')) return;
    e.preventDefault(); el.focus({ preventScroll: true });
    const i = +el.dataset.i;
    drag = { i, el, mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, a: { ...draft.areas[i] }, r: $('#frameImg').getBoundingClientRect() };
    el.classList.add('active'); el.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.r.width, dy = (e.clientY - drag.sy) / drag.r.height, m = drag.mode;
    let { x, y, w, h } = drag.a;
    if (m === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
    else {
      if (m.includes('w')) { const nx = clamp(x + dx, 0, x + w - .02); w += x - nx; x = nx; }
      if (m.includes('e')) w = clamp(w + dx, .02, 1 - x);
      if (m.includes('n')) { const ny = clamp(y + dy, 0, y + h - .02); h += y - ny; y = ny; }
      if (m.includes('s')) h = clamp(h + dy, .02, 1 - y);
    }
    Object.assign(draft.areas[drag.i], { x, y, w, h }); placeArea(drag.el, draft.areas[drag.i]); updateAreaRow(drag.i);
  });
  const end = () => { if (!drag) return; drag.el.classList.remove('active'); drag = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  // Keyboard: arrows move 1 px (10 px with Alt), Shift + arrows resize
  wrap.addEventListener('keydown', e => {
    const el = e.target.closest('.area'); if (!el) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!d) return;
    e.preventDefault(); const i = +el.dataset.i, a = draft.areas[i], [W, H] = areaSize(), step = e.altKey ? 10 : 1;
    if (e.shiftKey) { a.w += d[0] * step / W; a.h += d[1] * step / H; } else { a.x += d[0] * step / W; a.y += d[1] * step / H; }
    fixArea(a); placeArea(el, a); updateAreaRow(i);
  });
}
function areaMsg() {
  const msg = $('#detectMsg'), n = draft.areas.length;
  if (n) { msg.className = 'banner ok'; msg.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6be9a5" stroke-width="2.2" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg><span><b>${n} photo area${n > 1 ? 's' : ''}</b>. Guest photos fill them automatically. The booth takes ${n} photo${n > 1 ? 's' : ''}.</span>`; }
  else { msg.className = 'banner warn'; msg.innerHTML = '<span><b>No transparent areas found.</b> Make the photo areas fully transparent in Canva and export as PNG with “Transparent background”, or draw an area by hand.</span>'; }
}
function runDetect() {
  const img = $('#frameImg'); if (!img.naturalWidth) return toast('Upload a PNG frame first');
  try { draft.areas = detectAreas(img); } catch (e) { return toast('Could not read the frame: ' + e.message, 4000); }
  draft.width = img.naturalWidth; draft.height = img.naturalHeight;
  const r = draft.height / draft.width; if (!draft.id || !draft.paper) draft.paper = r > 2.2 ? 'strip' : r > 1 ? 'portrait' : 'landscape';
  $('#tPaper').value = draft.paper; drawAreas(); areaMsg();
}
$('#typeList').addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) { curType = b.dataset.type; draft = null; renderTemplates(); } });
$('#tplList').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b) return; draft = structuredClone(TEMPLATES.find(t => t.id === b.dataset.id)); pendingFrame = null; loadDraft(); });
$('#addType').onclick = async () => {
  const n = (prompt('Name of the new event type (e.g. Graduation):') || '').trim(); if (!n) return;
  if (!allTypes().includes(n)) { S.types = [...(S.types || []), n]; try { await saveStudio(); } catch (e) { return toast(e.message, 4000); } }
  curType = n; draft = null; renderTemplates(); toast(`Event type “${n}” added`);
};
$('#addTpl').onclick = () => { draft = newDraft(); pendingFrame = null; loadDraft(); $('#tName').focus(); };
$('#pngFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.type !== 'image/png') return toast('Choose a PNG file');
  if (pendingFrame) URL.revokeObjectURL(pendingFrame.url);
  pendingFrame = { file: f, url: URL.createObjectURL(f) };
  if (draft.name === 'New template') draft.name = f.name.replace(/\.png$/i, '').replace(/[-_]+/g, ' ');
  $('#tName').value = draft.name;
  const img = $('#frameImg'); img.hidden = false; $('#frameName').textContent = f.name;
  img.onload = () => { runDetect(); }; img.src = pendingFrame.url;
});
$('#detectBtn').onclick = () => { runDetect(); toast('Detection finished'); };
$('#frameWrap').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { draft.areas.splice(+b.dataset.rm, 1); drawAreas(); areaMsg(); } });
$('#drawArea').onclick = () => { if (!$('#frameImg').naturalWidth) return toast('Upload a PNG frame first'); drawing = true; $('#frameWrap').classList.add('drawing'); toast('Drag on the frame to draw a photo area'); };
{
  let start = null, box = null;
  const wrap = $('#frameWrap');
  const pos = e => { const r = $('#frameImg').getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  wrap.addEventListener('pointerdown', e => { if (!drawing) return; e.preventDefault(); start = pos(e); box = document.createElement('div'); box.className = 'area draw'; wrap.appendChild(box); wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', e => { if (!start) return; const p = pos(e); box.style.cssText = `left:${Math.min(p[0], start[0]) * 100}%;top:${Math.min(p[1], start[1]) * 100}%;width:${Math.abs(p[0] - start[0]) * 100}%;height:${Math.abs(p[1] - start[1]) * 100}%`; });
  wrap.addEventListener('pointerup', e => {
    if (!start) return; const p = pos(e), a = { x: Math.min(p[0], start[0]), y: Math.min(p[1], start[1]), w: Math.abs(p[0] - start[0]), h: Math.abs(p[1] - start[1]) };
    start = null; box.remove(); drawing = false; wrap.classList.remove('drawing');
    if (a.w > .03 && a.h > .03) { draft.areas.push(a); const img = $('#frameImg'); draft.width = img.naturalWidth; draft.height = img.naturalHeight; drawAreas(); areaMsg(); }
  });
}
function readDraft() { draft.name = $('#tName').value.trim() || 'Template'; draft.paper = $('#tPaper').value; draft.output_long = +$('#tRes').value; draft.fit = $('#tFit').value; draft.event_type = $('#tType').value; }
$('#tSave').onclick = async () => {
  readDraft();
  if (!pendingFrame && !draft.frame_url) return toast('Upload a PNG frame first');
  if (!draft.areas.length) return toast('Add at least one photo area (Auto-detect or Draw area)');
  const b = $('#tSave'); b.disabled = true;
  try {
    if (pendingFrame) { const path = `u-${USER.id}/tpl-${Date.now().toString(36)}.png`; await upload(path, pendingFrame.file, 'image/png'); draft.frame_url = fileUrl(path); URL.revokeObjectURL(pendingFrame.url); pendingFrame = null; }
    const row = { event_type: draft.event_type, name: draft.name, frame_url: draft.frame_url, width: draft.width, height: draft.height, areas: draft.areas, paper: draft.paper, output_long: draft.output_long, fit: draft.fit };
    const saved = draft.id ? check(await sb.from('templates').update(row).eq('id', draft.id).select().single()) : check(await sb.from('templates').insert(row).select().single());
    draft = structuredClone(saved); curType = draft.event_type;
    announce(); await renderTemplates(); toast(`Template saved. To offer it on the tablet, tick it in Events → Edit.`, 5000);
  } catch (e) { toast(e.message, 4000); }
  b.disabled = false;
};
$('#tDelete').onclick = async () => {
  if (!draft.id || !confirm(`Delete the template “${draft.name}”?`)) return;
  try { check(await sb.from('templates').delete().eq('id', draft.id)); const m = draft.frame_url.split('/object/public/photos/')[1]; if (m) await sb.storage.from('photos').remove([m]); draft = null; announce(); renderTemplates(); toast('Template deleted'); }
  catch (e) { toast(e.message, 4000); }
};
$('#tPreview').onclick = async () => {
  readDraft(); const img = $('#frameImg');
  if (!img.naturalWidth || !draft.areas.length) return toast('Upload a frame with photo areas first');
  const d = { ...tplToDesign({ ...draft, width: img.naturalWidth, height: img.naturalHeight }), frame_url: img.src, output_long: 1800 };
  const c = await compose(d, samples(d.areas.length), 'none', { qrText: S.printQr.on ? SITE + '?q=preview' : '' });
  modal(`<div class="row" style="justify-content:space-between"><b>Preview · ${esc(draft.name)}</b><button class="ico" data-close aria-label="Close">✕</button></div><img alt="Template preview" src="${c.toDataURL('image/jpeg', .85)}" style="max-height:72vh;max-width:100%;align-self:center;border-radius:4px">`, 720);
};
$('#tplQrOn').onchange = async () => { S.printQr.on = $('#tplQrOn').checked; $('#tplQr').hidden = !S.printQr.on; try { await saveStudio(); toast(S.printQr.on ? 'Small QR will be printed on every print' : 'Small QR turned off'); } catch (e) { toast(e.message, 4000); } };

/* ---- Capture & media ---- */
const MODES = [
  { key: 'photo', name: 'Photo', spec: 'up to 4K', note: 'JPG · printed and shared' },
  { key: 'gif', name: 'GIF', spec: '720 px', note: '10 frames · loops back and forth' },
  { key: 'boom', name: 'Boomerang', spec: '1280 px', note: 'Video · plays forward and back' },
  { key: 'video', name: 'Video', spec: 'up to 4K', note: 'Video with the length you choose' },
];
function renderMedia() { renderModes(); renderCaptureForm(); }
function renderModes() {
  $('#modes').innerHTML = MODES.map(m => { const on = !!S.modes[m.key]; return `<button class="card mode ${on ? 'on' : ''}" data-m="${m.key}" aria-pressed="${on}"><div class="row" style="justify-content:space-between;width:100%"><span class="row" style="font-weight:600"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${MODE_INFO[m.key][1]}</svg>${m.name}</span><span class="chip ${on ? '' : 'mute'}">${on ? 'On' : 'Off'}</span></div><div class="mono" style="font-size:22px;font-weight:600">${m.spec}</div><div class="lbl">${m.note}</div></button>`; }).join('');
}
function renderCaptureForm() {
  const c = S.capture;
  $('#capRes').value = c.res; $('#capCam').value = c.camera; $('#capMirror').checked = !!c.mirror; $('#capQ').value = c.quality; $('#capQv').textContent = c.quality + '%';
  $('#capCount').value = c.countdown; $('#capGap').value = c.gap ?? 2; $('#capVid').value = c.videoSec; $('#capCopies').value = c.maxCopies;
  renderDslrState();
}
function renderDslrState() { $('#dslrState').textContent = dslr ? 'Connected' : 'Not connected'; $('#dslrState').className = 'chip' + (dslr ? '' : ' mute'); $('#dslrTest').disabled = !dslr; if (dslr) $('#capCam').value = 'dslr'; }
$('#modes').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; S.modes[b.dataset.m] = !S.modes[b.dataset.m]; if (!enabledModes().length) S.modes.photo = true; renderModes(); });
$('#capQ').oninput = () => $('#capQv').textContent = $('#capQ').value + '%';
$('#capCam').onchange = () => { camTestOff(); if ($('#capCam').value === 'dslr') $('#dslrCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
$('#mediaSave').onclick = async () => {
  const n = (id, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(+$(id).value || d)));
  Object.assign(S.capture, { res: $('#capRes').value, camera: $('#capCam').value, mirror: $('#capMirror').checked, quality: n('#capQ', 70, 100, 95), countdown: n('#capCount', 1, 10, 3), gap: Math.max(0, Math.min(10, Math.round((+$('#capGap').value || 0) * 2) / 2)), videoSec: n('#capVid', 3, 30, 10), maxCopies: n('#capCopies', 1, 10, 3) });
  try { await saveStudio(); renderMedia(); toast('Saved. The tablet updates right away.'); } catch (e) { toast(e.message, 4000); }
};
let testStream = null;
function camTestOff() { cancelAnimationFrame(testRaf); testRaf = 0; const td = $('#testDslr'); if (td) td.hidden = true; const tv = $('#testVideo'); if (tv) tv.hidden = false; if (testStream) testStream.getTracks().forEach(t => t.stop()); testStream = null; const v = $('#testVideo'); if (v) v.srcObject = null; $('#camChip').textContent = 'Off'; $('#camChip').className = 'chip mute'; $('#testShot').disabled = true; $('#camOn').textContent = 'Turn on camera'; $('#resBadge').textContent = '–'; $('#resLabel').textContent = 'Camera off'; }
let testRaf = 0;
async function dslrCheckOn() {
  $('#camOn').disabled = true; $('#resLabel').textContent = 'Connecting to the Canon…';
  try { await dslrConnect(true); } catch (e) { $('#camOn').disabled = false; $('#resLabel').textContent = 'Canon not connected'; $('#testInfo').textContent = e.message; return; }
  $('#camOn').disabled = false; renderDslrState();
  const out = $('#testDslr'), x = out.getContext('2d'); out.hidden = false; $('#testVideo').hidden = true;
  const draw = () => { const src = $('#dslrView'); if (src.width) { if (out.width !== src.width) { out.width = src.width; out.height = src.height; } x.drawImage(src, 0, 0); $('#resLabel').textContent = `Canon live view ${src.width} × ${src.height} · photos at full resolution`; } testRaf = requestAnimationFrame(draw); };
  draw();
  $('#resBadge').textContent = 'DSLR'; $('#camChip').textContent = 'Canon DSLR'; $('#camChip').className = 'chip'; $('#testShot').disabled = false; $('#camOn').textContent = 'Turn off camera';
}
$('#camOn').onclick = async () => {
  if (testStream || testRaf) return camTestOff();
  if ($('#capCam').value === 'dslr') return dslrCheckOn();
  const [w, h] = RES[$('#capRes').value] || RES['4k'], cam = $('#capCam').value;
  try {
    testStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: cam === 'environment' ? 'environment' : 'user', width: { ideal: w }, height: { ideal: h } } });
    const v = $('#testVideo'); v.srcObject = testStream; await v.play().catch(() => {});
    await sleep(400);
    const s = testStream.getVideoTracks()[0].getSettings();
    $('#resBadge').textContent = (s.width || v.videoWidth) >= 3840 ? '4K' : (s.width || v.videoWidth) >= 2560 ? '1440p' : (s.width || v.videoWidth) >= 1920 ? '1080p' : 'SD';
    $('#resLabel').textContent = `${s.width || v.videoWidth} × ${s.height || v.videoHeight}${s.frameRate ? ' · ' + Math.round(s.frameRate) + ' fps' : ''}`;
    $('#camChip').textContent = 'On'; $('#camChip').className = 'chip'; $('#testShot').disabled = false; $('#camOn').textContent = 'Turn off camera';
  } catch (e) { toast('Cannot open a camera on this device: ' + e.message, 4000); }
};
$('#testShot').onclick = async () => {
  if (testRaf && dslr) {
    const b = $('#testShot'); b.disabled = true; $('#testInfo').textContent = 'Taking a Canon photo…'; const t0 = performance.now();
    try { dslr.pause = true; const c = await dslrFullPhoto(dslr); $('#testInfo').textContent = `Canon photo: ${c.width} × ${c.height} (saved at up to 4K) · took ${((performance.now() - t0) / 1000).toFixed(1)} s`; }
    catch (e) { $('#testInfo').textContent = e.message; }
    finally { dslr.pause = false; b.disabled = false; }
    return;
  }
  const v = $('#testVideo'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const b = await toBlob(c, 'image/jpeg', (+$('#capQ').value || 95) / 100);
  $('#testInfo').textContent = `Last test: ${c.width} × ${c.height} · ${(b.size / 1048576).toFixed(1)} MB`;
};
$('#dslrConnect').onclick = async () => {
  const b = $('#dslrConnect'); b.disabled = true; $('#dslrInfo').textContent = 'Connecting…';
  try { await dslrConnect(true); $('#dslrInfo').textContent = 'Live view on. Photos use the camera\'s full resolution.'; renderDslrState(); toast('Canon DSLR connected'); }
  catch (e) { $('#dslrInfo').textContent = e.message; }
  b.disabled = false;
};
$('#dslrTest').onclick = async () => {
  if (!dslr) return;
  try { const f = await dslr.cam.captureImageAsFile(); const bmp = await createImageBitmap(f); $('#dslrInfo').textContent = `DSLR test photo: ${bmp.width} × ${bmp.height} · ${(f.size / 1048576).toFixed(1)} MB`; }
  catch (e) { $('#dslrInfo').textContent = 'Test photo failed: ' + e.message; }
};

/* ---- Gallery & share ---- */
let galEvent = null, galPhotos = [], gFilter = 'all';
async function renderGallery() {
  try { await loadEvents(); } catch (e) {}
  if (!EVENTS.find(e => e.id === galEvent)) galEvent = ACTIVE.id;
  const ev = EVENTS.find(e => e.id === galEvent);
  $('#gEvent').innerHTML = EVENTS.map(e => `<option value="${e.id}" ${e.id === galEvent ? 'selected' : ''}>${esc(e.name)} (${esc(evType(e))})</option>`).join('');
  $('#gTitle').textContent = ev.name;
  if (!ev.album_token) { ev.album_token = token(); await sb.from('events').update({ album_token: ev.album_token }).eq('id', ev.id); }
  $('#albumLink').value = albumLink(ev); qr($('#albumQr'), albumLink(ev), 112);
  $('#albumOn').checked = ev.album_enabled !== false; $('#albumPin').value = ev.album_pin || '';
  $('#albumExp').value = ev.album_expires_at ? 'keep' : 'never'; $('#albumExp').querySelector('[value=keep]').hidden = !ev.album_expires_at;
  $('#albumExpInfo').textContent = ev.album_expires_at ? (new Date(ev.album_expires_at) < new Date() ? 'Expired on ' : 'Expires on ') + new Date(ev.album_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Never expires';
  try { galPhotos = check(await sb.from('photos').select('*').eq('event_id', galEvent).eq('owner', USER.id).order('created_at', { ascending: false })); } catch (e) { toast(e.message, 4000); galPhotos = []; }
  $('#gCount').textContent = `${galPhotos.length} session${galPhotos.length === 1 ? '' : 's'}`;
  drawThumbs();
}
function drawThumbs() {
  const badge = { photo: 'PHOTO', gif: 'GIF', boom: 'BOOMERANG', video: 'VIDEO' };
  const list = galPhotos.map((p, i) => ({ p, i })).filter(o => gFilter === 'all' || (o.p.kind || 'photo') === gFilter);
  $('#thumbs').innerHTML = list.length ? list.map(({ p, i }) => `<button class="thumb" data-i="${i}"><div class="im"><img src="${fileUrl(p.thumb_path)}" alt="Session ${galPhotos.length - i}" loading="lazy"><span class="tbadge ${(p.kind || 'photo') === 'photo' ? '' : 'anim'}">${badge[p.kind || 'photo']}</span></div><div class="row lbl" style="justify-content:space-between;font-size:12px"><span>#${galPhotos.length - i}</span><span class="mono">${timeOf(p.created_at)}</span></div></button>`).join('')
    : `<div class="empty">${galPhotos.length ? 'Nothing of this type yet.' : 'No photos yet. They appear here as soon as guests use the booth.'}</div>`;
}
$('#gEvent').onchange = () => { galEvent = $('#gEvent').value; renderGallery(); };
$('#gFilters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; gFilter = b.dataset.f; $$('#gFilters .pill').forEach(p => p.classList.toggle('on', p === b)); drawThumbs(); });
$('#thumbs').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return; const i = +b.dataset.i, p = galPhotos[i], kind = p.kind || 'photo';
  const link = shareLink(p), ev = EVENTS.find(x => x.id === p.event_id);
  const media = kind === 'gif' ? `<img src="${fileUrl(p.media_path)}" alt="" style="max-height:56vh;max-width:min(320px,100%);border-radius:4px">` : kind === 'photo' ? `<img src="${fileUrl(p.path)}" alt="" style="max-height:56vh;max-width:min(320px,100%);border-radius:4px">` : `<video src="${fileUrl(p.media_path)}" controls autoplay loop muted playsinline style="max-height:56vh;max-width:min(320px,100%);border-radius:4px"></video>`;
  const exp = p.print_expires_at ? new Date(p.print_expires_at) : null;
  const m = modal(`<div class="row" style="justify-content:space-between"><b>Session #${galPhotos.length - i} · ${MODE_INFO[kind][0]}</b><button class="ico" data-close aria-label="Close">✕</button></div>
    <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
      <div style="flex:none;max-width:100%">${media}</div>
      <div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <div class="cap">Share this ${kind === 'photo' ? 'photo' : 'file'} again</div>
        <div class="row" style="align-items:center;gap:14px"><div class="qrbox" id="photoQr"></div><p class="lbl" style="margin:0;line-height:1.5">Show this to the guest to scan. It opens only this ${kind === 'photo' ? 'photo' : 'file'}.</p></div>
        <input class="in mono" id="photoLink" readonly value="${esc(link)}" aria-label="Photo link" style="font-size:12px">
        ${S.printQr.on && kind === 'photo' && exp ? `<div class="lbl">The QR printed on this photo ${exp > new Date() ? 'works until ' + exp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'has expired'}. This QR here always works.</div>` : ''}
        <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" id="copyPhoto">Copy link</button><button class="btn sm" id="showTab">Show on tablet</button></div>
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px">${kind === 'photo' ? '<label class="field" style="width:80px" for="rpC">Copies<input class="in mono" id="rpC" type="number" min="1" max="10" value="1"></label><button class="btn pri" id="reprint" style="align-self:flex-end">Print again</button>' : ''}<button class="btn" id="dlOrig" style="align-self:flex-end">Download original</button><button class="btn" id="delPhoto" style="align-self:flex-end;color:#ff8a80">Delete</button></div>
      </div>
    </div>`, 780);
  qr(m.querySelector('#photoQr'), link, 112);
  m.querySelector('#copyPhoto').onclick = () => copyText(link, m.querySelector('#photoLink'));
  m.querySelector('#showTab').onclick = () => { if (!others().some(d => d.role === 'booth')) return toast('The tablet is not connected'); chan.send({ type: 'broadcast', event: 'show-qr', payload: { url: link, label: 'Scan to get your photo' } }); toast('QR shown on the tablet'); };
  const rp = m.querySelector('#reprint');
  if (rp) rp.onclick = async () => { try { const c = Math.max(1, Math.min(10, +m.querySelector('#rpC').value || 1)); check(await sb.from('print_jobs').insert({ event_id: p.event_id, photo_id: p.id, path: p.print_path || p.path, copies: c, label: `${ev ? ev.name : ''} · reprint` })); toast(printerOn() ? 'Sent to the printer' : 'Added to the print queue. Turn on printing in Printer.'); runPrinter(); } catch (err) { toast(err.message, 4000); } };
  m.querySelector('#dlOrig').onclick = async () => { const path = p.media_path || p.path; try { download(await (await fetch(fileUrl(path))).blob(), path.split('/').pop()); } catch (err) { window.open(fileUrl(path), '_blank'); } };
  m.querySelector('#delPhoto').onclick = async () => {
    if (!confirm('Delete this from the gallery? The guest link stops working.')) return;
    try { await sb.storage.from('photos').remove([p.path, p.thumb_path, p.media_path, p.print_path].filter(Boolean)); check(await sb.from('photos').delete().eq('id', p.id)); m.remove(); renderGallery(); toast('Deleted'); } catch (err) { toast(err.message, 4000); }
  };
});
$('#copyAlbum').onclick = () => copyText($('#albumLink').value, $('#albumLink'));
$('#dlAlbumQr').onclick = async () => { const ev = EVENTS.find(e => e.id === galEvent); download(await toBlob(qrCanvas(albumLink(ev), 1024), 'image/png'), `album-qr-${ev.name.replace(/[^\w]+/g, '-')}.png`); };
$('#newAlbumLink').onclick = async () => {
  if (!confirm('Make a new album link? The old link and QR stop working.')) return;
  try { check(await sb.from('events').update({ album_token: token() }).eq('id', galEvent)); renderGallery(); toast('New album link made'); } catch (e) { toast(e.message, 4000); }
};
$('#albumSave').onclick = async () => {
  const v = $('#albumExp').value, pinV = $('#albumPin').value.trim();
  if (pinV && !/^\d{4,8}$/.test(pinV)) return toast('PIN must be 4 to 8 digits');
  const upd = { album_enabled: $('#albumOn').checked, album_pin: pinV };
  if (v === 'never') upd.album_expires_at = null; else if (v !== 'keep') upd.album_expires_at = new Date(Date.now() + +v * 864e5).toISOString();
  try { check(await sb.from('events').update(upd).eq('id', galEvent)); renderGallery(); toast('Album settings saved'); } catch (e) { toast(e.message, 4000); }
};
$('#gZip').onclick = async () => {
  if (!galPhotos.length) return toast('No photos to download yet.');
  const b = $('#gZip'); b.disabled = true;
  try {
    const zip = new JSZip(); let n = 0;
    for (const p of galPhotos.slice().reverse()) {
      n++; b.textContent = `Preparing ${n}/${galPhotos.length}…`;
      const path = p.media_path || p.path; zip.file(`${String(n).padStart(3, '0')}-${p.kind || 'photo'}.${path.split('.').pop()}`, await (await fetch(fileUrl(path))).blob());
    }
    const ev = EVENTS.find(x => x.id === galEvent);
    download(await zip.generateAsync({ type: 'blob' }), `${(ev ? ev.name : 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'event'}.zip`);
  } catch (e) { toast('Download failed: ' + e.message, 4000); }
  b.disabled = false; b.textContent = 'Download all (ZIP)';
};

/* ---- Guest preview ---- */
async function renderGuestPreview() {
  const r = await sb.from('photos').select('share_token').eq('owner', USER.id).order('created_at', { ascending: false }).limit(1);
  const p = r.data && r.data[0];
  const url = p ? `${SITE}?p=${p.share_token}` : `${SITE}?p=preview`;
  $('#gvFrame').src = url; $('#gvOpen').href = url;
}

/* ---- Printer (this laptop) ---- */
let printBusy = false;
function printerUi() {
  const on = printerOn();
  $('#prnState').textContent = on ? 'On — jobs from the tablet print here' : 'Off — jobs wait in the queue';
  renderDevices();
}
$('#prnOn').onchange = () => { store.set('printer', $('#prnOn').checked); printerUi(); track(); runPrinter(); };
function renderPaper() {
  if (!STATION) return;
  const cap = STATION.media_capacity || 700, left = Math.max(0, cap - (STATION.printed_since_reset || 0)), pct = Math.max(0, Math.min(100, left / cap * 100));
  $('#paperLeft').textContent = left; $('#paperCap').textContent = cap; $('#hPaper').textContent = left;
  $('#paperBar').style.width = pct + '%'; $('#paperBar').style.background = pct < 8 ? '#ff6b5e' : pct < 20 ? '#ffd23f' : 'var(--ok)';
  $('#paperChip').className = 'chip' + (pct < 8 ? ' bad' : ''); $('#paperChip').textContent = pct < 8 ? 'Almost out — change the roll' : 'Counting automatically';
  if (document.activeElement !== $('#paperEdit')) $('#paperEdit').value = left;
  if (document.activeElement !== $('#capEdit')) $('#capEdit').value = cap;
}
async function saveStation(upd) { check(await sb.from('station_settings').update(upd).eq('owner', USER.id)); await loadStation(); renderPaper(); }
$('#paperSave').onclick = async () => {
  const cap = Math.max(1, Math.round(+$('#capEdit').value || STATION.media_capacity || 700)), left = Math.max(0, Math.min(cap, Math.round(+$('#paperEdit').value || 0)));
  try { await saveStation({ media_capacity: cap, printed_since_reset: cap - left }); toast('Paper count updated'); } catch (e) { toast(e.message, 4000); }
};
$('#paperNew').onclick = async () => {
  const cap = Math.max(1, Math.round(+$('#capEdit').value || STATION.media_capacity || 700));
  try { await saveStation({ media_capacity: cap, printed_since_reset: 0 }); toast('New roll: ' + cap + ' sheets'); } catch (e) { toast(e.message, 4000); }
};
async function renderQueue() {
  try {
    await loadStation(); renderPaper();
    const jobs = check(await sb.from('print_jobs').select('*').eq('owner', USER.id).order('created_at', { ascending: false }).limit(50));
    const cls = { waiting: 'chip mute', printing: 'chip hot', done: 'chip', failed: 'chip bad', cancelled: 'chip mute' };
    const lbl = { waiting: 'Waiting', printing: 'Printing', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
    $('#queue').innerHTML = jobs.length ? jobs.map(j => `<tr><td class="mono">${timeOf(j.created_at)}</td><td>${esc(j.label)}${j.error ? `<div class="lbl" style="color:#ff8a80">${esc(j.error)}</div>` : ''}</td><td class="mono">${j.copies}</td><td><span class="${cls[j.status] || 'chip'}">${lbl[j.status] || esc(j.status)}</span></td>
      <td>${['failed', 'cancelled', 'printing', 'done'].includes(j.status) ? `<button class="btn sm" data-q="retry" data-id="${j.id}">Print again</button>` : ''}${j.status === 'waiting' ? `<button class="btn sm" data-q="cancel" data-id="${j.id}">Cancel</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="lbl">No print jobs yet.</td></tr>';
  } catch (e) {}
}
async function queueBadge() { try { const r = await sb.from('print_jobs').select('id', { count: 'exact', head: true }).eq('owner', USER.id).eq('status', 'waiting'); $('#qBadge').hidden = !r.count; $('#qBadge').textContent = r.count || 0; } catch (e) {} }
$('#queue').onclick = async e => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  try {
    if (b.dataset.q === 'retry') check(await sb.from('print_jobs').update({ status: 'waiting', error: '', updated_at: new Date().toISOString() }).eq('id', b.dataset.id));
    else check(await sb.from('print_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', b.dataset.id).eq('status', 'waiting'));
    renderQueue(); queueBadge(); runPrinter();
  } catch (err) { toast(err.message, 4000); }
};
async function testPrint(strip) {
  const d = strip ? BUILTIN[0] : BUILTIN[1];
  const c = await compose({ ...d, output_long: 1800 }, samples(d.areas.length), 'none', { name: 'TEST PRINT', date: new Date().toLocaleString('en-GB'), qrText: S.printQr.on ? SITE : '' });
  try { await printImage(printCanvas(d, c).toDataURL('image/jpeg', .95), 1); } catch (e) { toast(e.message, 4000); }
}
$('#test46').onclick = () => testPrint(false); $('#testStrip').onclick = () => testPrint(true);
async function printImage(src, copies) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Could not download the photo to print')); i.src = src; });
  let url = src;
  if (img.naturalWidth > img.naturalHeight) { // landscape → rotate onto portrait 4x6 paper
    const c = document.createElement('canvas'); c.width = img.naturalHeight; c.height = img.naturalWidth;
    const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0); url = c.toDataURL('image/jpeg', .95);
  } else if (!src.startsWith('data:')) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); url = c.toDataURL('image/jpeg', .95); }
  const area = $('#printArea'); area.innerHTML = '';
  for (let i = 0; i < Math.max(1, copies); i++) { const im = new Image(); im.src = url; im.alt = ''; area.appendChild(im); }
  await Promise.all([...area.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
  await sleep(120); window.print(); await sleep(300); area.innerHTML = '';
}
async function runPrinter() {
  if (!printerOn() || printBusy || !USER) return;
  printBusy = true;
  try {
    for (;;) {
      const next = check(await sb.from('print_jobs').select('*').eq('owner', USER.id).eq('status', 'waiting').order('created_at', { ascending: true }).limit(1));
      if (!next.length || !printerOn()) break;
      const job = next[0];
      const claimed = check(await sb.from('print_jobs').update({ status: 'printing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'waiting').select());
      if (!claimed.length) continue;
      try {
        await printImage(fileUrl(job.path), job.copies);
        check(await sb.from('print_jobs').update({ status: 'done', error: '', updated_at: new Date().toISOString() }).eq('id', job.id));
        if (job.photo_id) { const p = (await sb.from('photos').select('printed').eq('id', job.photo_id).maybeSingle()).data; if (p) await sb.from('photos').update({ printed: (p.printed || 0) + job.copies }).eq('id', job.photo_id); }
        await loadStation(); await sb.from('station_settings').update({ printed_since_reset: (STATION.printed_since_reset || 0) + job.copies }).eq('owner', USER.id);
        STATION.printed_since_reset = (STATION.printed_since_reset || 0) + job.copies;
      } catch (e) { await sb.from('print_jobs').update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() }).eq('id', job.id); }
    }
  } catch (e) { /* offline: try again on the next tick */ }
  printBusy = false; renderPaper(); queueBadge();
  if (secOn('printer')) renderQueue();
}
setInterval(() => { if (ROLE === 'admin') runPrinter(); }, 10000);

/* ---- Studio settings ---- */
let pendingBg = null;
function renderStudio() {
  $('#brandIn').value = S.brand; $('#guestFoot').value = S.guestFooter; $('#guestFoot').placeholder = 'Photos by ' + (S.brand || 'Photobooth Studio');
  $('#pqOn').checked = !!S.printQr.on; $('#pqPos').value = S.printQr.pos;
  $('#bgDim').value = S.bg.dim; $('#bgSub').value = S.bg.sub || '';
  $$('#bgColors .sw').forEach(x => x.classList.toggle('on', x.dataset.c === S.bg.color));
  $('#bgFileName').textContent = S.bg.src ? S.bg.src.split('/').pop() : 'No file yet';
  applyBrand(); renderBgPrev(); renderPq();
}
function renderBgPrev() {
  paintBg($('#bgPrevLayer'), $('#bgPrevShade'), S.bg); $('#bgPrevTitle').textContent = ACTIVE ? ACTIVE.name : '';
  $('#bgDimV').textContent = S.bg.dim + '%';
  $$('#bgKinds .pill').forEach(b => b.classList.toggle('on', b.dataset.k === S.bg.kind));
  $('#bgUploadRow').hidden = S.bg.kind === 'color'; $('#bgColors').hidden = S.bg.kind !== 'color';
  $('#bgUploadLbl').textContent = { image: 'Upload photo', gif: 'Upload GIF', video: 'Upload video' }[S.bg.kind] || '';
  $('#bgFile').accept = { image: 'image/jpeg,image/png,image/webp', gif: 'image/gif', video: 'video/mp4,video/webm' }[S.bg.kind] || '';
}
async function renderPq() {
  $('#pqChip').className = 'chip' + (S.printQr.on ? '' : ' mute'); $('#pqChip').textContent = S.printQr.on ? 'On · 24 h links' : 'Off';
  const c = await compose({ ...BUILTIN[0], output_long: 900 }, samples(3), 'none', { name: ACTIVE ? ACTIVE.name : '', date: ACTIVE ? ACTIVE.event_date : '', qrText: S.printQr.on ? SITE + '?q=preview' : '' });
  $('#pqPrev').src = c.toDataURL('image/jpeg', .85);
}
$('#brandIn').addEventListener('input', () => { S.brand = $('#brandIn').value.trim() || 'Photobooth Studio'; applyBrand(); $('#guestFoot').placeholder = 'Photos by ' + S.brand; });
$('#guestFoot').addEventListener('input', () => { S.guestFooter = $('#guestFoot').value.trim(); });
$('#pqOn').onchange = () => { S.printQr.on = $('#pqOn').checked; renderPq(); };
$('#pqPos').onchange = () => { S.printQr.pos = $('#pqPos').value; renderPq(); };
$('#bgKinds').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; if (S.bg.kind !== b.dataset.k) { S.bg.src = ''; $('#bgFileName').textContent = 'No file yet'; } S.bg.kind = b.dataset.k; renderBgPrev(); });
$('#bgColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; S.bg.color = b.dataset.c; $$('#bgColors .sw').forEach(x => x.classList.toggle('on', x === b)); renderBgPrev(); });
$('#bgDim').oninput = () => { S.bg.dim = +$('#bgDim').value; renderBgPrev(); };
$('#bgSub').addEventListener('input', () => { S.bg.sub = $('#bgSub').value.trim(); });
$('#bgFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const k = S.bg.kind, ok = k === 'video' ? /^video\/(mp4|webm)$/.test(f.type) : k === 'gif' ? f.type === 'image/gif' : /^image\/(jpeg|png|webp)$/.test(f.type);
  if (!ok) return toast('That file type does not match. Choose a ' + ({ image: 'JPG or PNG photo', gif: 'GIF', video: 'MP4 or WebM video' }[k]));
  if (f.size > 50 * 1048576) return toast('That file is bigger than 50 MB. Use a shorter or smaller video.');
  $('#bgFileName').textContent = 'Uploading ' + f.name + '…';
  try { const path = `u-${USER.id}/bg-${Date.now().toString(36)}.${f.name.split('.').pop().toLowerCase()}`; await upload(path, f, f.type); S.bg.src = fileUrl(path); $('#bgFileName').textContent = f.name; renderBgPrev(); toast('Uploaded. Press Save to use it on the tablet.'); }
  catch (err) { $('#bgFileName').textContent = 'Upload failed'; toast(err.message, 4000); }
});
$('#logoFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(f.type)) return toast('Choose a PNG, JPG, SVG or WebP image');
  if (f.size > 5 * 1048576) return toast('Logo must be smaller than 5 MB');
  try { const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[f.type]; const path = `u-${USER.id}/logo-${Date.now().toString(36)}.${ext}`; await upload(path, f, f.type); S.logo = fileUrl(path); await saveStudio(); toast('Logo updated everywhere'); }
  catch (err) { toast(err.message, 4000); }
});
$('#logoReset').onclick = async () => { S.logo = ''; try { await saveStudio(); toast('Default logo restored'); } catch (e) { toast(e.message, 4000); } };
$('#studioSave').onclick = async () => { try { await saveStudio(); toast('Saved. The tablet updates right away.'); } catch (e) { toast(e.message, 4000); } };

/* ---- Accounts & PIN ---- */
function renderAccounts() { $('#aUser').value = PROFILE ? PROFILE.username : ''; $('#aPin').value = (STATION && STATION.staff_pin) || '1234'; $('#aPass').value = ''; }
$('#saveUser').onclick = async () => {
  const u = $('#aUser').value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) return toast('Use 3–32 letters, numbers, dots, dashes or underscores', 4000);
  try { const r = check(await sb.rpc('set_username', { new_username: u })); PROFILE = { ...(PROFILE || {}), username: r }; $('#whoami').textContent = r; $('#avatar').textContent = r[0].toUpperCase(); store.set('lastUser', r); toast('Username saved. Use it next time you log in.'); }
  catch (e) { toast(e.message, 4000); }
};
$('#savePass').onclick = async () => {
  const p = $('#aPass').value; if (p.length < 8) return toast('Use at least 8 characters');
  try { check(await sb.auth.updateUser({ password: p })); $('#aPass').value = ''; toast('Password changed. Use it next time you log in on any device.'); } catch (e) { toast(e.message, 4000); }
};
$('#savePin').onclick = async () => {
  const p = $('#aPin').value.trim(); if (!/^\d{4}$/.test(p)) return toast('PIN must be 4 digits');
  try { await saveStation({ staff_pin: p }); announce(); toast('Staff PIN saved'); } catch (e) { toast(e.message, 4000); }
};

/* ---------------- Start ---------------- */
(async () => {
  const { data } = await sb.auth.getSession();
  if (data && data.session) enter(data.session.user); else show('v-login');
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session && (!USER || USER.id !== session.user.id)) enter(session.user);
    if (ev === 'SIGNED_OUT') { USER = null; show('v-login'); }
  });
})();
