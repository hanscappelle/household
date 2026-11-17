'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { freeTaskOccurrenceDate } = require('../task-scheduling');

test('scheduler helper is available to the browser app', () => {
  const browserGlobal = {};
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), browserGlobal);
  assert.equal(typeof browserGlobal.freeTaskOccurrenceDate, 'function');

  const html = readFileSync(require.resolve('../index.html'), 'utf8');
  const server = readFileSync(require.resolve('../server'), 'utf8');
  assert.match(html, /src="task-scheduling\.js"/);
  assert.match(server, /'task-scheduling\.js'/);
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
