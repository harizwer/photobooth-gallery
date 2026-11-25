// Page layout for printing: copied from the website (public/app/app.js) so prints come out exactly the same.
// If these change there, copy them again (assistant/update-layout.py does it).
const PAPER = { dnp: [1240 / 300, 1844 / 300], plain: [4, 6] };
// How deep a thin white edge goes on each side of a print (a white line left at the edge of a Canva export, for example).
// Only near-pure-white rows/columns count, at most 3% deep, and only when the design further in is not white itself.
function whiteEdges(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const white = (d, i) => d[i + 3] < 20 || (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240);
  const share = (sx, sy, sw, sh) => { const d = x.getImageData(sx, sy, sw, sh).data; let n = 0, t = 0; for (let i = 0; i < d.length; i += 4 * 3) { t++; if (white(d, i)) n++; } return n / t; };
  const depth = (len, other, row) => {
    const max = Math.max(1, Math.round(len * .03)), probe = (k) => row(k);
    if (probe(max) > .9) return 0;                       // white further in too: a white design, leave it
    let k = 0; while (k < max && probe(k) > .97) k++;
    return k;
  };
  return {
    t: depth(h, w, k => share(0, k, w, 1)), b: depth(h, w, k => share(0, h - 1 - k, w, 1)),
    l: depth(w, h, k => share(k, 0, 1, h)), r: depth(w, h, k => share(w - 1 - k, 0, 1, h)),
  };
}
// Edge bleed without losing any of the design: the picture is printed at its true size, and a thin band around it
// (f of the size on each side) repeats the colour at its edge. The band falls off the paper, so a printer that is a
// fraction out never shows a white line, and the strip's margins stay exactly as designed.
// A thin white edge in the design itself is covered with the colour just inside it.
function withBleed(img, f) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const bx = Math.round(w * f), by = Math.round(h * f);
  let e = { t: 0, b: 0, l: 0, r: 0 }; try { e = whiteEdges(img); } catch (err) { }
  const c = document.createElement('canvas'); c.width = w + bx * 2; c.height = h + by * 2; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, bx, by);
  x.imageSmoothingEnabled = false;
  const T = e.t, B = h - 1 - e.b, L = e.l, Rr = w - 1 - e.r;          // the first rows/columns that are not a white edge
  if (by || T) x.drawImage(img, 0, T, w, 1, bx, 0, w, by + T);                 // top: that row, stretched up to the cut
  if (by || e.b) x.drawImage(img, 0, B, w, 1, bx, by + B + 1, w, by + e.b);    // bottom
  if (bx || L) x.drawImage(img, L, 0, 1, h, 0, by, bx + L, h);                 // left
  if (bx || e.r) x.drawImage(img, Rr, 0, 1, h, bx + Rr + 1, by, bx + e.r, h);  // right
  x.drawImage(img, L, T, 1, 1, 0, 0, bx + L, by + T);                          // corners
  x.drawImage(img, Rr, T, 1, 1, bx + Rr + 1, 0, bx + e.r, by + T);
  x.drawImage(img, L, B, 1, 1, 0, by + B + 1, bx + L, by + e.b);
  x.drawImage(img, Rr, B, 1, 1, bx + Rr + 1, by + B + 1, bx + e.r, by + e.b);
  return c;
}
// Two copies of the same strip side by side (or one above the other on a turned page)? Then each is laid out on its own.
function twinParts(img, W, H) {
  const t = document.createElement('canvas'); t.width = 64; t.height = 64; const x = t.getContext('2d', { willReadFrequently: true });
  const same = (a, b) => { x.clearRect(0, 0, 64, 64); x.drawImage(img, ...a, 0, 0, 32, 64); x.drawImage(img, ...b, 32, 0, 32, 64); const d = x.getImageData(0, 0, 64, 64).data; let s = 0; for (let y = 0; y < 64; y++) for (let i = 0; i < 32; i++) { const p = (y * 64 + i) * 4, q = p + 128; s += Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2]); } return s / (64 * 32 * 3) < 6; };
  const hw = Math.round(W / 2), hh = Math.round(H / 2);
  if (W < H && same([0, 0, hw, H], [hw, 0, W - hw, H])) return [[0, 0, hw, H], [hw, 0, W - hw, H]];
  if (W > H && same([0, 0, W, hh], [0, hh, W, H - hh])) return [[0, 0, W, hh], [0, hh, W, H - hh]];
  return [[0, 0, W, H]];
}
// The finished page, exactly the paper's size. Each strip (or the whole photo) is placed on its own: moved by the
// laptop's Move right/down, sized by Size, and enlarged by Edge bleed from its own centre, so every margin is trimmed by
// the same amount. Around each one, its edge colour carries on, so a move never shows white paper.
// The finished page at the size of the printer's page (pageIn = [width, height] in inches). The design keeps its true
// 4x6 size in the middle; the extra room the DNP prints past the paper edge is filled with each strip's edge colour.
function printPage(pic, cfg, inchesW, pageIn) {
  const W = pic.naturalWidth || pic.width, H = pic.naturalHeight || pic.height, mm = W / (inchesW * 25.4);
  const PW = Math.round(W * pageIn[0] / inchesW), PH = Math.round(PW * pageIn[1] / pageIn[0]), ox = (PW - W) / 2, oy = (PH - H) / 2;
  const c = document.createElement('canvas'); c.width = PW; c.height = PH; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.imageSmoothingQuality = 'high';
  const k = (cfg.scale || 100) / 100 * (1 + Math.max(0, cfg.bleed || 0) / 100), around = .12;
  const parts = twinParts(pic, W, H), twinX = parts.length === 2 && parts[1][0] > 0, twinY = parts.length === 2 && parts[1][1] > 0;
  parts.forEach(([px, py, pw, ph], i) => {
    const part = document.createElement('canvas'); part.width = pw; part.height = ph; part.getContext('2d').drawImage(pic, px, py, pw, ph, 0, 0, pw, ph);
    const ext = withBleed(part, around), ew = ext.width * k, eh = ext.height * k;
    const cx = ox + px + pw / 2 + (cfg.dx || 0) * mm, cy = oy + py + ph / 2 + (cfg.dy || 0) * mm;
    // each strip owns its half of the page, out to the page edge
    const cl = twinX ? [i ? PW / 2 : 0, 0, PW / 2, PH] : twinY ? [0, i ? PH / 2 : 0, PW, PH / 2] : [0, 0, PW, PH];
    x.save(); x.beginPath(); x.rect(...cl); x.clip(); x.drawImage(ext, cx - ew / 2, cy - eh / 2, ew, eh); x.restore();
  });
  return c;
}
function rotatedCanvas(img, cw) {
  const c = document.createElement('canvas'); c.width = img.naturalHeight || img.height; c.height = img.naturalWidth || img.width;
  const x = c.getContext('2d');
  if (cw) { x.translate(c.width, 0); x.rotate(Math.PI / 2); } else { x.translate(0, c.height); x.rotate(-Math.PI / 2); }
  x.drawImage(img, 0, 0); return c;
}
