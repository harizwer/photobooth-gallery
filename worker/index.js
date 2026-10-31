// Photobooth Studio worker.
// The website itself is served as static files (public/). This worker only adds /files/*:
// photos, strips, boomerangs and studio images, stored in Cloudflare R2 (bucket "photobooth-photos").
//   GET    /files/<path>  anyone with the link (paths contain random ids). Files saved before the move
//                         to R2 are fetched from the old Supabase storage once and copied into R2.
//   PUT    /files/<path>  logged-in owner only (Supabase login token).
//   DELETE /files/<path>  logged-in owner only.
const SUPABASE_URL = 'https://dqeyaimxfkursttbdmyp.supabase.co';
const PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZXlhaW14Zmt1cnN0dGJkbXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyODc2NTQsImV4cCI6MjEwODg2MzY1NH0.T5tHvHVpNzNHwxYFASy8WO6xr1bvfBko9gxHCoxVQSc';
const MAX_UPLOAD = 60 * 1024 * 1024;
let SB = SUPABASE_URL;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag',
};

export default {
  async fetch(request, env, ctx) {
    SB = env.SUPABASE_URL || SUPABASE_URL;   // overridable for local tests
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/files/')) return env.ASSETS.fetch(request);
    const path = decodeURIComponent(url.pathname.slice('/files/'.length));
    if (!validPath(path)) return text(400, 'Bad file name');
    try {
      switch (request.method) {
        case 'OPTIONS': return new Response(null, { status: 204, headers: CORS });
        case 'GET': case 'HEAD': return await serve(request, env, ctx, path);
        case 'PUT': return await put(request, env, path);
        case 'DELETE': return await del(request, env, path);
        default: return text(405, 'Method not allowed');
      }
    } catch (e) {
      return text(500, 'Storage error: ' + (e && e.message || e));
    }
  },
};

function validPath(p) {
  return p.length > 2 && p.length < 300 && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(p) && !p.includes('..');
}

function text(status, msg) {
  return new Response(msg, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function fileHeaders(obj) {
  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  h.set('ETag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'public, max-age=31536000, immutable');   // every file name is unique
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return h;
}

async function serve(request, env, ctx, path) {
  let obj = await env.PHOTOS.get(path, { range: request.headers, onlyIf: request.headers });
  if (obj === null) {
    // Not in R2 yet: an older file still in Supabase storage. Copy it over, then serve it.
    const old = await fetch(SB + '/storage/v1/object/public/photos/' + path);
    if (!old.ok) return text(404, 'File not found');
    const type = old.headers.get('Content-Type') || 'application/octet-stream';
    const body = await old.arrayBuffer();
    await env.PHOTOS.put(path, body, { httpMetadata: { contentType: type } });
    obj = await env.PHOTOS.get(path, { range: request.headers, onlyIf: request.headers });
    if (obj === null) return text(404, 'File not found');
  }
  const h = fileHeaders(obj);
  if (!('body' in obj)) return new Response(null, { status: 304, headers: h });   // not modified
  let status = 200;
  if (obj.range && request.headers.has('Range')) {
    const r = obj.range, start = r.offset ?? (obj.size - r.suffix), len = r.length ?? (obj.size - start);
    h.set('Content-Range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    h.set('Content-Length', String(len));
    status = 206;
  } else {
    h.set('Content-Length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers: h });
}

// Who is calling? Checks the Supabase login token and returns the user id.
async function userId(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return null;
  const r = await fetch(SB + '/auth/v1/user', { headers: { apikey: PUBLIC_KEY, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, auth } : null;
}

// May this user write here? "u-<user id>/..." is the user's own folder; "<event id>/..." belongs to the event's owner.
async function mayWrite(user, path) {
  const top = path.split('/')[0];
  if (top.startsWith('u-')) return top === 'u-' + user.id;
  const r = await fetch(`${SB}/rest/v1/events?id=eq.${encodeURIComponent(top)}&select=id`, { headers: { apikey: PUBLIC_KEY, Authorization: user.auth } });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function put(request, env, path) {
  const user = await userId(request);
  if (!user) return text(401, 'Log in again to save photos.');
  if (!(await mayWrite(user, path))) return text(403, 'Not allowed to save here.');
  const len = +request.headers.get('Content-Length') || 0;
  if (len > MAX_UPLOAD) return text(413, 'File too big');
  const type = request.headers.get('Content-Type') || 'application/octet-stream';
  const body = await request.arrayBuffer();
  if (!body.byteLength) return text(400, 'Empty file');
  if (body.byteLength > MAX_UPLOAD) return text(413, 'File too big');
  await env.PHOTOS.put(path, body, { httpMetadata: { contentType: type } });
  return new Response(JSON.stringify({ ok: true, path, size: body.byteLength }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function del(request, env, path) {
  const user = await userId(request);
  if (!user) return text(401, 'Log in again.');
  if (!(await mayWrite(user, path))) return text(403, 'Not allowed.');
  await env.PHOTOS.delete(path);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
