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
  assert.equal((await request('/api/preferences')).status, 401);
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
  assert.equal((await request('/api/preferences', { cookie: first.cookie })).json.colorPalette, 'forest');
  assert.equal((await request('/api/preferences', { cookie: second.cookie })).json.colorPalette, 'forest');
  const initialHousehold = await request('/api/state', { cookie: first.cookie });
  assert.equal((await request('/api/preferences', {
    method: 'PUT', cookie: first.cookie, body: { colorPalette: 'not-a-palette' }
  })).status, 400);
  const firstPalette = await request('/api/preferences', {
    method: 'PUT', cookie: first.cookie, body: { colorPalette: 'ocean' }
  });
  assert.equal(firstPalette.status, 200);
  assert.equal(firstPalette.json.colorPalette, 'ocean');
  assert.equal((await request('/api/preferences', { cookie: first.cookie })).json.colorPalette, 'ocean');
  assert.equal((await request('/api/preferences', { cookie: second.cookie })).json.colorPalette, 'forest');
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.revision, initialHousehold.json.revision);
  const state = await request('/api/state', { cookie: first.cookie });
  assert.equal(state.status, 200);
  assert.equal(state.json.data.members.length, 3);
  const invalidCustomization = structuredClone(state.json.data);
  invalidCustomization.customization = { ...invalidCustomization.customization, websiteTitle: '' };
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: invalidCustomization, revision: state.json.revision }
  })).status, 400);
  const invalidNotes = structuredClone(state.json.data);
  invalidNotes.notes = [{ id: 'invalid-note', title: '', description: 'Beschrijving', author: 'Gebruiker', archived: false }];
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: invalidNotes, revision: state.json.revision }
  })).status, 400);
  const invalidNoteImportance = structuredClone(state.json.data);
  invalidNoteImportance.notes = [{ id: 'invalid-note', title: 'Titel', description: 'Beschrijving', author: 'Gebruiker', archived: false, important: 'true' }];
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: invalidNoteImportance, revision: state.json.revision }
  })).status, 400);
  const invalidAppointment = structuredClone(state.json.data);
  invalidAppointment.appointments = [{ id: 'a1', title: 'Afspraak', memberId: 'unknown', allDay: true,
    startDate: '2026-11-18', endDate: '2026-11-18', startTime: '', endTime: '' }];
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: invalidAppointment, revision: state.json.revision }
  })).status, 400);
  assert.equal((await request('/api/invitations', {
    method: 'POST', cookie: first.cookie, body: { email: emails[2], role: 'parent', memberId: 'not-a-family-member' }
  })).status, 400);
  const changed = structuredClone(state.json.data);
  changed.customization.websiteTitle = 'De familie test';
  changed.customization.brandSubtitle = 'SAMEN STERK';
  changed.tasks[0].important = true;
  const completedAt = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  changed.completed[`${changed.tasks[0].id}|${dueDate}`] = {
    completedAt,
    completedByUserId: 'spoofed-user'
  };
  changed.groceries.push({ id: 'test', name: 'Melk', done: false, urgent: false });
  changed.appointments.push({ id: 'a1', title: 'Afspraak', memberIds: ['member-1', 'member-2'], allDay: true,
    startDate: '2026-11-18', endDate: '2026-11-18', startTime: '', endTime: '',
    recurrence: { frequency: 'biweekly', until: '', exceptions: { '2026-12-02': null } } });
  changed.notes = [
    { id: 'note-test', title: 'Testnotitie', description: 'Een beschrijving', author: 'Niet vertrouwen', archived: false, important: true },
    { id: 'note-default', title: 'Standaardnotitie', description: 'Niet belangrijk', author: 'Niet vertrouwen', archived: false }
  ];
  const saved = await request('/api/state', { method: 'PUT', cookie: first.cookie, body: { data: changed, revision: state.json.revision } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.data, (await request('/api/state', { cookie: first.cookie })).json.data);
  assert.equal(saved.json.revision, state.json.revision + 1);
  assert.deepEqual(saved.json.data.appointments, changed.appointments);
  assert.equal((await request('/api/state', { method: 'PUT', cookie: first.cookie, body: { data: changed, revision: state.json.revision } })).status, 409);
  assert.deepEqual((await request('/api/state', { cookie: first.cookie })).json.data.groceries, changed.groceries);
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.customization.websiteTitle, 'De familie test');
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.customization.brandSubtitle, 'SAMEN STERK');
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.tasks[0].important, true);
  const savedCompletion = (await request('/api/state', { cookie: first.cookie })).json.data.completed[
    `${changed.tasks[0].id}|${dueDate}`
  ];
  assert.equal(savedCompletion.completedAt, completedAt);
  const householdMembers = (await request('/api/household', { cookie: first.cookie })).json.members;
  assert.equal(String(savedCompletion.completedByUserId), String(householdMembers.find(member => member.email === emails[0]).id));
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.notes[0].author, emails[0]);
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.notes[0].important, true);
  assert.equal((await request('/api/state', { cookie: first.cookie })).json.data.notes[1].important, false);
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
  assert.equal((await request('/api/preferences', { cookie: invited.cookie })).json.colorPalette, 'forest');
  let invitedState = await request('/api/state', { cookie: invited.cookie });
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
  const childState = await request('/api/state', { cookie: childAccount.cookie });
  assert.equal(childState.json.role, 'child');
  assert.equal((await request('/api/preferences', {
    method: 'PUT', cookie: childAccount.cookie, body: { colorPalette: 'ocean' }
  })).status, 200);
  for (const change of [
    data => { data.tasks[0].title = 'Anders'; },
    data => { data.members[0].name = 'Anders'; },
    data => { data.groceries = []; },
    data => { data.mealIdeas = []; },
    data => { data.notes = []; },
    data => { data.customization.websiteTitle = 'Anders'; }
  ]) {
    const data = structuredClone(childState.json.data);
    change(data);
    assert.equal((await request('/api/state', {
      method: 'PUT', cookie: childAccount.cookie, body: { data, revision: childState.json.revision }
    })).status, 403);
  }
  const childChanges = structuredClone(childState.json.data);
  childChanges.completed[`${childChanges.tasks[0].id}|2026-11-16`] = true;
  childChanges.groceries[0].done = true;
  childChanges.groceries.push({ id: 'child-grocery', name: 'Brood', done: false, urgent: false });
  childChanges.mealIdeas[0].wishedBy.push(childChanges.members[0].id);
  childChanges.mealIdeas.push({ id: 'child-meal', name: 'Soep', wishedBy: [] });
  childChanges.notes.push({ id: 'child-note', title: 'Hallo', description: 'Bericht', author: 'Kind', archived: false });
  const childSaved = await request('/api/state', {
    method: 'PUT', cookie: childAccount.cookie, body: { data: childChanges, revision: childState.json.revision }
  });
  assert.equal(childSaved.status, 200);
  const stateAfterChildSave = (await request('/api/state', { cookie: childAccount.cookie })).json.data;
  const childUserId = childFamily.json.members.find(member => member.email === emails[3]).id;
  for (const item of [
    ...stateAfterChildSave.groceries.filter(item => item.id === 'child-grocery'),
    ...stateAfterChildSave.mealIdeas.filter(item => item.id === 'child-meal'),
    ...stateAfterChildSave.notes.filter(item => item.id === 'child-note')
  ]) {
    assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(String(item.createdByUserId), String(childUserId));
  }
  assert.equal((await request('/api/state', {
    method: 'PUT', cookie: first.cookie, body: { data: childState.json.data, revision: childSaved.json.revision }
  })).status, 200);
  invitedState = await request('/api/state', { cookie: invited.cookie });
  assert.equal((await request('/api/password-resets', {
    method: 'POST', cookie: childAccount.cookie, body: { email: emails[0] }
  })).status, 403);
  const passwordReset = await request('/api/password-resets', {
    method: 'POST', cookie: first.cookie, body: { email: emails[3] }
  });
  assert.equal(passwordReset.status, 201);
  assert.equal((await request(`/api/password-resets/${passwordReset.json.token}`)).json.email, emails[3]);
  const changedPassword = 'een-nieuw-veilig-testwachtwoord';
  assert.equal((await request('/api/password-resets/complete', {
    method: 'POST', body: { token: passwordReset.json.token, password: changedPassword }
  })).status, 200);
  assert.equal((await request('/api/state', { cookie: childAccount.cookie })).status, 401);
  assert.equal((await request(`/api/password-resets/${passwordReset.json.token}`)).status, 404);
  assert.equal((await request('/api/login', {
    method: 'POST', body: { email: emails[3], password: credentials.password }
  })).status, 401);
  assert.equal((await request('/api/login', {
    method: 'POST', body: { email: emails[3], password: changedPassword }
  })).status, 200);
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
  invitedChanged.notes[0].description = 'Aangepast door een ander gezinslid';
  const invitedSave = await request('/api/state', {
    method: 'PUT', cookie: invited.cookie, body: { data: invitedChanged, revision: invitedState.json.revision }
  });
  assert.equal(invitedSave.status, 200);
  const noteAfterEdit = (await request('/api/state', { cookie: first.cookie })).json.data.notes[0];
  assert.equal(noteAfterEdit.author, emails[0]);
  assert.equal(noteAfterEdit.important, true);
  assert.equal(noteAfterEdit.editedBy, invitedState.json.data.members.find(member => member.email === emails[2]).name);
  assert.deepEqual((await request('/api/state', { cookie: first.cookie })).json.data.groceries, invitedChanged.groceries);
  const login = await request('/api/login', { method: 'POST', body: credentials });
  assert.equal(login.status, 200);
  assert.equal((await request('/api/preferences', { cookie: login.cookie })).json.colorPalette, 'ocean');
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
