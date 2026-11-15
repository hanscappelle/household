'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');

const configured = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].every(key => process.env[key]);

for (const basePath of ['', '/household']) {
test(`accounts en opslag op ${basePath || '/'}`, { skip: !configured, timeout: 30000 }, async t => {
  const port = Number(process.env.TEST_PORT || 19877) + (basePath ? 1 : 0);
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, APP_ORIGIN: origin, APP_BASE_PATH: basePath, IP: '127.0.0.1', PORT: String(port), TRUST_PROXY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    socketPath: process.env.DB_SOCKET || undefined,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const emails = Array.from({ length: 5 }, () => `${randomUUID()}@example.test`);
  t.after(async () => {
    await pool.execute('DELETE FROM users WHERE email IN (?, ?, ?, ?, ?)', emails);
    await pool.end();
    server.kill();
  });
  for (let i = 0; i < 100 && !output.includes('Server luistert'); i++) {
    if (server.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(output, /Server luistert/);

  async function request(path, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
    const headers = {};
    if (method !== 'GET') headers.Origin = requestOrigin;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + basePath + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    return { status: response.status, json, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }

  assert.equal((await request('/api/state')).status, 401);
  assert.equal((await request('/api/register', { method: 'POST', requestOrigin: 'https://evil.example', body: {} })).status, 403);
  assert.equal((await request('/api/register', { method: 'POST', body: { email: emails[0], password: 'kort' } })).status, 400);
  const credentials = { email: emails[0], password: 'een-veilig-testwachtwoord' };
  const first = await request('/api/register', { method: 'POST', body: credentials });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
  assert.ok(first.headers.get('set-cookie').includes(`Path=${basePath || '/'}`));
  assert.equal((await request('/api/register', { method: 'POST', body: credentials })).status, 409);
  assert.equal((await request('/api/login', { method: 'POST', body: { ...credentials, password: 'een-fout-wachtwoord' } })).status, 401);
  const second = await request('/api/register', { method: 'POST', body: { email: emails[1], password: credentials.password } });
  assert.equal(second.status, 201);
  const state = await request('/api/state', { cookie: first.cookie });
  assert.equal(state.status, 200);
  assert.equal(state.json.data.members.length, 3);
  const invalidCustomization = structuredClone(state.json.data);
  invalidCustomization.customization = { ...invalidCustomization.customization, websiteTitle: '' };
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: invalidCustomization, revision: state.json.revision }
  })).status, 400);
  assert.equal((await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[2], role: 'parent', memberId: 'not-a-family-member' }
  })).status, 400);
  const changed = structuredClone(state.json.data);
  changed.customization.websiteTitle = 'De familie test';
  changed.customization.brandSubtitle = 'SAMEN STERK';
  changed.groceries.push({ id: 'test', name: 'Melk', done: false, urgent: false });
  const saved = await request('/api/state', { method: 'PUT', cookie: first.cookie, body: { data: changed, revision: state.json.revision } });
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/state', { method: 'PUT', cookie: first.cookie, body: { data: changed, revision: state.json.revision } })).status, 409);
  assert.deepEqual((await request('/api/state', { cookie: first.cookie })).json.data.groceries, changed.groceries);
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.customization.websiteTitle, 'De familie test');
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.customization.brandSubtitle, 'SAMEN STERK');
  assert.deepEqual((await request('/api/state', { cookie: second.cookie })).json.data.groceries, []);
  const invitation = await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[2], role: 'parent', memberId: 'member-3' }
  });
  assert.equal(invitation.status, 201);
  assert.equal((await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[2], role: 'parent', memberId: 'member-3' }
  })).status, 409);
  const inviteInfo = await request(`/api/invitations/${invitation.json.token}`);
  assert.equal(inviteInfo.status, 200);
  assert.equal(inviteInfo.json.email, emails[2]);
  const invited = await request('/api/invitations/accept', {
    method: 'POST', body: { token: invitation.json.token, password: credentials.password }
  });
  assert.equal(invited.status, 201);
  const invitedState = await request('/api/state', { cookie: invited.cookie });
  assert.deepEqual(invitedState.json.data.groceries, changed.groceries);
  assert.equal(invitedState.json.data.members.find(member => member.id === 'member-3').email, emails[2]);
  assert.equal((await request('/api/invitations', {
    method: 'POST', cookie: invited.cookie, body: { email: emails[4], role: 'parent' }
  })).status, 403);
  assert.equal((await request(`/api/invitations/${invitation.json.token}`)).status, 404);
  const family = await request('/api/household', { cookie: invited.cookie });
  assert.equal(family.status, 200);
  assert.equal(family.json.members.length, 2);
  assert.deepEqual(family.json.members.map(member => member.role).sort(), ['owner', 'parent']);
  const childInvitation = await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[3], role: 'child', memberId: null }
  });
  assert.equal(childInvitation.status, 201);
  const childAccount = await request('/api/invitations/accept', {
    method: 'POST', body: { token: childInvitation.json.token, password: credentials.password }
  });
  assert.equal(childAccount.status, 201);
  const childFamily = await request('/api/household', { cookie: childAccount.cookie });
  assert.equal(childFamily.json.canInvite, false);
  const revoked = await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[4], role: 'parent', memberId: null }
  });
  assert.equal(revoked.status, 201);
  const pending = await request('/api/household', { cookie: first.cookie });
  assert.equal(pending.json.invitations.length, 1);
  assert.equal((await request(`/api/invitations/${pending.json.invitations[0].id}`, {
    method: 'DELETE', cookie: first.cookie
  })).status, 200);
  assert.equal((await request(`/api/invitations/${revoked.json.token}`)).status, 404);
  const invitedChanged = structuredClone(invitedState.json.data);
  invitedChanged.groceries.push({ id: 'guest-test', name: 'Brood', done: false, urgent: false });
  const invitedSave = await request('/api/state', {
    method: 'PUT', cookie: invited.cookie, body: { data: invitedChanged, revision: invitedState.json.revision }
  });
  assert.equal(invitedSave.status, 200);
  assert.deepEqual((await request('/api/state', { cookie: first.cookie })).json.data.groceries, invitedChanged.groceries);
  const login = await request('/api/login', { method: 'POST', body: credentials });
  assert.equal(login.status, 200);
  assert.deepEqual((await request('/api/state', { cookie: login.cookie })).json.data.groceries, invitedChanged.groceries);
  assert.equal((await request('/api/logout', { method: 'POST', cookie: login.cookie })).status, 200);
  assert.equal((await request('/api/state', { cookie: login.cookie })).status, 401);
  assert.equal((await fetch(origin + basePath + '/server.js')).status, 404);
  assert.equal((await fetch(origin + basePath + '/')).status, 200);
  assert.equal((await fetch(origin + basePath + '/app.js')).status, 200);
  assert.equal((await fetch(origin + basePath + '/style.css')).status, 200);
  if (basePath) {
    const redirect = await fetch(origin + basePath + '?test=1', { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), `${basePath}/?test=1`);
    assert.equal((await fetch(origin + '/api/state')).status, 404);
  }
});
}
