'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { mergeHouseholdState } = require('../state-merge');

function setup(api) {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const elements = new Map();
  const document = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { inert: false, hidden: true, textContent: '', close() {} });
    return elements.get(selector);
  } };
  const base = {
    members: [], tasks: [], groceries: [], mealIdeas: [], notes: [],
    completed: {}, customization: { websiteTitle: 'Thuis' }
  };
  const context = vm.createContext({
    api, document, mergeHouseholdState, structuredClone, console: { error() {} },
    validateBackup: backup => {
      if (!backup.data || typeof backup.data !== 'object') throw new Error('Onbekend back-upformaat of versie.');
      return structuredClone(backup.data);
    },
    BACKUP_FORMAT: 'ons-huishouden-backup', state: structuredClone(base),
    savedState: structuredClone(base), revision: 1, demoMode: false, saving: false,
    needsRecovery: false, accountEmail: 'a@example.test', currentRole: 'owner', isChild: () => false
  });
  vm.runInContext(app.slice(app.indexOf('async function save('), app.indexOf('function escapeHtml(')), context);
  return { context, base, elements };
}

function conflict() {
  const error = new Error('conflict');
  error.status = 409;
  return error;
}

test('retries against newest revision, applies server metadata and saves a confirmed baseline', async () => {
  const requests = [];
  let base;
  const { context, base: initial } = setup(async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) throw conflict();
    if (requests.length === 2) return {
      email: 'a@example.test', role: 'owner', revision: 2,
      data: { ...base, groceries: [{ id: 'remote', name: 'Melk', done: false }] }
    };
    const body = JSON.parse(options.body);
    assert.equal(body.revision, 2);
    assert.deepEqual(body.data.groceries.map(item => item.id), ['remote', 'local']);
    return { revision: 3, data: { ...body.data, groceries: body.data.groceries.map(item => ({ ...item, createdByUserId: 7 })) } };
  });
  base = initial;
  const next = structuredClone(base);
  next.groceries.push({ id: 'local', name: 'Brood', done: false });
  assert.equal(await context.save(next), true);
  assert.equal(context.revision, 3);
  assert.deepEqual(next.groceries.map(item => item.createdByUserId), [7, 7]);
  assert.deepEqual(context.savedState, next);
  assert.notEqual(context.savedState, next);
  assert.equal(context.document.querySelector('#app').inert, false);
});

test('overlapping changes keep the attempted state for recovery without retrying a write', async () => {
  let calls = 0;
  let base;
  const { context, base: initial } = setup(async (url, options) => {
    calls++;
    if (options) throw conflict();
    return { email: 'a@example.test', role: 'owner', revision: 2, data: { ...base, customization: { websiteTitle: 'Anders' } } };
  });
  base = initial;
  const next = structuredClone(base);
  next.customization.websiteTitle = 'Lokaal';
  assert.equal(await context.save(next), false);
  assert.equal(calls, 2);
  assert.equal(context.state.customization.websiteTitle, 'Lokaal');
  assert.equal(context.needsRecovery, true);
  assert.equal(context.document.querySelector('#app').inert, true);
});

test('backup restoration never automatically merges a conflict', async () => {
  let calls = 0;
  const { context, base } = setup(async () => { calls++; throw conflict(); });
  assert.equal(await context.save(structuredClone(base), { mergeOnConflict: false }), false);
  assert.equal(calls, 1);
});

test('repeated conflicts stop after a bounded number of writes', async () => {
  let writes = 0;
  let base;
  const { context, base: initial } = setup(async (url, options) => {
    if (options) { writes++; throw conflict(); }
    return { email: 'a@example.test', role: 'owner', revision: writes + 1, data: base };
  });
  base = initial;
  assert.equal(await context.save(structuredClone(base)), false);
  assert.equal(writes, 4);
  assert.equal(context.needsRecovery, true);
});

test('does not retry after the session switches accounts', async () => {
  let calls = 0;
  let base;
  const { context, base: initial } = setup(async (url, options) => {
    calls++;
    if (options) throw conflict();
    return { email: 'other@example.test', role: 'owner', revision: 2, data: base };
  });
  base = initial;
  assert.equal(await context.save(structuredClone(base)), false);
  assert.equal(calls, 2);
  assert.match(context.document.querySelector('#recovery-message').textContent, /account is gewijzigd/);
});

test('reads the saved state from older servers that return only a revision', async () => {
  let calls = 0;
  let base;
  const { context, base: initial } = setup(async (url, options) => {
    calls++;
    if (options) return { revision: 2 };
    return {
      email: 'a@example.test', role: 'owner', revision: 3,
      data: { ...base, groceries: [
        { id: 'local', name: 'Brood', done: false, createdByUserId: 7 },
        { id: 'remote', name: 'Melk', done: false }
      ] }
    };
  });
  base = initial;
  const next = structuredClone(base);
  next.groceries.push({ id: 'local', name: 'Brood', done: false });
  assert.equal(await context.save(next), true);
  assert.equal(calls, 2);
  assert.equal(context.revision, 3);
  assert.equal(next.groceries[0].createdByUserId, 7);
  assert.equal(next.groceries[1].id, 'remote');
  assert.deepEqual(context.savedState, next);
});

test('reports a confirmed write if reloading its data fails, without retrying the write', async () => {
  let calls = 0;
  const { context, base } = setup(async (url, options) => {
    calls++;
    if (options) return { revision: 2 };
    throw new Error('Verbinding verbroken');
  });
  assert.equal(await context.save(structuredClone(base)), false);
  assert.equal(calls, 2);
  assert.match(context.document.querySelector('#recovery-message').textContent, /wijziging is opgeslagen/);
  assert.equal(context.document.querySelector('#recovery-title').textContent, 'Opgeslagen gegevens niet geladen');
  assert.doesNotMatch(context.document.querySelector('#recovery-advice').textContent, /mogelijk niet opgeslagen/);
  assert.equal(context.needsRecovery, true);
});

test('rejects a stale read after a confirmed write', async () => {
  let base;
  const { context, base: initial } = setup(async (url, options) => options
    ? { revision: 2 }
    : { email: 'a@example.test', role: 'owner', revision: 1, data: base });
  base = initial;
  assert.equal(await context.save(structuredClone(base)), false);
  assert.match(context.document.querySelector('#recovery-message').textContent, /verouderde of ongeldige revisie/);
});

test('does not accept an invalid successful save response', async () => {
  const { context, base } = setup(async () => ({ revision: 5, data: base }));
  assert.equal(await context.save(structuredClone(base)), false);
  assert.match(context.document.querySelector('#recovery-message').textContent, /ongeldige revisie/);
});
