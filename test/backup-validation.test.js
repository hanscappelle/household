'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { normalizeTask, validTaskAssignments, validAppointments } = require('../seed');
const { mergeHouseholdState } = require('../state-merge');
const { registerCreatedItems } = require('../creation-metadata');

const app = readFileSync(require.resolve('../app'), 'utf8');
const context = vm.createContext({
  BACKUP_FORMAT: 'ons-huishouden-backup',
  CUSTOM_TEXT_LIMITS: {},
  CUSTOM_TEXT_DEFAULTS: {},
  DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
  FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
  normalizeTask,
  validTaskAssignments,
  validAppointments
});
vm.runInContext(
  app.slice(app.indexOf('function validateMealIdeas('), app.indexOf('let state = null;')) +
  app.slice(app.indexOf('function dateKey('), app.indexOf('function addDays(')) +
  app.slice(app.indexOf('function validBackupDate('), app.indexOf('function exportBackup(')) +
  app.slice(app.indexOf('function readSchedule('), app.indexOf('function clearTaskAssignments(')) +
  app.slice(app.indexOf('function backupReplaceCounts('), app.indexOf('async function importBackup(')),
  context
);

test('backup replacement counts current and restored members, tasks and appointments', () => {
  const counts = context.backupReplaceCounts(
    { members: [{ id: 'm1' }, { id: 'm2' }], tasks: [{ id: 't1' }], appointments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] },
    { members: [{ id: 'm3' }], tasks: [{ id: 't1' }, { id: 't2' }], appointments: [] }
  );
  assert.equal(counts.members.current, 2);
  assert.equal(counts.members.restored, 1);
  assert.equal(counts.tasks.current, 1);
  assert.equal(counts.tasks.restored, 2);
  assert.equal(counts.appointments.current, 3);
  assert.equal(counts.appointments.restored, 0);
});

test('a concurrent completion of a deleted task cannot be saved as a merge', () => {
  const base = {
    members: [], tasks: [{ id: 't1', title: 'Taak', frequency: 'daily' }],
    groceries: [], mealIdeas: [], notes: [], completed: {}, customization: {}
  };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.tasks = [];
  remote.completed['t1|2026-11-16'] = true;
  const merged = mergeHouseholdState(base, local, remote);
  assert.throws(() => context.validateBackup({ format: 'ons-huishouden-backup', version: 1, data: merged }), /afvinkje bevat ongeldige gegevens/);
});

test('two stale clients can save edits to different tasks using an older server response', async () => {
  const raw = {
    members: [], tasks: [
      { id: 't1', title: 'Eerste taak', frequency: 'daily' },
      { id: 't2', title: 'Tweede taak', frequency: 'weekly', weekday: 1 }
    ],
    groceries: [], mealIdeas: [], notes: [], completed: {}, customization: {}
  };
  let serverData = structuredClone(raw);
  let serverRevision = 1;
  const api = async (url, options) => {
    if (!options) return { email: 'a@example.test', role: 'owner', data: structuredClone(serverData), revision: serverRevision };
    const body = JSON.parse(options.body);
    if (body.revision !== serverRevision) {
      const error = new Error('conflict');
      error.status = 409;
      throw error;
    }
    serverData = {
      ...body.data,
      tasks: registerCreatedItems(serverData.tasks, body.data.tasks, 1, '2026-11-17')
    };
    serverData = JSON.parse(JSON.stringify(serverData));
    return { revision: ++serverRevision };
  };
  const createClient = () => {
    const initial = context.validateBackup({ format: 'ons-huishouden-backup', version: 1, data: structuredClone(raw) });
    const elements = new Map();
    const client = vm.createContext({
      api, structuredClone, mergeHouseholdState, console,
      validateBackup: context.validateBackup, BACKUP_FORMAT: 'ons-huishouden-backup',
      state: structuredClone(initial), savedState: structuredClone(initial), revision: 1,
      accountEmail: 'a@example.test', currentRole: 'owner', isChild: () => false,
      demoMode: false, saving: false, needsRecovery: false,
      document: { querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, { close() {} });
        return elements.get(selector);
      } }
    });
    vm.runInContext(app.slice(app.indexOf('async function save('), app.indexOf('function escapeHtml(')), client);
    return client;
  };
  const first = createClient();
  const second = createClient();
  first.state.tasks[0].title = 'Eerste aangepast';
  second.state.tasks[1].title = 'Tweede aangepast';
  assert.equal(await first.save(), true);
  assert.equal(await second.save(), true);
  assert.deepEqual(serverData.tasks.map(task => task.title), ['Eerste aangepast', 'Tweede aangepast']);
  assert.equal(second.revision, 3);
  assert.equal(second.needsRecovery, false);
});

function backup(task) {
  return { format: 'ons-huishouden-backup', version: 1, data: { members: [], tasks: [task], completed: {} } };
}

test('adult speech buttons default to off and require a boolean setting', () => {
  const legacy = backup({ id: 't1', title: 'Taak', frequency: 'daily' });
  assert.equal(context.validateBackup(legacy).customization.speakButtonsForAdults, false);
  legacy.data.customization = { speakButtonsForAdults: true };
  assert.equal(context.validateBackup(legacy).customization.speakButtonsForAdults, true);
  legacy.data.customization.speakButtonsForAdults = 'true';
  assert.throws(() => context.validateBackup(legacy), /spreekknoppen bevat ongeldige gegevens/);
});

test('appointment backups accept legacy data and reject invalid references or ranges', () => {
  const legacy = backup({ id: 't1', title: 'Taak', frequency: 'daily' });
  assert.equal(context.validateBackup(legacy).appointments.length, 0);
  legacy.data.appointments = [{ id: 'a1', title: 'Afspraak', memberId: '', allDay: true,
    startDate: '2026-11-18', endDate: '2026-11-18', startTime: '', endTime: '' }];
  assert.equal(context.validateBackup(legacy).appointments.length, 1);
  legacy.data.members.push({ id: 'm1', name: 'Een' }, { id: 'm2', name: 'Twee' });
  delete legacy.data.appointments[0].memberId;
  legacy.data.appointments[0].memberIds = ['m1', 'm2'];
  assert.equal(context.validateBackup(legacy).appointments[0].memberIds.length, 2);
  legacy.data.appointments[0].recurrence = { frequency: 'weekly', until: '', exceptions: { '2026-11-25': null } };
  assert.equal(context.validateBackup(legacy).appointments[0].recurrence.exceptions['2026-11-25'], null);
  legacy.data.appointments[0].recurrence.frequency = 'biweekly';
  assert.equal(context.validateBackup(legacy).appointments[0].recurrence.frequency, 'biweekly');
  legacy.data.appointments[0].recurrence.frequency = 'daily';
  assert.throws(() => context.validateBackup(legacy), /afspraken bevatten ongeldige gegevens/);
  delete legacy.data.appointments[0].recurrence;
  legacy.data.appointments[0].memberIds = ['m1', 'm1'];
  assert.throws(() => context.validateBackup(legacy), /afspraken bevatten ongeldige gegevens/);
  delete legacy.data.appointments[0].memberIds;
  legacy.data.appointments[0].memberId = 'onbekend';
  assert.throws(() => context.validateBackup(legacy), /afspraken bevatten ongeldige gegevens/);
  legacy.data.appointments = null;
  assert.throws(() => context.validateBackup(legacy), /afspraken bevatten ongeldige gegevens/);
});

test('saved empty member selections load and normalize without becoming assignments', () => {
  const task = {
    id: 'glass', title: 'Glas wegbrengen', frequency: 'monthly', memberId: '',
    memberIds: [''], dailyAssignments: { 1: [''] }, weeklyAssignments: { even: [], odd: [] }
  };
  const result = context.validateBackup(backup(task));
  assert.deepEqual(result.tasks[0].memberIds, []);
  assert.deepEqual(result.tasks[0].dailyAssignments[1], []);
  assert.equal(result.tasks[0].allowMultipleMembers, false);
});

test('one-time tasks are accepted and their date is saved', () => {
  const task = { id: 'once', title: 'Pakket ophalen', frequency: 'once', date: '2026-11-18', memberId: 'm1' };
  const data = backup(task).data;
  data.members.push({ id: 'm1', name: 'Ada' });
  assert.equal(context.validateBackup({ format: 'ons-huishouden-backup', version: 1, data }).tasks[0].date, '2026-11-18');
  const flexibleTask = context.validateBackup({
    format: 'ons-huishouden-backup', version: 1,
    data: { ...data, tasks: [{ ...task, flexibleSchedule: true, flexibleSince: '2026-11-18' }] }
  }).tasks[0];
  assert.equal(flexibleTask.flexibleSchedule, true);
  assert.throws(() => context.validateBackup({
    format: 'ons-huishouden-backup', version: 1,
    data: { ...data, tasks: [{ ...task, date: '2026-02-30' }] }
  }), /ongeldige gegevens/);

  const schedule = { frequency: 'once' };
  context.readSchedule(schedule, { getAll: () => [], get: name => name === 'date' ? '2026-11-18' : null }, false);
  assert.equal(schedule.date, '2026-11-18');
});

test('flexible scheduling is preserved and requires a boolean flag', () => {
  const task = {
    id: 'flexible', title: 'Badkamer schoonmaken', frequency: 'weekly',
    flexibleSchedule: true, memberIds: ['m1'], flexibleSince: '2026-11-17'
  };
  const result = context.validateBackup(backup(task));
  assert.equal(result.tasks[0].flexibleSchedule, true);
  assert.deepEqual(result.tasks[0].memberIds, ['m1']);

  assert.throws(() => context.validateBackup(backup({
    ...task, flexibleSchedule: 'yes'
  })), /ongeldige gegevens/);
  assert.throws(() => context.validateBackup(backup({
    ...task, flexibleSince: 'not-a-date'
  })), /ongeldig schema/);
});

test('invalid member IDs remain rejected', () => {
  for (const memberIds of [['invalid|id'], [null], [' ', 'm1'], ['m1', 'm1']]) {
    assert.throws(() => context.validateBackup(backup({
      id: 'glass', title: 'Glas wegbrengen', frequency: 'monthly', memberIds
    })), /ongeldige gegevens/);
  }
});

test('shared task completion records can be stored per member', () => {
  const data = backup({ id: 'shared', title: 'Samen opruimen', frequency: 'daily' });
  data.data.completed['shared|2026-11-16'] = {
    memberCompletions: {
      m1: { completedAt: '2026-11-16', completedByUserId: '5' },
      m2: true
    }
  };
  assert.doesNotThrow(() => context.validateBackup(data));

  data.data.completed['shared|2026-11-16'].memberCompletions.m1.completedAt = '2026-02-30';
  assert.throws(() => context.validateBackup(data), /afvinkje bevat ongeldige gegevens/);
});

test('saving an empty member selection does not store a placeholder ID', () => {
  const task = { frequency: 'monthly' };
  const formData = {
    getAll: () => [''],
    get: name => name === 'monthDay' ? '1' : null
  };
  context.readSchedule(task, formData, false);
  assert.deepEqual(Array.from(task.memberIds), []);
  assert.equal(task.memberId, '');
});

test('a shared task remains open until each assigned member has completed it', () => {
  const date = '2026-11-16';
  const members = [{ id: 'm1' }, { id: 'm2' }];
  const state = {
    completed: {
      [`shared|${date}`]: {
        memberCompletions: {
          m1: { completedAt: '2026-11-17' }
        }
      }
    }
  };
  const sharedTask = { id: 'shared' };
  const completionContext = vm.createContext({
    state,
    membersOn: () => members,
    dateKey: () => date,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  });
  vm.runInContext(
    app.slice(app.indexOf('function completionMemberId('), app.indexOf('function membersOn(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')),
    completionContext
  );

  assert.equal(completionContext.isDone(sharedTask, {}, 'm1'), true);
  assert.equal(completionContext.isDone(sharedTask, {}, 'm2'), false);
  assert.equal(completionContext.isDone(sharedTask, {}), false);
  assert.equal(completionContext.isLate(sharedTask, {}, 'm1'), true);

  state.completed[`shared|${date}`].memberCompletions.m2 = { completedAt: date };
  assert.equal(completionContext.isDone(sharedTask, {}), true);
  assert.equal(completionContext.isLate(sharedTask, {}, 'm2'), false);
});
