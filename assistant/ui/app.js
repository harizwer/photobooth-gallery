// Raysnap Print Assistant: logs in to the studio, watches the print queue and prints each job on the right printer:
// 2x6 strips on the DNP with the 2-inch cut, 4R photos on the DNP without it. The website's Printer page stays as a
// backup; a job is only ever taken by one of them (it is "claimed" in the database before printing).
const SUPABASE_URL = 'https://dqeyaimxfkursttbdmyp.supabase.co';
const PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZXlhaW14Zmt1cnN0dGJkbXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyODc2NTQsImV4cCI6MjEwODg2MzY1NH0.T5tHvHVpNzNHwxYFASy8WO6xr1bvfBko9gxHCoxVQSc';
const FILES = (window.__FILES__ || 'https://photobooth-studio.harizwer03.workers.dev') + '/files/';
const A = window.assistant;
const sb = (window.__SB_FAKE__ || window.supabase).createClient(SUPABASE_URL, PUBLIC_KEY);
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = r => { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('ra.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) { } },
};
let toastT = 0;
function toast(m, ms = 3500) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

let USER = null, ACTIVE = null, STATION = null, PRINTERS = [], busy = false, online = true, stripTurn = 0, presence = null;
const deviceId = store.get('device', '') || (() => { const d = 'ra-' + Math.random().toString(36).slice(2, 10); store.set('device', d); return d; })();

/* ---------- Log in ---------- */
$('#lUser').value = store.get('lastUser', '');
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const u = $('#lUser').value.trim().toLowerCase(), p = $('#lPass').value;
  $('#lBtn').disabled = true; $('#lMsg').textContent = '';
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY, Authorization: 'Bearer ' + PUBLIC_KEY }, body: JSON.stringify({ username: u, password: p }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Could not log in');
    check(await sb.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token }));
    store.set('lastUser', u); $('#lPass').value = '';
    const { data } = await sb.auth.getSession(); await start(data.session.user);
  } catch (err) { $('#lMsg').textContent = /fetch|network/i.test(err.message) ? 'No internet connection. Check the WiFi and try again.' : err.message; }
  finally { $('#lBtn').disabled = false; }
};
$('#logout').onclick = async () => { if (!confirm('Log out? Printing stops until you log in again.')) return; await sb.auth.signOut(); location.reload(); };

/* ---------- Start ---------- */
async function start(user) {
  USER = user;
  $('#vLogin').classList.remove('on'); $('#vMain').classList.add('on');
  $('#who').textContent = store.get('lastUser', '') || user.email || '—';
  A.version().then(v => { $('#ver').textContent = v; }).catch(() => {});
  A.autostart().then(on => { $('#autoStart').checked = on; }).catch(() => {});
  await loadPrinters();
  renderCfg();
  await Promise.all([loadEvent(), loadStation()]).catch(() => {});
  renderStats(); renderQueue();
  sb.channel('ra-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs', filter: `owner=eq.${USER.id}` }, () => { run(); renderQueue(); renderStats(); }).subscribe();
  presence = sb.channel('booth-' + USER.id, { config: { presence: { key: deviceId } } });
  presence.subscribe(st => { if (st === 'SUBSCRIBED') track(); });
  run();
}
// Tell the tablets a printer is ready (they show "Printer ready")
function track() { if (presence) presence.track({ role: 'assistant', printer: autoOn() && kindsOn().length > 0, kinds: kindsOn(), label: 'Print Assistant (Windows)', at: Date.now() }).catch(() => {}); }
setInterval(() => { if (USER) { run(); renderStats(); } }, 5000);

/* ---------- Printers ---------- */
const autoOn = () => $('#autoOn').checked;
$('#autoOn').checked = store.get('autoOn', true);
$('#autoOn').onchange = () => { store.set('autoOn', autoOn()); track(); renderStatus(); run(); };
async function loadPrinters() {
  try { PRINTERS = await A.printers(); } catch (e) { PRINTERS = []; }
  const saved = store.get('printers', null);
  const guess = { strip: (PRINTERS.find(p => /rx1|dnp|ds-/i.test(p.name) && !/4r/i.test(p.name)) || {}).name || '', '4r': (PRINTERS.find(p => /4r/i.test(p.name)) || {}).name || '', strip2: '' };
  const cur = saved || guess;
  for (const [id, key] of [['#prnStrip', 'strip'], ['#prn4r', '4r'], ['#prnStrip2', 'strip2']]) {
    $(id).innerHTML = `<option value="">— ${key === 'strip2' ? 'None' : 'Not set'} —</option>` + PRINTERS.map(p => `<option value="${esc(p.name)}" ${cur[key] === p.name ? 'selected' : ''}>${esc(p.label)}${p.isDefault ? ' (default)' : ''}</option>`).join('');
    $(id).onchange = () => { store.set('printers', { strip: $('#prnStrip').value, '4r': $('#prn4r').value, strip2: $('#prnStrip2').value }); track(); renderStatus(); run(); };
  }
  if (!saved) store.set('printers', guess);
  renderStatus();
}
// Which printer a job of this paper goes to. Strips alternate between two printers when a second one is set.
const kindsOn = () => ['strip', '4r'].filter(k => printerFor(k, true));
function printerFor(paper, peek) {
  const p = store.get('printers', {});
  if (paper === '4r') return p['4r'] || '';
  if (p.strip && p.strip2) { const n = stripTurn % 2 ? p.strip2 : p.strip; if (!peek) stripTurn++; return n; }
  return p.strip || p.strip2 || '';
}

/* ---------- Status and numbers ---------- */
function renderStatus() {
  const pill = $('#statusPill'), noPrinter = !printerFor('strip', true) && !printerFor('4r', true);
  const [cls, text, title, sub] = !online ? ['bad', 'No internet', 'Waiting for the internet', 'Prints wait in the queue and come out when the connection is back.']
    : noPrinter ? ['', 'Choose a printer', 'Choose a printer below', 'Pick the DNP for strips and for 4R, then prints come out by themselves.']
    : !autoOn() ? ['', 'Auto print is off', 'Auto print is off', 'Prints wait in the queue. Turn on Auto print, or print from the website’s Printer page.']
    : ['ok', 'Printing automatically', 'Printing automatically', 'Prints from the tablet and the table QR come out by themselves. You can close this window; it keeps printing from the tray.'];
  pill.className = 'pill ' + cls; $('#statusText').textContent = text; $('#heroTitle').textContent = title; $('#heroSub').textContent = sub;
  $('#useStrip').textContent = printerFor('strip', true) ? '' : 'Strips wait until a printer is set';
  $('#use4r').textContent = printerFor('4r', true) ? '' : '4R prints wait until a printer is set';
}
async function loadEvent() { const r = check(await sb.from('events').select('id,name,event_date').eq('owner', USER.id).eq('is_active', true).limit(1)); ACTIVE = r[0] || null; }
async function loadStation() { STATION = check(await sb.from('station_settings').select('*').eq('owner', USER.id).maybeSingle()); }
async function renderStats() {
  if (!USER) return;
  $('#evName').textContent = ACTIVE ? ACTIVE.name : '—'; $('#evDate').textContent = ACTIVE ? ACTIVE.event_date || '' : '';
  if (STATION) { const cap = STATION.media_capacity || 700, left = Math.max(0, cap - (STATION.printed_since_reset || 0)); $('#paperLeft').textContent = left; $('#paperCap').textContent = cap; $('#paperBar').style.width = Math.max(0, Math.min(100, left / cap * 100)) + '%'; }
  try {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const rows = check(await sb.from('print_jobs').select('status,copies,created_at').eq('owner', USER.id).gte('created_at', day.toISOString()));
    $('#todayCount').textContent = rows.filter(j => j.status === 'done').reduce((n, j) => n + (j.copies || 1), 0);
    const w = rows.filter(j => j.status === 'waiting').length; $('#waitingText').textContent = w ? `${w} waiting` : 'Nothing waiting';
    if (!online) { online = true; renderStatus(); }
  } catch (e) { if (online) { online = false; renderStatus(); } }
}
async function renderQueue() {
  if (!USER) return;
  let rows = [];
  try { rows = check(await sb.from('print_jobs').select('*').eq('owner', USER.id).order('created_at', { ascending: false }).limit(25)); } catch (e) { return; }
  $('#queue').innerHTML = rows.length ? rows.map(j => `<tr><td>${new Date(j.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(j.label || '')}</td><td>${j.paper === '4r' ? '4R' : '2×6'}</td><td>${j.copies}</td><td><span class="st ${esc(j.status)}">${esc(j.status)}</span>${j.error ? `<div class="muted sm">${esc(j.error)}</div>` : ''}</td><td>${j.status === 'failed' ? `<button class="btn sm" data-retry="${esc(j.id)}">Try again</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No prints yet.</td></tr>';
  $$('[data-retry]').forEach(b => b.onclick = async () => { await sb.from('print_jobs').update({ status: 'waiting', error: '', updated_at: new Date().toISOString() }).eq('id', b.dataset.retry); run(); renderQueue(); });
}
$('#refreshQ').onclick = renderQueue;

/* ---------- Printing ---------- */
const printCfg = () => ({ orient: 'portrait', paper: 'dnp', dx: 0, dy: 0, scale: 100, bleed: 0, ...store.get('printCfg', {}) });
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Could not download the photo to print')); i.src = src; }); }
const toBlobQ = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
// Lay out one picture as the finished page (same as the website) and print it on `deviceName`.
async function printPicture(img, copies, deviceName, raw) {
  const cfg = raw ? { ...printCfg(), dx: 0, dy: 0, scale: 100, bleed: 0 } : printCfg(), landPage = cfg.orient === 'landscape';
  const landImg = (img.naturalWidth || img.width) > (img.naturalHeight || img.height);
  let pic = img; if (landImg !== landPage) pic = rotatedCanvas(img, !landPage);
  const paperIn = PAPER[cfg.paper] || PAPER.dnp, pageIn = landPage ? [paperIn[1], paperIn[0]] : paperIn;
  const page = printPage(pic, cfg, landPage ? 6 : 4, pageIn);
  const jpeg = await (await toBlobQ(page, .95)).arrayBuffer();
  const r = await A.print({ jpeg, page: pageIn, copies, deviceName, landscape: landPage });
  if (!r || !r.ok) throw new Error('The printer did not take the print' + (r && r.reason ? ': ' + r.reason : '') + '. Check it is on and has paper.');
}
let countQ = Promise.resolve();
function countPrinted(n, photoId) {
  countQ = countQ.then(async () => {
    try {
      if (photoId) { const p = (await sb.from('photos').select('printed').eq('id', photoId).maybeSingle()).data; if (p) await sb.from('photos').update({ printed: (p.printed || 0) + n }).eq('id', photoId); }
      await loadStation(); if (STATION) { await sb.from('station_settings').update({ printed_since_reset: (STATION.printed_since_reset || 0) + n }).eq('owner', USER.id); STATION.printed_since_reset = (STATION.printed_since_reset || 0) + n; }
    } catch (e) { }
  });
  return countQ;
}
const myJobs = new Set();
async function run() {
  if (!USER || busy || !autoOn()) return;
  const kinds = kindsOn();
  if (!kinds.length) return;
  busy = true;
  try {
    // A job left on "printing" by a page or assistant that stopped goes back in the queue
    const stale = new Date(Date.now() - 3 * 60e3).toISOString();
    await sb.from('print_jobs').update({ status: 'waiting', updated_at: new Date().toISOString() }).eq('owner', USER.id).eq('status', 'printing').lt('created_at', stale).in('paper', kinds)
      .not('id', 'in', `(${[...myJobs].join(',') || '00000000-0000-0000-0000-000000000000'})`);
    for (;;) {
      if (!autoOn()) break;
      const next = check(await sb.from('print_jobs').select('*').eq('owner', USER.id).eq('status', 'waiting').in('paper', kinds).order('created_at', { ascending: true }).limit(1));
      if (!next.length) break;
      const job = next[0];
      const claimed = check(await sb.from('print_jobs').update({ status: 'printing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'waiting').select());
      if (!claimed.length) continue;   // the website or another assistant took it
      myJobs.add(job.id);
      try {
        const img = await loadImg(FILES + job.path);
        await printPicture(img, job.copies, printerFor(job.paper || 'strip'));
        check(await sb.from('print_jobs').update({ status: 'done', error: '', updated_at: new Date().toISOString() }).eq('id', job.id));
        const pid = job.photo_id || (((await sb.from('print_jobs').select('photo_id').eq('id', job.id).maybeSingle()).data) || {}).photo_id;
        await countPrinted(job.copies, pid);
      } catch (e) {
        await sb.from('print_jobs').update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() }).eq('id', job.id);
        toast('Print failed: ' + e.message, 6000);
      }
      myJobs.delete(job.id);
    }
    if (!online) { online = true; renderStatus(); }
  } catch (e) { if (online) { online = false; renderStatus(); } }
  finally { busy = false; }
}

/* ---------- Test prints ---------- */
function testSheet(kind) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1800; const x = c.getContext('2d'), mm = 300 / 25.4;
  if (kind === 'edge') {   // colour bands at every edge, 1 mm each
    x.fillStyle = '#263238'; x.fillRect(0, 0, 1200, 1800);
    ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((col, i) => { const a = Math.round(i * mm), b = Math.round((i + 1) * mm); x.fillStyle = col; x.fillRect(a, a, 1200 - 2 * a, b - a); x.fillRect(a, 1800 - b, 1200 - 2 * a, b - a); x.fillRect(a, a, b - a, 1800 - 2 * a); x.fillRect(1200 - b, a, b - a, 1800 - 2 * a); });
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 44px sans-serif'; x.fillText('EDGE CHECK', 600, 860); x.font = '30px sans-serif'; x.fillText('red = 0–1 mm · orange 1–2 · yellow 2–3 · green 3–4', 600, 920);
    return c;
  }
  const strip = (ox, w) => {
    x.fillStyle = '#2a0c16'; x.fillRect(ox, 0, w, 1800);
    for (let i = 0; i < (kind === '4r' ? 1 : 3); i++) { const h = kind === '4r' ? 1300 : 470, y = 60 + i * (h + 30); const g = x.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#c9a35b'); g.addColorStop(1, '#6e4a1f'); x.fillStyle = g; x.fillRect(ox + 40, y, w - 80, h); }
    x.fillStyle = '#d4af37'; x.textAlign = 'center'; x.font = 'italic bold 54px Georgia, serif'; x.fillText('Raysnap', ox + w / 2, 1640); x.font = '28px sans-serif'; x.fillText(kind === '4r' ? 'Test print 4R (not cut)' : 'Test print 2×6 strip', ox + w / 2, 1700);
  };
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 1800);
  if (kind === '4r') strip(0, 1200); else { strip(0, 600); strip(600, 600); }
  return c;
}
$$('[data-test]').forEach(b => b.onclick = async () => {
  const kind = b.dataset.test, dev = kind === '4r' ? printerFor('4r', true) : printerFor('strip', true);
  if (!dev) return toast('Choose the printer first.');
  b.disabled = true;
  try { await printPicture(testSheet(kind), 1, dev, kind === 'edge'); toast('Sent to ' + dev); await countPrinted(1); renderStats(); }
  catch (e) { toast(e.message, 6000); }
  finally { b.disabled = false; }
});

/* ---------- Settings ---------- */
function renderCfg() { const c = printCfg(); $('#cOrient').value = c.orient; $('#cPaper').value = c.paper; $('#cDx').value = c.dx; $('#cDy').value = c.dy; $('#cSc').value = c.scale; $('#cBleed').value = c.bleed; }
$('#cSave').onclick = () => {
  const num = (id, lo, hi, d) => { const v = +$(id).value; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  store.set('printCfg', { orient: $('#cOrient').value, paper: $('#cPaper').value, dx: num('#cDx', -15, 15, 0), dy: num('#cDy', -15, 15, 0), scale: num('#cSc', 90, 110, 100), bleed: num('#cBleed', 0, 8, 0) });
  renderCfg(); toast('Print settings saved on this computer');
};
$('#autoStart').onchange = async () => { try { $('#autoStart').checked = await A.autostart($('#autoStart').checked); } catch (e) { toast(e.message); } };
$('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === b.dataset.tab)); if (b.dataset.tab === 'queue') renderQueue(); };
window.addEventListener('online', () => { online = true; renderStatus(); run(); });
window.addEventListener('offline', () => { online = false; renderStatus(); });

/* ---------- Open: already logged in? ---------- */
(async () => {
  const { data } = await sb.auth.getSession();
  if (data && data.session) start(data.session.user).catch(e => toast(e.message, 6000));
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_OUT') location.reload(); });
})();
