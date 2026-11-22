'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const renderFamilySource = app.slice(app.indexOf('function renderFamily()'), app.indexOf('function renderGroceries()'));

function renderFamily(member, statistics) {
  const context = vm.createContext({
    state: { members: [member], tasks: [] },
    householdInfo: { members: [], invitations: [], canInvite: false },
    demoMode: true,
    isChild: () => false,
    memberStatistics: () => statistics,
    memberDetails: () => 'Ouder',
    assignedMemberIds: () => [],
    createdDateLabel: item => item.createdAt ? '1 januari 2026' : 'datum niet bekend',
    avatar: () => '<span class="avatar">A</span>',
    escapeHtml: value => String(value)
  });
  vm.runInContext(renderFamilySource, context);
  return context.renderFamily();
}

test('family member tiles show the three task totals from their statistics', () => {
  const html = renderFamily(
    { id: 'm1', name: 'Alex', createdAt: '2026-01-01' },
    { completed: 3, scheduled: 8, completedLate: 1 }
  );

  assert.match(html, /<strong>3<\/strong><span>Uitgevoerde taken<\/span>/);
  assert.match(html, /<strong>8<\/strong><span>Ingeplande taken<\/span>/);
  assert.match(html, /<strong>1<\/strong><span>Te laat uitgevoerd<\/span>/);
});

test('family member tiles identify missing task statistics without a creation date', () => {
  const html = renderFamily({ id: 'm1', name: 'Alex' }, null);

  assert.match(html, /Niet beschikbaar zonder aanmaakdatum/);
  assert.doesNotMatch(html, /member-task-statistics-grid/);
});

test('member statistics comparison chart shows all three metrics and highlights the selected member', () => {
  const renderChartSource = app.slice(
    app.indexOf('function renderMemberStatisticsChart('),
    app.indexOf('function renderDashboard()')
  );
  const members = [
    { id: 'm1', name: 'Alex' },
    { id: 'm2', name: 'Sam' },
    { id: 'm3', name: 'Noor' }
  ];
  const statistics = {
    m1: { scheduled: 8, completed: 3, completedLate: 1 },
    m2: { scheduled: 5, completed: 4, completedLate: 2 },
    m3: null
  };
  const context = vm.createContext({
    state: { members },
    memberStatistics: member => statistics[member.id],
    escapeHtml: value => String(value)
  });
  vm.runInContext(renderChartSource, context);

  const html = context.renderMemberStatisticsChart(members[0], statistics.m1);
  assert.match(html, /Ingeplande taken/);
  assert.match(html, /Uitgevoerde taken/);
  assert.match(html, /Te laat uitgevoerde taken/);
  assert.match(html, /class="member-comparison-row selected"/);
  assert.match(html, /href="#statistieken\/m1" aria-current="page">Alex<span class="member-comparison-selected">dit gezinslid<\/span>/);
  assert.match(html, /href="#statistieken\/m2">Sam<\/a>/);
  assert.match(html, /href="#statistieken\/m3">Noor<\/a>/);
  assert.match(html, /<strong>–<\/strong>/);
});

test('member task statistics are rendered as accessible disclosure buttons', () => {
  const renderStatisticsSource = app.slice(
    app.indexOf('function renderMemberStatistics('),
    app.indexOf('function memberTaskOccurrences(')
  );
  const context = vm.createContext({
    activeMemberTaskMetric: null,
    memberStatistics: () => ({
      scheduled: 8,
      completed: 3,
      completedLate: 1,
      creations: []
    }),
    createdDateLabel: () => '1 januari 2026',
    escapeHtml: value => String(value),
    renderMemberStatisticsChart: () => '<div></div>',
    state: { tasks: [] }
  });
  vm.runInContext(renderStatisticsSource, context);

  const html = context.renderMemberStatistics({ id: 'm1', name: 'Alex' });
  assert.match(html, /data-action="toggle-member-task-list" data-member-id="m1" data-metric="scheduled" aria-expanded="false" aria-controls="member-task-list"/);
  assert.match(html, /data-metric="completed"/);
  assert.match(html, /data-metric="completedLate"/);
});

test('member task tables show occurrences filtered for the selected statistic', () => {
  const taskSource = app.slice(
    app.indexOf('function memberTaskOccurrences('),
    app.indexOf('function renderMemberStatisticsChart(')
  );
  const task = { id: 't1', title: 'Keuken opruimen', plannedDate: '2026-01-02' };
  const context = vm.createContext({
    state: { tasks: [task] },
    validBackupDate: () => true,
    parseDate: value => new Date(`${value}T12:00:00`),
    dateKey: date => date.toISOString().slice(0, 10),
    addDays: (date, count) => {
      const next = new Date(date);
      next.setDate(next.getDate() + count);
      return next;
    },
    occursOn: (item, date) => date.toISOString().slice(0, 10) === item.plannedDate,
    membersOn: () => [{ id: 'm1' }],
    isDone: () => true,
    isLate: () => true,
    formatDate: date => `${date.getDate()} januari ${date.getFullYear()}`,
    escapeHtml: value => String(value)
  });
  vm.runInContext(taskSource, context);

  const html = context.renderMemberTaskTable(
    { id: 'm1', name: 'Alex', createdAt: '2026-01-01' },
    'completedLate'
  );
  assert.match(html, /<th scope="col">Taak<\/th>/);
  assert.match(html, /Keuken opruimen/);
  assert.match(html, /2 januari 2026/);
  assert.match(html, /Te laat uitgevoerd/);
});
