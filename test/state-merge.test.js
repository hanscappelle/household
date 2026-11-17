'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeHouseholdState } = require('../state-merge');

function data() {
  return {
    members: [{ id: 'm1', name: 'Een' }, { id: 'm2', name: 'Twee' }],
    tasks: [{ id: 't1', title: 'Taak' }, { id: 't2', title: 'Andere taak' }],
    groceries: [{ id: 'g1', name: 'Melk', done: false }],
    mealIdeas: [], notes: [], completed: {}, customization: { websiteTitle: 'Thuis', welcomeTitle: 'Welkom' }
  };
}

test('merges independent additions, edits, deletions and completion keys', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.tasks[0].title = 'Nieuwe taak';
  local.groceries.push({ id: 'g2', name: 'Brood', done: false });
  local.completed['t1|2026-11-17'] = true;
  local.customization.websiteTitle = 'Gezin';
  remote.tasks = remote.tasks.filter(task => task.id !== 't2');
  remote.groceries[0].done = true;
  remote.groceries.push({ id: 'g3', name: 'Kaas', done: false });
  remote.completed['t1|2026-11-18'] = true;
  remote.customization.welcomeTitle = 'Hallo';
  const merged = mergeHouseholdState(base, local, remote);
  assert.deepEqual(merged.tasks, [{ id: 't1', title: 'Nieuwe taak' }]);
  assert.deepEqual(merged.groceries.map(item => item.id), ['g1', 'g3', 'g2']);
  assert.equal(merged.groceries[0].done, true);
  assert.deepEqual(merged.completed, { 't1|2026-11-17': true, 't1|2026-11-18': true });
  assert.deepEqual(merged.customization, { websiteTitle: 'Gezin', welcomeTitle: 'Hallo' });
  assert.deepEqual(base, data());
});

test('rejects concurrent edits or delete versus edit of the same item', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.groceries[0].done = true;
  remote.groceries[0].name = 'Sojamelk';
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
  remote.groceries = [];
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
});

test('accepts identical changes and rejects simultaneous additions with the same id', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.groceries[0].done = remote.groceries[0].done = true;
  assert.equal(mergeHouseholdState(base, local, remote).groceries[0].done, true);
  local.notes.push({ id: 'n1', title: 'Een' });
  remote.notes.push({ id: 'n1', title: 'Twee' });
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
});

test('rejects member deletion against concurrent task changes, in both directions', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.members.pop();
  remote.tasks[0].title = 'Aangepast';
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
  assert.throws(() => mergeHouseholdState(base, remote, local), /Dezelfde gegevens/);
});

test('rejects reordered or malformed collections instead of silently dropping changes', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.tasks.reverse();
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
  local.tasks = [base.tasks[0], base.tasks[0]];
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
});

test('handles item ids that are also object prototype properties', () => {
  const base = data();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.groceries.push({ id: 'constructor', name: 'Brood', done: false });
  remote.groceries.push({ id: '__proto__', name: 'Kaas', done: false });
  assert.deepEqual(mergeHouseholdState(base, local, remote).groceries.map(item => item.id),
    ['g1', '__proto__', 'constructor']);
});
