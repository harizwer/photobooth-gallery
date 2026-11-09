/* =====================================================================
   Photobooth Studio — one website for the tablet (Booth) and the laptop
   (Admin board + printing). Data lives in Supabase.
   ===================================================================== */
const SUPABASE_URL = 'https://dqeyaimxfkursttbdmyp.supabase.co';
const NATIVE = window.PBNative || null;   // set when the page runs inside the Photobooth Android app
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
// Photos and studio images live in Cloudflare R2, served by this website's worker at /files/ (see worker/index.js).
const fileUrl = path => path ? `${location.origin}/files/${path}` : '';
async function authHeader() { const { data } = await sb.auth.getSession(); const t = data && data.session && data.session.access_token; if (!t) throw new Error('Log in again to save photos.'); return 'Bearer ' + t; }
// Delete files: from R2, and any older copy still in Supabase storage.
async function removeFiles(paths) {
  paths = paths.filter(Boolean); if (!paths.length) return;
  const auth = await authHeader().catch(() => '');
  await Promise.all(paths.map(p => fetch(fileUrl(p), { method: 'DELETE', headers: { Authorization: auth } }).catch(() => {})));
  for (let i = 0; i < paths.length; i += 100) await sb.storage.from('photos').remove(paths.slice(i, i + 100)).catch(() => {});
}
// A file path from a saved address (new /files/ addresses and older Supabase ones).
const pathOfUrl = u => String(u || '').split('/files/')[1] || String(u || '').split('/object/public/photos/')[1] || '';
const token = (n = 12) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const timeOf = d => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function check(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }
function qr(el, text, size) { el.innerHTML = ''; if (window.QRCode) new QRCode(el, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M }); else el.textContent = text; }
function qrCanvas(text, size, level) { const d = document.createElement('div'); new QRCode(d, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel[level || 'M'] }); return d.querySelector('canvas'); }
const shareLink = p => `${SITE}?p=${p.share_token}`;
const albumLink = e => `${SITE}?album=${e.album_token}`;
const toBlob = (c, type = 'image/jpeg', q = .92) => new Promise(r => c.toBlob(r, type, q));
function scaled(src, max) {
  const w0 = src.width || src.videoWidth, h0 = src.height || src.videoHeight;
  const s = Math.min(1, max / Math.max(w0, h0)); const o = document.createElement('canvas');
  o.width = Math.round(w0 * s); o.height = Math.round(h0 * s); const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high'; ox.drawImage(src, 0, 0, o.width, o.height); return o;
}
async function copyText(text, input) { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch (e) { if (input) input.select(); toast('Select the link and copy it'); } }
function download(blobOrUrl, name) { const a = document.createElement('a'); a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

/* ---------------- Studio settings ---------------- */
const STUDIO_DEFAULT = {
  brand: 'Photobooth Studio', guestFooter: '', logo: '',
  printQr: { on: false, pos: 'br' },
  bg: { kind: 'color', color: '#ff5a26', src: '', dim: 45, sub: '' },
  stickers: { on: true, packs: ['props', 'love', 'party', 'raya', 'fun'], custom: [], texts: [{ t: 'Selamat Pengantin Baru', font: 'Great Vibes', color: '#ffffff' }] },
  guestbook: { on: false, prompt: 'Write a message for the couple ✍️', auto: false, paper: 'cream', paperSrc: '', screen: '#141416', screenSrc: '', pdfBg: true },
  beauty: 0,
  aiBg: { on: true, builtin: ['white', 'grey', 'gold', 'rose', 'night'], blur: true, list: [] },
  voice: { on: false, lang: 'ms-MY', volume: 1, lines: {}, clips: {} },
  music: { on: false, volume: .35, tracks: [], repeat: 'one' },
  videoBook: { on: false, sec: 20, prompt: 'Say something to the couple! 🎥', montage: { format: 'portrait', bg: 'leather', bgSrc: '', title: 'Video Guestbook', names: '', font: 'Great Vibes', color: '#ffffff' } },
  countdown: { frame: 'none', frameSrc: '', prevBorder: '#ffffff', tick: 'beep', tickSrc: '', last: 'beep', lastSrc: '', shutter: 'click', shutterSrc: '', font: 'Geist', color: '#ffffff', stroke: 0, strokeColor: '#000000', size: 100, anim: 'pop', volume: 1 },
  smile: { text: 'Smile!', font: 'Geist', color: '#ffffff', stroke: 0, strokeColor: '#000000', emoji: '', deco: 'none', size: 100, numbers: false },
  printScreen: { on: true, kind: 'theme', theme: 'knit', src: '', dim: 25, text: 'Printing your photo…', sec: 12 },
  modes: { photo: true, gif: true, boom: true, video: false },
  capture: { res: '4k', camera: 'dslr', mirror: true, quality: 95, countdown: 3, gap: 2, videoSec: 10, maxCopies: 3, photoGif: true, canonLive: true, originals: true },
  types: [],
};
let S = structuredClone(STUDIO_DEFAULT);
function mergeStudio(d) {
  const o = structuredClone(STUDIO_DEFAULT); d = d || {};
  for (const k of Object.keys(d)) o[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? { ...o[k], ...d[k] } : d[k];
  return fixOldSettings(o);
}
const cachedStudio = store.get('studio', null);
// Older saved setting 'laptop' (removed): use the Canon on the tablet
function fixOldSettings(o) { if (o && o.capture && !/^(dslr|user|environment)$/.test(o.capture.camera)) o.capture.camera = 'dslr'; o.modes = { photo: true, gif: false, boom: false, video: !!(o.videoBook && o.videoBook.on) }; if (o && o.capture && o.capture.photoGif === undefined) o.capture.photoGif = true; return o; }   // photo mode only; the strip boomerang is optional
if (cachedStudio) S = mergeStudio(cachedStudio);
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
// A guest photo with the guest's own zoom and position (adj = { z, dx, dy }; dx/dy are fractions of the photo spot).
// When zoomed out so far that the photo no longer fills its spot, the spot is filled with the strip's colour first.
const noAdj = a => !a || ((a.z || 1) === 1 && !a.dx && !a.dy);
function drawShot(x, img, dx, dy, dw, dh, fit, adj, fill) {
  if (noAdj(adj)) return drawInto(x, img, dx, dy, dw, dh, fit);
  const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
  const base = fit === 'contain' ? Math.min(dw / iw, dh / ih) : Math.max(dw / iw, dh / ih), k = base * (adj.z || 1), w = iw * k, h = ih * k;
  const left = dx + dw / 2 + (adj.dx || 0) * dw - w / 2, top = dy + dh / 2 + (adj.dy || 0) * dh - h / 2;
  if (left > dx + .5 || top > dy + .5 || left + w < dx + dw - .5 || top + h < dy + dh - .5) { x.fillStyle = fill || '#ffffff'; x.fillRect(dx, dy, dw, dh); }
  x.drawImage(img, left, top, w, h);
}
// The strip's own colour around each photo spot: the most common colour of the frame just outside the spot.
const fillCache = {};
async function areaFills(d) {
  const key = (d.frame_url || 'builtin:' + d.id) + '|' + JSON.stringify(d.areas);
  if (fillCache[key]) return fillCache[key];
  const plain = d.builtin ? '#f4efe6' : '#ffffff';
  const frame = await loadImg(d.frame_url);
  if (!frame) return (fillCache[key] = d.areas.map(() => plain));
  const W = 300, H = Math.max(1, Math.round(300 * frame.naturalHeight / frame.naturalWidth));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(frame, 0, 0, W, H);
  let px; try { px = x.getImageData(0, 0, W, H).data; } catch (e) { return (fillCache[key] = d.areas.map(() => plain)); }
  return (fillCache[key] = d.areas.map(a => {
    const counts = new Map(), ring = Math.max(3, Math.round(W * .02));
    const x0 = Math.floor(a.x * W) - ring, y0 = Math.floor(a.y * H) - ring, x1 = Math.ceil((a.x + a.w) * W) + ring, y1 = Math.ceil((a.y + a.h) * H) + ring;
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
      const inside = xx >= a.x * W && xx < (a.x + a.w) * W && yy >= a.y * H && yy < (a.y + a.h) * H; if (inside) continue;
      const i = (yy * W + xx) * 4; if (px[i + 3] < 200) continue;
      const q = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4), e = counts.get(q);
      if (e) { e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2]; } else counts.set(q, { n: 1, r: px[i], g: px[i + 1], b: px[i + 2] });
    }
    let best = null; for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best ? `rgb(${Math.round(best.r / best.n)},${Math.round(best.g / best.n)},${Math.round(best.b / best.n)})` : plain;
  }));
}
/* ---------- Stickers: emoji, text or picture, placed by the guest (x, y, w as fractions of the strip; r in degrees) ---------- */
const STICKER_PACKS = {
  props: ['Props', ['👓', '🕶️', '👑', '🎩', '🧢', '🎀', '💋', '🥸', '👒', '🪭']],
  love: ['Love', ['💖', '💕', '💘', '💍', '💐', '🌹', '😍', '🥰', '💌']],
  party: ['Party', ['🎉', '🎊', '🥳', '🎈', '✨', '⭐', '🎂', '🍾', '🎁']],
  raya: ['Raya', ['🌙', '🕌', '🪔', '✨', '🤲', '🎆', '⭐', '🌟', '🥮']],
  fun: ['Fun', ['😎', '😂', '🤪', '😜', '👍', '✌️', '🔥', '💯', '🙌']],
};
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
// Size of a sticker in strip pixels (before rotation)
function stkBox(st, W, H, x) {
  const size = st.w * Math.min(W, H);
  if (st.k === 't') { const f = size * .32; let w = [...st.v].length * f * .55; if (x) { x.save(); x.font = `700 ${f}px "${st.font || 'Geist'}", Geist, sans-serif`; w = x.measureText(st.v).width; x.restore(); } return [w + f * .4, f * 1.35]; }
  if (st.k === 'i' && st.ar) return st.ar >= 1 ? [size, size / st.ar] : [size * st.ar, size];
  return [size, size];
}
async function drawSticker(x, st, W, H) {
  const size = st.w * Math.min(W, H);
  x.save(); x.translate(st.x * W, st.y * H); x.rotate((st.r || 0) * Math.PI / 180);
  if (st.k === 'i') {
    const im = await loadImg(st.v);
    if (im) { const ar = im.naturalWidth / im.naturalHeight, w = ar >= 1 ? size : size * ar, h = ar >= 1 ? size / ar : size; x.drawImage(im, -w / 2, -h / 2, w, h); }
  } else if (st.k === 't') {
    const f = size * .32; x.font = `700 ${f}px "${st.font || 'Geist'}", Geist, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = f * .14; x.strokeStyle = 'rgba(0,0,0,.55)'; x.strokeText(st.v, 0, 0); x.fillStyle = st.color || '#fff'; x.fillText(st.v, 0, 0);
  } else {
    x.font = `${size * .9}px ${EMOJI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(st.v, 0, size * .04);
  }
  x.restore();
}
/* ---------- Beauty: smoother skin (edge-preserving, skin tones only) and a slightly brighter look ---------- */
const BEAUTY_K = [0, .35, .6, .85];
function beautify(src, k, maxSide = 2400) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight, sc = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * sc), h = Math.round(h0 * sc);
  const out = document.createElement('canvas'); out.width = w; out.height = h; const o = out.getContext('2d', { willReadFrequently: true }); o.imageSmoothingQuality = 'high';
  const r = Math.max(2, Math.round(Math.min(w, h) * .006 * (.6 + k)));
  o.filter = `blur(${r}px)`; o.drawImage(src, 0, 0, w, h); o.filter = 'none';
  const B = o.getImageData(0, 0, w, h).data; o.drawImage(src, 0, 0, w, h);
  const A = o.getImageData(0, 0, w, h), a = A.data, thr = 14 + 26 * k, inv = 1 / (thr * thr), lift = 1 + .07 * k;
  for (let i = 0; i < a.length; i += 4) {
    const R = a[i], G = a[i + 1], Bl = a[i + 2];
    const cb = 128 - .168736 * R - .331264 * G + .5 * Bl, cr = 128 + .5 * R - .418688 * G - .081312 * Bl;
    const skin = cb > 77 && cb < 130 && cr > 132 && cr < 175 ? 1 : .2;
    const dd = (Math.abs(R - B[i]) + Math.abs(G - B[i + 1]) + Math.abs(Bl - B[i + 2])) / 3, wgt = k * skin * Math.exp(-dd * dd * inv);
    a[i] = Math.min(255, (R + (B[i] - R) * wgt) * lift + 2 * k);
    a[i + 1] = Math.min(255, (G + (B[i + 1] - G) * wgt) * lift);
    a[i + 2] = Math.min(255, (Bl + (B[i + 2] - Bl) * wgt) * lift);
  }
  o.putImageData(A, 0, 0); return out;
}
// The shots to use for this session: with the beauty level applied (made once per level, then kept)
async function reviewShots(s) {
  const lv = +s.beauty || 0, bg = s.bg || ''; if ((!lv && !bg) || !s.shots) return s.shots;
  s._beauty = s._beauty || {}; const key = lv + '|' + bg;
  if (!s._beauty[key]) {
    busy(bg ? 'Changing the background…' : 'Applying beauty…'); await sleep(30);
    try {
      let src = s.shots;
      if (lv) src = s._beauty[lv + '|'] || (s._beauty[lv + '|'] = s.shots.map(c => beautify(c, BEAUTY_K[lv])));
      if (bg) { const out = []; for (const [i, c] of src.entries()) out.push(await withBackground(c, bg, 'photo', s.shots[i])); src = out; }
      s._beauty[key] = src;
    } catch (e) { busy(false); toast('Could not change the background: ' + e.message, 6000); s.bg = ''; return lv ? s._beauty[lv + '|'] || s.shots : s.shots; }
    finally { busy(false); }
  }
  return s._beauty[key];
}
/* ---------- AI background: find the people in a photo (MediaPipe, runs on the device) and put a new background behind them ---------- */
const MP_BASE = new URL('../vendor/mediapipe/', location.href).href;
const segmenters = {};
async function segmenter(kind) {   // 'photo' = accurate model (hair, edges), 'fast' = small model for boomerang frames
  if (segmenters[kind]) return segmenters[kind];
  segmenters[kind] = (async () => {
    const { ImageSegmenter } = await import(MP_BASE + 'vision_bundle.mjs');
    const fileset = { wasmLoaderPath: MP_BASE + 'vision_wasm_internal.js', wasmBinaryPath: MP_BASE + 'vision_wasm_internal.wasm' };
    const model = MP_BASE + (kind === 'photo' ? 'selfie_multiclass.tflite' : 'selfie_segmenter.tflite');
    const make = delegate => ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
    try { return await make('GPU'); } catch (e) { return make('CPU'); }
  })();
  segmenters[kind].catch(() => { delete segmenters[kind]; });
  return segmenters[kind];
}
// How much each pixel belongs to a person (0..255) as a canvas the size of the model's mask
const maskCache = new WeakMap();   // each photo is analysed once; changing the background only re-draws
async function personMask(src, kind) {
  if (kind === 'photo' && maskCache.has(src)) return maskCache.get(src);
  const job = personMaskNow(src, kind);
  if (kind === 'photo') { maskCache.set(src, job); job.catch(() => maskCache.delete(src)); }
  return job;
}
async function personMaskNow(src, kind) {
  const seg = await segmenter(kind);
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight, k = Math.min(1, 1024 / Math.max(w0, h0));
  const small = document.createElement('canvas'); small.width = Math.round(w0 * k); small.height = Math.round(h0 * k);
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const res = seg.segment(small), masks = res.confidenceMasks;
  // multiclass model: mask 0 is the background; selfie model: mask 0 is the person
  const m = masks[0], mw = m.width, mh = m.height, conf = m.getAsFloat32Array();
  const out = document.createElement('canvas'); out.width = mw; out.height = mh; const ox = out.getContext('2d'), img = ox.createImageData(mw, mh);
  const bgFirst = kind === 'photo';
  for (let i = 0; i < conf.length; i++) {
    let p = bgFirst ? 1 - conf[i] : conf[i];
    p = Math.min(1, Math.max(0, (p - .35) / .3));   // firm up the edge a little
    img.data[i * 4 + 3] = Math.round(p * 255);
  }
  ox.putImageData(img, 0, 0);
  if (res.close) res.close(); masks.forEach(x => x.close && x.close());
  return out;
}
// Built-in backgrounds, painted (no photos needed)
const AIBG_BUILTIN = {
  white: ['Studio white', (x, w, h) => { const g = x.createRadialGradient(w / 2, h * .45, h * .1, w / 2, h / 2, h); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9d9de'); x.fillStyle = g; x.fillRect(0, 0, w, h); }],
  grey: ['Studio grey', (x, w, h) => { const g = x.createRadialGradient(w / 2, h * .45, h * .1, w / 2, h / 2, h); g.addColorStop(0, '#8d9299'); g.addColorStop(1, '#2f3237'); x.fillStyle = g; x.fillRect(0, 0, w, h); }],
  gold: ['Gold bokeh', (x, w, h) => bokeh(x, w, h, ['#3a2410', '#120a04'], ['255,200,110', '255,170,60', '255,230,160'])],
  rose: ['Rose bokeh', (x, w, h) => bokeh(x, w, h, ['#5a2236', '#1d0a12'], ['255,160,190', '255,120,160', '255,210,225'])],
  night: ['City lights', (x, w, h) => bokeh(x, w, h, ['#16203d', '#05070f'], ['120,170,255', '255,210,120', '200,120,255'])],
};
function bokeh(x, w, h, bg, cols) {
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]); x.fillStyle = g; x.fillRect(0, 0, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const r = (.02 + rnd() * .07) * Math.min(w, h), cx = rnd() * w, cy = rnd() * h, c = cols[i % cols.length], a = .12 + rnd() * .35;
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${c},${a})`); rg.addColorStop(.75, `rgba(${c},${a * .8})`); rg.addColorStop(1, `rgba(${c},0)`);
    x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  }
}
// The guest's photo with the chosen background ('blur', a built-in key, or 'u:<index>' for the studio's own pictures)
async function withBackground(src, key, kind = 'photo', maskFrom) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const mask = await personMask(maskFrom || src, kind);
  const out = document.createElement('canvas'); out.width = w; out.height = h; const x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
  if (key === 'blur') { x.filter = `blur(${Math.round(Math.max(w, h) * .012)}px)`; x.drawImage(src, -w * .03, -h * .03, w * 1.06, h * 1.06); x.filter = 'none'; }
  else if (AIBG_BUILTIN[key]) AIBG_BUILTIN[key][1](x, w, h);
  else {
    const u = key.startsWith('u:') && (S.aiBg.list || [])[+key.slice(2)], img = u && await loadImg(u.url);
    if (img) { const k = Math.max(w / img.naturalWidth, h / img.naturalHeight); x.drawImage(img, (w - img.naturalWidth * k) / 2, (h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
    else { x.fillStyle = '#ddd'; x.fillRect(0, 0, w, h); }
  }
  // the person: photo cut out by the (softened, enlarged) mask
  const p = document.createElement('canvas'); p.width = w; p.height = h; const px = p.getContext('2d'); px.imageSmoothingQuality = 'high';
  px.filter = `blur(${Math.max(1, Math.round(Math.max(w, h) / 900))}px)`; px.drawImage(mask, 0, 0, w, h); px.filter = 'none';
  px.globalCompositeOperation = 'source-in'; px.drawImage(src, 0, 0, w, h);
  x.drawImage(p, 0, 0);
  return out;
}
/* ---------- Voice guide and theme music ---------- */
const VOICE_LINES = {
  welcome: ['When a guest starts', 'Selamat datang! Pilih design kegemaran anda.'],
  ready: ['Before each photo', 'Sedia ya, pandang kamera!'],
  smile: ['Just before the photo', 'Senyum!'],
  review: ['After the photos', 'Cantiknya! Edit gambar anda, kemudian tekan Print.'],
  printing: ['While printing', 'Gambar anda sedang dicetak.'],
  thanks: ['Thank-you screen', 'Terima kasih! Imbas kod QR untuk gambar anda.'],
  video: ['Before a video message', 'Sedia untuk rakam ucapan anda!'],
};
const voiceLine = k => ((S.voice && S.voice.lines && S.voice.lines[k]) ?? VOICE_LINES[k][1]) || '';
let voiceAudio = null, music = null, musicWanted = false;
function duck(on) { if (music) music.volume = Math.max(0, Math.min(1, (S.music.volume ?? .35) * (on ? .25 : 1))); }
// Speak a line: the studio's own recording if there is one, otherwise the device's text-to-speech (Malay where available)
function say(key) {
  const V = S.voice || {}; if (!V.on || ROLE !== 'booth') return Promise.resolve();
  const text = voiceLine(key), clip = V.clips && V.clips[key];
  if (!text && !clip) return Promise.resolve();
  hush(); duck(true);
  return new Promise(res => {
    const done = () => { duck(false); res(); };
    if (clip) { voiceAudio = new Audio(clip); voiceAudio.volume = V.volume ?? 1; voiceAudio.onended = done; voiceAudio.onerror = done; voiceAudio.play().catch(done); return; }
    if (NATIVE && NATIVE.speak) { try { NATIVE.speak(text, V.lang || 'ms-MY'); } catch (e) { } setTimeout(done, Math.min(6000, 600 + text.length * 70)); return; }
    if (!window.speechSynthesis) return done();
    const u = new SpeechSynthesisUtterance(text), voices = speechSynthesis.getVoices(), lang = (V.lang || 'ms-MY').toLowerCase();
    u.voice = voices.find(v => v.lang.toLowerCase() === lang) || voices.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || voices.find(v => /^id/i.test(v.lang)) || null;
    u.lang = u.voice ? u.voice.lang : (V.lang || 'ms-MY'); u.volume = V.volume ?? 1; u.rate = 1; u.onend = done; u.onerror = done;
    speechSynthesis.speak(u); setTimeout(done, 8000);
  });
}
function hush() { if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; } if (window.speechSynthesis) speechSynthesis.cancel(); if (NATIVE && NATIVE.stopSpeak) try { NATIVE.stopSpeak(); } catch (e) { } }
// Theme music: the track picked for this event's type (or for all types), looping quietly
// The tracks for this event's type, in the order they were added
function musicList() {
  const M = S.music || {}; if (!M.on) return [];
  const type = evType(ACTIVE); return (M.tracks || []).filter(t => !t.types || !t.types.length || t.types.includes(type));
}
let musicIdx = 0, musicDone = false;
// Repeat modes: 'one' = this song over and over, 'all' = every song in turn then from the start, 'once' = every song once, then quiet
function musicPlay() {
  musicWanted = true; if (ROLE !== 'booth') return;
  const list = musicList(); if (!list.length) { musicStop(); return; }
  if (musicDone) return;
  const mode = S.music.repeat || 'one';
  if (musicIdx >= list.length) musicIdx = 0;
  const t = list[musicIdx];
  if (!music || music._src !== t.url) {
    musicStop(); music = new Audio(t.url); music._src = t.url;
    music.onended = () => {
      if ((S.music.repeat || 'one') === 'one') return;
      musicIdx++;
      if (musicIdx >= musicList().length) { if (S.music.repeat === 'once') { musicDone = true; musicStop(); return; } musicIdx = 0; }
      if (music) music._src = '';
      musicPlay();
    };
  }
  music.loop = mode === 'one';
  duck(false); music.play().catch(() => {});
}
function musicPause() { if (music) music.pause(); }
function musicStop() { if (music) { music.pause(); music = null; } }
function fitText(x, text, maxW, size, font, weight = '') { do { x.font = `${weight} ${size}px ${font}`; size -= 2; } while (x.measureText(text).width > maxW && size > 10); }
function designSize(d) { const long = Math.min(4000, d.output_long || 3600), s = long / Math.max(d.w, d.h); return [Math.round(d.w * s), Math.round(d.h * s)]; }
// Compose the finished photo: guest shots in the areas, the PNG frame on top, optional small QR.
async function compose(d, shots, filter = 'none', opts = {}) {
  const [W, H] = designSize(d); const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';   // big camera photos shrink into the spots without losing detail
  x.fillStyle = d.builtin ? '#f4efe6' : '#ffffff'; x.fillRect(0, 0, W, H);
  const f = (FILTERS.find(z => z[0] === filter) || FILTERS[0]);
  const adjs = opts.adjust || [], fills = adjs.some(a => !noAdj(a)) ? await areaFills(d) : [];
  d.areas.forEach((a, i) => {
    const ax = Math.round(a.x * W), ay = Math.round(a.y * H), aw = Math.round(a.w * W), ah = Math.round(a.h * H);
    const shot = shots && shots[i];
    if (a.r) {   // tilted photo area: draw it turned around its centre
      x.save(); x.translate(ax + aw / 2, ay + ah / 2); x.rotate(a.r * Math.PI / 180);
      x.beginPath(); x.rect(-aw / 2, -ah / 2, aw, ah); x.clip();
      if (shot) { if (FILTER_OK) x.filter = f[2]; drawShot(x, shot, -aw / 2, -ah / 2, aw, ah, d.fit, adjs[i], fills[i]); }
      else if (opts.blank) { x.fillStyle = opts.blank; x.fillRect(-aw / 2, -ah / 2, aw, ah); }
      else { x.fillStyle = '#c9c9d1'; x.fillRect(-aw / 2, -ah / 2, aw, ah); x.fillStyle = '#8a8a96'; x.font = `bold ${Math.min(aw, ah) * .28}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), 0, 0); }
      x.restore(); return;
    }
    if (shot) { x.save(); x.beginPath(); x.rect(ax, ay, aw, ah); x.clip(); if (FILTER_OK) x.filter = f[2]; drawShot(x, shot, ax, ay, aw, ah, d.fit, adjs[i], fills[i]); x.restore(); if (!FILTER_OK) manualFilter(x, filter, ax, ay, aw, ah); }
    else if (opts.blank) { x.fillStyle = opts.blank; x.fillRect(ax, ay, aw, ah); }
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
  for (const st of opts.stickers || []) await drawSticker(x, st, W, H);
  if (opts.qrText) drawPrintQr(x, W, H, d, opts.qrText);
  return c;
}
// Small QR in a corner. Each QR square is a whole number of pixels so the printer prints it crisp and phones read it easily.
function drawPrintQr(x, W, H, d, text) {
  const target = Math.min(W, H) * (d.paper === 'strip' ? .16 : .09);
  const holder = document.createElement('div'), qrc = new QRCode(holder, { text, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.L });
  const mat = qrc._oQRCode, n = mat.getModuleCount(), px = Math.max(2, Math.round(target / n)), side = n * px;
  const pad = 2 * px, m = Math.round(Math.max(side * .2, Math.min(W, H) * .06));   // clear of the edge bleed
  const qx = S.printQr.pos === 'bl' ? m : W - side - m, qy = H - side - m;
  x.fillStyle = '#fff'; x.fillRect(qx - pad, qy - pad, side + pad * 2, side + pad * 2);
  x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mat.isDark(r, c)) x.fillRect(qx + c * px, qy + r * px, px, px);
}
// 4R sheet (4×6 in at 300 dpi) with the photo 4 times, each in a 2×3 in (2R) spot. A landscape photo is turned to fit.
function sheet4R(img) {
  if (!img) throw new Error('photo not found');
  const SW = 1200, SH = 1800, tw = SW / 2, th = SH / 2;
  const c = document.createElement('canvas'); c.width = SW; c.height = SH; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, SW, SH); x.imageSmoothingQuality = 'high';
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, turn = iw > ih;
  const w = turn ? ih : iw, h = turn ? iw : ih, k = Math.min(tw / w, th / h), dw = w * k, dh = h * k;
  for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) {
    x.save(); x.translate(q * tw + tw / 2, r * th + th / 2); if (turn) x.rotate(Math.PI / 2);
    if (turn) x.drawImage(img, -dh / 2, -dw / 2, dh, dw); else x.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    x.restore();
  }
  return c;
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
const allTypes = () => [...new Set([...DEFAULT_TYPES.filter(t => !(S.hiddenTypes || []).includes(t)), ...(S.types || []), ...TEMPLATES.map(t => t.event_type), ...EVENTS.map(evType)])];
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
const MODE_INFO = { photo: ['Photo', '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'], gif: ['GIF', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h3v3M14 9v6M17 9h-3M17 12h-2"/>'], boom: ['Boomerang', '<path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5"/><path d="M18 3v4h-4M6 21v-4h4"/>'], video: ['Video message', '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>'] };
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
  const liveWas = S.capture.canonLive !== false;
  try { await loadAll(); } catch (e) {}
  if (dslr && !B.session && liveWas !== (S.capture.canonLive !== false)) {
    try { sessionStorage.removeItem('pb.liveBroken'); } catch (e) {}
    dslrDisconnect().then(() => dslrConnect(false)).then(() => startCamera()).catch(() => startCamera());
  }
  $('#bTitle').textContent = ACTIVE ? ACTIVE.name : '';
  if (!B.session && (musicWanted || (S.music && S.music.on))) musicPlay();   // music only while nobody is using the booth
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
  $('#bStatus').innerHTML = (printerOnline() ? '<span class="dot"></span>Printer ready' : '<span class="dot warn"></span>Printer laptop not connected') + ` · ${dslr && dslr.running ? (dslr.noLive ? 'Canon DSLR ready · preview: tablet camera' : 'Canon DSLR · live view') : 'Tablet camera'}` + (UPLOADS.size ? ` · Uploading ${UPLOADS.size}…` : '');
}
$('#bModes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) startFlow(b.dataset.mode); });

/* ---------- Camera: tablet camera or Canon DSLR over USB ---------- */
const MAXRES = [4096, 2160];   // ask for the best the camera can do; the device gives its highest
let dslr = null; // { cam, canvas, running }
function stopCamera() { if (B.stream) B.stream.getTracks().forEach(t => t.stop()); B.stream = null; }
async function startCamera() {
  if (dslr && dslr.running && !dslr.noLive) { showDslrView(); return; }   // a connected Canon always wins
  stopCamera();
  if (S.capture.camera === 'dslr' && !(dslr && dslr.running)) {
    if (await dslrAutoConnect()) return;
    if (!dslrCrashed) toast('Canon DSLR not connected. Using the tablet camera. Open Staff → Camera to connect it.', 5000);
  }
  const pref = S.capture.camera === 'dslr' ? 'user' : (store.get('camDevice', '') || S.capture.camera || 'user');
  const [w, h] = MAXRES;
  const base = pref === 'user' || pref === 'environment' ? { facingMode: pref } : { deviceId: { exact: pref } };
  try {
    B.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 60 } } });
  } catch (e) {
    try { B.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
    catch (e2) { return showErr('Cannot open the camera', 'Allow camera access for this website in the browser settings, then tap Try again.', () => startCamera(), () => {}); }
  }
  const v = $('#live'); v.hidden = false; $('#dslrView').hidden = true; v.srcObject = B.stream; await v.play().catch(() => {});
  if (ROLE === 'booth') boothStatus();
}
function showDslrView() { stopCamera(); $('#live').hidden = true; $('#dslrView').hidden = false; if (ROLE === 'booth') boothStatus(); }
function dslrSupported() { return !!NATIVE || (!!navigator.usb && window.crossOriginIsolated); }
/* ---------- Photobooth Android app: the app talks to the Canon over USB itself ----------
   The app gives this page a small bridge (window.PBNative) plus two addresses it answers itself:
   /__canon/frame (newest live view picture) and /__canon/photo (a photo it just took).
   NativeCamera looks exactly like the camera library, so the rest of the booth works unchanged. */
const nativeWait = new Map(); let nativeId = 0;
window.__pbNativeDone = (id, r) => { const f = nativeWait.get(id); if (f) { nativeWait.delete(id); f(r || { ok: false, error: 'No answer from the app' }); } };
function nativeCall(op) { return new Promise(res => { const id = ++nativeId; nativeWait.set(id, res); NATIVE.call(op, id); }); }
class NativeCamera {
  constructor() { this.seq = 0; }
  static async showPicker() {}
  async connect() { const r = await nativeCall('connect'); if (!r.ok) throw new Error(r.error); this.model = r.model; }
  async disconnect() { await nativeCall('disconnect'); }
  async setConfigValue(key, on) { if (key !== 'viewfinder') return; const r = await nativeCall(on ? 'liveOn' : 'liveOff'); if (!r.ok) throw new Error(r.error); }
  async capturePreviewAsBlob() {
    const res = await fetch('/__canon/frame?after=' + this.seq, { cache: 'no-store' });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || 'No live view picture from the Canon');
    this.seq = +res.headers.get('X-Seq') || this.seq + 1;
    return res.blob();
  }
  async captureImageAsFile() {
    const r = await nativeCall('capture'); if (!r.ok) throw new Error(r.error);
    const res = await fetch('/__canon/photo?id=' + r.id, { cache: 'no-store' });
    if (!res.ok) throw new Error('The app could not hand over the photo.');
    return new File([await res.blob()], 'canon.jpg', { type: 'image/jpeg' });
  }
  async consumeEvents() { const r = await nativeCall('ping'); if (!r.ok) throw new Error(r.error); }
}
// The camera library can only hold ONE connection per page. After it crashes, only a page reload clears it.
let dslrLib = null, dslrBusy = null, dslrCrashed = false;
const isWindows = /Windows/i.test(navigator.userAgent), isAndroid = /Android/i.test(navigator.userAgent);
function dslrHelp(e) {
  const m = String(e && e.message || e);
  if (NATIVE) return m;   // the app already explains its problems in plain words
  const crash = (e && e.constructor && e.constructor.name === 'RuntimeError') || /memory access|out of bounds|unreachable|table index/i.test(m);
  if (crash) dslrCrashed = true;
  if (/No device selected|NotFoundError/i.test(m)) return 'No camera was chosen. Tap Connect again and pick the Canon in the list.';
  if (/I\/O|claim|busy|access denied|SecurityError|NetworkError/i.test(m)) return 'The tablet could not take control of the Canon\'s USB connection (' + m + '). Another app on the tablet is probably holding the Canon. When Android shows “Choose an app for the USB device”, do NOT pick any app: press Back to close it. Force stop (or disable) OurBooth, Photos and MTP Host in Settings → Apps, and clear any “Always” default there. Then unplug the cable, plug it back in, close the pop-up with Back, reload this page and tap Connect once.';
  const steps = isWindows
    ? 'On a Windows laptop the camera needs the WinUSB driver first: install Zadig (zadig.akeo.ie), choose the Canon EOS 750D, pick WinUSB, click Replace Driver. Then reload this page.'
    : 'When Android asks “Choose an app for the USB device”, press Back — do not pick Gallery, Photos, MTP Host or OurBooth. Force stop OurBooth and Photos in Settings → Apps. On the camera: Wi-Fi off, dial on P or M, power switch on ON (not video), lens on.';
  return (crash ? 'The camera connection crashed. ' : 'Could not connect to the camera (' + m + '). ') + 'Unplug the USB cable, switch the camera off and on, plug it back in, reload this page, then tap Connect once. ' + steps;
}
async function dslrConnect(pick) {
  if (!NATIVE && !navigator.usb) throw new Error('This browser cannot use USB devices. Use Chrome on an Android tablet (iPad is not supported).');
  if (!NATIVE && !window.crossOriginIsolated) throw new Error('Open the booth from the Cloudflare address of this website to use the DSLR.');
  if (dslrCrashed) throw new Error('Reload this page first (the camera connection crashed earlier), then tap Connect once.');
  if (dslr && dslr.running) { if (!dslr.noLive) showDslrView(); return dslr.cam; }   // already connected: never open a second connection
  if (dslrBusy) return dslrBusy;                       // a connect is already in progress
  dslrBusy = (async () => {
    CAMLOG.push('—'); await camLog(pick ? 'tapped Connect' : 'automatic reconnect');
    if (pick) { try { sessionStorage.removeItem('pb.liveBroken'); sessionStorage.setItem('pb.dslrReloads', '[]'); } catch (e) {} }   // a manual Connect always starts fresh
    try { if (!dslrLib) dslrLib = NATIVE ? { Camera: NativeCamera } : await import('../vendor/gphoto2/camera.js'); await camLog('camera library loaded'); }
    catch (e) { await camLog('camera library failed to load: ' + e.message); throw new Error('The camera part of the website did not load. Check the internet and reload the page. (' + e.message + ')'); }
    if (pick) {
      await camLog('opening Chrome camera list');
      try { await dslrLib.Camera.showPicker(); await camLog('camera chosen in the list'); }
      catch (e) {
        await camLog('camera list: ' + e.name + ': ' + e.message);
        if (/No device selected|NotFoundError/i.test(e.name + e.message)) throw new Error('No camera was chosen. If the Chrome list was EMPTY, the tablet cannot see the Canon at all: check the OTG adapter and cable (try another one), turn on "OTG" in the tablet settings if it has that option, and make sure the Canon is switched on. If the Canon was in the list, tap it, then tap Connect.');
        throw new Error(dslrHelp(e));
      }
    }
    handedOff = false;
    // Up to 3 tries. Before each one, free the camera from anything still holding it
    // (another tab of this site, or a USB handle left open by an earlier connection).
    let cam = null, lastErr = null, liveOk = false;
    await releaseOtherTabs();
    await camLog('connecting');
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) setDslrMsg(`Connecting to the Canon… (try ${attempt} of 3)`);
      await freeUsb();
      cam = new dslrLib.Camera();
      try {
        // Every step has a time limit: a Canon that never answers must not freeze the booth.
        await withTimeout(cam.connect(), NATIVE ? 120000 : 15000, HUNG); await camLog(`try ${attempt}: connected`); lastErr = null;
        // Canon live view over this kind of USB link is unreliable (it freezes the Canon), while Canon photos are reliable.
        // So the preview always comes from the tablet camera and the Canon only takes the photos.
        const wantLive = S.capture.canonLive !== false && !liveIsBroken();
        if (!wantLive) await camLog('Canon takes the photos; preview from the tablet camera');
        if (wantLive) {
          // Start live view FIRST, before changing any camera setting (a Canon busy with a setting answers "I/O problem").
          // It takes a moment to start (the mirror flips up), so wait, then give the first picture plenty of time.
          try { await withTimeout(cam.setConfigValue('viewfinder', true), 8000, HUNG); await camLog('live view switched on'); } catch (e) { if (e.message === HUNG || (e && e.constructor && e.constructor.name === 'RuntimeError')) throw e; await camLog('live view switch: ' + e.message); }
          await sleep(1500);
          for (let i = 1; i <= 6 && !liveOk; i++) {
            try { await withTimeout(cam.capturePreviewAsBlob(), 12000, HUNG); liveOk = true; await camLog(`live view OK (check ${i})`); }
            catch (e) { if (e.message === HUNG || (e && e.constructor && e.constructor.name === 'RuntimeError')) { markLiveBroken(); throw e; } await camLog(`live view check ${i}: ${e.message}`); if (/I\/O/i.test(e.message)) await usbClearHalts('live view check'); await sleep(1500); }
          }
        }
        // No camera settings are changed here: the Canon is used exactly as it is set on the camera.
        break;   // connected: with or without live view
      }
      catch (e) {
        await camLog(`try ${attempt}: ${(e && e.constructor && e.constructor.name) || 'Error'}: ${e && e.message}`);
        if (e.message === HUNG) {   // the library is now stuck waiting for the Canon: only a fresh page clears it
          dslrCrashed = true; B.recoverDslr = true; lastErr = e; cam = null;
          throw new Error('The Canon did not answer. The booth uses the tablet camera for now and reconnects the Canon by itself in a moment. If this keeps happening: switch the Canon off and on, and close the “Choose an app for the USB device” pop-up with Back.');
        }
        lastErr = e; try { await withTimeout(cam.disconnect(), 3000, 'x'); } catch (_) {} cam = null;
        if (e && e.constructor && e.constructor.name === 'RuntimeError') break;   // the library crashed: only a page reload helps
        await sleep(1500 * attempt);                                          // give the camera time to settle
      }
    }
    if (lastErr) throw new Error(dslrHelp(lastErr));
    dslr = { cam, canvas: $('#dslrView'), running: true, lastFrame: Date.now(), noLive: !liveOk };
    if (liveOk) { showDslrView(); await sleep(400); dslr.loopDone = dslrLoop(dslr); }
    else {
      // No live view from this Canon: guests see the tablet camera for framing, photos are still taken with the Canon.
      dslr.loopDone = dslrKeepAlive(dslr);
      setDslrMsg('Canon connected. Every photo is taken with the Canon; the preview uses the tablet camera (smooth and stable).');
      $('#dslrView').hidden = true; B.stream || (ROLE === 'booth' && startCamera());
    }
    // Remember the choice so the booth reconnects to the Canon next time
    if (S.capture.camera !== 'dslr') { S.capture.camera = 'dslr'; saveStudio().catch(() => {}); }
    try { if (sessionStorage.getItem('pb.dslrRecovering')) { sessionStorage.removeItem('pb.dslrRecovering'); setTimeout(() => toast('Canon reconnected'), 500); } } catch (e) {}
    return cam;
  })();
  try { return await dslrBusy; } finally { dslrBusy = null; }
}
const HUNG = 'The Canon did not answer in time';
// If the Canon's live view freezes the USB link, use 'photos only' until the Canon is switched off and on.
function liveIsBroken() { try { return sessionStorage.getItem('pb.liveBroken') === '1'; } catch (e) { return false; } }
function markLiveBroken() { try { sessionStorage.setItem('pb.liveBroken', '1'); } catch (e) {} camLog('live view marked unstable'); }
function setDslrMsg(t) { const a = $('#dslrInfo'), b = $('#bCamInfo'); if (a) a.textContent = t; if (b) b.textContent = t; }
// Close any USB handle Chrome still has open to the camera; optionally reset the link (same as replugging).
async function freeUsb() {
  let list = []; try { list = await navigator.usb.getDevices(); } catch (e) { return; }
  for (const d of list) { try { if (d.opened) await d.close(); } catch (e) {} }
}
/* ---------- Camera report: what happened on the last connect (to send to support) ---------- */
const CAMLOG = (() => { try { return JSON.parse(sessionStorage.getItem('pb.camlog') || '[]'); } catch (e) { return []; } })();
async function camLog(step) {
  let devs = '';
  if (NATIVE) devs = NATIVE.present() ? 'Canon on USB (app)' : 'no Canon on USB (app)';
  else try { devs = (await navigator.usb.getDevices()).map(d => `${d.manufacturerName || '?'} ${d.productName || '?'} [${(d.vendorId || 0).toString(16)}:${(d.productId || 0).toString(16)}] ${d.opened ? 'open' : 'closed'}`).join('; ') || 'none'; } catch (e) { devs = 'n/a'; }
  CAMLOG.push(`${new Date().toLocaleTimeString('en-GB')} ${step} | USB devices: ${devs}`);
  try { sessionStorage.setItem('pb.camlog', JSON.stringify(CAMLOG.slice(-40))); } catch (e) {}
}
function camReport() {
  return ['Photobooth camera report', `Page: ${ROLE || '-'} · Camera setting: ${S.capture.camera} · Connected now: ${!!(dslr && dslr.running)}`, `Browser: ${navigator.userAgent}`, `Isolated: ${window.crossOriginIsolated} · WebUSB: ${!!navigator.usb} · Other tab had camera: ${otherTabHadCamera}`, ...(CAMLOG.length ? CAMLOG : ['(nothing recorded yet: tap Connect camera first, then copy the report)']),
    `Live view: ${LV.frames} frames in ${LV.since ? Math.round((Date.now() - LV.since) / 1000) : 0} s · last frame ${dslr && dslr.lastFrame ? ((Date.now() - dslr.lastFrame) / 1000).toFixed(1) + ' s ago' : '-'} · last ${LV.lastMs} ms · slowest ${LV.slowest} ms · errors ${LV.errors}${LV.lastErr ? ' (' + LV.lastErr + ')' : ''} · event reads ${LV.events}`,
    `Canon photos: ${LV.captures.join(' / ') || 'none yet'}`,
    ...(NATIVE ? [`App ${NATIVE.version()} · ${NATIVE.status()}`, 'App camera log:', NATIVE.log() || '(empty)'] : [])].join('\n');
}
// Only one tab can use the camera. Ask other open tabs of this site (on this tablet) to let go of it first.
const camChan = 'BroadcastChannel' in window ? new BroadcastChannel('pb-camera') : null;
let otherTabHadCamera = false, handedOff = false;   // handedOff: another tab took the camera, so this tab stops reconnecting
if (camChan) camChan.onmessage = async e => {
  if (e.data === 'release') { handedOff = true; if (dslr) { await dslrDisconnect(); camChan.postMessage('released'); if (ROLE === 'booth') { dslrCrashed = false; startCamera(); } toast('The Canon is being used in another tab of this website.', 6000); } }
  if (e.data === 'released') otherTabHadCamera = true;
};
async function releaseOtherTabs() { if (!camChan) return; otherTabHadCamera = false; camChan.postMessage('release'); await sleep(700); if (otherTabHadCamera) await sleep(1500); }
// Stop the live view and wait for it to finish before closing, so the library never uses a closed connection.
async function dslrDisconnect() { const d = dslr; dslr = null; if (!d) return; d.running = false; try { await d.loopDone; } catch (e) {} try { await d.cam.disconnect(); } catch (e) {} }
async function dslrAutoConnect() {
  try {
    if (!dslrSupported() || dslrCrashed || handedOff) return false; if (!(await canonPresent())) return false;
    let recovering = false; try { recovering = !!sessionStorage.getItem('pb.dslrRecovering'); } catch (e) {}
    if (recovering) { await camLog('waiting 4 s so the Canon can settle'); await sleep(4000); }
    await dslrConnect(false); return true;
  } catch (e) { return false; }
}
// After a failed USB transfer the camera's USB channel can stay blocked ("stalled"), and every later
// request then waits forever. Clear the blocked channels of the Canon's photo interface so it answers again.
async function usbClearHalts(why) {
  let n = 0;
  try {
    for (const d of await navigator.usb.getDevices()) {
      if (!d.opened || !d.configuration) continue;
      for (const itf of d.configuration.interfaces) {
        const alt = itf.alternate; if (!alt || alt.interfaceClass !== 6) continue;
        for (const ep of alt.endpoints) if (ep.type === 'bulk') { try { await d.clearHalt(ep.direction, ep.endpointNumber); n++; } catch (e) {} }
      }
    }
  } catch (e) {}
  if (n) camLog(`cleared ${n} blocked USB channel${n > 1 ? 's' : ''}${why ? ' (' + why + ')' : ''}`);
  return n;
}
// Switch the Canon's live view (back) on. Used after every photo and after an I/O problem.
async function liveViewOn(d) {
  try { await withTimeout(d.cam.setConfigValue('viewfinder', true), 8000, 'The Canon live view stopped answering'); }
  catch (e) { if (/stopped answering/.test(e.message)) throw e; }
}
const LV = { frames: 0, since: 0, slowest: 0, lastMs: 0, errors: 0, lastErr: '', events: 0, captures: [] };   // live view stats for the camera report
async function dslrLoop(d) {
  const x = d.canvas.getContext('2d'); let fails = 0, lastEvents = Date.now();
  Object.assign(LV, { frames: 0, since: Date.now(), slowest: 0, errors: 0, lastErr: '', events: 0 });
  while (d.running && dslr === d) {
    if (d.pause) { await sleep(60); continue; }
    try {
      const t0 = performance.now();
      const blob = await withTimeout(d.cam.capturePreviewAsBlob(), 15000, 'The Canon live view stopped answering');
      const bmp = await createImageBitmap(blob); fails = 0; d.lastFrame = Date.now();
      LV.frames++; LV.lastMs = Math.round(performance.now() - t0); LV.slowest = Math.max(LV.slowest, LV.lastMs);
      if (d.canvas.width !== bmp.width) { d.canvas.width = bmp.width; d.canvas.height = bmp.height; }
      x.drawImage(bmp, 0, 0); bmp.close && bmp.close();
      if (d.recTrack) { d.recTrack.requestFrame(); continue; }   // recording a video message: next picture straight away
      // Full speed while guests look at the camera; a gentle keep-alive while the start screen covers it
      await sleep(document.hidden ? 600 : (ROLE === 'booth' && $('#b-attract').classList.contains('on')) ? 400 : 15);   // as fast as the Canon allows while guests look at it
    } catch (e) {
      LV.errors++; LV.lastErr = e.message; camLog('live view problem: ' + e.message);
      if (/stopped answering|did not answer/.test(e.message)) { markLiveBroken(); if (dslr === d) dslrFallback(); return; }   // the library is stuck: recover (photos only next time)
      const msg = dslrHelp(e);
      if (dslrCrashed || ++fails > (NATIVE ? 40 : 12)) { markLiveBroken(); if (dslr === d) dslrFallback(msg); return; }   // camera lost: keep the booth working
      if (/I\/O/i.test(e.message)) await usbClearHalts('live view');
      await sleep(1500);   // the Canon is busy: give it a moment
      try { await liveViewOn(d); } catch (e2) { markLiveBroken(); if (dslr === d) dslrFallback(); return; }  // then switch its live view back on before asking again
    }
  }
}
/* ---------- Keeping the Canon working during an event ----------
   The camera library can get stuck if the Canon stops answering (most often it cannot focus).
   Then: finish the session with the tablet camera, and once the guest is done, reload the page,
   which reconnects the Canon automatically (at most 3 times in 5 minutes). */
const dslrHealthy = () => !!(dslr && dslr.running && (dslr.noLive || Date.now() - (dslr.lastFrame || 0) < 25000));
let dslrOld = null;   // the last Canon connection, closed properly before a reload
function dslrFallback(reason) {
  const d = dslr; if (!d) return Promise.resolve();
  dslrOld = d.cam;
  camLog('switched to the tablet camera' + (reason ? ': ' + String(reason).slice(0, 80) : ''));
  dslr = null; d.running = false; dslrCrashed = true; B.recoverDslr = true;
  toast('The Canon stopped responding. This session uses the tablet camera; the Canon reconnects by itself after it.' + (reason ? ' ' + reason : ''), 9000);
  return ROLE === 'booth' ? startCamera() : Promise.resolve();
}
let gaveUpToast = 0;
async function canonPresent() { if (NATIVE) { try { return !!NATIVE.present(); } catch (e) { return false; } } try { return !!(navigator.usb && (await navigator.usb.getDevices()).length); } catch (e) { return false; } }
async function dslrRecover(force) {
  if (!(await canonPresent())) return;                 // camera off or unplugged: wait until it comes back
  let tries = []; try { tries = JSON.parse(sessionStorage.getItem('pb.dslrReloads') || '[]').filter(t => Date.now() - t < 5 * 60e3); } catch (e) {}
  if (tries.length >= 3) {                              // don't loop: try again a few minutes later
    if (Date.now() - gaveUpToast > 120e3) { gaveUpToast = Date.now(); toast('The Canon keeps stopping. Switch the Canon OFF and ON again — it reconnects by itself. Using the tablet camera until then.', 12000); }
    return;
  }
  if (UPLOADS.size || (!force && (B.session || !$('#b-attract').classList.contains('on')))) return;   // only when the booth is idle
  tries.push(Date.now()); try { sessionStorage.setItem('pb.dslrReloads', JSON.stringify(tries)); sessionStorage.setItem('pb.dslrRecovering', '1'); } catch (e) {}
  await camLog('reloading the page to reconnect the Canon');
  busy('Reconnecting the Canon…');
  if (dslrOld && !B.session) { try { await withTimeout(dslrOld.disconnect(), 3000, 'x'); } catch (e) {} } dslrOld = null;
  await freeUsb(); setTimeout(() => location.reload(), 600);
}
/* Keep the Canon connected without anyone touching it:
   - every few seconds while the booth is idle, reconnect it if it dropped
   - when the camera is switched back on / plugged in, reconnect it
   - when it is switched off / unplugged, carry on with the tablet camera meanwhile */
let ensuring = false;
async function dslrEnsure() {
  if (ensuring || handedOff || ROLE !== 'booth' || S.capture.camera !== 'dslr' || B.session || dslrBusy || !dslrSupported()) return;
  if (dslr && dslr.running) { if (!dslr.pause && !dslrHealthy()) dslrFallback(); return; }
  ensuring = true;
  try {
    if (!(await canonPresent())) return;
    if (dslrCrashed || B.recoverDslr) return dslrRecover();   // an old connection is stuck: a fresh page clears it
    await dslrConnect(false); toast('Canon reconnected'); boothStatus();
  } catch (e) { /* camera still waking up: try again next round */ }
  finally { ensuring = false; }
}
setInterval(dslrEnsure, 4000);
// Canon switched on / plugged in: always a fresh start, even after the reconnect limit was reached
function onCanonPlugged() { try { sessionStorage.setItem('pb.dslrReloads', '[]'); sessionStorage.removeItem('pb.liveBroken'); } catch (e) {} camLog('Canon plugged in / switched on'); setTimeout(dslrEnsure, 2500); }
function onCanonUnplugged() { if (dslr) dslrFallback('The Canon was switched off or unplugged — it reconnects by itself when it is back.'); }
if (navigator.usb) { navigator.usb.addEventListener('connect', onCanonPlugged); navigator.usb.addEventListener('disconnect', onCanonUnplugged); }
window.addEventListener('pbcanon', e => (e.detail === 'connect' ? onCanonPlugged : onCanonUnplugged)());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(dslrEnsure, 800); });
// Without live view, talk to the Canon every 15 s so it stays awake and we notice if it drops.
async function dslrKeepAlive(d) {
  let fails = 0;
  while (d.running && dslr === d) {
    await sleep(20000); if (!d.running || dslr !== d || d.pause) continue;
    try { await withTimeout(d.cam.consumeEvents(), 8000, 'no answer'); fails = 0; d.lastFrame = Date.now(); }
    catch (e) { if (++fails >= 2 && dslr === d) { dslrFallback(); return; } }
  }
}
// One frame from the live preview, at most `max` px on the long edge.
function grabFrame(max = 4000) {
  const canonView = dslr && !dslr.noLive, src = canonView ? dslr.canvas : $('#live');
  const w = src.videoWidth || src.width, h = src.videoHeight || src.height;
  if (!w || !h) throw new Error('The camera is not ready yet.');
  const s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const x = c.getContext('2d');
  if (!canonView && S.capture.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0, c.width, c.height); return c;
}
function withTimeout(promise, ms, msg) { let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); }
const DSLR_SHOT_HELP = 'The Canon did not take the photo in time. Usually it could not focus: add more light, or focus once and switch the lens to MF. Also set the camera to JPEG (not RAW) and make sure an SD card is in.';
// Canon photo (high resolution). Never waits more than 20 s: if the Canon hangs, the live view frame is used instead.
async function dslrFullPhoto(d) {
  const t0 = performance.now(); let f;
  B.lastOriginal = null;
  try { f = await withTimeout(d.cam.captureImageAsFile(), NATIVE ? 45000 : 20000, DSLR_SHOT_HELP); B.lastOriginal = f; }
  catch (e) { if (/I\/O/i.test(e.message)) await usbClearHalts('photo'); LV.captures.push(`photo FAILED after ${((performance.now() - t0) / 1000).toFixed(1)} s: ${e.message.slice(0, 60)}`); camLog('Canon photo failed: ' + e.message.slice(0, 80)); throw e; }
  LV.captures.push(`photo ${(f.size / 1048576).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s`); if (LV.captures.length > 10) LV.captures.shift();
  let bmp;
  try { bmp = await createImageBitmap(f, { resizeWidth: 4000, resizeQuality: 'high' }); }
  catch (e) { throw new Error('The Canon sent a file the browser cannot read. Set Image quality on the camera to a JPEG setting (not RAW).'); }
  const c = scaled(bmp, 4000); bmp.close && bmp.close(); return c;
}
async function capturePhoto() {
  if (dslr && !dslrHealthy()) { await dslrFallback(); await sleep(700); }
  const d = dslr;
  if (d) {
    d.pause = true; $('#shotInfo').textContent = 'Hold still…'; const slowMsg = setTimeout(() => { if (B.session) $('#shotInfo').textContent = 'Getting the photo from the Canon…'; }, 2500);
    try { return await dslrFullPhoto(d); }
    catch (e) {
      const live = grabFrame();                       // last Canon live view frame, taken at the right moment
      if (/did not take the photo in time/.test(e.message)) await dslrFallback(e.message);   // the library is stuck now
      else toast(e.message, 9000);
      return live;
    }
    finally {
      clearTimeout(slowMsg);
      // After a photo the Canon has turned its live view off: give it a moment, switch it back on, THEN resume
      if (!d.noLive && dslr === d) { await sleep(700); try { await liveViewOn(d); } catch (e) {} }
      d.pause = false;
    }
  }
  return grabFrame();
}
function liveStream() { return dslr && !dslr.noLive ? dslr.canvas.captureStream(24) : B.stream; }
// Video messages: with the Canon, each live view picture is recorded exactly once, at the moment it arrives
// (no repeated or skipped pictures, and it stays in step with the sound). The app is asked for full speed.
function recVideoStream(mic) {
  let vt;
  if (dslr && !dslr.noLive) {
    vt = dslr.canvas.captureStream(0).getVideoTracks()[0]; dslr.recTrack = vt;
    if (NATIVE) nativeCall('liveFast').catch(() => {});
  } else vt = B.stream.getVideoTracks()[0];
  return new MediaStream([vt, ...(mic ? mic.getAudioTracks() : [])]);
}
function endRecVideo() {
  if (dslr && dslr.recTrack) { dslr.recTrack.stop(); dslr.recTrack = null; if (NATIVE) nativeCall('liveNormal').catch(() => {}); }
}

/* ---------- Session flow ---------- */
function goHome() {
  if (S.music && S.music.on) musicPlay();   // the guest is done: music back on
  B.session = null; clearInterval(B.reviewT); clearInterval(B.doneT);
  $('#b-count').textContent = ''; $('#busy').hidden = true; $('#bErr').hidden = true;
  bscreen('b-attract');
  if (B.recoverDslr) dslrRecover();
  if (B.pendingReload) { B.pendingReload = false; boothLoad(); }
}
function startFlow(mode) {
  ac(); keepAwake(); musicPause(); say(mode === 'video' ? 'video' : 'welcome');
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
// onAt runs when `at` seconds are left (used to start recording the boomerang); minSecs makes the countdown at least that long.
async function countdown(me, label, onAt, at = 1, minSecs = 0) {
  const el = $('#b-count'); $('#shotInfo').textContent = label;
  for (let n = Math.max(1, S.capture.countdown || 3, minSecs); n > 0; n--) { if (B.session !== me) return false; showCount(el, n); cdSound(n === 1 ? 'last' : 'tick'); if (n === at && onAt) onAt(); await sleep(1000); }
  if (B.session !== me) return false;
  showSmile(el); say('smile'); await sleep(250); return true;
}
/* ---------- The "Smile!" word: text, font, colour, outline, emoji and a pattern, all set in Capture & media ---------- */
const SMILE_FONTS = ['Geist', 'Playfair Display', 'Pacifico', 'Lobster', 'Bebas Neue', 'Dancing Script', 'Fredoka', 'Bungee', 'Great Vibes', 'Baloo 2', 'Righteous', 'Permanent Marker'];
const SMILE_EMOJI = ['', '📸', '😄', '✨', '💖', '🎉', '🌸', '👑', '🥳', '💍', '🌙', '⭐'];
const SMILE_DECO = { none: ['None', []], sparkles: ['Sparkles', ['✨', '⭐']], hearts: ['Hearts', ['💖', '💕', '❤️']], stars: ['Stars', ['⭐', '🌟']], confetti: ['Confetti', ['🎉', '🎊', '✨']], flowers: ['Flowers', ['🌸', '🌼', '🌺']] };
function smileStyle(el, m, sizeCss) {
  el.style.fontFamily = `"${m.font || 'Geist'}", Geist, system-ui, sans-serif`;
  el.style.color = m.color || '#fff';
  el.style.webkitTextStroke = m.stroke ? `${m.stroke / 100}em ${m.strokeColor || '#000'}` : '';
  el.style.paintOrder = 'stroke fill';
  if (sizeCss) el.style.fontSize = sizeCss;
}
function showCount(el, n) {
  el.textContent = n; styleCount(el);
}
// root: where to draw (the booth countdown or the admin preview); vmin: how big the screen is, in px of 1vh/1vw
function showSmile(el, m = S.smile || {}, preview) {
  const emo = m.emoji || '', text = (m.text || 'Smile!').trim() || 'Smile!';
  const chars = [...text].length + (emo ? 4 : 0), k = (m.size || 100) / 100;
  el.removeAttribute('style');
  el.innerHTML = `<span class="smilew">${emo ? `<span class="smemo">${emo}</span>` : ''}<span class="smtxt">${esc(text)}</span>${emo ? `<span class="smemo">${emo}</span>` : ''}</span>`;
  const t = el.querySelector('.smilew');
  smileStyle(t, m, preview ? `${Math.min(60, 520 / Math.max(4, chars)) * k}px` : `min(${30 * k}vh, ${Math.round(150 / Math.max(4, chars) * k)}vw)`);
  t.querySelectorAll('.smemo').forEach(e => { e.style.webkitTextStroke = '0'; });
  const deco = (SMILE_DECO[m.deco] || SMILE_DECO.none)[1];
  for (let i = 0; i < (deco.length ? 14 : 0); i++) {
    const d = document.createElement('span'); d.className = 'smdeco'; d.textContent = deco[i % deco.length];
    const ang = (i / 14) * Math.PI * 2, r = 38 + (i % 3) * 8;
    d.style.left = `${50 + Math.cos(ang) * r}%`; d.style.top = `${50 + Math.sin(ang) * r * .8}%`;
    d.style.fontSize = `${(preview ? 18 : 6) + (i % 3) * (preview ? 6 : 2)}${preview ? 'px' : 'vmin'}`; d.style.animationDelay = `${(i % 5) * 60}ms`;
    el.appendChild(d);
  }
}
/* ---------- Countdown screen: frame over the camera, sounds and the look of the numbers (Capture & media) ---------- */
const CD_FRAMES = { none: 'None', white: 'White', gold: 'Gold', film: 'Film strip', glow: 'Rounded glow', image: 'Your PNG' };
const CD_SOUNDS = { beep: 'Beep', soft: 'Soft tick', bell: 'Bell', pop: 'Pop', drum: 'Drum', none: 'None' };
const CD_SHUTTERS = { click: 'Camera click', soft: 'Soft click', retro: 'Retro', none: 'None' };
const CD_ANIMS = { pop: 'Pop', zoom: 'Zoom', fade: 'Fade', spin: 'Spin', none: 'None' };
const cdOpt = () => ({ frame: 'none', frameSrc: '', prevBorder: '#ffffff', tick: 'beep', tickSrc: '', last: 'beep', lastSrc: '', shutter: 'click', shutterSrc: '', font: 'Geist', color: '#ffffff', stroke: 0, strokeColor: '#000000', size: 100, anim: 'pop', volume: 1, ...(S.countdown || {}) });
// Painted sounds (no files needed). last = the final second, a little higher.
function cdTone(kind, last, vol) {
  try {
    const a = ac(), t = a.currentTime, out = a.createGain(); out.gain.value = vol; out.connect(a.destination);
    const osc = (type, f, d, g0, f1) => { const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(g).connect(out); o.start(t); o.stop(t + d); };
    const noise = (d, g0, hp) => { const n = Math.round(a.sampleRate * d), b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); const s = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; g.gain.value = g0; s.buffer = b; s.connect(f).connect(g).connect(out); s.start(t); };
    const k = last ? 1.5 : 1;
    if (kind === 'beep') osc('sine', 880 * k, .12, .25);
    else if (kind === 'soft') osc('sine', 620 * k, .07, .18);
    else if (kind === 'bell') { osc('sine', 1046 * k, .9, .22); osc('sine', 2093 * k, .5, .08); }
    else if (kind === 'pop') osc('triangle', 900 * k, .09, .35, 180);
    else if (kind === 'drum') { osc('sine', 140 * (last ? 1.3 : 1), .25, .6, 50); noise(.08, .25, 1500); }
    else if (kind === 'click') noise(.18, .5, 200);
    else if (kind === 'softclick') noise(.06, .3, 2500);
    else if (kind === 'retro') { noise(.05, .45, 800); setTimeout(() => cdTone('softclick', false, vol), 110); }
  } catch (e) { }
}
const cdClips = {};
function cdPlay(src, vol) {   // the studio's own sound file
  try { let a = cdClips[src]; if (!a) { a = cdClips[src] = new Audio(src); a.preload = 'auto'; } const c = a.cloneNode(); c.volume = Math.min(1, vol); c.play().catch(() => {}); } catch (e) { }
}
function cdSound(which) {   // 'tick' | 'last' | 'shutter'
  const o = cdOpt(), vol = o.volume ?? 1, kind = o[which], src = o[which + 'Src'];
  if (kind === 'none') return;
  if (kind === 'file' && src) return cdPlay(src, vol);
  if (which === 'shutter') return cdTone(kind === 'soft' ? 'softclick' : kind, false, vol);
  cdTone(kind, which === 'last', vol);
}
// Frame over the camera picture while counting down (and the border of the photo shown between shots)
function paintCdFrame(el, o = cdOpt()) {
  el.className = 'cdframe cdf-' + (o.frame || 'none');
  el.innerHTML = o.frame === 'image' && o.frameSrc ? `<img src="${esc(o.frameSrc)}" alt="">` : '';
}
// The countdown number with its font, colour, outline, size and movement
function styleCount(el, o = cdOpt(), preview) {
  el.removeAttribute('style'); el.classList.remove('cda-pop', 'cda-zoom', 'cda-fade', 'cda-spin');
  el.style.fontFamily = `"${o.font || 'Geist'}", Geist, system-ui, sans-serif`;
  el.style.color = o.color || '#fff';
  el.style.webkitTextStroke = o.stroke ? `${o.stroke / 100}em ${o.strokeColor || '#000'}` : '';
  el.style.paintOrder = 'stroke fill';
  const k = (o.size || 100) / 100; el.style.fontSize = preview ? `${Math.round(110 * k)}px` : `min(${Math.round(36 * k)}vw, ${Math.round(36 * k)}vh)`;
  if (o.anim && o.anim !== 'none') { void el.offsetWidth; el.classList.add('cda-' + o.anim); }
}
function flash() { cdSound('shutter'); const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
async function startSession(design) {
  clearInterval(B.reviewT); clearInterval(B.doneT);
  const me = B.session = { mode: B.mode, design, shots: [], filter: 'none', copies: 1, saved: null, printed: false, jobId: null };
  if (dslr && !dslrHealthy()) { await dslrFallback(); await sleep(800); }
  paintCdFrame($('#cdFrame')); $('#shotPrev').style.borderColor = cdOpt().prevBorder || '#fff';
  bscreen('b-shoot');
  try {
    if (me.mode === 'photo') {
      const n = design.areas.length;
      me.bursts = [];
      const wantBoom = S.capture.photoGif !== false && n > 1, boomSec = boomSeconds();
      for (let i = 0; i < n; i++) {
        // For the strip boomerang: record the last few seconds of the countdown before each photo
        let burst = null;
        const label = `Photo ${i + 1} of ${n}` + (wantBoom ? ' · keep moving for the boomerang!' : '');
        say('ready');
        if (!(await countdown(me, label, wantBoom ? () => { burst = recordBurst(me, boomSec); } : null, boomSec, wantBoom ? boomSec : 0))) return;
        if (burst) burst.stop();
        B.lastOriginal = null; flash(); const c = await capturePhoto(); me.shots.push(c); (me.originals = me.originals || []).push(B.lastOriginal);
        me.bursts.push(burst ? burst.frames : []);
        if (B.session !== me) return;
        $('#b-count').textContent = '';
        if (i < n - 1) {   // pause between photos, showing the one just taken
          const g = +S.capture.gap, gap = (Number.isFinite(g) ? Math.max(0, g) : 1) * 1000;
          if (gap) { $('#shotPrev').src = scaled(c, 900).toDataURL('image/jpeg', .8); $('#shotPrev').hidden = false; $('#shotInfo').textContent = `Next photo in a moment…`; await sleep(gap); $('#shotPrev').hidden = true; }
          if (B.session !== me) return;
        }
      }
    } else if (me.mode === 'gif') {
      if (!(await countdown(me, 'GIF · get ready to move!'))) return;
      $('#b-count').textContent = ''; $('#shotInfo').innerHTML = '<span class="recdot"></span>Recording GIF';
      for (let i = 0; i < 10; i++) { if (B.session !== me) return; me.shots.push(grabFrame(800)); /* GIFs get very slow to build above ~800 px */ beep(1500, .03); await sleep(200); }
    } else if (me.mode === 'boom') {
      if (!(await countdown(me, 'Boomerang · keep moving!'))) return;
      $('#b-count').textContent = ''; $('#shotInfo').innerHTML = '<span class="recdot"></span>Recording boomerang';
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) { if (B.session !== me) return; me.shots.push(grabFrame(1920)); await sleep(70); }
    } else if (me.mode === 'video') {
      const VB = S.videoBook || {}, sec = Math.max(5, Math.min(60, +VB.sec || 20));
      let mic = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }); }
      catch (e) { toast('The microphone is not allowed, so this video has no sound. Allow the microphone for the app or website.', 7000); }
      try {
        if (!(await countdown(me, VB.prompt || 'Say something nice! 🎥'))) return;
        $('#b-count').textContent = ''; $('#recStop').hidden = false; hush(); musicPause();
        me.blob = await recordStream(recVideoStream(mic), sec * 1000, me, s => { $('#shotInfo').innerHTML = `<span class="recdot"></span>Recording · ${s}s left`; $('#b-count').textContent = s; }, 4e6);
      } finally { $('#recStop').hidden = true; endRecVideo(); if (mic) mic.getTracks().forEach(t => t.stop()); }
      if (B.session !== me) return;
      me.poster = grabFrame(1920);
    }
  } catch (e) { return showErr('Camera problem', e.message, () => startSession(design), goHome); }
  $('#b-count').textContent = '';
  await openReview();
}
function recMime() { const c = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']; return c.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || ''; }
function recordStream(stream, ms, me, tick, bitrate = 12e6) {
  return new Promise((res, rej) => {
    if (!window.MediaRecorder) return rej(new Error('This browser cannot record video.'));
    const mime = recMime(), chunks = [];
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128e3 } : { videoBitsPerSecond: bitrate });
    me.stopRec = () => { if (r.state === 'recording') r.stop(); };
    r.ondataavailable = e => e.data.size && chunks.push(e.data);
    let t = 0;
    r.onstop = () => { clearInterval(t); res(new Blob(chunks, { type: (r.mimeType || mime || 'video/webm').split(';')[0] })); };
    r.start(250);
    let left = Math.round(ms / 1000); tick && tick(left);
    t = setInterval(() => { left--; if (B.session !== me || left <= 0) { clearInterval(t); if (r.state !== 'inactive') r.stop(); } else tick && tick(left); }, 1000);
  });
}
// Boomerang: play the frames forward and back twice, recorded to a video file.
// Frames can be canvases or JPEG blobs (blobs are decoded one step ahead while playing).
async function makeBoomerang(frames, fps = 24, loops = 2) {
  const get = f => f instanceof Blob ? createImageBitmap(f) : Promise.resolve(f);
  const first = await get(frames[0]);
  const c = document.createElement('canvas'); c.width = first.width; c.height = first.height; const x = c.getContext('2d');
  x.drawImage(first, 0, 0);
  const idx = []; for (let k = 0; k < loops; k++) { for (let i = 0; i < frames.length; i++) idx.push(i); for (let i = frames.length - 2; i > 0; i--) idx.push(i); }
  const stream = c.captureStream(30), mime = recMime(), chunks = [];
  const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: frames.length > 30 ? 5e6 : 10e6 } : {});
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => r.onstop = res);
  r.start(250);
  let next = get(frames[idx[0]]);
  for (let j = 0; j < idx.length; j++) {
    const t = performance.now(), img = await next;
    next = j + 1 < idx.length ? get(frames[idx[j + 1]]) : null;
    x.drawImage(img, 0, 0); if (img.close && frames[idx[j]] instanceof Blob) img.close();
    await sleep(Math.max(0, 1000 / fps - (performance.now() - t)));
  }
  await sleep(120); r.stop(); await done;
  return new Blob(chunks, { type: (r.mimeType || mime || 'video/webm').split(';')[0] });
}
async function makeGif(frames, delay = 120, bounce = true) {   // delay: one number, or one per frame
  const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc.esm.js');
  const gif = GIFEncoder(), w = frames[0].width, h = frames[0].height;
  const seq = bounce ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
  for (const f of seq) {
    const data = f.getContext('2d').getImageData(0, 0, w, h).data;
    const pal = quantize(data, 256), idx = applyPalette(data, pal);
    gif.writeFrame(idx, w, h, { palette: pal, delay: Array.isArray(delay) ? delay[seq.indexOf(f)] : delay }); await sleep(0);
  }
  gif.finish(); return new Blob([gif.bytes()], { type: 'image/gif' });
}
// A GIF of the strip the guest chose: same frame, background and photo spots.
// The photos appear one by one in their own spot, then the finished strip stays on screen before it loops.
// Short burst of preview frames (for the strip boomerang). Keeps grabbing until stop() is called.
const boomSeconds = () => Math.max(1, Math.min(5, +S.capture.boomSec || 5));
// Frames are kept as small JPEGs (about 10 a second) so a 5-second boomerang for every photo fits in the tablet's memory.
function recordBurst(me, secs = 1) {
  const frames = [], max = Math.round(secs * 10) + 4; let on = true;
  (async () => {
    while (on && B.session === me && frames.length < max) {
      const t = performance.now();
      try { const c = grabFrame(640); frames.push(new Promise(res => c.toBlob(res, 'image/jpeg', .85))); } catch (e) {}
      await sleep(Math.max(10, 100 - (performance.now() - t)));
    }
  })();
  return { frames, stop() { on = false; } };
}
// Strip boomerang: the chosen strip (same frame and background) with every photo moving at the same time,
// forward and back. Shared by QR/link, never printed. Video where the browser can record, otherwise an animated GIF.
async function stripBoomerang(design, bursts, filter, name, date, adjust, stickers, beauty, bgKey) {
  const lists = await Promise.all(bursts.map(b => Promise.all(b).then(l => l.filter(Boolean))));
  const k = Math.min(...lists.map(l => l.length)); if (k < 4) return null;
  const d = { ...design, output_long: 1280 }, frames = [];
  for (let i = 0; i < k; i++) {   // one strip picture per moment, kept as a JPEG
    let imgs = await Promise.all(lists.map(l => createImageBitmap(l[i])));
    if (beauty) { const bm = imgs; imgs = bm.map(b => beautify(b, beauty, 640)); bm.forEach(b => b.close && b.close()); }
    if (bgKey) { const out = []; for (const b of imgs) { try { out.push(await withBackground(b, bgKey, 'fast')); } catch (e) { out.push(b); } } imgs = out; }
    const c = await compose(d, imgs, filter, { name, date, adjust, stickers }); imgs.forEach(b => b.close && b.close());
    frames.push(await new Promise(res => c.toBlob(res, 'image/jpeg', .88))); await sleep(0);
  }
  // Recorded at ~10 frames a second, played a little faster (15) like a real boomerang; long ones loop once
  if (window.MediaRecorder && recMime()) return makeBoomerang(frames, 15, k > 30 ? 1 : 2);
  const step = Math.max(1, Math.round(k / 15)), pick = frames.filter((_, i) => i % step === 0);
  const cv = await Promise.all(pick.map(async b => { const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0); bm.close && bm.close(); return scaled(c, 800); }));
  return makeGif(cv, 90, true);
}
async function renderSession() {
  const s = B.session, box = $('#reviewMedia');
  if (s.mode === 'photo') {
    const prev = await compose({ ...s.design, output_long: s.dragging ? 800 : 1200 }, await reviewShots(s), s.filter, { name: ACTIVE.name, date: ACTIVE.event_date, adjust: s.adjust, stickers: s.stickers });
    prev.className = 'media' + (s.design.paper === 'landscape' ? ' wide' : ''); prev.setAttribute('aria-label', 'Your photo. Tap a photo to zoom or move it.');
    let wrap = $('#rvWrap');
    if (!wrap || !box.contains(wrap)) { box.innerHTML = '<div id="rvWrap"><div id="rvSel" hidden></div></div>'; wrap = $('#rvWrap'); }
    const old = wrap.querySelector('canvas'); if (old) old.replaceWith(prev); else wrap.prepend(prev);
    showAdjSel(); showStkSel();
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
    box.innerHTML = s.mode === 'gif' ? `<img class="media wide" alt="Your GIF" src="${url}">` : s.mode === 'video' ? `<video class="media wide" src="${url}" autoplay playsinline controls></video>` : `<video class="media wide" src="${url}" autoplay loop muted playsinline></video>`;
    if (s.mode === 'video') { const v = box.querySelector('video'); v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
  }
}
async function openReview() {
  const s = B.session;
  if (s.mode === 'photo' && !s.adjust) { s.adjust = s.shots.map(() => ({ z: 1, dx: 0, dy: 0 })); s.adjSel = 0; s.stickers = []; s.stkSel = -1; s.beauty = +S.beauty || 0; s.bg = ''; }
  try { await renderSession(); } catch (e) { return showErr('Something went wrong', e.message, () => openReview(), goHome); }
  const isPhoto = s.mode === 'photo';
  $('#rvTabs').hidden = !isPhoto;
  $('#rvTabs [data-tab=stk]').hidden = !(S.stickers && S.stickers.on !== false);
  $('#rvTabs [data-tab=aibg]').hidden = !(S.aiBg && S.aiBg.on !== false);
  if (isPhoto) { renderAiBgPanel(); say('review'); }
  // Get the AI ready while the guest looks at the strip, so a background choice shows quickly
  if (isPhoto && S.aiBg && S.aiBg.on !== false) (async () => { await sleep(700); for (const c of s.shots || []) { if (B.session !== s || !s.shots) return; await personMask(c, 'photo'); await sleep(40); } })().catch(() => {});
  showReviewTab(isPhoto ? 'adj' : '');
  if (isPhoto) { renderAdjButtons(); renderStickerPanel(); $$('#bBeauty [data-bt]').forEach(b => b.classList.toggle('on', +b.dataset.bt === (+s.beauty || 0))); }
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
/* ---------- Zoom & move each photo on the review screen ---------- */
const ADJ_MIN = .5, ADJ_MAX = 3;
function renderAdjButtons() {
  const s = B.session; if (!s || !s.adjust) return;
  $('#adjPick').innerHTML = s.adjust.length > 1 ? s.adjust.map((_, i) => `<button class="${i === s.adjSel ? 'on' : ''}" data-adj="${i}">Photo ${i + 1}</button>`).join('') : '';
  $('#adjZoom').value = Math.round((s.adjust[s.adjSel].z || 1) * 100);
}
function showAdjSel() {
  const s = B.session, sel = $('#rvSel'), cv = $('#rvWrap canvas'); if (!sel || !cv || !s || !s.adjust) return;
  const a = s.design.areas[s.adjSel]; if (!a) { sel.hidden = true; return; }
  sel.hidden = s.adjust.length < 2 && noAdj(s.adjust[0]);
  sel.style.cssText = `left:${a.x * 100}%;top:${a.y * 100}%;width:${a.w * 100}%;height:${a.h * 100}%;transform:rotate(${a.r || 0}deg)`;
}
let adjRaf = 0;
function adjChanged() {   // redraw at most once per screen frame while the guest drags
  $('#adjZoom').value = Math.round((B.session.adjust[B.session.adjSel].z || 1) * 100);
  if (adjRaf) return; adjRaf = requestAnimationFrame(async () => { adjRaf = 0; if (B.session) await renderSession(); });
}
function setZoom(z) { const a = B.session.adjust[B.session.adjSel]; a.z = Math.min(ADJ_MAX, Math.max(ADJ_MIN, Math.round(z * 100) / 100)); clampPan(a); adjChanged(); }
function clampPan(a) { const lim = .5 + Math.max(.5, (a.z || 1) / 2); a.dx = Math.max(-lim, Math.min(lim, a.dx || 0)); a.dy = Math.max(-lim, Math.min(lim, a.dy || 0)); }
$('#adjPick').addEventListener('click', e => { const b = e.target.closest('[data-adj]'); if (!b || !B.session) return; B.session.adjSel = +b.dataset.adj; renderAdjButtons(); showAdjSel(); });
$('#adjMinus').onclick = () => B.session && setZoom((B.session.adjust[B.session.adjSel].z || 1) - .1);
$('#adjPlus').onclick = () => B.session && setZoom((B.session.adjust[B.session.adjSel].z || 1) + .1);
$('#adjZoom').oninput = () => B.session && setZoom(+$('#adjZoom').value / 100);
$('#adjReset').onclick = () => { if (!B.session) return; B.session.adjust[B.session.adjSel] = { z: 1, dx: 0, dy: 0 }; adjChanged(); };
// Background choices on the review screen
let aibgThumbs = {};
function aibgThumb(k) {
  if (aibgThumbs[k]) return aibgThumbs[k];
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; AIBG_BUILTIN[k][1](c.getContext('2d'), 96, 64);
  return (aibgThumbs[k] = c.toDataURL('image/jpeg', .8));
}
function renderAiBgPanel() {
  const A = S.aiBg || {}, s = B.session, cur = (s && s.bg) || '';
  const items = [['', 'Original', ''], ...(A.blur !== false ? [['blur', 'Blur', '']] : []), ...(A.builtin || []).filter(k => AIBG_BUILTIN[k]).map(k => [k, AIBG_BUILTIN[k][0], aibgThumb(k)]), ...(A.list || []).map((u, i) => ['u:' + i, u.name || 'Background ' + (i + 1), u.url])];
  $('#bAiBg').innerHTML = items.map(([k, n, img]) => `<button class="aibg ${k === cur ? 'on' : ''}" data-bg="${esc(k)}">${img ? `<img src="${esc(img)}" alt="" crossorigin="anonymous">` : `<span class="aibgic">${k === 'blur' ? '◐' : '◻'}</span>`}<span>${esc(n)}</span></button>`).join('');
}
$('#bAiBg').addEventListener('click', async e => {
  const b = e.target.closest('[data-bg]'); if (!b || !B.session) return;
  B.session.bg = b.dataset.bg; renderAiBgPanel(); await renderSession(); renderAiBgPanel();
});
function showReviewTab(t) {
  $$('#rvTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('#b-review [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
}
$('#rvTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showReviewTab(b.dataset.tab); });
$('#bBeauty').addEventListener('click', async e => {
  const b = e.target.closest('[data-bt]'); if (!b || !B.session) return;
  B.session.beauty = +b.dataset.bt; $$('#bBeauty button').forEach(x => x.classList.toggle('on', x === b)); await renderSession();
});
// Sticker panel: the packs the studio turned on, plus the studio's own pictures and text stickers
let stkPack = '';
function stickerPacks() {
  const st = S.stickers || {}, list = (st.packs || []).filter(k => STICKER_PACKS[k]).map(k => [k, STICKER_PACKS[k][0]]);
  if ((st.custom || []).length || (st.texts || []).length) list.unshift(['mine', '★ Ours']);
  return list;
}
function renderStickerPanel() {
  const packs = stickerPacks(); if (!packs.some(p => p[0] === stkPack)) stkPack = packs.length ? packs[0][0] : '';
  $('#stkPacks').innerHTML = packs.map(([k, n]) => `<button class="${k === stkPack ? 'on' : ''}" data-pack="${k}">${esc(n)}</button>`).join('');
  const st = S.stickers || {};
  $('#stkGrid').innerHTML = stkPack === 'mine'
    ? [...(st.texts || []).map((t, i) => `<button class="txt" data-add="t:${i}" style="font-family:'${esc(t.font || 'Geist')}';color:${esc(t.color || '#fff')}">${esc(t.t)}</button>`), ...(st.custom || []).map((u, i) => `<button data-add="i:${i}"><img src="${esc(u.url || u)}" alt="" crossorigin="anonymous"></button>`)].join('')
    : (STICKER_PACKS[stkPack] ? STICKER_PACKS[stkPack][1] : []).map(e => `<button data-add="e:${e}">${e}</button>`).join('');
  $('#stkSelRow').hidden = !(B.session && B.session.stkSel >= 0);
}
$('#stkPacks').addEventListener('click', e => { const b = e.target.closest('[data-pack]'); if (!b) return; stkPack = b.dataset.pack; renderStickerPanel(); });
$('#stkGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'), s = B.session; if (!b || !s) return;
  const k = b.dataset.add[0], v = b.dataset.add.slice(2), st = S.stickers || {};
  let item;
  if (k === 'e') item = { k: 'e', v, w: .22 };
  else if (k === 't') { const t = st.texts[+v]; item = { k: 't', v: t.t, font: t.font, color: t.color, w: Math.min(.5, .8 / Math.max(1, [...t.t].length * .176)) }; }   // long texts start small enough to fit
  else { const u = st.custom[+v], im = b.querySelector('img'); item = { k: 'i', v: u.url || u, w: .3, ar: im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : 1 }; }
  // new stickers land near the middle, a little apart from each other
  const n = s.stickers.length; Object.assign(item, { x: .5 + ((n % 3) - 1) * .12, y: .35 + (n % 4) * .08, r: 0 });
  s.stickers.push(item); s.stkSel = s.stickers.length - 1; renderStickerPanel(); adjChanged();
});
const stkSel = () => B.session && B.session.stkSel >= 0 ? B.session.stickers[B.session.stkSel] : null;
$('#stkSmaller').onclick = () => { const t = stkSel(); if (t) { t.w = Math.max(.06, t.w / 1.15); adjChanged(); } };
$('#stkBigger').onclick = () => { const t = stkSel(); if (t) { t.w = Math.min(1.5, t.w * 1.15); adjChanged(); } };
$('#stkTurn').onclick = () => { const t = stkSel(); if (t) { t.r = ((t.r || 0) + 15) % 360; adjChanged(); } };
$('#stkDel').onclick = () => { const s = B.session; if (!s || s.stkSel < 0) return; s.stickers.splice(s.stkSel, 1); s.stkSel = -1; renderStickerPanel(); adjChanged(); };
// Outline around the selected sticker on the preview
function showStkSel() {
  const s = B.session, cv = $('#rvWrap canvas'); if (!cv || !s) return;
  let el = $('#rvStk'); if (!el) { el = document.createElement('div'); el.id = 'rvStk'; $('#rvWrap').appendChild(el); }
  const t = stkSel(); if (!t) { el.hidden = true; return; }
  const W = cv.width, H = cv.height, [bw, bh] = stkBox(t, W, H, cv.getContext('2d'));
  el.hidden = false; el.style.cssText = `left:${(t.x * W - bw / 2) / W * 100}%;top:${(t.y * H - bh / 2) / H * 100}%;width:${bw / W * 100}%;height:${bh / H * 100}%;transform:rotate(${t.r || 0}deg)`;
}
// Which sticker is under the finger (top one first)? u, v are fractions of the strip.
function stickerAt(s, u, v, cv) {
  const W = cv.width, H = cv.height, x = cv.getContext('2d');
  for (let i = s.stickers.length - 1; i >= 0; i--) {
    const t = s.stickers[i], [bw, bh] = stkBox(t, W, H, x), a = -(t.r || 0) * Math.PI / 180;
    const px = (u - t.x) * W, py = (v - t.y) * H, lx = px * Math.cos(a) - py * Math.sin(a), ly = px * Math.sin(a) + py * Math.cos(a);
    if (Math.abs(lx) <= bw / 2 + 12 && Math.abs(ly) <= bh / 2 + 12) return i;
  }
  return -1;
}
// Touch the strip: a sticker under the finger moves (two fingers resize and turn it);
// otherwise tap picks a photo, one finger moves it, two fingers pinch to zoom.
{
  const pts = new Map(); let start = null;
  const box = $('#reviewMedia');
  const local = e => { const r = box.querySelector('canvas').getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const two = p => p.length > 1 ? { dist: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), ang: Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) } : { dist: 0, ang: 0 };
  // remember where the fingers and the thing being moved were when this gesture (or finger count) started
  const begin = s => {
    const p = [...pts.values()], stk = start ? start.stk : -1;
    start = { p, ...two(p), stk };
    if (stk >= 0) start.t = { ...s.stickers[stk] }; else start.a = { ...s.adjust[s.adjSel] };
  };
  box.addEventListener('pointerdown', e => {
    const s = B.session; if (!s || !s.adjust || !box.querySelector('canvas')) return;
    e.preventDefault(); box.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      const [u, v] = local(e), cv = box.querySelector('canvas'), hitS = stickerAt(s, u, v, cv);
      if (hitS >= 0) { s.stkSel = hitS; start = { stk: hitS }; renderStickerPanel(); showStkSel(); }
      else {
        start = { stk: -1 };
        if (s.stkSel >= 0) { s.stkSel = -1; renderStickerPanel(); showStkSel(); }
        const hit = s.design.areas.findIndex(a => u >= a.x && u <= a.x + a.w && v >= a.y && v <= a.y + a.h);
        if (hit >= 0 && hit !== s.adjSel) { s.adjSel = hit; renderAdjButtons(); showAdjSel(); }
      }
    }
    begin(s);
  });
  box.addEventListener('pointermove', e => {
    const s = B.session; if (!s || !start || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const p = [...pts.values()], r = box.querySelector('canvas').getBoundingClientRect(), g = two(p);
    if (start.stk >= 0) {   // move / resize / turn the sticker
      const t = s.stickers[start.stk]; if (!t) return;
      if (p.length > 1 && start.dist) { t.w = Math.max(.06, Math.min(1.5, start.t.w * g.dist / start.dist)); t.r = (start.t.r || 0) + (g.ang - start.ang) * 180 / Math.PI; }
      else if (p.length === 1 && start.p.length === 1) { t.x = Math.max(0, Math.min(1, start.t.x + (p[0][0] - start.p[0][0]) / r.width)); t.y = Math.max(0, Math.min(1, start.t.y + (p[0][1] - start.p[0][1]) / r.height)); }
      s.dragging = true; adjChanged(); return;
    }
    const a = s.adjust[s.adjSel], ar = s.design.areas[s.adjSel];
    if (p.length > 1 && start.dist) { a.z = Math.min(ADJ_MAX, Math.max(ADJ_MIN, start.a.z * g.dist / start.dist)); }
    else if (p.length === 1 && start.p.length === 1) {
      // finger movement, turned into the photo spot's own direction when the spot is rotated
      let mx = p[0][0] - start.p[0][0], my = p[0][1] - start.p[0][1]; const t = -(ar.r || 0) * Math.PI / 180;
      [mx, my] = [mx * Math.cos(t) - my * Math.sin(t), mx * Math.sin(t) + my * Math.cos(t)];
      a.dx = start.a.dx + mx / (ar.w * r.width); a.dy = start.a.dy + my / (ar.h * r.height);
    }
    s.dragging = true; clampPan(a); adjChanged();
  });
  const up = e => {
    pts.delete(e.pointerId); const s = B.session;
    if (!pts.size) { if (s && s.dragging) { s.dragging = false; adjChanged(); } start = null; return; }
    if (s && start) begin(s);   // one finger lifted: carry on with the other
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
}
$('#cMinus').onclick = () => { if (!B.session) return; B.session.copies = Math.max(1, B.session.copies - 1); $('#cNum').textContent = B.session.copies; };
$('#cPlus').onclick = () => { if (!B.session) return; B.session.copies = Math.min(S.capture.maxCopies || 1, B.session.copies + 1); $('#cNum').textContent = B.session.copies; };
function busy(msg) { $('#busy').hidden = !msg; if (msg) $('#busyMsg').textContent = msg; }
async function upload(path, blob, type) {
  const r = await fetch(fileUrl(path), { method: 'PUT', headers: { Authorization: await authHeader(), 'Content-Type': type || blob.type || 'application/octet-stream' }, body: blob });
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'Upload failed (' + r.status + ')');
}
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
  const q = (S.capture.quality || 95) / 100, qrOn = !!S.printQr.on, photoGifOn = S.capture.photoGif !== false;
  const job = (async () => {
    await sleep(30);   // let the "Thank you" screen appear first
    let full; const work = [];
    if (s.mode === 'photo') {
      full = await compose(s.design, await reviewShots(s), s.filter, { name: evName, date: evDate, adjust: s.adjust, stickers: s.stickers });
      let sheet = full;
      if (qrOn) { sheet = document.createElement('canvas'); sheet.width = full.width; sheet.height = full.height; const x = sheet.getContext('2d'); x.drawImage(full, 0, 0); drawPrintQr(x, full.width, full.height, s.design, `${SITE}?q=${row.print_token}`); }
      const printBlob = await jpeg(printCanvas(s.design, sheet), q);
      work.push(retry(() => upload(row.print_path, printBlob, 'image/jpeg')));
      if (S.capture.originals !== false && s.shots) {
        // Each camera photo in HD for the guest: the Canon's own JPEG when it is a sensible size, otherwise 4000 px at 92%.
        // With the beauty filter on, the smoothed photo is used so it matches the strip.
        const lv = (+s.beauty || 0) || (s.bg ? 1 : 0), src = lv ? await reviewShots(s) : s.shots;
        row.originals = src.map((_, i) => `${ev}/${id}-o${i + 1}.jpg`);
        src.forEach((shot, i) => {
          const cam = !lv && s.originals && s.originals[i], useCam = cam && cam.size <= 6e6 && /jpe?g/i.test(cam.type || 'image/jpeg');
          work.push((useCam ? Promise.resolve(cam) : jpeg(shot, .92)).then(b => retry(() => upload(row.originals[i], b, 'image/jpeg'))));
        });
        s.originals = null;
      }
      if (photoGifOn && s.bursts && s.bursts.length > 1) {
        try {
          const g = await stripBoomerang(s.design, s.bursts, s.filter, evName, evDate, s.adjust, s.stickers, BEAUTY_K[+s.beauty || 0], s.bg);
          if (g) { const ext = g.type === 'image/gif' ? 'gif' : g.type === 'video/mp4' ? 'mp4' : 'webm'; row.media_path = `${ev}/${id}.${ext}`; work.push(retry(() => upload(row.media_path, g, g.type))); }
        } catch (e) { /* the photo still saves without the boomerang */ }
        s.bursts = null;
      }
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
  s.printMsg = 'Getting your print ready…';
  const shot = $('#rvWrap canvas');
  if (S.printScreen && S.printScreen.on !== false && shot) showPrinting(s, shot); else openDone(s.printMsg, true);
  const copies = s.copies, label = `${ACTIVE.name} · ${s.design.name}`, ev = ACTIVE.id;
  try {
    const row = await s.savePromise;
    const job = await retry(async () => check(await sb.from('print_jobs').insert({ event_id: ev, photo_id: row.id, path: row.print_path || row.path, copies, label }).select().single()));
    s.jobId = job.id;
    s.printMsg = printerOnline() ? 'Sending to the printer…' : 'Your print is in the queue. It starts when the printer laptop is connected.';
    if (B.session === s && $('#b-done').classList.contains('on')) { $('#printMsg').textContent = printerOnline() ? 'Sending to the printer…' : 'Your print is in the queue. It starts when the printer laptop is connected.'; $('#printBar').style.width = '30%'; }
  } catch (e) { if (B.session === s) { s.printMsg = 'Could not send the print. Please call the attendant.'; $('#printMsg').textContent = s.printMsg; } }
}
/* ---------- Printing screen: the guest's photo slides out of a printer slot over the chosen background ---------- */
const PS_THEMES = { knit: ['Knit rose', '#8a2f3d'], cream: ['Cream', '#5b4a33'], night: ['Night', '#ffffff'], confetti: ['Confetti', '#5b4a33'] };
function paintPs(layer, shade, P) {
  if (P.kind === 'theme' || !P.src) {
    const t = PS_THEMES[P.theme] ? P.theme : 'knit', key = 'theme:' + t;
    if (layer.dataset.k !== key) { layer.innerHTML = `<div class="pstheme pst-${t}">${t === 'knit' ? '<span class="bow">🎀</span>' : ''}</div>`; layer.style.background = ''; layer.dataset.k = key; }
    shade.style.opacity = 0; return PS_THEMES[t][1];
  }
  paintBg(layer, shade, { kind: P.kind, src: P.src, dim: P.dim ?? 25 }); return '#ffffff';
}
// Puts the picture under the slot at a size that fits the screen (or the admin preview box).
function layoutPs(root, img, maxW, maxH) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(maxW / w, maxH / h);
  const out = root.querySelector('.psout'), pic = root.querySelector('.psout img');
  out.style.width = Math.round(w * k) + 'px'; out.style.height = Math.round(h * k) + 'px';
  pic.style.width = out.style.width; pic.style.height = out.style.height;
  root.querySelector('.psslot').style.width = Math.round(w * k + 40) + 'px';
}
function playPs(root, sec) {
  const pic = root.querySelector('.psout img');
  pic.getAnimations().forEach(a => a.cancel());
  return pic.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], { duration: sec * 1000, easing: 'linear', fill: 'forwards' });
}
function showPrinting(s, shot) {
  const P = S.printScreen || {}, root = $('#b-print');
  root.style.setProperty('--ps-ink', paintPs($('#psLayer'), $('#psShade'), P));
  $('#psText').textContent = P.text || 'Printing your photo…'; say('printing');
  const pic = $('#psImg'); pic.src = shot.toDataURL('image/jpeg', .85);
  layoutPs(root, shot, Math.min(innerWidth * .42, 380), innerHeight * .62);
  bscreen('b-print'); clearInterval(B.doneT);
  const sec = Math.max(3, Math.min(30, +P.sec || 12)), anim = playPs(root, sec);
  let gone = false;
  const next = () => { if (gone) return; gone = true; if (B.session === s && root.classList.contains('on')) openDone(s.printMsg || 'Printing… collect your photo at the printer.', true); };
  anim.onfinish = () => setTimeout(next, 1200);
  root.onclick = next;   // a tap skips to the QR
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
  $('#gbOpen').hidden = !gbAvailable(s); $('#gbOpen').textContent = (S.guestbook && S.guestbook.prompt) || 'Write a message ✍️';
  if (s && s.mode !== 'show') say('thanks');
  let left = 30; const tick = () => $('#doneTimer').textContent = `Going back automatically in ${left}s`;
  tick(); clearInterval(B.doneT); B.doneT = setInterval(() => { left--; tick(); if (left <= 0) goHome(); }, 1000);
  if (gbAvailable(s) && S.guestbook.auto && !s.gbAutoShown) { s.gbAutoShown = true; setTimeout(() => { if (B.session === s && $('#b-done').classList.contains('on')) openGuestbook(); }, 1500); }
}
/* ---------- Guestbook: guests write a message with a finger ---------- */
const GB = { strokes: [], cur: null, color: '#1d1d1f', w: 6 };
function gbSetup() {
  const cv = $('#gbCanvas'), r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); gbRedraw();
}
function gbRedraw() {
  const cv = $('#gbCanvas'), x = cv.getContext('2d'), k = cv.width / (cv.getBoundingClientRect().width || 1);
  x.clearRect(0, 0, cv.width, cv.height); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const st of GB.strokes) gbStroke(x, st, k);
  $('#gbHint').hidden = GB.strokes.length > 0;
}
function gbStroke(x, st, k) {
  const p = st.p; if (!p.length) return;
  x.strokeStyle = st.c; x.fillStyle = st.c; x.lineWidth = st.w * k;
  if (p.length === 1) { x.beginPath(); x.arc(p[0][0] * k, p[0][1] * k, st.w * k / 2, 0, 7); x.fill(); return; }
  x.beginPath(); x.moveTo(p[0][0] * k, p[0][1] * k);
  for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; x.quadraticCurveTo(p[i][0] * k, p[i][1] * k, mx * k, my * k); }
  x.lineTo(p[p.length - 1][0] * k, p[p.length - 1][1] * k); x.stroke();
}
{
  const cv = $('#gbCanvas');
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); GB.cur = { c: GB.color, w: GB.w, p: [pos(e)] }; GB.strokes.push(GB.cur); gbRedraw(); });
  cv.addEventListener('pointermove', e => { if (!GB.cur) return; GB.cur.p.push(pos(e)); gbRedraw(); });
  const end = () => { GB.cur = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
$('#gbColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; GB.color = b.dataset.c; $$('#gbColors .sw').forEach(x => x.classList.toggle('on', x === b)); });
$('#gbSizes').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; GB.w = +b.dataset.w; $$('#gbSizes .pill').forEach(x => x.classList.toggle('on', x === b)); });
$('#gbUndo').onclick = () => { GB.strokes.pop(); gbRedraw(); };
$('#gbClear').onclick = () => { GB.strokes = []; gbRedraw(); };
function openGuestbook() {
  const s = B.session; if (!s || !s.row) return;
  clearInterval(B.doneT); GB.strokes = []; $('#gbName').value = '';
  $('#gbPrompt').textContent = (S.guestbook && S.guestbook.prompt) || 'Write a message for the couple ✍️';
  paintGuestbook($('#b-msg'), $('#b-msg .gbpad'));
  bscreen('b-msg'); requestAnimationFrame(gbSetup);
}
function backToDone(msg) {
  const s = B.session; if (!s) return goHome();
  bscreen('b-done'); if (msg) toast(msg, 3000);
  $('#gbOpen').hidden = !gbAvailable(s);
  let left = 30; const tick = () => $('#doneTimer').textContent = `Going back automatically in ${left}s`;
  tick(); clearInterval(B.doneT); B.doneT = setInterval(() => { left--; tick(); if (left <= 0) goHome(); }, 1000);
}
const gbAvailable = s => !!(S.guestbook && S.guestbook.on && s && s.row && s.mode === 'photo' && !s.messageSaved);
$('#gbOpen').onclick = openGuestbook;
$('#gbCancel').onclick = () => backToDone();
$('#gbSave').onclick = async () => {
  const s = B.session; if (!s || !s.row) return backToDone();
  if (!GB.strokes.length) return toast('Write something first, or tap Skip');
  // the message only, trimmed to what was written, on a transparent background
  const src = $('#gbCanvas'), k = src.width / src.getBoundingClientRect().width;
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const st of GB.strokes) for (const [px, py] of st.p) { x0 = Math.min(x0, px - st.w); y0 = Math.min(y0, py - st.w); x1 = Math.max(x1, px + st.w); y1 = Math.max(y1, py + st.w); }
  const pad = 16, c = document.createElement('canvas'); c.width = Math.round((x1 - x0 + pad * 2) * k); c.height = Math.round((y1 - y0 + pad * 2) * k);
  const x = c.getContext('2d'); x.translate((pad - x0) * k, (pad - y0) * k); x.lineCap = 'round'; x.lineJoin = 'round';
  for (const st of GB.strokes) gbStroke(x, st, k);
  const name = $('#gbName').value.trim(), path = s.row.path.replace(/\.jpg$/, '') + '-msg.png', blob = await toBlob(c, 'image/png'), id = s.row.id;
  s.messageSaved = true; backToDone('Thank you for your message!');
  (async () => {   // upload in the background; keeps trying if the internet drops
    try { await retry(() => upload(path, blob, 'image/png')); await s.savePromise; await retry(async () => check(await sb.from('photos').update({ message_path: path, message_name: name || null }).eq('id', id))); }
    catch (e) { console.warn('guestbook save failed', e); }
  })();
};
function boothJob(job) {
  const s = B.session; if (!s || job.id !== s.jobId) return;
  const txt = { waiting: printerOnline() ? 'Sending to the printer…' : 'Waiting for the printer laptop…', printing: 'Printing… collect your photo at the printer.', done: 'Done! Collect your photo at the printer.', failed: 'Printer problem — please call the attendant.', cancelled: 'Print cancelled.' }[job.status];
  if (txt) s.printMsg = txt;
  if (!$('#b-done').classList.contains('on')) return;   // still on the printing animation: shown when it ends
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
$('#recStop').onclick = () => { if (B.session && B.session.stopRec) B.session.stopRec(); };
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
  if (navigator.usb || NATIVE) opts += '<option value="dslr">Canon DSLR (USB)</option>';
  $('#bCamSel').innerHTML = opts; $('#bCamSel').value = dslr ? 'dslr' : (store.get('camDevice', '') || (S.capture.camera === 'dslr' ? 'user' : S.capture.camera));
  $('#bMirror').checked = !!S.capture.mirror;
  const v = $('#live'); $('#bCamInfo').textContent = dslr ? 'Canon DSLR connected (USB)' : v.videoWidth ? `Camera: ${v.videoWidth} × ${v.videoHeight}` : '';
}
$('#bCamSel').onchange = async () => {
  if ($('#bCamSel').value === 'dslr' && dslrCrashed) { try { sessionStorage.removeItem('pb.dslrReloads'); } catch (e) {} S.capture.camera = 'dslr'; await saveStudio().catch(() => {}); return dslrRecover(true); }
  if ($('#bCamSel').value === 'dslr') { $('#bCamInfo').textContent = 'Connecting…'; try { await dslrConnect(true); toast('Canon DSLR connected'); } catch (e) { $('#bCamInfo').textContent = e.message; return; } boothStatus(); return fillCamMenu(); }
  store.set('camDevice', $('#bCamSel').value); await dslrDisconnect(); S.capture.camera = /^(user|environment)$/.test($('#bCamSel').value) ? $('#bCamSel').value : 'user'; saveStudio().catch(() => {}); startCamera().then(fillCamMenu); };
$('#bMirror').onchange = () => { S.capture.mirror = $('#bMirror').checked; $('#live').classList.toggle('mirror', S.capture.mirror); saveStudio().catch(() => {}); };
$('#bDslr').onclick = async () => { if (dslrCrashed) { try { sessionStorage.removeItem('pb.dslrReloads'); } catch (e) {} S.capture.camera = 'dslr'; await saveStudio().catch(() => {}); return dslrRecover(true); } const b = $('#bDslr'); b.disabled = true; $('#bCamInfo').textContent = 'Connecting…'; try { await dslrConnect(true); toast('Canon DSLR connected'); fillCamMenu(); } catch (e) { $('#bCamInfo').textContent = e.message; } b.disabled = false; };
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
  ({ home: renderHome, events: renderEvents, templates: renderTemplates, media: renderMedia, gallery: () => renderGallery(), printer: () => { renderQueue(); renderPaper(); renderPrintCfg(); }, studio: renderStudio, accounts: renderAccounts, guest: renderGuestPreview })[name]();
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
/* ---------- Storage used in Cloudflare R2 (10 GB free) ---------- */
const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(0, Math.round(b / 1e3)) + ' KB';
let STORAGE = null;
async function loadStorage(fresh) {
  const r = await fetch('/api/storage' + (fresh ? '?fresh=1' : ''), { headers: { Authorization: await authHeader() } });
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || 'Could not read the storage');
  return (STORAGE = await r.json());
}
async function renderStorage(fresh) {
  try { await loadStorage(fresh); } catch (e) { $('#stUsed').textContent = '–'; $('#stOf').textContent = 'Could not read the storage right now.'; return; }
  const { bytes, freeBytes, folders } = STORAGE, pct = Math.min(100, bytes / freeBytes * 100), left = Math.max(0, freeBytes - bytes);
  $('#stUsed').textContent = fmtSize(bytes); $('#stOf').textContent = `of ${fmtSize(freeBytes)} used (${pct < 1 && bytes ? '<1' : Math.round(pct)}%)`;
  $('#stFill').style.width = Math.max(bytes ? 1 : 0, pct) + '%'; $('#stBar').setAttribute('aria-valuenow', Math.round(pct));
  $('#stBar').className = 'stbar' + (pct >= 95 ? ' full' : pct >= 80 ? ' warn' : '');
  const chip = $('#stChip'); chip.hidden = pct < 80;
  chip.textContent = pct >= 100 ? 'Over the free 10 GB: small charge per extra GB' : pct >= 95 ? 'Almost full' : 'Getting full'; chip.className = 'chip' + (pct >= 95 ? ' bad' : ' warn');
  $('#stLeft').textContent = bytes > freeBytes ? `${fmtSize(bytes - freeBytes)} over the free amount` : `${fmtSize(left)} free`;
  // about 9 MB per photo session (photo, print strip, boomerang)
  $('#stSessions').textContent = left ? `room for about ${Math.floor(left / 9e6).toLocaleString('en-GB')} more photo sessions` : 'Free up space: download and delete an old event';
  const top = Object.entries(folders || {}).map(([id, b]) => [EVENTS.find(e => e.id === id), b]).filter(([e]) => e).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('#stTop').textContent = top.length ? 'Biggest events: ' + top.map(([e, b]) => `${e.name} ${fmtSize(b)}`).join(' · ') : '';
}
$('#stRefresh').onclick = () => renderStorage(true);
async function renderHome() {
  try { await Promise.all([loadEvents(), loadTemplates(), loadStation(), loadStats()]); } catch (e) { toast(e.message, 4000); }
  renderStorage();
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
      const photos = check(await sb.from('photos').select('path,thumb_path,media_path,print_path,message_path,originals').eq('event_id', ev.id));
      const paths = photos.flatMap(p => [p.path, p.thumb_path, p.media_path, p.print_path, p.message_path, ...(p.originals || []), p.path && p.path.replace(/\.jpg$/, '-4r.jpg')]).filter(Boolean);
      await removeFiles(paths);
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
  $('#renameType').textContent = `✎ Rename “${curType}”`;
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
function placeArea(el, a) { el.style.cssText = `left:${a.x * 100}%;top:${a.y * 100}%;width:${a.w * 100}%;height:${a.h * 100}%;transform:rotate(${a.r || 0}deg)`; }
function drawAreas() {
  $$('#frameWrap .area').forEach(a => a.remove());
  draft.areas.forEach((a, i) => {
    const el = document.createElement('div'); el.className = 'area'; el.dataset.i = i; el.tabIndex = 0;
    el.setAttribute('aria-label', `Photo area ${i + 1}. Drag to move, drag a corner to resize, drag the round handle to rotate, or use the arrow keys (Shift + arrows to resize, [ and ] to rotate).`);
    placeArea(el, a);
    el.innerHTML = `<span>Area ${i + 1}</span><button type="button" data-rm="${i}" aria-label="Remove area ${i + 1}">✕</button>` + ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(h => `<i class="hdl ${h}" data-h="${h}"></i>`).join('') + '<i class="hdl rot" data-h="rot" title="Drag to rotate"></i>';
    $('#frameWrap').appendChild(el);
  });
  const [W, H] = areaSize();
  $('#areaList').innerHTML = draft.areas.map((a, i) => `<div class="arow" style="flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><b>Area ${i + 1} · Photo ${i + 1}</b><button class="btn sm" data-rm-row="${i}" style="height:26px;padding:0 8px">Remove</button></div>
    <div class="anum">${[['x', 'X', W], ['y', 'Y', H], ['w', 'Width', W], ['h', 'Height', H]].map(([k, l, S]) => `<label>${l}<input class="in mono" type="number" data-ai="${i}" data-k="${k}" value="${Math.round(a[k] * S)}" min="0" max="${S}"></label>`).join('')}</div>
    <div class="row" style="gap:6px;align-items:flex-end;flex-wrap:wrap"><label style="flex:1;min-width:90px">Rotate (°)<input class="in mono" type="number" step="0.5" min="-180" max="180" data-ai="${i}" data-k="r" value="${+(a.r || 0).toFixed(1)}"></label><button class="btn sm" data-rot="${i}" data-by="-5" style="height:34px">⟲ 5°</button><button class="btn sm" data-rot="${i}" data-by="5" style="height:34px">⟳ 5°</button><button class="btn sm" data-rot="${i}" data-by="0" style="height:34px">Straight</button></div></div>`).join('') || '<p class="lbl" style="margin:0">None yet.</p>';
}
function updateAreaRow(i) {
  const [W, H] = areaSize(), a = draft.areas[i];
  $$(`#areaList [data-ai="${i}"]`).forEach(inp => { const k = inp.dataset.k; inp.value = k === 'r' ? +(a.r || 0).toFixed(1) : Math.round(a[k] * (k === 'x' || k === 'w' ? W : H)); });
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function fixArea(a) { a.w = clamp(a.w, .02, 1); a.h = clamp(a.h, .02, 1); a.x = clamp(a.x, 0, 1 - a.w); a.y = clamp(a.y, 0, 1 - a.h); return a; }
// Type exact pixel values
$('#areaList').addEventListener('input', e => {
  const inp = e.target.closest('[data-ai]'); if (!inp) return;
  const i = +inp.dataset.ai, k = inp.dataset.k, [W, H] = areaSize(), v = +inp.value;
  if (!Number.isFinite(v)) return;
  if (k === 'r') draft.areas[i].r = normDeg(v); else draft.areas[i][k] = v / (k === 'x' || k === 'w' ? W : H);
  fixArea(draft.areas[i]);
  const el = $(`#frameWrap .area[data-i="${i}"]`); if (el) placeArea(el, draft.areas[i]);
});
$('#areaList').addEventListener('change', e => { if (e.target.closest('[data-ai]')) updateAreaRow(+e.target.dataset.ai); });
$('#areaList').addEventListener('click', e => {
  const b = e.target.closest('[data-rm-row]'); if (b) { draft.areas.splice(+b.dataset.rmRow, 1); drawAreas(); areaMsg(); return; }
  const r = e.target.closest('[data-rot]'); if (!r) return;
  const i = +r.dataset.rot, a = draft.areas[i], by = +r.dataset.by;
  a.r = by ? normDeg((a.r || 0) + by) : 0; placeArea($(`#frameWrap .area[data-i="${i}"]`), a); updateAreaRow(i);
});
// Keep angles between -180 and 180, rounded to half a degree; 0 is stored as "no rotation"
function normDeg(v) { v = ((+v % 360) + 540) % 360 - 180; v = Math.round(v * 2) / 2; return Math.abs(v) < .25 ? 0 : v; }
// Drag to move, drag a corner or edge to resize
{
  let drag = null; const wrap = $('#frameWrap');
  wrap.addEventListener('pointerdown', e => {
    if (drawing) return;
    const el = e.target.closest('.area'); if (!el || e.target.closest('button')) return;
    e.preventDefault(); el.focus({ preventScroll: true });
    const i = +el.dataset.i;
    drag = { i, el, mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, a: { ...draft.areas[i] }, r: $('#frameImg').getBoundingClientRect() };
    if (drag.mode === 'rot') { const b = el.getBoundingClientRect(); drag.cx = b.left + b.width / 2; drag.cy = b.top + b.height / 2; }
    el.classList.add('active'); el.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.r.width, dy = (e.clientY - drag.sy) / drag.r.height, m = drag.mode;
    if (m === 'rot') {   // the round handle sits above the top edge: pointing straight up = 0°
      let deg = Math.atan2(e.clientX - drag.cx, drag.cy - e.clientY) * 180 / Math.PI;
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      draft.areas[drag.i].r = normDeg(deg); placeArea(drag.el, draft.areas[drag.i]); updateAreaRow(drag.i); return;
    }
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
    if (e.key === '[' || e.key === ']') { e.preventDefault(); const i = +el.dataset.i, a = draft.areas[i]; a.r = normDeg((a.r || 0) + (e.key === ']' ? 1 : -1) * (e.altKey ? 5 : 1)); placeArea(el, a); updateAreaRow(i); return; }
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
  S.hiddenTypes = (S.hiddenTypes || []).filter(t => t !== n);
  if (!allTypes().includes(n)) { S.types = [...(S.types || []), n]; try { await saveStudio(); } catch (e) { return toast(e.message, 4000); } }
  curType = n; draft = null; renderTemplates(); toast(`Event type “${n}” added`);
};
// Rename the selected event type: its templates and events move to the new name.
$('#renameType').onclick = async () => {
  const old = curType, n = (prompt(`New name for “${old}”:`, old) || '').trim();
  if (!n || n === old) return;
  if (allTypes().includes(n) && !confirm(`“${n}” already exists. Move everything from “${old}” into “${n}”?`)) return;
  const b = $('#renameType'); b.disabled = true;
  try {
    check(await sb.from('templates').update({ event_type: n }).eq('owner', USER.id).eq('event_type', old));
    for (const e of EVENTS.filter(e => evType(e) === old)) check(await sb.from('events').update({ settings: { ...(e.settings || {}), type: n } }).eq('id', e.id));
    S.types = [...new Set([...(S.types || []).filter(t => t !== old), n])];
    if (DEFAULT_TYPES.includes(old)) S.hiddenTypes = [...new Set([...(S.hiddenTypes || []), old])];
    S.hiddenTypes = (S.hiddenTypes || []).filter(t => t !== n);
    await saveStudio(); await Promise.all([loadTemplates(), loadEvents()]);
    curType = n; draft = null; renderTemplates(); announce(); toast(`Renamed to “${n}”`);
  } catch (e) { toast(e.message, 5000); }
  b.disabled = false;
};
// Remove an event type that has no templates and no events.
$('#removeType').onclick = async () => {
  const t = curType;
  if (TEMPLATES.some(x => x.event_type === t)) return toast(`“${t}” still has templates. Delete or move them first (or rename the type).`, 5000);
  if (EVENTS.some(e => evType(e) === t)) return toast(`An event still uses “${t}”. Change it in Events → Edit first.`, 5000);
  if (!confirm(`Remove the event type “${t}”?`)) return;
  S.types = (S.types || []).filter(x => x !== t);
  if (DEFAULT_TYPES.includes(t)) S.hiddenTypes = [...new Set([...(S.hiddenTypes || []), t])];
  try { await saveStudio(); curType = allTypes()[0]; draft = null; renderTemplates(); toast(`“${t}” removed`); } catch (e) { toast(e.message, 4000); }
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
  try { check(await sb.from('templates').delete().eq('id', draft.id)); const m = pathOfUrl(draft.frame_url); if (m) await removeFiles([m]); draft = null; announce(); renderTemplates(); toast('Template deleted'); }
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
  { key: 'photo', name: 'Photo', spec: 'High resolution', note: 'JPG · printed and shared' },
  { key: 'gif', name: 'GIF', spec: '800 px', note: '10 frames · loops back and forth (GIFs above this size get very slow to make)' },
  { key: 'boom', name: 'Boomerang', spec: 'High resolution', note: 'Video · plays forward and back' },
  { key: 'video', name: 'Video', spec: 'High resolution', note: 'Video with the length you choose' },
];
function renderMedia() { renderModes(); renderCaptureForm(); renderSmileSettings(); renderVideoBookSettings(); renderCountdownSettings(); }
function renderModes() {
  $('#modes').innerHTML = MODES.map(m => { const on = !!S.modes[m.key]; return `<button class="card mode ${on ? 'on' : ''}" data-m="${m.key}" aria-pressed="${on}"><div class="row" style="justify-content:space-between;width:100%"><span class="row" style="font-weight:600"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${MODE_INFO[m.key][1]}</svg>${m.name}</span><span class="chip ${on ? '' : 'mute'}">${on ? 'On' : 'Off'}</span></div><div class="mono" style="font-size:22px;font-weight:600">${m.spec}</div><div class="lbl">${m.note}</div></button>`; }).join('');
}
function renderCaptureForm() {
  const c = S.capture;
  $('#capCam').value = c.camera; $('#capMirror').checked = !!c.mirror; $('#capCanonLive').checked = c.canonLive !== false; $('#capPhotoGif').checked = c.photoGif !== false; $('#capOriginals').checked = c.originals !== false; $('#capBoomSec').value = c.boomSec || 5; $('#capQ').value = c.quality; $('#capQv').textContent = c.quality + '%';
  $('#capCount').value = c.countdown; $('#capGap').value = c.gap ?? 2; $('#capVid').value = c.videoSec; $('#capCopies').value = c.maxCopies;
  renderDslrState();
}
function renderDslrState() { $('#dslrState').textContent = dslr ? 'Connected' : 'Not connected'; $('#dslrState').className = 'chip' + (dslr ? '' : ' mute'); $('#dslrTest').disabled = !dslr; if (dslr) $('#capCam').value = 'dslr'; }
$('#modes').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; S.modes[b.dataset.m] = !S.modes[b.dataset.m]; if (!enabledModes().length) S.modes.photo = true; renderModes(); });
$('#capQ').oninput = () => $('#capQv').textContent = $('#capQ').value + '%';
$('#capCam').onchange = () => { camTestOff(); if ($('#capCam').value === 'dslr') $('#dslrCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
/* ---- Smile settings ---- */
function renderSmileSettings() {
  const m = S.smile;
  $('#smText').value = m.text || ''; $('#smFont').value = m.font || 'Geist'; $('#smColor').value = m.color || '#ffffff';
  $('#smStroke').value = String(m.stroke || 0); $('#smStrokeColor').value = m.strokeColor || '#000000'; $('#smStrokeColor').disabled = !m.stroke;
  $('#smSize').value = m.size || 100; $('#smSizeV').textContent = (m.size || 100) + '%';
  $$('#smColors [data-c]').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === (m.color || '').toLowerCase()));
  $('#smEmoji').innerHTML = SMILE_EMOJI.map(e => `<button class="pill ${e === (m.emoji || '') ? 'on' : ''}" data-e="${e}">${e || 'None'}</button>`).join('');
  $('#smDeco').innerHTML = Object.entries(SMILE_DECO).map(([k, [n, em]]) => `<button class="pill ${k === (m.deco || 'none') ? 'on' : ''}" data-d="${k}">${em[0] ? em[0] + ' ' : ''}${n}</button>`).join('');
  smilePreview();
}
function smilePreview() { const box = $('#smPrevCount'); showSmile(box, S.smile, true); box.classList.remove('go'); void box.offsetWidth; box.classList.add('go'); }
$('#smFont').innerHTML = SMILE_FONTS.map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
$('#smText').addEventListener('input', () => { S.smile.text = $('#smText').value; smilePreview(); });
$('#smFont').onchange = () => { S.smile.font = $('#smFont').value; smilePreview(); };
$('#smColor').oninput = () => { S.smile.color = $('#smColor').value; $$('#smColors [data-c]').forEach(b => b.classList.remove('on')); smilePreview(); };
$('#smColors').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; S.smile.color = b.dataset.c; renderSmileSettings(); });
$('#smStroke').onchange = () => { S.smile.stroke = +$('#smStroke').value; renderSmileSettings(); };
$('#smStrokeColor').oninput = () => { S.smile.strokeColor = $('#smStrokeColor').value; smilePreview(); };
$('#smSize').oninput = () => { S.smile.size = +$('#smSize').value; $('#smSizeV').textContent = S.smile.size + '%'; smilePreview(); };
$('#smEmoji').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; S.smile.emoji = b.dataset.e; renderSmileSettings(); });
$('#smDeco').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; S.smile.deco = b.dataset.d; renderSmileSettings(); });
$('#smPlay').onclick = smilePreview;
/* ---- Admin: Countdown screen card ---- */
function renderCountdownSettings() {
  const o = cdOpt();
  $('#cdFrames').innerHTML = Object.entries(CD_FRAMES).map(([k, n]) => `<button class="pill ${o.frame === k ? 'on' : ''}" data-cdf="${k}">${n}</button>`).join('');
  $('#cdPrevBorder').value = o.prevBorder || '#ffffff';
  const soundSel = (id, list, key) => { $(id).innerHTML = Object.entries(list).map(([k, n]) => `<option value="${k}">${n}</option>`).join('') + (o[key + 'Src'] ? '<option value="file">Your sound</option>' : ''); $(id).value = o[key] === 'file' && !o[key + 'Src'] ? Object.keys(list)[0] : o[key]; };
  soundSel('#cdTick', CD_SOUNDS, 'tick'); soundSel('#cdLast', CD_SOUNDS, 'last'); soundSel('#cdShutter', CD_SHUTTERS, 'shutter');
  if (!$('#cdFont').options.length) $('#cdFont').innerHTML = SMILE_FONTS.map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
  $('#cdFont').value = o.font; $('#cdColor').value = o.color; $('#cdStroke').value = String(o.stroke || 0); $('#cdStrokeColor').value = o.strokeColor; $('#cdStrokeColor').disabled = !o.stroke;
  $('#cdSize').value = o.size; $('#cdSizeV').textContent = o.size + '%'; $('#cdVol').value = Math.round((o.volume ?? 1) * 100);
  $('#cdAnims').innerHTML = Object.entries(CD_ANIMS).map(([k, n]) => `<button class="pill ${o.anim === k ? 'on' : ''}" data-cda="${k}">${n}</button>`).join('');
  paintCdFrame($('#cdPrevFrame'), o); styleCount($('#cdPrevNum'), o, true); $('#cdPrevNum').textContent = '3';
}
const cdSet = (k, v) => { S.countdown = { ...cdOpt(), [k]: v }; renderCountdownSettings(); };
$('#cdFrames').addEventListener('click', e => { const b = e.target.closest('[data-cdf]'); if (!b) return; if (b.dataset.cdf === 'image' && !cdOpt().frameSrc) return $('#cdFrameFile').click(); cdSet('frame', b.dataset.cdf); });
$('#cdAnims').addEventListener('click', e => { const b = e.target.closest('[data-cda]'); if (b) cdSet('anim', b.dataset.cda); });
$('#cdPrevBorder').oninput = () => { S.countdown = { ...cdOpt(), prevBorder: $('#cdPrevBorder').value }; };
['tick', 'last', 'shutter'].forEach(k => {
  const id = '#cd' + k[0].toUpperCase() + k.slice(1);
  $(id).onchange = () => { cdSet(k, $(id).value); cdSound(k); };
});
$('#cdFont').onchange = () => cdSet('font', $('#cdFont').value);
$('#cdColor').oninput = () => { S.countdown = { ...cdOpt(), color: $('#cdColor').value }; styleCount($('#cdPrevNum'), cdOpt(), true); };
$('#cdStroke').onchange = () => cdSet('stroke', +$('#cdStroke').value);
$('#cdStrokeColor').oninput = () => { S.countdown = { ...cdOpt(), strokeColor: $('#cdStrokeColor').value }; styleCount($('#cdPrevNum'), cdOpt(), true); };
$('#cdSize').oninput = () => { S.countdown = { ...cdOpt(), size: +$('#cdSize').value }; $('#cdSizeV').textContent = $('#cdSize').value + '%'; styleCount($('#cdPrevNum'), cdOpt(), true); };
$('#cdVol').oninput = () => { S.countdown = { ...cdOpt(), volume: +$('#cdVol').value / 100 }; };
$('#cdFrameFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!/^image\/(png|webp)$/.test(f.type)) return toast('Use a PNG with a see-through middle.');
  try { const u = await gbUpload(f, 'cdframe'); if (u) { S.countdown = { ...cdOpt(), frame: 'image', frameSrc: u }; renderCountdownSettings(); toast('Uploaded. Press Save to send to the tablet.'); } } catch (err) { toast(err.message, 4000); }
});
// "Use my own sound": any sound or video file becomes MP3
let cdUpKey = '';
$('#cdSounds').addEventListener('click', e => { const b = e.target.closest('[data-cdup]'); if (b) { cdUpKey = b.dataset.cdup; $('#cdSoundFile').click(); } });
$('#cdSoundFile').addEventListener('change', async e => {
  const f = e.target.files[0], k = cdUpKey; e.target.value = ''; if (!f || !k) return;
  try {
    toast('Adding the sound…', 3000);
    const mp3 = await toMp3(f, 5), path = `u-${USER.id}/cd-${k}-${Date.now().toString(36)}.mp3`;
    await upload(path, mp3, 'audio/mpeg'); S.countdown = { ...cdOpt(), [k]: 'file', [k + 'Src']: fileUrl(path) }; renderCountdownSettings(); cdSound(k);
    toast('Sound added. Press Save to send it to the tablet.');
  } catch (err) { toast(err.message, 5000); }
});
// Preview: 3, 2, 1, Smile with the chosen look and sounds
$('#cdPlay').onclick = async () => {
  ac(); const num = $('#cdPrevNum'), o = cdOpt();
  for (const n of [3, 2, 1]) { num.textContent = n; styleCount(num, o, true); cdSound(n === 1 ? 'last' : 'tick'); await sleep(1000); }
  num.removeAttribute('style'); showSmile(num, S.smile, true); cdSound('shutter');
  const fl = $('#cdPrevFlash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  await sleep(1200); num.textContent = '3'; styleCount(num, cdOpt(), true);
};
$('#mediaSave').onclick = async () => {
  const n = (id, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(+$(id).value || d)));
  const liveBefore = S.capture.canonLive !== false;
  Object.assign(S.capture, { camera: $('#capCam').value, mirror: $('#capMirror').checked, canonLive: $('#capCanonLive').checked, photoGif: $('#capPhotoGif').checked, originals: $('#capOriginals').checked, boomSec: n('#capBoomSec', 1, 5, 5), quality: n('#capQ', 70, 100, 95), countdown: n('#capCount', 1, 10, 3), gap: Math.max(0, Math.min(10, Math.round((+$('#capGap').value || 0) * 2) / 2)), videoSec: n('#capVid', 3, 30, 10), maxCopies: n('#capCopies', 1, 10, 3) });
  try { await saveStudio(); renderMedia(); toast('Saved. The tablet updates right away.'); } catch (e) { toast(e.message, 4000); }
  if (dslr && liveBefore !== (S.capture.canonLive !== false)) {   // apply the Canon live view choice now
    camTestOff(); try { sessionStorage.removeItem('pb.liveBroken'); } catch (e) {}
    await dslrDisconnect(); setDslrMsg('Reconnecting the Canon…');
    try { await dslrConnect(false); setDslrMsg(dslr && !dslr.noLive ? 'Canon live view on.' : 'Canon connected · preview from the tablet camera.'); renderDslrState(); } catch (e) { setDslrMsg(e.message); }
  }
};
let testStream = null;
function camTestOff() { cancelAnimationFrame(testRaf); testRaf = 0; const td = $('#testDslr'); if (td) td.hidden = true; const tv = $('#testVideo'); if (tv) tv.hidden = false; if (testStream) testStream.getTracks().forEach(t => t.stop()); testStream = null; const v = $('#testVideo'); if (v) v.srcObject = null; $('#camChip').textContent = 'Off'; $('#camChip').className = 'chip mute'; $('#testShot').disabled = true; $('#camOn').textContent = 'Turn on camera'; $('#resBadge').textContent = '–'; $('#resLabel').textContent = 'Camera off'; }
let testRaf = 0;
async function dslrCheckOn() {
  $('#camOn').disabled = true; $('#resLabel').textContent = 'Connecting to the Canon…';
  try { await dslrConnect(true); } catch (e) { $('#camOn').disabled = false; $('#resLabel').textContent = 'Canon not connected'; $('#testInfo').textContent = e.message; return; }
  $('#camOn').disabled = false; renderDslrState();
  if (dslr && dslr.noLive) {
    testRaf = 1;
    try { testStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } } }); const v = $('#testVideo'); v.hidden = false; $('#testDslr').hidden = true; v.srcObject = testStream; await v.play().catch(() => {}); } catch (e) {}
    $('#resBadge').textContent = 'DSLR'; $('#resLabel').textContent = 'Canon connected · this preview is the tablet camera; every photo is taken with the Canon.'; $('#camChip').textContent = 'Canon DSLR'; $('#camChip').className = 'chip'; $('#testShot').disabled = false; $('#camOn').textContent = 'Turn off camera'; return; }
  const out = $('#testDslr'), x = out.getContext('2d'); out.hidden = false; $('#testVideo').hidden = true;
  const draw = () => { const src = $('#dslrView'); if (src.width) { if (out.width !== src.width) { out.width = src.width; out.height = src.height; } x.drawImage(src, 0, 0); $('#resLabel').textContent = `Canon live view ${src.width} × ${src.height} · photos at full resolution`; } testRaf = requestAnimationFrame(draw); };
  draw();
  $('#resBadge').textContent = 'DSLR'; $('#camChip').textContent = 'Canon DSLR'; $('#camChip').className = 'chip'; $('#testShot').disabled = false; $('#camOn').textContent = 'Turn off camera';
}
$('#camOn').onclick = async () => {
  if (testStream || testRaf) return camTestOff();
  if ($('#capCam').value === 'dslr') return dslrCheckOn();
  const [w, h] = MAXRES, cam = $('#capCam').value;
  try {
    testStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: cam === 'environment' ? 'environment' : 'user', width: { ideal: w }, height: { ideal: h } } });
    const v = $('#testVideo'); v.srcObject = testStream; await v.play().catch(() => {});
    await sleep(400);
    const s = testStream.getVideoTracks()[0].getSettings();
    $('#resBadge').textContent = 'HIGH';
    $('#resLabel').textContent = `${s.width || v.videoWidth} × ${s.height || v.videoHeight}${s.frameRate ? ' · ' + Math.round(s.frameRate) + ' fps' : ''}`;
    $('#camChip').textContent = 'On'; $('#camChip').className = 'chip'; $('#testShot').disabled = false; $('#camOn').textContent = 'Turn off camera';
  } catch (e) { toast('Cannot open a camera on this device: ' + e.message, 4000); }
};
$('#testShot').onclick = async () => {
  if (testRaf && dslr) {
    const b = $('#testShot'); b.disabled = true; $('#testInfo').textContent = 'Taking a Canon photo…'; const t0 = performance.now();
    try { dslr.pause = true; const c = await dslrFullPhoto(dslr); $('#testInfo').textContent = `Canon photo: ${c.width} × ${c.height} · took ${((performance.now() - t0) / 1000).toFixed(1)} s`; }
    catch (e) { $('#testInfo').textContent = e.message; }
    finally { if (dslr && !dslr.noLive) { await sleep(700); try { await liveViewOn(dslr); } catch (e) {} } if (dslr) dslr.pause = false; b.disabled = false; }
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
  catch (e) { $('#dslrInfo').textContent = e.message + ' If it still fails, tap “Copy camera report” and send it to support.'; }
  b.disabled = false;
};
$('#bReport').onclick = () => $('#dslrReport').click();
$('#dslrReport').onclick = async () => {
  const r = camReport();
  if (NATIVE) { try { NATIVE.copy(r); return toast('Camera report copied. Paste it in your message to support.'); } catch (e) {} }
  try { await navigator.clipboard.writeText(r); toast('Camera report copied. Paste it in your message to support.'); }
  catch (e) { modal(`<div class="row" style="justify-content:space-between"><b>Camera report</b><button class="ico" data-close aria-label="Close">✕</button></div><textarea class="in ta mono" rows="12" readonly style="font-size:11px">${esc(r)}</textarea><p class="lbl" style="margin:0">Take a screenshot of this and send it to support.</p>`, 640); }
};
// Forget the USB permission so Chrome asks again (fixes a stale permission on some tablets)
$('#dslrForget').onclick = async () => {
  if (NATIVE) { await dslrDisconnect(); return toast('Canon disconnected. Tap Connect camera to connect it again.'); }
  if (!navigator.usb) return toast('This browser cannot use USB devices.');
  await dslrDisconnect();
  try { for (const d of await navigator.usb.getDevices()) { try { if (d.opened) await d.close(); } catch (e) {} if (d.forget) await d.forget(); } } catch (e) {}
  toast('Camera permission reset. Unplug the Canon, plug it back in, reload this page and tap Connect camera.', 9000);
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
  (STORAGE ? Promise.resolve(STORAGE) : loadStorage().catch(() => null)).then(st => { const b = st && st.folders && st.folders[galEvent]; $('#gSize').hidden = !b; if (b) $('#gSize').textContent = fmtSize(b) + ' used'; });
  drawThumbs();
}
function drawThumbs() {
  const badge = { photo: 'PHOTO', gif: 'GIF', boom: 'BOOMERANG', video: 'VIDEO' };
  const list = galPhotos.map((p, i) => ({ p, i })).filter(o => gFilter === 'all' || (o.p.kind || 'photo') === gFilter);
  $('#thumbs').innerHTML = list.length ? list.map(({ p, i }) => `<button class="thumb" data-i="${i}"><div class="im"><img src="${fileUrl(p.thumb_path)}" alt="Session ${galPhotos.length - i}" loading="lazy"><span class="tbadge ${(p.kind || 'photo') === 'photo' ? '' : 'anim'}">${badge[p.kind || 'photo']}${(p.kind || 'photo') === 'photo' && p.media_path ? (/\.gif$/.test(p.media_path) ? ' + GIF' : ' + BOOMERANG') : ''}</span></div><div class="row lbl" style="justify-content:space-between;font-size:12px"><span>#${galPhotos.length - i}</span><span class="mono">${timeOf(p.created_at)}</span></div></button>`).join('')
    : `<div class="empty">${galPhotos.length ? 'Nothing of this type yet.' : 'No photos yet. They appear here as soon as guests use the booth.'}</div>`;
}
$('#gEvent').onchange = () => { galEvent = $('#gEvent').value; renderGallery(); };
$('#gFilters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; gFilter = b.dataset.f; $$('#gFilters .pill').forEach(p => p.classList.toggle('on', p === b)); drawThumbs(); });
$('#thumbs').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return; const i = +b.dataset.i, p = galPhotos[i], kind = p.kind || 'photo';
  const link = shareLink(p), ev = EVENTS.find(x => x.id === p.event_id);
  const media = kind === 'gif' ? `<img src="${fileUrl(p.media_path)}" alt="" style="max-height:56vh;max-width:min(320px,100%);border-radius:4px">` : kind === 'photo' ? `<img id="gPhotoImg" src="${fileUrl(p.path)}" alt="" crossorigin="anonymous" style="max-height:56vh;max-width:min(320px,100%);border-radius:4px">` : `<video src="${fileUrl(p.media_path)}" controls autoplay loop muted playsinline style="max-height:56vh;max-width:min(320px,100%);border-radius:4px"></video>`;
  const exp = p.print_expires_at ? new Date(p.print_expires_at) : null;
  const m = modal(`<div class="row" style="justify-content:space-between"><b>Session #${galPhotos.length - i} · ${MODE_INFO[kind][0]}</b><button class="ico" data-close aria-label="Close">✕</button></div>
    <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
      <div style="flex:none;max-width:100%;display:flex;flex-direction:column;gap:10px">${media}${p.message_path ? `<div style="background:#fffdf8;border-radius:10px;padding:10px;max-width:320px"><img src="${fileUrl(p.message_path)}" alt="Guestbook message" style="max-width:100%;max-height:160px;display:block;margin:auto">${p.message_name ? `<div style="color:#5b4a33;font-style:italic;text-align:right;margin-top:6px">— ${esc(p.message_name)}</div>` : ''}</div>` : ''}</div>
      <div style="flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <div class="cap">Share this ${kind === 'photo' ? 'photo' : 'file'} again</div>
        <div class="row" style="align-items:center;gap:14px"><div class="qrbox" id="photoQr"></div><p class="lbl" style="margin:0;line-height:1.5">Show this to the guest to scan. It opens only this ${kind === 'photo' ? 'photo' : 'file'}.</p></div>
        <input class="in mono" id="photoLink" readonly value="${esc(link)}" aria-label="Photo link" style="font-size:12px">
        ${S.printQr.on && kind === 'photo' && exp ? `<div class="lbl">The QR printed on this photo ${exp > new Date() ? 'works until ' + exp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'has expired'}. Guest links (this QR too) work for 12 hours after the photo; after that, share the event album.</div>` : ''}
        <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" id="copyPhoto">Copy link</button><button class="btn sm" id="showTab">Show on tablet</button></div>
        ${kind === 'photo' ? '<div class="row" style="flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px"><button class="btn sm" id="dup4r" aria-pressed="false">⊞ Duplicate to 4R</button><span class="lbl" id="dup4rInfo" style="font-size:12px">Print this photo small, 4 times on one 4×6 (4R) sheet.</span></div>' : ''}
        <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:6px">${kind === 'photo' ? '<label class="field" style="width:80px" for="rpC">Copies<input class="in mono" id="rpC" type="number" min="1" max="10" value="1"></label><button class="btn pri" id="reprint" style="align-self:flex-end">Print again</button>' : ''}<button class="btn" id="dlOrig" style="align-self:flex-end">Download original</button>${(p.originals || []).length ? `<button class="btn" id="dlHd" style="align-self:flex-end">Download HD photos (${p.originals.length})</button>` : ''}${kind === 'photo' && p.media_path ? `<button class="btn" id="dlGif" style="align-self:flex-end">Download ${/\.gif$/.test(p.media_path) ? 'GIF' : 'boomerang'}</button>` : ''}<button class="btn" id="delPhoto" style="align-self:flex-end;color:#ff8a80">Delete</button></div>
      </div>
    </div>`, 780);
  qr(m.querySelector('#photoQr'), link, 112);
  m.querySelector('#copyPhoto').onclick = () => copyText(link, m.querySelector('#photoLink'));
  m.querySelector('#showTab').onclick = () => { if (!others().some(d => d.role === 'booth')) return toast('The tablet is not connected'); chan.send({ type: 'broadcast', event: 'show-qr', payload: { url: link, label: 'Scan to get your photo' } }); toast('QR shown on the tablet'); };
  // "Duplicate to 4R": the photo four times (2 × 2, each 2R size) on one 4×6 sheet. Toggles back to the normal print.
  let as4r = false, sheet4r = null, sheet4rPath = '';
  const d4 = m.querySelector('#dup4r'), img = m.querySelector('#gPhotoImg'), origSrc = img && img.src;
  // Only for 2R-shaped photos (about 2:3). A 2x6 strip is long and thin: it already prints 2 per 4R sheet.
  const isStrip = () => { const w = img.naturalWidth, h = img.naturalHeight; return w && h && Math.max(w, h) / Math.min(w, h) > 2.2; };
  const stripNote = () => { if (d4 && isStrip()) { d4.disabled = true; d4.textContent = '⊞ Duplicate to 4R'; m.querySelector('#dup4rInfo').textContent = 'Not for strips: a 2×6 strip already prints 2 per 4R sheet (cut in the middle). Use this for 2R (2×3) designs.'; } };
  if (img) { if (img.complete) stripNote(); else img.addEventListener('load', stripNote, { once: true }); }
  if (d4) d4.onclick = async () => {
    if (isStrip()) return stripNote();
    as4r = !as4r; d4.setAttribute('aria-pressed', as4r); d4.textContent = as4r ? '↩ Back to 2R' : '⊞ Duplicate to 4R';
    m.querySelector('#dup4rInfo').textContent = as4r ? 'Print again and download now use the 4R sheet (4 copies).' : 'Print this photo small, 4 times on one 4×6 (4R) sheet.';
    if (m.querySelector('#dlOrig')) m.querySelector('#dlOrig').textContent = as4r ? 'Download 4R sheet' : 'Download original';
    if (!as4r) { img.src = origSrc; return; }
    try { if (!sheet4r) { d4.disabled = true; sheet4r = sheet4R(await loadImg(fileUrl(p.path))); } img.src = scaled(sheet4r, 900).toDataURL('image/jpeg', .85); }
    catch (err) { toast('Could not make the 4R sheet: ' + err.message, 5000); as4r = false; d4.textContent = '⊞ Duplicate to 4R'; }
    finally { d4.disabled = false; }
  };
  const path4r = async () => {   // upload the 4R sheet once, so the printing laptop can fetch it
    if (sheet4rPath) return sheet4rPath;
    const path = p.path.replace(/\.jpg$/, '') + '-4r.jpg'; await upload(path, await jpeg(sheet4r, .95), 'image/jpeg'); return (sheet4rPath = path);
  };
  const rp = m.querySelector('#reprint');
  if (rp) rp.onclick = async () => {
    rp.disabled = true;
    try {
      const c = Math.max(1, Math.min(10, +m.querySelector('#rpC').value || 1)), path = as4r ? await path4r() : (p.print_path || p.path);
      check(await sb.from('print_jobs').insert({ event_id: p.event_id, photo_id: p.id, path, copies: c, label: `${ev ? ev.name : ''} · reprint${as4r ? ' · 4R ×4' : ''}` }));
      toast(printerOn() ? 'Sent to the printer' : 'Added to the print queue. Turn on printing in Printer.'); runPrinter();
    } catch (err) { toast(err.message, 4000); }
    rp.disabled = false;
  };
  const dlPath = async path => { try { download(await (await fetch(fileUrl(path))).blob(), path.split('/').pop()); } catch (err) { window.open(fileUrl(path), '_blank'); } };
  if (m.querySelector('#dlGif')) m.querySelector('#dlGif').onclick = () => dlPath(p.media_path);
  if (m.querySelector('#dlHd')) m.querySelector('#dlHd').onclick = async () => {
    const b = m.querySelector('#dlHd'); b.disabled = true; b.textContent = 'Preparing…';
    try {
      if (p.originals.length === 1) await dlPath(p.originals[0]);
      else { const zip = new JSZip(); for (const [i, path] of p.originals.entries()) zip.file(`photo-${i + 1}.jpg`, await (await fetch(fileUrl(path))).blob()); download(await zip.generateAsync({ type: 'blob' }), `${p.id}-HD-photos.zip`); }
    } catch (err) { toast(err.message, 4000); }
    b.disabled = false; b.textContent = `Download HD photos (${p.originals.length})`;
  };
  m.querySelector('#dlOrig').onclick = async () => { if (as4r && sheet4r) return download(await jpeg(sheet4r, .95), p.path.split('/').pop().replace(/\.jpg$/, '') + '-4R.jpg'); const path = kind === 'photo' ? p.path : (p.media_path || p.path); try { download(await (await fetch(fileUrl(path))).blob(), path.split('/').pop()); } catch (err) { window.open(fileUrl(path), '_blank'); } };
  m.querySelector('#delPhoto').onclick = async () => {
    if (!confirm('Delete this from the gallery? The guest link stops working.')) return;
    try { await removeFiles([p.path, p.thumb_path, p.media_path, p.print_path, p.message_path, ...(p.originals || []), p.path && p.path.replace(/\.jpg$/, '-4r.jpg')]); check(await sb.from('photos').delete().eq('id', p.id)); m.remove(); renderGallery(); toast('Deleted'); } catch (err) { toast(err.message, 4000); }
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
  if (v === 'never') upd.album_expires_at = null;
  else if (v === '7') { const ev = EVENTS.find(e => e.id === galEvent), t = ev && ev.event_date ? Date.parse(ev.event_date) : NaN, d = new Date(Math.max(Date.now(), Number.isFinite(t) ? t : 0)); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 8); upd.album_expires_at = d.toISOString(); }   // through the 7th day after the event
  else if (v !== 'keep') upd.album_expires_at = new Date(Date.now() + +v * 864e5).toISOString();
  try { check(await sb.from('events').update(upd).eq('id', galEvent)); renderGallery(); toast('Album settings saved'); } catch (e) { toast(e.message, 4000); }
};
$('#gZip').onclick = async () => {
  if (!galPhotos.length) return toast('No photos to download yet.');
  const b = $('#gZip'); b.disabled = true;
  try {
    const zip = new JSZip(); let n = 0;
    for (const p of galPhotos.slice().reverse()) {
      n++; b.textContent = `Preparing ${n}/${galPhotos.length}…`;
      const k = p.kind || 'photo', paths = k === 'photo' ? [p.path, p.media_path].filter(Boolean) : [p.media_path || p.path];
      for (const path of paths) zip.file(`${String(n).padStart(3, '0')}-${k}.${path.split('.').pop()}`, await (await fetch(fileUrl(path))).blob());
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
// Print settings for this laptop: paper orientation in the DNP driver, fine position and size.
// bleed: the photo is printed slightly bigger than the paper (edges trimmed) so there is never a white line at an edge
const printCfg = () => ({ orient: 'portrait', dx: 0, dy: 0, scale: 100, bleed: 3, ...store.get('printCfg', {}) });
function renderPrintCfg() { const c = printCfg(); $('#pcOrient').value = c.orient; $('#pcDx').value = c.dx; $('#pcDy').value = c.dy; $('#pcSc').value = c.scale; $('#pcBleed').value = c.bleed; }
$('#pcSave').onclick = () => {
  const num = (id, lo, hi, d) => { const v = +$(id).value; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  store.set('printCfg', { orient: $('#pcOrient').value, dx: num('#pcDx', -15, 15, 0), dy: num('#pcDy', -15, 15, 0), scale: num('#pcSc', 90, 110, 100), bleed: num('#pcBleed', 0, 8, 3) });
  renderPrintCfg(); toast('Print settings saved on this laptop');
};
$('#pcTest').onclick = async () => {
  $('#pcSave').click();
  // 4x6 portrait test sheet at 300 dpi: border 2 mm in, dashed cut line in the middle, arrows to the top
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1800; const x = c.getContext('2d'), mm = 300 / 25.4;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 1800);
  x.strokeStyle = '#000'; x.lineWidth = 4; x.strokeRect(2 * mm, 2 * mm, 1200 - 4 * mm, 1800 - 4 * mm);
  x.setLineDash([24, 16]); x.strokeStyle = '#d00'; x.beginPath(); x.moveTo(600, 0); x.lineTo(600, 1800); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#000'; x.textAlign = 'center'; x.font = 'bold 54px system-ui'; x.fillText('▲ TOP ▲', 300, 120); x.fillText('▲ TOP ▲', 900, 120);
  x.font = '34px system-ui'; ['Border 2 mm from', 'every edge', '', 'Strips are cut', 'on the red line'].forEach((t, i) => { x.fillText(t, 300, 820 + i * 48); x.fillText(t, 900, 820 + i * 48); });
  try { await printImage(c.toDataURL('image/jpeg', .95), 1); } catch (e) { toast(e.message, 4000); }
};
function rotated(img, cw) {   // rotate an image 90° (clockwise when cw)
  const c = document.createElement('canvas'); c.width = img.naturalHeight || img.height; c.height = img.naturalWidth || img.width;
  const x = c.getContext('2d');
  if (cw) { x.translate(c.width, 0); x.rotate(Math.PI / 2); } else { x.translate(0, c.height); x.rotate(-Math.PI / 2); }
  x.drawImage(img, 0, 0); return c.toDataURL('image/jpeg', .95);
}
let printRun = 0;
async function printImage(src, copies) {
  const run = ++printRun;
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Could not download the photo to print')); i.src = src; });
  const cfg = printCfg(), landPage = cfg.orient === 'landscape', landImg = img.naturalWidth > img.naturalHeight;
  let url = src;
  if (landImg !== landPage) url = rotated(img, !landPage);   // turn the picture to match the paper
  else if (!src.startsWith('data:')) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); url = c.toDataURL('image/jpeg', .95); }
  const [pw, ph] = landPage ? ['6in', '4in'] : ['4in', '6in'];
  $('#pageStyle').textContent = `@page{size:${pw} ${ph};margin:0}`;
  const area = $('#printArea'); area.innerHTML = '';
  area.style.cssText = `--pw:${pw};--ph:${ph};--dx:${cfg.dx}mm;--dy:${cfg.dy}mm;--sc:${(cfg.scale / 100) * (1 + (cfg.bleed || 0) / 100)}`;
  for (let i = 0; i < Math.max(1, copies); i++) { const im = new Image(); im.src = url; im.alt = ''; area.appendChild(im); }
  await Promise.all([...area.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
  await sleep(150); if (run !== printRun) return; window.print(); await sleep(400); if (run === printRun) area.innerHTML = '';
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
  applyBrand(); renderBgPrev(); renderPq(); renderPsSettings(); renderStickerSettings(); renderGbStyleSettings(); renderAiBgSettings(); renderVoiceSettings();
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
  $('#pqChip').className = 'chip' + (S.printQr.on ? '' : ' mute'); $('#pqChip').textContent = S.printQr.on ? 'On · 12 h links' : 'Off';
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
/* ---- Printing screen settings ---- */
function renderPsSettings() {
  const P = S.printScreen;
  $('#psOn').checked = P.on !== false; $('#psTextIn').value = P.text || ''; $('#psSec').value = P.sec || 12; $('#psDim').value = P.dim ?? 25; $('#psDimV').textContent = (P.dim ?? 25) + '%';
  $$('#psKinds .pill').forEach(b => b.classList.toggle('on', b.dataset.k === P.kind));
  $$('#psThemes [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === P.theme));
  $('#psThemes').hidden = P.kind !== 'theme'; $('#psUploadRow').hidden = P.kind === 'theme'; $('#psDimRow').hidden = P.kind === 'theme';
  $('#psUploadLbl').textContent = { image: 'Upload photo', gif: 'Upload GIF', video: 'Upload video' }[P.kind] || '';
  $('#psFile').accept = { image: 'image/jpeg,image/png,image/webp', gif: 'image/gif', video: 'video/mp4,video/webm' }[P.kind] || '';
  $('#psFileName').textContent = P.src ? P.src.split('/').pop() : 'No file yet';
  psPreview();
}
let psSample = null;
async function psPreview(play) {
  const P = S.printScreen, box = $('#psPrev');
  box.style.setProperty('--ps-ink', paintPs($('#psPrevLayer'), $('#psPrevShade'), P));
  $('#psPrevText').textContent = P.text || 'Printing your photo…';
  if (!psSample) psSample = await compose({ ...BUILTIN[0], output_long: 600 }, samples(3), 'none', { name: ACTIVE ? ACTIVE.name : '', date: ACTIVE ? ACTIVE.event_date : '' });
  const img = $('#psPrevImg'); if (!img.src) img.src = psSample.toDataURL('image/jpeg', .8);
  layoutPs(box, psSample, box.clientWidth * .3, box.clientHeight * .62);
  if (play) playPs(box, Math.max(3, Math.min(30, +P.sec || 12)));
}
$('#psOn').onchange = () => { S.printScreen.on = $('#psOn').checked; };
$('#psKinds').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; if (S.printScreen.kind !== b.dataset.k) S.printScreen.src = ''; S.printScreen.kind = b.dataset.k; renderPsSettings(); });
$('#psThemes').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; S.printScreen.theme = b.dataset.t; renderPsSettings(); });
$('#psTextIn').addEventListener('input', () => { S.printScreen.text = $('#psTextIn').value.trim(); $('#psPrevText').textContent = S.printScreen.text || 'Printing your photo…'; });
$('#psSec').addEventListener('change', () => { S.printScreen.sec = Math.max(3, Math.min(30, Math.round(+$('#psSec').value || 12))); $('#psSec').value = S.printScreen.sec; });
$('#psDim').oninput = () => { S.printScreen.dim = +$('#psDim').value; $('#psDimV').textContent = S.printScreen.dim + '%'; psPreview(); };
$('#psPlay').onclick = () => psPreview(true);
$('#psFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const k = S.printScreen.kind, ok = k === 'video' ? /^video\/(mp4|webm)$/.test(f.type) : k === 'gif' ? f.type === 'image/gif' : /^image\/(jpeg|png|webp)$/.test(f.type);
  if (!ok) return toast('That file type does not match. Choose a ' + ({ image: 'JPG or PNG photo', gif: 'GIF', video: 'MP4 or WebM video' }[k]));
  if (f.size > 50 * 1024 * 1024) return toast('That file is over 50 MB.');
  $('#psFileName').textContent = 'Uploading ' + f.name + '…';
  try { const path = `u-${USER.id}/ps-${Date.now().toString(36)}.${f.name.split('.').pop().toLowerCase()}`; await upload(path, f, f.type); S.printScreen.src = fileUrl(path); $('#psFileName').textContent = f.name; psPreview(); toast('Uploaded. Press Save to use it on the tablet.'); }
  catch (err) { $('#psFileName').textContent = 'Upload failed'; toast(err.message, 4000); }
});
/* ---- Stickers, guestbook and beauty settings (Studio settings) ---- */
function renderStickerSettings() {
  const st = S.stickers;
  $('#stOn').checked = st.on !== false;
  $('#stPacksAdmin').innerHTML = Object.entries(STICKER_PACKS).map(([k, [n, em]]) => `<button class="pill ${(st.packs || []).includes(k) ? 'on' : ''}" data-pk="${k}">${em[0]} ${n}</button>`).join('');
  $('#stCustom').innerHTML = (st.custom || []).map((u, i) => `<button data-rmc="${i}" title="Remove"><img src="${esc(u.url || u)}" alt="" crossorigin="anonymous"><span class="x">✕</span></button>`).join('') || '<span class="lbl">None yet</span>';
  $('#stTexts').innerHTML = (st.texts || []).map((t, i) => `<button class="pill" data-rmt="${i}" title="Remove" style="font-family:'${esc(t.font || 'Geist')}';color:${esc(t.color || '#fff')}">${esc(t.t)} <span style="color:#ff8a80">✕</span></button>`).join('') || '<span class="lbl">None yet</span>';
  if (!$('#stTextFont').options.length) $('#stTextFont').innerHTML = SMILE_FONTS.map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
  const g = S.guestbook;
  $('#gbOn').checked = !!g.on; $('#gbPromptIn').value = g.prompt || ''; $('#gbAuto').checked = !!g.auto; $('#beautyDef').value = String(+S.beauty || 0);
}
$('#stOn').onchange = () => { S.stickers.on = $('#stOn').checked; };
$('#stPacksAdmin').addEventListener('click', e => {
  const b = e.target.closest('[data-pk]'); if (!b) return;
  const set = new Set(S.stickers.packs || []); set.has(b.dataset.pk) ? set.delete(b.dataset.pk) : set.add(b.dataset.pk);
  S.stickers.packs = Object.keys(STICKER_PACKS).filter(k => set.has(k)); renderStickerSettings();
});
$('#stCustom').addEventListener('click', e => { const b = e.target.closest('[data-rmc]'); if (!b || !confirm('Remove this sticker?')) return; S.stickers.custom.splice(+b.dataset.rmc, 1); renderStickerSettings(); });
$('#stTexts').addEventListener('click', e => { const b = e.target.closest('[data-rmt]'); if (!b) return; S.stickers.texts.splice(+b.dataset.rmt, 1); renderStickerSettings(); });
$('#stTextAdd').onclick = () => {
  const t = $('#stTextIn').value.trim(); if (!t) return toast('Type the sticker text first');
  S.stickers.texts = [...(S.stickers.texts || []), { t, font: $('#stTextFont').value, color: $('#stTextColor').value }]; $('#stTextIn').value = ''; renderStickerSettings();
};
$('#stFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (!/^image\/(png|webp)$/.test(f.type)) { toast('Use PNG or WebP stickers (with a transparent background).'); continue; }
    if (f.size > 5 * 1024 * 1024) { toast(f.name + ' is over 5 MB.'); continue; }
    try { const path = `u-${USER.id}/stk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${f.type === 'image/webp' ? 'webp' : 'png'}`; await upload(path, f, f.type); S.stickers.custom = [...(S.stickers.custom || []), { url: fileUrl(path) }]; }
    catch (err) { toast(err.message, 4000); }
  }
  renderStickerSettings(); toast('Uploaded. Press Save to send to the tablet.');
});
$('#gbOn').onchange = () => { S.guestbook.on = $('#gbOn').checked; };
$('#gbPromptIn').addEventListener('input', () => { S.guestbook.prompt = $('#gbPromptIn').value.trim(); });
$('#gbAuto').onchange = () => { S.guestbook.auto = $('#gbAuto').checked; };
$('#beautyDef').onchange = () => { S.beauty = +$('#beautyDef').value; };

/* ---- Guestbook look: the writing card and the screen behind it (also used for the PDF pages) ---- */
const GB_PAPERS = {
  cream: ['Cream', '#fffdf8', '#fffdf8'],
  white: ['White', '#ffffff', '#ffffff'],
  lined: ['Lined', 'linear-gradient(90deg,transparent 58px,#f0b4b4 58px 60px,transparent 60px),repeating-linear-gradient(#fffdf8 0 38px,#c9dcf0 38px 40px)', '#fffdf8'],
  dotted: ['Dotted', 'radial-gradient(#d6ccbc 1.6px,transparent 2.2px) 0 0/26px 26px,#fffdf8', '#fffdf8'],
  kraft: ['Kraft', 'radial-gradient(rgba(90,60,30,.08) 1px,transparent 1.5px) 0 0/7px 7px,#d9bb8f', '#d9bb8f'],
  blush: ['Blush', 'radial-gradient(120% 90% at 20% 10%,#fff4f6,#fbdde4)', '#fde8ec'],
};
const GB_SCREENS = ['#141416', '#2b1d1f', '#1d2433', '#24301f', '#3a2b1c', '#f4efe6'];
const gbStyle = () => ({ paper: 'cream', paperSrc: '', screen: '#141416', screenSrc: '', ...(S.guestbook || {}) });
// The card and the screen behind it, on the tablet (or the admin preview)
function paintGuestbook(screenEl, padEl) {
  const g = gbStyle(), paper = GB_PAPERS[g.paper] || GB_PAPERS.cream;
  padEl.style.background = g.paper === 'image' && g.paperSrc ? `url("${g.paperSrc}") center/cover no-repeat, #fff` : paper[1];
  screenEl.style.background = g.screenSrc ? `url("${g.screenSrc}") center/cover no-repeat, ${g.screen}` : `radial-gradient(90% 80% at 50% 30%, ${g.screen}, ${g.screen === '#f4efe6' ? '#e6dccb' : '#0b0b0c'})`;
  const light = !g.screenSrc && g.screen === '#f4efe6';
  screenEl.classList.toggle('gblight', light);
}
function renderGbStyleSettings() {
  const g = gbStyle();
  $('#gbPapers').innerHTML = Object.entries(GB_PAPERS).map(([k, [n, css]]) => `<button class="gbsw ${g.paper === k ? 'on' : ''}" data-paper="${k}" style="background:${css}" title="${n}"><span>${n}</span></button>`).join('')
    + `<button class="gbsw ${g.paper === 'image' ? 'on' : ''}" data-paper="image" style="${g.paperSrc ? `background:url('${esc(g.paperSrc)}') center/cover` : ''}" title="Your picture"><span>${g.paperSrc ? 'Your picture' : 'Upload…'}</span></button>`;
  $('#gbScreens').innerHTML = GB_SCREENS.map(c => `<button class="sw ${!g.screenSrc && g.screen === c ? 'on' : ''}" data-screen="${c}" style="background:${c}" aria-label="Screen colour ${c}"></button>`).join('');
  $('#gbScreenFileName').textContent = g.screenSrc ? 'Picture in use' : 'No picture';
  $('#gbScreenClear').hidden = !g.screenSrc;
  $('#gbPdfBg').checked = g.pdfBg !== false;
  paintGuestbook($('#gbPrev'), $('#gbPrevPad'));
}
$('#gbPapers').addEventListener('click', e => {
  const b = e.target.closest('[data-paper]'); if (!b) return;
  if (b.dataset.paper === 'image' && !S.guestbook.paperSrc) return $('#gbPaperFile').click();
  S.guestbook.paper = b.dataset.paper; renderGbStyleSettings();
});
$('#gbScreens').addEventListener('click', e => { const b = e.target.closest('[data-screen]'); if (!b) return; S.guestbook.screen = b.dataset.screen; S.guestbook.screenSrc = ''; renderGbStyleSettings(); });
$('#gbScreenClear').onclick = () => { S.guestbook.screenSrc = ''; renderGbStyleSettings(); };
$('#gbPdfBg').onchange = () => { S.guestbook.pdfBg = $('#gbPdfBg').checked; };
async function gbUpload(f, prefix) {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Use a JPG or PNG picture.'); return ''; }
  if (f.size > 15 * 1024 * 1024) { toast('That picture is over 15 MB.'); return ''; }
  const path = `u-${USER.id}/${prefix}-${Date.now().toString(36)}.${f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg'}`;
  await upload(path, f, f.type); return fileUrl(path);
}
$('#gbPaperFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const u = await gbUpload(f, 'gbcard'); if (u) { S.guestbook.paperSrc = u; S.guestbook.paper = 'image'; renderGbStyleSettings(); toast('Uploaded. Press Save to send to the tablet.'); } } catch (err) { toast(err.message, 4000); }
});
$('#gbScreenFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const u = await gbUpload(f, 'gbscreen'); if (u) { S.guestbook.screenSrc = u; renderGbStyleSettings(); toast('Uploaded. Press Save to send to the tablet.'); } } catch (err) { toast(err.message, 4000); }
});
/* ---- Video guestbook settings (Capture & media) ---- */
function renderVideoBookSettings() {
  const v = S.videoBook;
  $('#vbOn').checked = !!v.on; $('#vbSec').value = v.sec || 20; $('#vbPrompt').value = v.prompt || '';
}
$('#vbOn').onchange = () => { S.videoBook.on = $('#vbOn').checked; S.modes.video = S.videoBook.on; };
$('#vbSec').onchange = () => { S.videoBook.sec = Math.max(5, Math.min(60, Math.round(+$('#vbSec').value || 20))); $('#vbSec').value = S.videoBook.sec; };
$('#vbPrompt').addEventListener('input', () => { S.videoBook.prompt = $('#vbPrompt').value.trim(); });

/* ---- Video guestbook montage: every video message of the event in one video, on a themed frame ---- */
const MT_BGS = { leather: ['Leather', '#5b1a17', '#ffffff'], navy: ['Navy', '#1d2433', '#ffffff'], black: ['Black', '#111111', '#ffffff'], sage: ['Sage', '#7f927a', '#ffffff'], blush: ['Blush', '#f3d3da', '#5b2a33'], cream: ['Cream', '#f1e9dc', '#4a3b2a'] };
const MT_ANIMS = { none: 'Static', fade: 'Fade in', float: 'Float', bounce: 'Bounce', pulse: 'Pulse', wave: 'Wave', swing: 'Swing', type: 'Typewriter', pop: 'Pop', glow: 'Glow' };
const MT_ANIM_DEFAULT = { titleAnim: 'float', namesAnim: 'glow', dateAnim: 'fade', capAnim: 'pop' };
let mtTexture = {};
// A soft texture so plain colours look like card or leather
function mtBackground(W, H, key) {
  const k = key + W + 'x' + H; if (mtTexture[k]) return mtTexture[k];
  const [, base] = MT_BGS[key] || MT_BGS.leather, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  if (key === 'leather') {   // pebbled leather: many small soft cells
    for (let i = 0; i < W * H / 260; i++) { const px = Math.random() * W, py = Math.random() * H, r = 4 + Math.random() * 9; x.fillStyle = `rgba(0,0,0,${.05 + Math.random() * .12})`; x.beginPath(); x.ellipse(px, py, r, r * (.6 + Math.random() * .5), Math.random() * 3, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,.035)'; x.beginPath(); x.arc(px - 2, py - 2, r * .5, 0, 7); x.fill(); }
  } else {
    for (let i = 0; i < W * H / 90; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},.035)`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  }
  const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return (mtTexture[k] = c);
}
function mtLayout(o) {
  const port = o.format !== 'landscape', W = port ? 1080 : 1920, H = port ? 1920 : 1080;
  const win = port ? { x: 60, y: 560, w: 960, h: 540 } : { x: 385, y: 190, w: 1150, h: 647 };
  return { W, H, port, win, titleY: port ? 380 : 120, namesY: port ? 1400 : 950, dateY: port ? 1500 : 1030 };
}
// The parts that never move (background picture or texture), drawn once and reused for every frame
function mtStatic(o, L, bgImg) {
  const c = document.createElement('canvas'); c.width = L.W; c.height = L.H; const x = c.getContext('2d');
  if (bgImg) { const k = Math.max(L.W / bgImg.width, L.H / bgImg.height); x.drawImage(bgImg, (L.W - bgImg.width * k) / 2, (L.H - bgImg.height * k) / 2, bgImg.width * k, bgImg.height * k); }
  else x.drawImage(mtBackground(L.W, L.H, o.bg), 0, 0);
  return c;
}
const easeOutBack = p => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
// Text with a movement. t = seconds since the movement started.
function mtText(x, text, cx, cy, font, color, anim, t, maxW, box) {
  if (!text) return;
  x.save(); x.font = font; x.textBaseline = 'middle';
  const size = parseFloat((font.match(/(\d+(?:\.\d+)?)px/) || [0, 40])[1]), chars = [...text];
  let alpha = 1, dy = 0, sc = 1, rot = 0, shown = text, glow = 0;
  switch (anim) {
    case 'fade': alpha = Math.min(1, t / 1.2); break;
    case 'float': dy = Math.sin(t * 2) * size * .08; break;
    case 'bounce': dy = -Math.abs(Math.sin(t * 3.2)) * size * .22; break;
    case 'pulse': sc = 1 + Math.sin(t * 3) * .06; break;
    case 'swing': rot = Math.sin(t * 2.2) * .07; break;
    case 'type': shown = chars.slice(0, Math.min(chars.length, Math.floor(t * 14))).join(''); break;
    case 'pop': { const p = Math.min(1, t / .45); sc = p < 1 ? .3 + .7 * easeOutBack(p) : 1; alpha = Math.min(1, t / .2); break; }
    case 'glow': glow = 12 + (Math.sin(t * 3) + 1) * 16; break;
  }
  const full = x.measureText(text).width, fit = maxW && full > maxW ? maxW / full : 1;
  x.globalAlpha = alpha; x.translate(cx, cy + dy); x.rotate(rot); x.scale(sc * fit, sc * fit);
  if (box) { x.fillStyle = box; x.beginPath(); x.roundRect(-full / 2 - size * .45, -size * .78, full + size * .9, size * 1.56, size * .3); x.fill(); }
  x.fillStyle = color; x.shadowColor = anim === 'glow' ? color : 'rgba(0,0,0,.35)'; x.shadowBlur = anim === 'glow' ? glow : (box ? 0 : 10);
  if (anim === 'wave') { let px = -full / 2; x.textAlign = 'left'; chars.forEach((ch, i) => { x.fillText(ch, px, Math.sin(t * 4 - i * .5) * size * .12); px += x.measureText(ch).width; }); }
  else if (anim === 'type') { x.textAlign = 'left'; x.fillText(shown, -full / 2, 0); }
  else { x.textAlign = 'center'; x.fillText(shown, 0, 0); }
  x.restore();
}
// One frame: the fixed background, the video window (with caption), and the moving words.
// t = seconds since the montage started; tc = seconds since this message started.
function mtDraw(x, o, L, stat, frame, caption, fade, t, tc) {
  const { W, win } = L, col = o.color || '#fff';
  x.drawImage(stat, 0, 0);
  mtText(x, (o.title || 'Video Guestbook').toUpperCase(), W / 2, L.titleY, `${L.port ? 120 : 96}px "Bebas Neue", Geist, sans-serif`, col, o.titleAnim || 'none', t, W - 100);
  x.save(); x.beginPath(); x.roundRect(win.x, win.y, win.w, win.h, 34); x.clip();
  x.fillStyle = '#000'; x.fillRect(win.x, win.y, win.w, win.h);
  if (frame) {
    const iw = frame.videoWidth || frame.width, ih = frame.videoHeight || frame.height;
    if (iw && ih) { const k = Math.max(win.w / iw, win.h / ih); x.drawImage(frame, win.x + (win.w - iw * k) / 2, win.y + (win.h - ih * k) / 2, iw * k, ih * k); }
  }
  if (caption) mtText(x, caption, W / 2, win.y + win.h - 62, `700 ${L.port ? 40 : 38}px Geist, system-ui, sans-serif`, '#fff', o.capAnim || 'none', tc, win.w - 90, 'rgba(0,0,0,.6)');
  if (fade) { x.fillStyle = `rgba(0,0,0,${fade})`; x.fillRect(win.x, win.y, win.w, win.h); }
  x.restore();
  x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 3; x.beginPath(); x.roundRect(win.x, win.y, win.w, win.h, 34); x.stroke();
  mtText(x, o.names || '', W / 2, L.namesY, `${L.port ? 130 : 104}px "${o.font || 'Great Vibes'}", cursive`, col, o.namesAnim || 'none', t, W - 80);
  mtText(x, o.date || '', W / 2, L.dateY, `500 ${L.port ? 40 : 34}px Geist, system-ui, sans-serif`, col, o.dateAnim || 'none', t, W - 80);
}
const mtFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function mtVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.playsInline = true; v.preload = 'auto'; v.src = src;
    v.onloadeddata = () => res(v); v.onerror = () => rej(new Error('Could not load a video'));
  });
}
async function renderMontage(clips, o, onProgress, cancel) {
  const L = mtLayout(o), c = document.createElement('canvas'); c.width = L.W; c.height = L.H; const x = c.getContext('2d');
  await Promise.all([document.fonts.load(`120px "Bebas Neue"`), document.fonts.load(`120px "${o.font || 'Great Vibes'}"`)]).catch(() => {});
  const stat = mtStatic(o, L, o.bg === 'image' && o.bgSrc ? await loadImg(o.bgSrc) : null);
  const ac = new (window.AudioContext || window.webkitAudioContext)(), dest = ac.createMediaStreamDestination();
  // A constant, inaudible signal keeps the sound track running from the first moment. Without it the recorder
  // skips the silent intro and every message's sound comes out earlier than its picture.
  const keep = ac.createConstantSource(); keep.offset.value = 1e-4; keep.connect(dest); keep.start();
  // Drawing and capturing a picture takes about 0.1 s, so the sound waits the same time and both stay together
  const lag = ac.createDelay(1); lag.delayTime.value = .1; lag.connect(dest);
  // Frames are added by hand (one per drawing), so every picture carries the exact time it was shown,
  // in step with the sound that plays at that moment.
  const vtrack = c.captureStream(0).getVideoTracks()[0];
  const stream = new MediaStream([vtrack, ...dest.stream.getAudioTracks()]);
  const mime = recMime(), chunks = [];
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160e3 } : {});
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  const total = clips.reduce((t, k) => t + (k.dur || 10), 0) + 4; let done = 0;
  const T0 = performance.now(), now = () => (performance.now() - T0) / 1000;
  let lastPaint = 0;
  const paint = (frame, cap, fade, tc) => { const p = performance.now(); if (p - lastPaint < 30) return; lastPaint = p; mtDraw(x, o, L, stat, frame, cap, fade, now(), tc); vtrack.requestFrame(); };
  await ac.resume().catch(() => {});
  rec.start(500);
  // intro: the frame on its own for 2 seconds
  for (const ti = performance.now(); performance.now() - ti < 2000 && !cancel.on;) { paint(null, '', 0, 0); await mtFrame(); }
  done += 2; onProgress(done / total);
  for (const k of clips) {
    if (cancel.on) break;
    const v = await mtVideo(k.src || k.url); const node = ac.createMediaElementSource(v); node.connect(lag);
    await v.play();
    const t0 = performance.now();
    while (!v.ended && !cancel.on) {
      const el = (performance.now() - t0) / 1000, left = v.duration ? v.duration - v.currentTime : 1;
      const fade = el < .35 ? 1 - el / .35 : left < .3 ? 1 - left / .3 : 0;
      paint(v, k.caption || '', Math.max(0, Math.min(1, fade)), v.currentTime);
      onProgress(Math.min(1, (done + v.currentTime) / total));
      await mtFrame();
    }
    v.pause(); node.disconnect(); done += k.dur || v.duration || 0;
  }
  for (const ti = performance.now(); performance.now() - ti < 2000 && !cancel.on;) { paint(null, '', 0, 0); await mtFrame(); }
  rec.stop(); await stopped; vtrack.stop(); keep.stop(); ac.close().catch(() => {});
  return cancel.on ? null : new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
}
$('#gVideoBook').onclick = async () => {
  const ev = EVENTS.find(e => e.id === galEvent); if (!ev) return;
  const list = galPhotos.filter(p => p.kind === 'video' && p.media_path).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!list.length) return toast('No video messages for this event yet. Turn on Video guestbook in Capture & media.', 6000);
  const o = { ...MT_ANIM_DEFAULT, ...S.videoBook.montage }; if (!o.names) o.names = ev.name || ''; o.date = ev.event_date || '';
  const caps = {}, chosen = new Set(list.map(p => p.id));
  const animSel = (id, label) => `<label class="field" style="width:150px">${label}<select class="in" id="${id}">${Object.entries(MT_ANIMS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>`;
  const m = modal(`<div class="row" style="justify-content:space-between"><b>🎬 Video guestbook · ${esc(ev.name)}</b><button class="ico" data-close aria-label="Close">✕</button></div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start">
      <div style="flex:none;display:flex;flex-direction:column;gap:8px;align-items:center"><canvas id="mtPrev" style="border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:100%"></canvas><span class="lbl" style="font-size:12px">Live preview of the movements</span></div>
      <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px">
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="pill" data-fmt="portrait">Portrait 1080×1920 (TikTok / Reels)</button><button class="pill" data-fmt="landscape">Landscape 1920×1080</button></div>
        <div><div class="lbl" style="margin-bottom:6px">Background</div><div class="row" id="mtBgs" style="gap:6px;flex-wrap:wrap"></div>
          <div class="row" style="gap:8px;margin-top:6px"><label class="btn sm" for="mtBgFile" style="cursor:pointer">Upload background</label><input type="file" id="mtBgFile" accept="image/jpeg,image/png,image/webp" hidden><span class="lbl" style="font-size:12px">Best: 1080 × 1920 (portrait)</span></div></div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="flex:1;min-width:150px">Title<input class="in" id="mtTitle" maxlength="30"></label><label class="field" style="flex:1;min-width:150px">Names<input class="in" id="mtNames" maxlength="40"></label></div>
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="field" style="width:190px">Names font<select class="in" id="mtFont">${SMILE_FONTS.map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('')}</select></label><label class="field" style="width:90px">Text colour<input type="color" id="mtColor" style="width:100%;height:42px;border:0;background:none;padding:0"></label></div>
        <div><div class="lbl" style="margin-bottom:6px">Movement of the words</div><div class="row" style="gap:8px;flex-wrap:wrap">${animSel('mtTitleAnim', 'Title')}${animSel('mtNamesAnim', 'Names')}${animSel('mtDateAnim', 'Date')}${animSel('mtCapAnim', 'Captions')}</div></div>
        <div class="lbl">Messages (${list.length}) — untick to leave out, use ↑ ↓ to change the order, and add a caption if you like</div>
        <div id="mtClips" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto"></div>
        <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><button class="btn pri" id="mtMake">Make video</button><button class="btn" id="mtCancel" hidden>Stop</button><span class="lbl" id="mtInfo"></span></div>
        <div style="height:8px;border-radius:4px;background:#2a2a2e" id="mtBarWrap" hidden><div id="mtBar" style="height:8px;border-radius:4px;background:var(--accent);width:0"></div></div>
        <div class="lbl" style="font-size:12px">The video is made in real time on this laptop (about as long as all the messages together). Keep this tab open in front while it works.</div>
      </div>
    </div>`, 1020);
  let order = list.slice();
  const prev = m.querySelector('#mtPrev'), px = prev.getContext('2d');
  let firstPoster = null, stat = null, statKey = '';
  loadImg(fileUrl(list[0].path)).then(i => { firstPoster = i; });
  // the preview keeps playing so the movements can be seen
  const tStart = performance.now();
  (async function loop() {
    while (document.body.contains(prev)) {
      const L = mtLayout(o), key = o.format + o.bg + o.bgSrc;
      if (prev.width !== L.W) { prev.width = L.W; prev.height = L.H; prev.style.width = (L.port ? 270 : 420) + 'px'; }
      if (key !== statKey) { statKey = key; stat = mtStatic(o, L, o.bg === 'image' && o.bgSrc ? await loadImg(o.bgSrc) : null); }
      const t = (performance.now() - tStart) / 1000;
      mtDraw(px, o, L, stat, firstPoster, caps[order[0].id] || (o.capAnim !== 'none' ? 'Your caption here' : ''), 0, t % 6, t % 4);
      await mtFrame();
    }
  })();
  function renderOpts() {
    m.querySelectorAll('[data-fmt]').forEach(b => b.classList.toggle('on', b.dataset.fmt === (o.format || 'portrait')));
    m.querySelector('#mtBgs').innerHTML = Object.entries(MT_BGS).map(([k, [n, c]]) => `<button class="pill ${o.bg === k ? 'on' : ''}" data-bg="${k}"><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:${c};vertical-align:-1px;margin-right:6px;border:1px solid #fff4"></span>${n}</button>`).join('') + (o.bgSrc ? `<button class="pill ${o.bg === 'image' ? 'on' : ''}" data-bg="image">Your picture</button>` : '');
    m.querySelector('#mtTitle').value = o.title || ''; m.querySelector('#mtNames').value = o.names || ''; m.querySelector('#mtFont').value = o.font || 'Great Vibes'; m.querySelector('#mtColor').value = o.color || '#ffffff';
    [['mtTitleAnim', 'titleAnim'], ['mtNamesAnim', 'namesAnim'], ['mtDateAnim', 'dateAnim'], ['mtCapAnim', 'capAnim']].forEach(([id, k]) => { m.querySelector('#' + id).value = o[k] || 'none'; });
    m.querySelector('#mtClips').innerHTML = order.map((p, i) => `<div class="row" style="gap:8px;align-items:center;background:#1a1a1c;border:1px solid var(--line);border-radius:10px;padding:6px">
      <input type="checkbox" data-pick="${p.id}" ${chosen.has(p.id) ? 'checked' : ''} aria-label="Include message ${i + 1}">
      <img src="${fileUrl(p.thumb_path || p.path)}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:6px">
      <span class="mono lbl" style="width:58px">${timeOf(p.created_at)}</span>
      <input class="in" data-cap="${p.id}" placeholder="Caption (optional)" value="${esc(caps[p.id] || '')}" style="flex:1;min-width:80px;height:34px">
      <button class="btn sm" data-up="${i}" aria-label="Move up">↑</button><button class="btn sm" data-down="${i}" aria-label="Move down">↓</button></div>`).join('');
  }
  m.addEventListener('click', e => {
    const f = e.target.closest('[data-fmt]'); if (f) { o.format = f.dataset.fmt; return renderOpts(); }
    const b = e.target.closest('[data-bg]'); if (b) { o.bg = b.dataset.bg; if (o.bg !== 'image') o.color = MT_BGS[o.bg][2]; return renderOpts(); }
    const u = e.target.closest('[data-up]'), d = e.target.closest('[data-down]');
    if (u || d) { const i = +(u || d).dataset[u ? 'up' : 'down'], j = u ? i - 1 : i + 1; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; renderOpts(); }
  });
  m.addEventListener('change', e => {
    const c = e.target.closest('[data-pick]'); if (c) { c.checked ? chosen.add(c.dataset.pick) : chosen.delete(c.dataset.pick); return; }
    const a = { mtTitleAnim: 'titleAnim', mtNamesAnim: 'namesAnim', mtDateAnim: 'dateAnim', mtCapAnim: 'capAnim', mtFont: 'font' }[e.target.id]; if (a) o[a] = e.target.value;
  });
  m.addEventListener('input', e => {
    const c = e.target.closest('[data-cap]'); if (c) { caps[c.dataset.cap] = c.value.trim(); return; }
    if (e.target.id === 'mtTitle') o.title = e.target.value; if (e.target.id === 'mtNames') o.names = e.target.value; if (e.target.id === 'mtColor') o.color = e.target.value;
  });
  m.querySelector('#mtBgFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const u = await gbUpload(f, 'mtbg'); if (u) { o.bgSrc = u; o.bg = 'image'; renderOpts(); } } catch (err) { toast(err.message, 4000); }
  });
  renderOpts();
  const cancel = { on: false };
  m.querySelector('#mtCancel').onclick = () => { cancel.on = true; };
  m.querySelector('#mtMake').onclick = async () => {
    const clips = order.filter(p => chosen.has(p.id)).map(p => ({ url: fileUrl(p.media_path), caption: caps[p.id] || '', dur: 0 }));
    if (!clips.length) return toast('Tick at least one message');
    const mk = m.querySelector('#mtMake'); mk.disabled = true; m.querySelector('#mtCancel').hidden = false; m.querySelector('#mtBarWrap').hidden = false; cancel.on = false;
    // remember the look for next time (not the names, which belong to this event)
    S.videoBook.montage = { format: o.format, bg: o.bg, bgSrc: o.bgSrc, title: o.title, font: o.font, color: o.color, names: '', titleAnim: o.titleAnim, namesAnim: o.namesAnim, dateAnim: o.dateAnim, capAnim: o.capAnim }; saveStudio().catch(() => {});
    const urls = [];
    try {
      // Download every message first, so nothing stops to buffer while the montage is being made
      for (const [i, k] of clips.entries()) {
        m.querySelector('#mtInfo').textContent = `Getting the videos… ${i + 1}/${clips.length}`;
        try { const b = await (await fetch(k.url)).blob(); k.src = URL.createObjectURL(b); urls.push(k.src); const v = await mtVideo(k.src); k.dur = isFinite(v.duration) ? v.duration : 10; v.removeAttribute('src'); v.load(); } catch (e) { k.dur = 10; }
      }
      const t0 = Date.now();
      const blob = await renderMontage(clips, o, f => {
        m.querySelector('#mtBar').style.width = Math.round(f * 100) + '%';
        const el = (Date.now() - t0) / 1000, left = f > .02 ? Math.max(0, el / f - el) : 0;
        m.querySelector('#mtInfo').textContent = `Making the video… ${Math.round(f * 100)}%${left ? ` · about ${Math.ceil(left / 60)} min left` : ''}`;
      }, cancel);
      if (!blob) { m.querySelector('#mtInfo').textContent = 'Stopped.'; }
      else {
        const ext = blob.type === 'video/mp4' ? 'mp4' : 'webm';
        download(blob, `video-guestbook-${(ev.name || 'event').replace(/[^\w]+/g, '-')}.${ext}`);
        m.querySelector('#mtInfo').textContent = `Done · ${(blob.size / 1048576).toFixed(1)} MB downloaded (${ext.toUpperCase()})`;
      }
    } catch (e) { m.querySelector('#mtInfo').textContent = 'Could not make the video: ' + e.message; }
    urls.forEach(u => URL.revokeObjectURL(u));
    mk.disabled = false; m.querySelector('#mtCancel').hidden = true;
  };
};
/* ---- Admin: AI backgrounds, voice guide and music (Studio settings) ---- */
function renderAiBgSettings() {
  const A = S.aiBg;
  $('#abOn').checked = A.on !== false;
  $('#abBuiltin').innerHTML = Object.entries(AIBG_BUILTIN).map(([k, [n]]) => `<button class="pill ${(A.builtin || []).includes(k) ? 'on' : ''}" data-ab="${k}">${n}</button>`).join('') + `<button class="pill ${A.blur !== false ? 'on' : ''}" data-ab="blur">Blur</button>`;
  $('#abList').innerHTML = (A.list || []).map((u, i) => `<div class="abitem"><img src="${esc(u.url)}" alt="" crossorigin="anonymous"><input class="in" data-abn="${i}" value="${esc(u.name || '')}" placeholder="Name" maxlength="20"><button class="btn sm" data-abrm="${i}" style="color:#ff8a80">Remove</button></div>`).join('') || '<span class="lbl">None yet</span>';
}
$('#abOn').onchange = () => { S.aiBg.on = $('#abOn').checked; };
$('#abBuiltin').addEventListener('click', e => {
  const b = e.target.closest('[data-ab]'); if (!b) return;
  if (b.dataset.ab === 'blur') S.aiBg.blur = S.aiBg.blur === false;
  else { const set = new Set(S.aiBg.builtin || []); set.has(b.dataset.ab) ? set.delete(b.dataset.ab) : set.add(b.dataset.ab); S.aiBg.builtin = Object.keys(AIBG_BUILTIN).filter(k => set.has(k)); }
  renderAiBgSettings();
});
$('#abList').addEventListener('input', e => { const i = e.target.dataset.abn; if (i != null) S.aiBg.list[+i].name = e.target.value.trim(); });
$('#abList').addEventListener('click', e => { const b = e.target.closest('[data-abrm]'); if (!b || !confirm('Remove this background?')) return; S.aiBg.list.splice(+b.dataset.abrm, 1); renderAiBgSettings(); });
$('#abFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    try { const u = await gbUpload(f, 'aibg'); if (u) S.aiBg.list = [...(S.aiBg.list || []), { url: u, name: f.name.replace(/\.[^.]+$/, '').slice(0, 20) }]; } catch (err) { toast(err.message, 4000); }
  }
  renderAiBgSettings(); toast('Uploaded. Press Save to send to the tablet.');
});

function renderVoiceSettings() {
  const V = S.voice, M = S.music;
  $('#voOn').checked = !!V.on; $('#voLang').value = V.lang || 'ms-MY'; $('#voVol').value = Math.round((V.volume ?? 1) * 100);
  $('#voLines').innerHTML = Object.entries(VOICE_LINES).map(([k, [when]]) => `<div class="voline"><span class="lbl" style="width:150px;flex:none">${when}</span>
    <input class="in" data-vl="${k}" value="${esc(voiceLine(k))}" maxlength="90" style="flex:1;min-width:160px">
    <button class="btn sm" data-vtest="${k}" title="Listen">▶</button>
    <button class="btn sm" data-vrec="${k}">${V.clips && V.clips[k] ? '● Re-record' : '● Record my voice'}</button>
    <button class="btn sm" data-vup="${k}" title="MP3, or a video/audio file (it becomes MP3)">⬆ Upload</button>
    ${V.clips && V.clips[k] ? `<button class="btn sm" data-vdel="${k}" title="Use the computer voice again" style="color:#ff8a80">✕</button>` : ''}</div>`).join('');
  $('#muOn').checked = !!M.on; $('#muVol').value = Math.round((M.volume ?? .35) * 100);
  $$('#muRepeat [data-rep]').forEach(b => b.classList.toggle('on', b.dataset.rep === (M.repeat || 'one')));
  $('#muList').innerHTML = (M.tracks || []).map((t, i) => `<div class="voline"><span style="flex:1;min-width:120px">🎵 ${esc(t.name || 'Track')}</span>
    <span class="row" style="gap:4px;flex-wrap:wrap">${allTypes().map(ty => `<button class="pill ${(t.types || []).includes(ty) ? 'on' : ''}" data-mut="${i}" data-ty="${esc(ty)}">${esc(ty)}</button>`).join('')}</span>
    <button class="btn sm" data-mup="${i}">▶</button><button class="btn sm" data-murm="${i}" style="color:#ff8a80">Remove</button></div>`).join('') || '<span class="lbl">No music yet</span>';
}
let voRec = null, adminAudio = null, voUpKey = '';
// Any sound or video file → MP3, here in the browser (MP3 files are kept as they are)
async function toMp3(file, maxSec = 60) {
  if (file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name)) return file;
  if (file.size > 300 * 1024 * 1024) throw new Error('That file is over 300 MB.');
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  let audio; try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); } catch (e) { throw new Error('Could not read the sound in that file. Try an MP4, MOV, M4A, WAV or MP3.'); }
  await loadScript('../vendor/lame.min.js');
  const sr = audio.sampleRate, n = Math.min(audio.length, Math.round(sr * maxSec)), chs = audio.numberOfChannels, pcm = new Int16Array(n);
  const data = [...Array(chs)].map((_, c) => audio.getChannelData(c));
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < chs; c++) v += data[c][i]; v /= chs; pcm[i] = Math.max(-1, Math.min(1, v)) * 32767; }
  const enc = new window.lamejs.Mp3Encoder(1, sr, 128), parts = [];
  for (let i = 0; i < n; i += 1152) { const b = enc.encodeBuffer(pcm.subarray(i, i + 1152)); if (b.length) parts.push(b); if (i % (1152 * 400) === 0) await sleep(0); }
  const end = enc.flush(); if (end.length) parts.push(end);
  return new Blob(parts, { type: 'audio/mpeg' });
}
$('#voOn').onchange = () => { S.voice.on = $('#voOn').checked; };
$('#voLang').onchange = () => { S.voice.lang = $('#voLang').value; };
$('#voVol').oninput = () => { S.voice.volume = +$('#voVol').value / 100; };
$('#muOn').onchange = () => { S.music.on = $('#muOn').checked; };
$('#muRepeat').addEventListener('click', e => { const b = e.target.closest('[data-rep]'); if (!b) return; S.music.repeat = b.dataset.rep; renderVoiceSettings(); });
$('#muVol').oninput = () => { S.music.volume = +$('#muVol').value / 100; if (adminAudio) adminAudio.volume = S.music.volume; };
$('#voLines').addEventListener('input', e => { const k = e.target.dataset.vl; if (k) S.voice.lines = { ...(S.voice.lines || {}), [k]: e.target.value }; });
$('#voLines').addEventListener('click', async e => {
  const t = e.target.closest('[data-vtest]'), r = e.target.closest('[data-vrec]'), d = e.target.closest('[data-vdel]');
  if (t) { // listen here on the laptop
    const k = t.dataset.vtest, clip = S.voice.clips && S.voice.clips[k];
    if (clip) { if (adminAudio) adminAudio.pause(); adminAudio = new Audio(clip); adminAudio.play(); return; }
    if (!window.speechSynthesis) return toast('This browser has no computer voice. Record your own voice instead.');
    const u = new SpeechSynthesisUtterance(voiceLine(k)), vs = speechSynthesis.getVoices(), lang = (S.voice.lang || 'ms-MY').toLowerCase();
    u.voice = vs.find(v => v.lang.toLowerCase() === lang) || vs.find(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || null; u.lang = S.voice.lang || 'ms-MY';
    speechSynthesis.cancel(); speechSynthesis.speak(u); return;
  }
  if (d) { delete S.voice.clips[d.dataset.vdel]; renderVoiceSettings(); return; }
  const up = e.target.closest('[data-vup]'); if (up) { voUpKey = up.dataset.vup; $('#voFile').click(); return; }
  if (r) {   // record the studio's own voice for this line (tap again to stop)
    const k = r.dataset.vrec;
    if (voRec) { voRec.stop(); return; }
    let mic; try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (err) { return toast('Allow the microphone to record your voice.', 5000); }
    const chunks = [], mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    voRec = new MediaRecorder(mic, mime ? { mimeType: mime } : {}); voRec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
    r.textContent = '■ Stop recording'; r.classList.add('pri');
    const auto = setTimeout(() => voRec && voRec.stop(), 10000);
    voRec.onstop = async () => {
      clearTimeout(auto); mic.getTracks().forEach(x => x.stop()); voRec = null;
      const blob = new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] }), ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      try { const path = `u-${USER.id}/voice-${k}-${Date.now().toString(36)}.${ext}`; await upload(path, blob, blob.type); S.voice.clips = { ...(S.voice.clips || {}), [k]: fileUrl(path) }; toast('Recorded. Press Save to send it to the tablet.'); }
      catch (err) { toast(err.message, 4000); }
      renderVoiceSettings();
    };
    voRec.start();
  }
});
$('#voFile').addEventListener('change', async e => {
  const f = e.target.files[0], k = voUpKey; e.target.value = ''; if (!f || !k) return;
  if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|m4a|mp4|mov|wav|webm|aac|ogg)$/i.test(f.name)) return toast('Choose a sound or video file (MP3, MP4, MOV, M4A, WAV).');
  const b = $(`#voLines [data-vup="${k}"]`); if (b) { b.disabled = true; b.textContent = /\.mp3$/i.test(f.name) ? 'Uploading…' : 'Converting to MP3…'; }
  try {
    const mp3 = await toMp3(f, 30), path = `u-${USER.id}/voice-${k}-${Date.now().toString(36)}.mp3`;
    await upload(path, mp3, 'audio/mpeg'); S.voice.clips = { ...(S.voice.clips || {}), [k]: fileUrl(path) };
    toast(`Added (${Math.round(mp3.size / 1024)} KB MP3). Press Save to send it to the tablet.`);
  } catch (err) { toast(err.message, 6000); }
  renderVoiceSettings();
});
$('#muList').addEventListener('click', e => {
  const ty = e.target.closest('[data-mut]'), pl = e.target.closest('[data-mup]'), rm = e.target.closest('[data-murm]');
  if (ty) { const t = S.music.tracks[+ty.dataset.mut], set = new Set(t.types || []); set.has(ty.dataset.ty) ? set.delete(ty.dataset.ty) : set.add(ty.dataset.ty); t.types = [...set]; renderVoiceSettings(); }
  if (pl) { const t = S.music.tracks[+pl.dataset.mup]; if (adminAudio && !adminAudio.paused && adminAudio._src === t.url) { adminAudio.pause(); return; } if (adminAudio) adminAudio.pause(); adminAudio = new Audio(t.url); adminAudio._src = t.url; adminAudio.volume = S.music.volume ?? .35; adminAudio.play(); }
  if (rm && confirm('Remove this track?')) { S.music.tracks.splice(+rm.dataset.murm, 1); renderVoiceSettings(); }
});
$('#muFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    if (!/^(audio|video)\//.test(f.type)) { toast('Choose a sound or video file (MP3, MP4, M4A, WAV).'); continue; }
    try {
      if (!/\.mp3$/i.test(f.name)) toast('Converting ' + f.name + ' to MP3…', 4000);
      const mp3 = await toMp3(f, 600); if (mp3.size > 25 * 1024 * 1024) { toast(f.name + ' is over 25 MB as MP3.'); continue; }
      const path = `u-${USER.id}/music-${Date.now().toString(36)}.mp3`; await upload(path, mp3, 'audio/mpeg'); S.music.tracks = [...(S.music.tracks || []), { url: fileUrl(path), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), types: [] }]; }
    catch (err) { toast(err.message, 4000); }
  }
  renderVoiceSettings(); toast('Uploaded. Tick the event types, then press Save.');
});
/* ---- Guestbook PDF: every message of the event with its photo ---- */
async function imgData(url, max, type) {
  const r = await fetch(url); if (!r.ok) throw new Error('Could not load ' + url.split('/').pop());
  const bm = await createImageBitmap(await r.blob()), k = Math.min(1, max / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
  const x = c.getContext('2d'); if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(bm, 0, 0, c.width, c.height); bm.close && bm.close();
  return { data: c.toDataURL(type, .88), w: c.width, h: c.height };
}
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const t = document.createElement('script'); t.src = src; t.onload = res; t.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(t); }); }
$('#gGuestbook').onclick = async () => {
  const ev = EVENTS.find(e => e.id === galEvent); if (!ev) return;
  const list = galPhotos.filter(p => p.message_path).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (!list.length) return toast('No guestbook messages for this event yet. Turn on the guestbook in Studio settings.', 5000);
  const b = $('#gGuestbook'); b.disabled = true; b.textContent = 'Making the PDF…';
  try {
    await loadScript('../vendor/jspdf.umd.min.js');
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' }), PW = 210, PH = 297, g = gbStyle();
    // Page background: the guestbook card picture (cover), or the paper colour
    let pageImg = null;
    if (g.pdfBg !== false && g.paper === 'image' && g.paperSrc) { try { pageImg = await imgData(g.paperSrc, 1800, 'image/jpeg'); } catch (e) { } }
    const hex = (g.pdfBg !== false && GB_PAPERS[g.paper] ? GB_PAPERS[g.paper][2] : '#faf6f0').replace('#', '');
    const paintPage = () => {
      if (pageImg) { const k = Math.max(PW / pageImg.w, PH / pageImg.h), w = pageImg.w * k, h = pageImg.h * k; doc.addImage(pageImg.data, 'JPEG', (PW - w) / 2, (PH - h) / 2, w, h, 'pagebg'); }
      else { doc.setFillColor(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)); doc.rect(0, 0, PW, PH, 'F'); }
    };
    // Cover
    paintPage();
    doc.setTextColor(91, 74, 51); doc.setFont('times', 'italic'); doc.setFontSize(40); doc.text(doc.splitTextToSize(ev.name || 'Our day', 170), PW / 2, 120, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.text(String(ev.event_date || ''), PW / 2, 150, { align: 'center' });
    doc.setFontSize(12); doc.text(`Guestbook · ${list.length} message${list.length > 1 ? 's' : ''}`, PW / 2, 162, { align: 'center' });
    doc.setFontSize(10); doc.setTextColor(140, 130, 115); doc.text(S.brand || '', PW / 2, PH - 20, { align: 'center' });
    // Two messages a page: the photo on the left, the handwriting on the right
    for (let i = 0; i < list.length; i++) {
      if (i % 2 === 0) { doc.addPage(); paintPage(); }
      b.textContent = `Making the PDF… ${i + 1}/${list.length}`;
      const p = list[i], top = i % 2 === 0 ? 14 : PH / 2 + 4, boxH = PH / 2 - 22;
      try {
        const ph = await imgData(fileUrl(p.path), 1400, 'image/jpeg'), k = Math.min(70 / ph.w, boxH / ph.h), w = ph.w * k, h = ph.h * k;
        doc.addImage(ph.data, 'JPEG', 16 + (70 - w) / 2, top + (boxH - h) / 2, w, h);
      } catch (e) { /* photo missing: keep the message */ }
      try {
        const m = await imgData(fileUrl(p.message_path), 1600, 'image/png'), k = Math.min(100 / m.w, (boxH - 18) / m.h, .5), w = m.w * k, h = m.h * k;
        doc.addImage(m.data, 'PNG', 96 + (100 - w) / 2, top + (boxH - 18 - h) / 2, w, h);
      } catch (e) { }
      doc.setTextColor(91, 74, 51); doc.setFont('times', 'italic'); doc.setFontSize(14);
      doc.text(p.message_name ? '— ' + p.message_name : '', 146, top + boxH - 8, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150, 140, 125);
      doc.text(new Date(p.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), 146, top + boxH - 2, { align: 'center' });
      if (i % 2 === 0 && i + 1 < list.length) { doc.setDrawColor(220, 210, 195); doc.line(20, PH / 2, PW - 20, PH / 2); }
    }
    download(doc.output('blob'), `guestbook-${(ev.name || 'event').replace(/[^\w]+/g, '-')}.pdf`);
    toast('Guestbook PDF downloaded');
  } catch (e) { toast('Could not make the PDF: ' + e.message, 6000); }
  b.disabled = false; b.textContent = '📖 Guestbook PDF';
};
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
