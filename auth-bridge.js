// Google refuses to sign people in inside an app's own window ("This browser or
// app may not be secure"). So when the Cleer page tries to start Google
// sign-in, we catch that and do it in the person's normal browser instead:
//
//   1. The sign-in page opens in the default browser, and Supabase is told to
//      send the result back to a tiny server that only this computer can reach
//      (http://127.0.0.1:53682).
//   2. That server receives the result and hands it to the Cleer window, which
//      finishes signing in exactly as if Google had returned to it directly.
//
// The address http://127.0.0.1:53682/** must be listed under Supabase →
// Authentication → URL Configuration → Redirect URLs (see README).
const http = require('http');

const AUTH_PORT = 53682;
const AUTH_CALLBACK = `http://127.0.0.1:${AUTH_PORT}/callback`;
const TIMEOUT_MS = 5 * 60 * 1000;

let server = null;
let timer = null;

function closeServer() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (server) { try { server.close(); } catch {} server = null; }
}

function isSupabaseAuthorize(url) {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/auth/v1/authorize');
  } catch {
    return false;
  }
}

const PAGE_STYLE = 'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#f5f6f7;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#a3a8b2;margin:0}';

// Step 1 page: the sign-in result may arrive after a "#" (which a server cannot
// see), so this page forwards it to the server as normal text.
const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Cleer</title><style>${PAGE_STYLE}</style>
<div><h1>Finishing sign-in…</h1><p>One moment.</p></div>
<script>location.replace('/done?s=' + encodeURIComponent(location.search) + '&h=' + encodeURIComponent(location.hash));</script>`;

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Cleer</title><style>${PAGE_STYLE}</style>
<div><h1>You're signed in</h1><p>You can close this tab and go back to Cleer.</p></div>`;

// authorizeUrl: the Supabase sign-in address the page tried to open.
// ctx: { win, appUrl, openExternal }
function startGoogleSignIn(authorizeUrl, ctx) {
  const target = new URL(authorizeUrl);
  target.searchParams.set('redirect_to', AUTH_CALLBACK);
  closeServer();

  server = http.createServer((req, res) => {
    let reqUrl;
    try { reqUrl = new URL(req.url, `http://127.0.0.1:${AUTH_PORT}`); } catch { res.writeHead(400); res.end(); return; }

    if (reqUrl.pathname === '/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CALLBACK_PAGE);
    } else if (reqUrl.pathname === '/done') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DONE_PAGE);
      const search = reqUrl.searchParams.get('s') || '';
      const hash = reqUrl.searchParams.get('h') || '';
      // Only ever appended to the Cleer address, never to anything else.
      const okSearch = search === '' || search[0] === '?';
      const okHash = hash === '' || hash[0] === '#';
      if (okSearch && okHash && !/[\r\n]/.test(search + hash)) {
        const base = ctx.appUrl.replace(/\/+$/, '');
        const win = ctx.win;
        if (win && !win.isDestroyed()) {
          win.loadURL(`${base}/${search}${hash}`);
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      }
      setTimeout(closeServer, 500);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.on('error', () => { closeServer(); });
  server.listen(AUTH_PORT, '127.0.0.1', () => ctx.openExternal(target.toString()));
  timer = setTimeout(closeServer, TIMEOUT_MS);
}

module.exports = { isSupabaseAuthorize, startGoogleSignIn, closeServer, AUTH_PORT, AUTH_CALLBACK };
