const http = require('http');

const WORKFLOW_ID = 'U7fHPfZF9vwTdF28';
const N8N_EMAIL   = 'gonzalezcamilo437@gmail.com';
const N8N_PASS    = 'fittracker2026';

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const r = http.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: (() => { try { return JSON.parse(d); } catch { return d; } })(),
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
      }));
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

(async () => {
  // Login
  const login = await req('POST', '/rest/login', { emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASS });
  if (login.status !== 200) { console.error('Login failed:', login.status, login.body); process.exit(1); }
  const cookie = login.cookie;
  console.log('[n8n] Logged in');

  // Deactivate
  const deact = await req('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: false }, cookie);
  console.log('[n8n] Deactivate:', deact.status, deact.body?.active);

  await new Promise(r => setTimeout(r, 2000));

  // Activate
  const act = await req('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: true }, cookie);
  console.log('[n8n] Activate:', act.status, act.body?.active);

  // Verify active nodes
  const wf = await req('GET', `/rest/workflows/${WORKFLOW_ID}`, null, cookie);
  const nodes = wf.body?.nodes || [];
  console.log('[n8n] Current nodes:', nodes.map(n => n.name).join(', '));
  console.log('\n✅ Workflow reloaded — using Ollama now.');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
