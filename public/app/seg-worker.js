// AI background: finds the people in a photo, away from the screen's thread, so the tablet never freezes.
// Messages in:  { id, kind: 'photo' | 'fast', bmp: ImageBitmap }   or   { id, kind, warm: true } to load the model early.
// Messages out: { id, ok, w, h, a: Uint8ClampedArray (how much each pixel is a person, 0-255) }  or  { id, ok: false, error }.
const BASE = new URL('../vendor/mediapipe/', self.location.href).href;
const segs = {};
function seg(kind) {
  if (segs[kind]) return segs[kind];
  segs[kind] = (async () => {
    const { ImageSegmenter } = await import(BASE + 'vision_bundle.mjs');
    const fileset = { wasmLoaderPath: BASE + 'vision_wasm_internal.js', wasmBinaryPath: BASE + 'vision_wasm_internal.wasm' };
    const model = BASE + (kind === 'photo' ? 'selfie_multiclass.tflite' : 'selfie_segmenter.tflite');
    const make = delegate => ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
    return make('CPU');   // the processor: the graphics chip can stop answering inside a worker on some tablets
  })();
  segs[kind].catch(() => { delete segs[kind]; });
  return segs[kind];
}
// one photo at a time, in the order asked
let queue = Promise.resolve();
self.onmessage = e => {
  const { id, kind, bmp, warm } = e.data;
  queue = queue.then(async () => {
    try {
      const s = await seg(kind);
      if (warm) return self.postMessage({ id, ok: true });
      const res = s.segment(bmp), masks = res.confidenceMasks, m = masks[0], w = m.width, h = m.height, conf = m.getAsFloat32Array();
      // multiclass model: mask 0 is the background; selfie model: mask 0 is the person
      const bgFirst = kind === 'photo', a = new Uint8ClampedArray(w * h);
      for (let i = 0; i < conf.length; i++) {
        let p = bgFirst ? 1 - conf[i] : conf[i];
        p = Math.min(1, Math.max(0, (p - .35) / .3));   // firm up the edge a little
        a[i] = p * 255;
      }
      if (res.close) res.close(); masks.forEach(x => x.close && x.close()); if (bmp && bmp.close) bmp.close();
      self.postMessage({ id, ok: true, w, h, a }, [a.buffer]);
    } catch (err) {
      if (bmp && bmp.close) bmp.close();
      self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
  });
};
