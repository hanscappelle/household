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

test('shared session preference persists locally across account sessions', () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const values = new Map();
  const context = vm.createContext({
    SHARED_ACCOUNT_KEY: 'ons-huishouden-gedeelde-sessie',
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(
    app.slice(app.indexOf('function loadSharedAccountPreference('), app.indexOf('function initializeTheme(')),
    context
  );

  assert.equal(context.loadSharedAccountPreference(), false);
  context.saveSharedAccountPreference(true);
  assert.equal(context.loadSharedAccountPreference(), true);
  context.saveSharedAccountPreference(false);
  assert.equal(context.loadSharedAccountPreference(), false);
});

test('session and speech settings render in a separate panel after display and text settings', () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const renderBackup = app.slice(app.indexOf('function renderBackup('), app.indexOf('function renderHelp('));
  const renderForRole = role => {
    const context = vm.createContext({
      CUSTOM_TEXT_LIMITS: {
        websiteTitle: 60, brandSubtitle: 40, welcomeTitle: 80,
        welcomeText: 160, sidebarTitle: 100, sidebarText: 200
      },
      COLOR_PALETTES: [{ id: 'forest', label: 'Bosgroen', description: 'Groen' }],
      state: {
        customization: {
          websiteTitle: 'Thuis', brandSubtitle: 'SAMEN', welcomeTitle: 'Welkom',
          welcomeText: 'Samen thuis', sidebarTitle: 'Samen', sidebarText: 'Thuis',
          speakButtonsForAdults: true
        }
      },
      isChild: () => role === 'child',
      demoMode: true,
      sharedAccount: true,
      colorPalette: 'forest',
      textSize: 'normal',
      escapeHtml: value => String(value)
    });
    vm.runInContext(renderBackup, context);
    return context.renderBackup();
  };
  const parentSettings = renderForRole('parent');
  assert.ok(parentSettings.indexOf('Jouw weergave') < parentSettings.indexOf('Teksten personaliseren'));
  assert.ok(parentSettings.indexOf('Teksten personaliseren') < parentSettings.indexOf('Sessie en spraak'));
  assert.match(parentSettings, /name="speakButtonsForAdults"/);
  assert.doesNotMatch(parentSettings, /Sessie-instellingen opslaan/);
  const childSettings = renderForRole('child');
  assert.match(childSettings, /name="sharedAccount"/);
  assert.doesNotMatch(childSettings, /name="speakButtonsForAdults"/);
  assert.doesNotMatch(childSettings, /Teksten personaliseren/);
});

test('session and speech checkboxes save immediately when changed', async () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const values = new Map();
  const errorBox = { textContent: '' };
  const banner = { hidden: true };
  const panel = { querySelector: () => errorBox };
  const context = vm.createContext({
    SHARED_ACCOUNT_KEY: 'ons-huishouden-gedeelde-sessie',
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    state: { customization: { speakButtonsForAdults: false } },
    sharedAccount: false,
    isChild: () => false,
    save: async nextState => {
      context.state = nextState;
      return true;
    },
    document: {
      querySelector: selector => {
        assert.equal(selector, '#shared-account-banner');
        return banner;
      }
    },
    showToast() {},
    render() {}
  });
  vm.runInContext(
    app.slice(app.indexOf('function saveSharedAccountPreference('), app.indexOf('function initializeTheme(')),
    context
  );
  const checkbox = (name, checked) => ({
    name,
    checked,
    closest: selector => {
      assert.equal(selector, '#session-settings');
      return panel;
    }
  });

  await context.updateSessionSetting(checkbox('sharedAccount', true));
  assert.equal(values.get('ons-huishouden-gedeelde-sessie'), 'true');
  assert.equal(context.sharedAccount, true);
  assert.equal(banner.hidden, false);

  await context.updateSessionSetting(checkbox('speakButtonsForAdults', true));
  assert.equal(context.state.customization.speakButtonsForAdults, true);
  assert.equal(errorBox.textContent, '');
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

test('flexible shared tasks remain due until every assigned member completes them', () => {
  const task = { id: 'shared', frequency: 'weekly', memberIds: ['m1', 'm2'] };
  const completed = {
    'shared|2026-11-16': {
      memberCompletions: { m1: { completedAt: '2026-11-18' } }
    }
  };
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-19', '2026-11-16', completed), '2026-11-16');

  completed['shared|2026-11-16'].memberCompletions.m2 = { completedAt: '2026-11-19' };
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', completed), null);
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-19', '2026-11-16', completed), '2026-11-16');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-20', '2026-11-16', completed), null);
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

test('one-time tasks occur only on their chosen date', () => {
  const task = { id: 'once', frequency: 'once', date: '2026-11-18' };
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-17', '2026-11-16', {}), null);
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', {}), '2026-11-18');
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-20', '2026-11-16', {}), '2026-11-18');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-18', '2026-11-16', {}), '2026-11-18');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-19', '2026-11-16', {}), '2026-11-18');

  const completed = { 'once|2026-11-18': { completedAt: '2026-11-20' } };
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-20', '2026-11-16', completed), '2026-11-18');
  assert.equal(freeTaskOccurrenceDate(task, '2026-11-21', '2026-11-16', completed), null);
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-20', '2026-11-16', completed), '2026-11-18');
  assert.equal(flexibleTaskOccurrenceDate(task, '2026-11-21', '2026-11-16', completed), null);
});

test('assigned one-time tasks appear in the planner once and retain their completion date', () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }],
      tasks: [{ id: 'once', title: 'Pakket ophalen', frequency: 'once', date: '2026-11-18', memberIds: ['m1'] }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1
  });
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function birthdaysOn(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')),
    context
  );

  const tasksOn = date => context.tasksOn(context.parseDate(date)).length;
  assert.equal(tasksOn('2026-11-17'), 0);
  assert.equal(tasksOn('2026-11-18'), 1);
  assert.equal(tasksOn('2026-11-19'), 0);
  assert.equal(context.isScheduled(context.state.tasks[0]), true);
  assert.equal(context.completionKey(context.state.tasks[0], context.parseDate('2026-11-18')), 'once|2026-11-18');

  context.state.completed['once|2026-11-18'] = true;
  assert.equal(context.isDone(context.state.tasks[0], context.parseDate('2026-11-18')), true);
  assert.equal(tasksOn('2026-11-18'), 1);
});

test('combined free tasks stay unassigned and in the plan until the period is completed', () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }],
      tasks: [{
        id: 'weekly', title: 'Badkamer schoonmaken', frequency: 'weekly',
        flexibleSchedule: true, freeToTake: true, flexibleSince: '2026-11-16', memberIds: ['m1']
      }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1
  });
  vm.runInContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function birthdaysOn(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')),
    context
  );

  const tasksOn = date => context.tasksOn(context.parseDate(date));
  assert.equal(tasksOn('2026-11-18').length, 1);
  assert.deepEqual([...context.membersOn(context.state.tasks[0], context.parseDate('2026-11-18'))], []);
  assert.deepEqual([...context.assignedMemberIds(context.state.tasks[0])], []);
  assert.equal(context.isScheduled(context.state.tasks[0]), true);
  assert.equal(context.completionKey(context.state.tasks[0], context.parseDate('2026-11-18')), 'weekly|2026-11-16');

  context.state.completed['weekly|2026-11-16'] = { completedAt: '2026-11-18' };
  assert.equal(tasksOn('2026-11-17').length, 0);
  assert.equal(tasksOn('2026-11-18').length, 1);
  assert.equal(context.isDone(context.state.tasks[0], context.parseDate('2026-11-18')), true);
  assert.equal(context.isLate(context.state.tasks[0], context.parseDate('2026-11-18')), false);
  assert.equal(tasksOn('2026-11-19').length, 0);
  assert.equal(tasksOn('2026-11-23').length, 1);
});

test('flexible task completion stays on the selected planner date', async () => {
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
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    currentUserId: 'user-1',
    sharedAccount: true,
    demoMode: false,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1,
    save: async () => true,
    render() {}
  });
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function birthdaysOn(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')) +
    app.slice(app.indexOf('async function updateTaskCompletion('), app.indexOf('function speakText(')),
    context
  );

  await context.updateTaskCompletion({
    taskId: 'weekly', date: '2026-11-20', memberId: 'm1', checked: true
  });
  assert.equal(context.state.completed['weekly|2026-11-16'].completedAt, '2026-11-20');
  assert.equal(context.isDone(context.state.tasks[0], context.parseDate('2026-11-20'), 'm1'), true);
  assert.equal(context.tasksOn(context.parseDate('2026-11-20')).length, 1);
  assert.equal(context.tasksOn(context.parseDate('2026-11-21')).length, 0);
});

test('individual logins reassign only the completed task occurrence', async () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }, { id: 'm2', name: 'Bram' }],
      tasks: [{
        id: 'weekly', title: 'Badkamer schoonmaken', frequency: 'weekly', weekday: 1,
        weeklyAssignments: { odd: ['m1'], even: ['m1'] }
      }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    currentUserId: 'user-2',
    accountEmail: 'bram@example.test',
    sharedAccount: false,
    demoMode: false,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1,
    save: async () => true,
    render() {}
  });
  context.currentMember = () => context.state.members.find(member => member.id === 'm2');
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function completionKey(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')) +
    app.slice(app.indexOf('async function updateTaskCompletion('), app.indexOf('function speakText(')),
    context
  );

  const dueDate = context.parseDate('2026-11-16');
  await context.updateTaskCompletion({
    taskId: 'weekly', date: '2026-11-16', memberId: 'm1', checked: true
  });
  assert.equal(context.state.completed['weekly|2026-11-16'].completedByMemberId, 'm2');
  assert.deepEqual([...context.membersOn(context.state.tasks[0], dueDate).map(member => member.id)], ['m2']);
  assert.equal(context.isDone(context.state.tasks[0], dueDate, 'm2'), true);

  const nextOccurrence = context.parseDate('2026-11-23');
  assert.deepEqual([...context.membersOn(context.state.tasks[0], nextOccurrence).map(member => member.id)], ['m1']);
  assert.equal(context.isDone(context.state.tasks[0], nextOccurrence, 'm1'), false);
});

test('individual logins can take ownership of an everyone task for one occurrence', async () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }, { id: 'm2', name: 'Bram' }],
      tasks: [{
        id: 'shared-weekly', title: 'Vuilnis buitenzetten', frequency: 'weekly',
        weekday: 1, freeToTake: true, freeSince: '2026-11-16'
      }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    currentUserId: 'user-2',
    accountEmail: 'bram@example.test',
    sharedAccount: false,
    demoMode: false,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1,
    save: async () => true,
    render() {}
  });
  context.currentMember = () => context.state.members.find(member => member.id === 'm2');
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function completionKey(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')) +
    app.slice(app.indexOf('async function updateTaskCompletion('), app.indexOf('function speakText(')),
    context
  );

  const completedDay = context.parseDate('2026-11-16');
  await context.updateTaskCompletion({
    taskId: 'shared-weekly', date: '2026-11-16', memberId: undefined, checked: true
  });
  assert.equal(context.state.completed['shared-weekly|2026-11-16'].completedByMemberId, 'm2');
  assert.deepEqual([...context.membersOn(context.state.tasks[0], completedDay).map(member => member.id)], ['m2']);
  assert.equal(context.isDone(context.state.tasks[0], completedDay, 'm2'), true);

  const nextOccurrence = context.parseDate('2026-11-23');
  assert.deepEqual([...context.membersOn(context.state.tasks[0], nextOccurrence)], []);
});

test('shared logins leave completed everyone tasks unassigned', async () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      members: [{ id: 'm1', name: 'Ada' }],
      tasks: [{
        id: 'shared-weekly', title: 'Vuilnis buitenzetten', frequency: 'weekly',
        weekday: 1, freeToTake: true, freeSince: '2026-11-16'
      }],
      completed: {}
    },
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    FREQUENCIES: { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks', once: 'Eenmalig' },
    currentUserId: 'user-1',
    accountEmail: 'ada@example.test',
    sharedAccount: true,
    demoMode: false,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    validBackupDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    isoWeek: () => 1,
    save: async () => true,
    render() {}
  });
  context.currentMember = () => context.state.members[0];
  vm.runInNewContext(readFileSync(require.resolve('../task-scheduling'), 'utf8'), context);
  vm.runInContext(
    app.slice(app.indexOf('function membersForAssignment('), app.indexOf('function completionKey(')) +
    app.slice(app.indexOf('function completionKey('), app.indexOf('function showToast(')) +
    app.slice(app.indexOf('async function updateTaskCompletion('), app.indexOf('function speakText(')),
    context
  );

  const completedDay = context.parseDate('2026-11-16');
  await context.updateTaskCompletion({
    taskId: 'shared-weekly', date: '2026-11-16', memberId: undefined, checked: true
  });
  assert.equal(context.state.completed['shared-weekly|2026-11-16'].completedByMemberId, undefined);
  assert.deepEqual([...context.membersOn(context.state.tasks[0], completedDay)], []);
});

test('parent can mark a late shared-task completion as not late without reopening it', async () => {
  const app = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: {
      tasks: [{ id: 'shared', title: 'Badkamer', frequency: 'weekly' }],
      completed: {
        'shared|2026-11-16': {
          memberCompletions: {
            m1: { completedAt: '2026-11-20', completedByUserId: '5' },
            m2: { completedAt: '2026-11-17', completedByUserId: '6' }
          }
        }
      }
    },
    isChild: () => false,
    parseDate: key => {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day);
    },
    completionKey: (task, date) => `${task.id}|${context.dateKey(date)}`,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    isLate: (task, date, memberId) => context.state.completed[`${task.id}|2026-11-16`]
      ?.memberCompletions?.[memberId]?.completedAt > context.dateKey(date),
    save: async () => true,
    render() {},
    showToast() {}
  });
  vm.runInContext(
    app.slice(app.indexOf('async function markCompletionNotLate('), app.indexOf('function speakText(')),
    context
  );

  await context.markCompletionNotLate({ taskId: 'shared', date: '2026-11-16', memberId: 'm1' });
  assert.equal(context.state.completed['shared|2026-11-16'].memberCompletions.m1.completedAt, '2026-11-16');
  assert.equal(context.state.completed['shared|2026-11-16'].memberCompletions.m1.completedByUserId, '5');
  assert.equal(context.state.completed['shared|2026-11-16'].memberCompletions.m2.completedAt, '2026-11-17');
  assert.ok(context.state.completed['shared|2026-11-16'].memberCompletions.m1);
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
