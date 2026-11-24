#!/usr/bin/env node
// Security verification — run with `pnpm verify:security` (after `pnpm build`).
//
// 1. STATIC: the browser code (src/ + dist/) must contain only the public anon/publishable key:
//    no service_role JWT, no sb_secret_ key, no SUPABASE_SERVICE_ROLE_KEY reference.
// 2. LIVE (anon key only, like any visitor):
//    - GET /rest/v1/{units,profiles,building_admins,payments} → 401/403 or [] (no data leaks)
//    - POST rpc/get_public_landing_state → 200
//    - POST rpc/get_public_building_dashboard → 200, and NO "whatsapp_phone" anywhere in the JSON
// Exits with code 1 on any failure.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|html|json|webmanifest)$/.test(name)) out.push(p);
  }
  return out;
}

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 1. static
console.log('\n1) Static scan of browser code (src/, dist/, public-config.json)');
const files = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'dist')),
  join(root, 'public-config.json'),
].filter((f) => existsSync(f));
let staticOk = true;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = file.replace(root + '/', '');
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) {
    fail(`${rel}: contains an sb_secret_ key`);
    staticOk = false;
  }
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(text)) {
    fail(`${rel}: references SUPABASE_SERVICE_ROLE_KEY`);
    staticOk = false;
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (jwtRole(m[0]) === 'service_role') {
      fail(`${rel}: contains a service_role JWT`);
      staticOk = false;
    }
  }
}
if (staticOk) pass(`${files.length} files scanned — no secret keys, only the public anon/publishable key`);
if (!existsSync(join(root, 'dist'))) console.log('  (dist/ not found — run `pnpm build` first to scan the bundle too)');

// ---------------------------------------------------------------- 2. live
const pub = existsSync(join(root, 'public-config.json')) ? JSON.parse(readFileSync(join(root, 'public-config.json'), 'utf8')) : {};
const url = (process.env.SUPABASE_URL || pub.supabaseUrl || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_ANON_KEY || pub.supabasePublishableKey || '';

if (!url || !key) {
  console.log('\n2) Live checks skipped (no SUPABASE_URL / SUPABASE_ANON_KEY)');
} else {
  console.log(`\n2) Live anonymous checks against ${url}`);
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  const safeFetch = async (path, init = {}) => {
    try {
      return await fetch(url + path, { ...init, headers });
    } catch (e) {
      return { status: 0, text: async () => String(e) };
    }
  };

  for (const table of ['units', 'profiles', 'building_admins', 'payments', 'buildings']) {
    const res = await safeFetch(`/rest/v1/${table}?select=*&limit=5`);
    const body = await res.text();
    const leaked = res.status === 200 && body.trim() !== '[]';
    if (res.status === 0) fail(`GET /rest/v1/${table}: network error`);
    else if (leaked) fail(`GET /rest/v1/${table} as anon returned data (HTTP ${res.status})`);
    else pass(`GET /rest/v1/${table} as anon → HTTP ${res.status}${res.status === 200 ? ' []' : ''} (no data)`);
  }

  const landingRes = await safeFetch('/rest/v1/rpc/get_public_landing_state', { method: 'POST', body: '{}' });
  const landing = landingRes.status === 200 ? JSON.parse(await landingRes.text()) : null;
  if (landing) pass(`rpc/get_public_landing_state → 200 (${landing.building_count} active building(s))`);
  else fail(`rpc/get_public_landing_state → HTTP ${landingRes.status}`);

  const slug = process.argv[2] || landing?.single_slug;
  if (!slug) {
    console.log('  (pass a building slug as argument to check its dashboard: pnpm verify:security <slug>)');
  } else {
    const res = await safeFetch('/rest/v1/rpc/get_public_building_dashboard', {
      method: 'POST',
      body: JSON.stringify({ p_slug: slug }),
    });
    const text = await res.text();
    if (res.status !== 200 || text === 'null') fail(`rpc/get_public_building_dashboard("${slug}") → HTTP ${res.status} ${text.slice(0, 80)}`);
    else if (/whatsapp_phone/.test(text)) fail('dashboard JSON contains "whatsapp_phone"');
    else if (/"notes"\s*:\s*"[^"]*"/.test(JSON.stringify(JSON.parse(text).payments ?? []))) fail('dashboard exposes private payment notes');
    else pass(`rpc/get_public_building_dashboard("${slug}") → 200, zero whatsapp_phone fields, no payment notes`);
  }
}

console.log(failures ? `\n✗ ${failures} check(s) FAILED\n` : '\n✓ All security checks passed\n');
process.exit(failures ? 1 : 0);
