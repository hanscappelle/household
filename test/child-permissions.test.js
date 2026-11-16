'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { childChangesAllowed } = require('../child-permissions');
const { normalizeTask } = require('../seed');

const defaults = { websiteTitle: 'Ons huishouden' };
const original = {
  members: [{ id: 'm1', name: 'Kind' }, { id: 'm2', name: 'Ouder' }],
  tasks: [{ id: 't1', title: 'Tafel dekken', frequency: 'daily', days: [1], memberId: 'm1' }],
  completed: {},
  groceries: [{ id: 'g1', name: 'Melk', done: false }],
  mealIdeas: [{ id: 'i1', name: 'Pasta', wishedBy: [] }],
  notes: [{ id: 'n1', title: 'Titel', description: 'Bericht', author: 'Ouder', archived: false }],
  customization: { websiteTitle: 'Ons huishouden' }
};

function clientState() {
  const data = structuredClone(original);
  data.tasks = data.tasks.map(normalizeTask);
  data.notes = data.notes.map(note => ({ ...note, important: false }));
  return data;
}

test('kind mag toevoegen en bestaande checkboxen aan- en uitvinken', () => {
  const data = clientState();
  data.completed['t1|2026-11-16'] = true;
  data.groceries[0].done = true;
  data.groceries.push({ id: 'g2', name: 'Brood', done: false, urgent: false, createdAt: '2026-11-16', createdByUserId: 5 });
  data.mealIdeas[0].wishedBy.push('m1');
  data.mealIdeas.push({ id: 'i2', name: 'Soep', wishedBy: [], createdAt: '2026-11-16', createdByUserId: 5 });
  data.notes.push({ id: 'n2', title: 'Hallo', description: 'Bericht', author: 'Kind', archived: false, important: true });
  assert.equal(childChangesAllowed(original, data, defaults), true);

  const next = structuredClone(data);
  delete next.completed['t1|2026-11-16'];
  next.groceries[0].done = false;
  next.mealIdeas[0].wishedBy = [];
  assert.equal(childChangesAllowed(data, next, defaults), true);
});

test('kind kan geen beschermde gegevens wijzigen of verwijderen', async t => {
  const cases = {
    'taak wijzigen': data => { data.tasks[0].title = 'Anders'; },
    'taak inplannen': data => { data.tasks[0].dailyAssignments[2] = ['m1', 'm2']; },
    'taak toevoegen': data => { data.tasks.push({ ...data.tasks[0], id: 't2' }); },
    'taak verwijderen': data => { data.tasks = []; },
    'onbekend afvinkje': data => { data.completed['t2|2026-11-16'] = true; },
    'ongeldige datum': data => { data.completed['t1|2026-02-30'] = true; },
    'boodschap verwijderen': data => { data.groceries = []; },
    'boodschap hernoemen': data => { data.groceries[0].name = 'Brood'; },
    'dringendheid wijzigen': data => { data.groceries[0].urgent = true; },
    'bestaand id hergebruiken': data => { data.groceries.push({ id: 'g1', name: 'Brood', done: false, urgent: false }); },
    'gerecht verwijderen': data => { data.mealIdeas = []; },
    'gerecht hernoemen': data => { data.mealIdeas[0].name = 'Soep'; },
    'onbekende maaltijdwens': data => { data.mealIdeas[0].wishedBy = ['onbekend']; },
    'notitie verwijderen': data => { data.notes = []; },
    'notitie bewerken': data => { data.notes[0].description = 'Anders'; },
    'notitie archiveren': data => { data.notes[0].archived = true; },
    'teksten aanpassen': data => { data.customization.websiteTitle = 'Anders'; },
    'onbekende eigenschap toevoegen': data => { data.extra = true; },
    'gezinslid bewerken': data => { data.members[0].name = 'Andere naam'; },
    'gezinslid verwijderen': data => { data.members = data.members.filter(member => member.id !== 'm2'); }
  };
  for (const [name, change] of Object.entries(cases)) {
    await t.test(name, () => {
      const data = clientState();
      change(data);
      assert.equal(childChangesAllowed(original, data, defaults), false);
    });
  }
});

test('oude gegevens en nieuwe gezinsprofielen blijven bruikbaar', () => {
  const old = structuredClone(original);
  delete old.notes;
  delete old.customization;
  const data = structuredClone(old);
  data.tasks = data.tasks.map(normalizeTask);
  data.notes = [];
  data.customization = { ...defaults };
  data.members.push({ id: 'm3', name: 'Nieuw', birthDate: null, email: null });
  assert.equal(childChangesAllowed(old, data, defaults), true);
});

test('kind kan taken met meerdere toegewezen gezinsleden ongewijzigd afvinken', () => {
  const previous = clientState();
  previous.tasks[0].dailyAssignments[1] = ['m1', 'm2'];
  const submitted = structuredClone(previous);
  submitted.completed['t1|2026-11-16'] = true;
  assert.equal(childChangesAllowed(previous, submitted, defaults), true);
});

test('oude sporadische taken worden jaarlijkse taken', () => {
  const task = normalizeTask({ id: 't1', title: 'Ramen wassen', frequency: 'occasional', date: '2024-06-15' });
  assert.equal(task.frequency, 'yearly');
  assert.equal(task.date, '2024-06-15');
});

test('oude enkele toewijzingen en nieuwe meervoudige toewijzingen worden genormaliseerd', () => {
  const legacy = normalizeTask({
    frequency: 'daily',
    dailyAssignments: { 1: 'm1' },
    weeklyAssignments: { even: 'm2', odd: '' },
    memberId: 'm1'
  });
  assert.deepEqual(legacy.dailyAssignments[1], ['m1']);
  assert.deepEqual(legacy.weeklyAssignments, { even: ['m2'], odd: [] });
  assert.deepEqual(legacy.memberIds, ['m1']);
  assert.equal(legacy.allowMultipleMembers, false);

  const multiple = normalizeTask({
    frequency: 'daily',
    dailyAssignments: { 1: ['m1', 'm2'] },
    weeklyAssignments: { even: ['m1', 'm2'], odd: [] },
    memberIds: ['m1', 'm2']
  });
  assert.deepEqual(multiple.dailyAssignments[1], ['m1', 'm2']);
  assert.deepEqual(multiple.weeklyAssignments.even, ['m1', 'm2']);
  assert.deepEqual(multiple.memberIds, ['m1', 'm2']);
  assert.equal(multiple.allowMultipleMembers, true);

  const defaultTask = normalizeTask({ frequency: 'daily' });
  assert.equal(defaultTask.allowMultipleMembers, false);
});
