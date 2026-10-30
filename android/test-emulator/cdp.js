// Talks to the app's WebView over the Chrome DevTools protocol and checks the Canon bridge.
const targets = require('../../out-emu/targets.json');
const page = targets.find(t => t.type === 'page') || targets[0];
if (!page) { console.log('NO PAGE IN WEBVIEW'); process.exit(0); }
console.log('page:', page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let n = 0; const wait = new Map();
const send = (method, params) => new Promise(res => { const id = ++n; wait.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = m => { const d = JSON.parse(m.data); if (wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const check = `(async () => {
  const out = {};
  out.page = location.href; out.title = document.title; out.ua = navigator.userAgent;
  out.hasBridge = !!window.PBNative;
  if (!window.PBNative) return JSON.stringify(out);
  out.version = PBNative.version(); out.present = PBNative.present(); out.status = JSON.parse(PBNative.status());
  const call = op => new Promise(res => { const id = 900000 + Math.floor(Math.random() * 1000); const prev = window.__pbNativeDone;
    window.__pbNativeDone = (i, r) => { if (i === id) { window.__pbNativeDone = prev; res(r); } else if (prev) prev(i, r); };
    PBNative.call(op, id); setTimeout(() => res('TIMEOUT'), 30000); });
  out.connect = await call('connect');
  out.capture = await call('capture');
  const f = await fetch('/__canon/frame?after=0'); out.frame = [f.status, await f.text()];
  const p = await fetch('/__canon/photo?id=1'); out.photo = p.status;
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); out.tabletCamera = s.getVideoTracks()[0].label || 'ok'; s.getTracks().forEach(t => t.stop()); }
  catch (e) { out.tabletCamera = 'ERROR ' + e.name + ': ' + e.message; }
  out.loginScreen = !!document.querySelector('#v-login.on');
  out.boothCodeLoaded = typeof window.__pbNativeDone === 'function';
  out.bodyText = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 300);
  out.log = PBNative.log();
  return JSON.stringify(out, null, 1);
})()`;
ws.onopen = async () => {
  const r = await send('Runtime.evaluate', { expression: check, awaitPromise: true, returnByValue: true });
  console.log(r.result && r.result.result ? r.result.result.value : JSON.stringify(r));
  ws.close(); process.exit(0);
};
setTimeout(() => { console.log('CDP TIMEOUT'); process.exit(0); }, 90000);
