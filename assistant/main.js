// Raysnap Print Assistant: the Windows program next to the printer.
// It logs in to the studio, takes print jobs from the tablet and phones, and prints them straight to the chosen
// printer (no print window): 2x6 strips to the DNP set up with the 2-inch cut, 4R photos to the DNP without it.
// The window (ui/) does the work; this file opens it, keeps it running in the tray and prints pages silently.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, session } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');

const SELFTEST = process.argv.includes('--selftest');
let win = null, tray = null, quitting = false;

if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600, show: !process.argv.includes('--hidden') && !SELFTEST,
    backgroundColor: '#180309', title: 'Raysnap Print Assistant', icon: path.join(__dirname, 'ui/img/icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false, webviewTag: true },
  });
  win.loadFile(path.join(__dirname, 'ui/index.html'));
  // Closing the window keeps the assistant printing in the background (tray icon); Quit from the tray stops it.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

app.whenReady().then(async () => {
  createWindow();
  if (SELFTEST) return selftest();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'ui/img/icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Raysnap Print Assistant: printing in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Raysnap Print Assistant', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Quit (stop printing)', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (quitting || SELFTEST) app.quit(); });

// The admin board (the website) runs inside the window in a <webview>. Links it opens in a new tab (guest page,
// album, WhatsApp...) open in the normal browser; it may not navigate away from the studio website itself.
const STUDIO = process.env.RA_STUDIO_URL || 'https://photobooth-studio.harizwer03.workers.dev';
app.on('web-contents-created', (e, wc) => {
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (ev, url) => { if (!url.startsWith(STUDIO)) { ev.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
});
app.on('web-contents-created', (e, wc) => {
  // The admin board gets no access to the computer: no Node, no preload script, only the studio website
  wc.on('will-attach-webview', (ev, prefs, params) => {
    delete prefs.preload; prefs.nodeIntegration = false; prefs.contextIsolation = true;
    if (!params.src.startsWith(STUDIO) && params.src !== 'about:blank') ev.preventDefault();
  });
});
ipcMain.handle('studio-url', () => STUDIO);
ipcMain.handle('studio-clear', () => session.fromPartition('persist:studio').clearStorageData());
ipcMain.handle('printers', async () => (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, label: p.displayName || p.name, isDefault: !!p.isDefault })));
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('open-external', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('autostart', (e, on) => {
  if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
});

// Print one finished page picture (already the paper's exact size) on a printer, with no print window.
// page = [width, height] in inches; copies = how many sheets.
async function printPage({ jpeg, page, copies, deviceName, landscape }, toPdf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raysnap-'));
  const img = path.join(dir, 'page.jpg'), html = path.join(dir, 'page.html');
  fs.writeFileSync(img, Buffer.from(jpeg));
  const [w, h] = page.map(v => (+v).toFixed(4) + 'in');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>@page{size:${w} ${h};margin:0}html,body{margin:0;padding:0;background:#fff}
.pg{width:${w};height:${h};overflow:hidden;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}
img{display:block;width:100%;height:100%;object-fit:cover}</style>` + Array.from({ length: Math.max(1, copies | 0) }, () => '<div class="pg"><img src="page.jpg"></div>').join(''));
  const pw = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await pw.loadFile(html);
    await pw.webContents.executeJavaScript('Promise.all([...document.images].map(i => i.decode().catch(() => {}))).then(() => true)');
    if (toPdf) return await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, landscape: !!landscape });
    return await new Promise(resolve => {
      pw.webContents.print({ silent: true, printBackground: true, deviceName, landscape: !!landscape, margins: { marginType: 'none' }, copies: 1 },
        (ok, reason) => resolve({ ok, reason: reason || '' }));
    });
  } finally {
    pw.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
ipcMain.handle('print', (e, job) => printPage(job));

// Checked by the build machine: the window loads, printers can be listed, and a page is laid out at the DNP size.
async function selftest() {
  const out = { ok: false, steps: {} };
  try {
    await new Promise(r => win.webContents.once('did-finish-load', r));
    out.steps.window = await win.webContents.executeJavaScript('!!document.querySelector("#vLogin") && typeof window.assistant === "object"');
    out.steps.printers = (await win.webContents.getPrintersAsync()).map(p => p.name);
    const pixel = Buffer.from(await win.webContents.executeJavaScript(`(async () => { const c = document.createElement('canvas'); c.width = 1240; c.height = 1844; const x = c.getContext('2d'); x.fillStyle = '#c0392b'; x.fillRect(0, 0, 1240, 1844); const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .9)); return [...new Uint8Array(await b.arrayBuffer())]; })()`));
    const pdf = await printPage({ jpeg: pixel, page: [1240 / 300, 1844 / 300], copies: 2 }, true);
    out.steps.pdfBytes = pdf.length;
    out.steps.pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    out.steps.pdfBox = (pdf.toString('latin1').match(/\/MediaBox\s*\[([^\]]+)\]/) || [])[1] || '';
    out.ok = out.steps.window === true && out.steps.pdfPages === 2;
  } catch (e) { out.error = String(e && e.stack || e); }
  fs.writeFileSync(path.join(process.cwd(), 'selftest.json'), JSON.stringify(out, null, 2));
  quitting = true; app.exit(out.ok ? 0 : 1);
}
