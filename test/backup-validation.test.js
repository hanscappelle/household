'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { normalizeTask, validTaskAssignments } = require('../seed');

const app = readFileSync(require.resolve('../app'), 'utf8');
const context = vm.createContext({
  BACKUP_FORMAT: 'ons-huishouden-backup',
  CUSTOM_TEXT_LIMITS: {},
  CUSTOM_TEXT_DEFAULTS: {},
  DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
  FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks' },
  normalizeTask,
  validTaskAssignments
});
vm.runInContext(
  app.slice(app.indexOf('function dateKey('), app.indexOf('function addDays(')) +
  app.slice(app.indexOf('function validBackupDate('), app.indexOf('function exportBackup(')) +
  app.slice(app.indexOf('function readSchedule('), app.indexOf('function clearTaskAssignments(')),
  context
);

function backup(task) {
  return { format: 'ons-huishouden-backup', version: 1, data: { members: [], tasks: [task], completed: {} } };
}

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

test('invalid member IDs remain rejected', () => {
  for (const memberIds of [['invalid|id'], [null], [' ', 'm1'], ['m1', 'm1']]) {
    assert.throws(() => context.validateBackup(backup({
      id: 'glass', title: 'Glas wegbrengen', frequency: 'monthly', memberIds
    })), /ongeldige gegevens/);
  }
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
