// Run: node tests/serve-fixture.mjs; open http://127.0.0.1:8765.
// Serves the real frontend with a synthetic Supabase adapter. No live requests.
import http from 'node:http';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const server = http.createServer((req, res) => {
  if (req.url === '/mock-supabase.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(fs.readFileSync(new URL('tests/mock-supabase.js', root)));
    return;
  }
  let html = fs.readFileSync(new URL('index.html', root), 'utf8');
  html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,
    '<script src="/mock-supabase.js"></script>');
  if (html.includes('cdn.jsdelivr.net')) throw new Error('Fixture must not load the real SDK');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'");
  res.end(html);
});
server.listen(8765, '0.0.0.0', () => console.log('Synthetic CareFlow test fixture at http://127.0.0.1:8765'));
