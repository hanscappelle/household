'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { freeTaskOccurrenceDate, flexibleTaskOccurrenceDate } = require('../task-scheduling');

test('scheduler helper is available to the browser app', () => {
  const browserGlobal = {};
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), browserGlobal);
  assert.equal(typeof browserGlobal.freeTaskOccurrenceDate, 'function');
  assert.equal(typeof browserGlobal.flexibleTaskOccurrenceDate, 'function');

  const html = readFileSync(require.resolve('../index.html'), 'utf8');
  const server = readFileSync(require.resolve('../server'), 'utf8');
  assert.match(html, /src="task-scheduling\.js"/);
  assert.match(server, /'task-scheduling\.js'/);
});

test('flexible daily tasks remain in the plan until completed for the day', () => {
  const task = { id: 'daily', frequency: 'daily' };
  const completed = {};
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', completed), '2026-11-16');

  completed['daily|2026-11-16'] = { completedAt: '2026-11-16' };
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-16', '2026-11-16', completed), '2026-11-16');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', completed), '2026-11-17');
});

test('flexible weekly tasks stay due through the week and restart next week', () => {
  const task = { id: 'weekly', frequency: 'weekly' };
  const completed = {};
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-21', '2026-11-16', completed), '2026-11-16');

  completed['weekly|2026-11-16'] = { completedAt: '2026-11-20' };
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-20', '2026-11-16', completed), '2026-11-16');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-21', '2026-11-16', completed), null);
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-23', '2026-11-16', completed), '2026-11-23');
});

test('flexible monthly and yearly tasks use the calendar period without a fixed date', () => {
  const monthly = { id: 'monthly', frequency: 'monthly' };
  const yearly = { id: 'yearly', frequency: 'yearly' };
  assert.equal(flexibleTaskOccurrenceDate(monthly, '2026-11-28', '2026-11-15', {}), '2026-11-15');
  assert.equal(flexibleTaskOccurrenceDate(yearly, '2026-11-28', '2026-11-15', {}), '2026-11-15');

  const completed = { 'monthly|2026-11-15': { completedAt: '2026-11-20' } };
  assert.equal(flexibleTaskOccurrenceDate(monthly, '2026-11-21', '2026-11-15', completed), null);
  assert.equal(flexibleTaskOccurrenceDate(monthly, '2026-12-01', '2026-11-15', completed), '2026-12-01');
});

test('flexible tasks appear under their assigned member until that period is completed', () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }],
      tasks: [{
        id: 'weekly', title: 'Badkamer schoonmaken', frequency: 'weekly',
        flexibleSchedule: true, flexibleSince: '2026-11-16', memberIds: ['m1']
      }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks' },
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1
  });
  vm.runInContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function birthdaysOn(')),
    context
  );

  const tasksOn = date => context.tasksOn(context.parseDate(date));
  assert.equal(tasksOn('2026-11-18').length, 1);
  assert.equal(context.membersOn(context.state.tasks[0], context.parseDate('2026-11-18'))[0].id, 'm1');
  assert.equal(context.isScheduled(context.state.tasks[0]), true);

  context.state.completed['weekly|2026-11-16'] = { completedAt: '2026-11-18' };
  assert.equal(tasksOn('2026-11-18').length, 1);
  assert.equal(tasksOn('2026-11-19').length, 0);
});

test('daily free task keeps its original instance until completed', () => {
  const task = { id: 'daily', frequency: 'daily' };
  const completed = {};
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', completed), '2026-11-16');

  completed['daily|2026-11-16'] = { completedAt: '2026-11-18' };
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', completed), '2026-11-16');
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-19', '2026-11-16', completed), '2026-11-19');
});

test('weekly free task rolls past later weekly dates and restarts on its next weekday', () => {
  const task = { id: 'weekly', frequency: 'weekly', weekday: 1 };
  const completed = {};
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-23', '2026-11-16', completed), '2026-11-16');

  completed['weekly|2026-11-16'] = { completedAt: '2026-11-23' };
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-23', '2026-11-16', completed), '2026-11-16');
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-24', '2026-11-16', completed), null);
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-30', '2026-11-16', completed), '2026-11-30');
});

test('monthly and yearly free tasks retain their recurrence date while overdue', () => {
  const monthly = { id: 'monthly', frequency: 'monthly', monthDay: 15 };
  assert.equal(freeTaskOccurrenceDate(monthly, '2026-12-20', '2026-11-15', {}), '2026-11-15');

  const yearly = { id: 'yearly', frequency: 'yearly', date: '2024-02-29' };
  assert.equal(freeTaskOccurrenceDate(yearly, '2027-03-01', '2024-02-29', {}), '2024-02-29');
  const completed = { 'yearly|2024-02-29': { completedAt: '2027-03-01' } };
  assert.equal(freeTaskOccurrenceDate(yearly, '2027-03-01', '2024-02-29', completed), '2024-02-29');
  assert.equal(freeTaskOccurrenceDate(yearly, '2028-02-28', '2024-02-29', completed), null);
  assert.equal(freeTaskOccurrenceDate(yearly, '2028-02-29', '2024-02-29', completed), '2028-02-29');
});

test('early completion advances to the next occurrence without looping', () => {
  const source = readFileSync(require.resolve('../task-scheduling'), 'utf8');
  const cases = [
    { task: { id: 'monthly', frequency: 'monthly', monthDay: 20 }, since: '2026-11-17', due: '2026-11-20', after: '2026-11-21', next: '2026-12-20' },
    { task: { id: 'daily', frequency: 'daily' }, since: '2026-11-20', due: '2026-11-20', after: '2026-11-21', next: '2026-11-21' },
    { task: { id: 'weekly', frequency: 'weekly', weekday: 1 }, since: '2026-11-17', due: '2026-11-23', after: '2026-11-24', next: '2026-11-30' },
    { task: { id: 'yearly', frequency: 'yearly', date: '2024-11-20' }, since: '2026-11-17', due: '2026-11-20', after: '2026-11-21', next: '2027-11-20' }
  ];
  for (const { task, since, due, after, next } of cases) {
    const completed = { [`${task.id}|${due}`]: { completedAt: '2026-11-17' } };
    const context = vm.createContext({ task, since, due, after, next, completed });
    vm.runInContext(source, context);
    const query = date => vm.runInContext(`freeTaskOccurrenceDate(task, ${date}, since, completed)`, context, { timeout: 1000 });
    assert.equal(query('due'), due, `${task.frequency}: completed occurrence remains visible on its scheduled day`);
    assert.equal(query('after'), task.frequency === 'daily' ? next : null, `${task.frequency}: day after scheduled occurrence`);
    assert.equal(query('next'), next, `${task.frequency}: next occurrence`);
  }
});
