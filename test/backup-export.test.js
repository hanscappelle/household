'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const code = app.slice(app.indexOf('function dateKey('), app.indexOf('function parseDate(')) +
  app.slice(app.indexOf('function exportBackup('), app.indexOf('function backupReplaceCounts('));
const state = { members: [{ name: 'Ada' }] };
const expectedContents = JSON.stringify({ format: 'ons-huishouden-backup', version: 1, data: state }, null, 2);

function setup(globals, date = new Date(2026, 0, 2, 3, 4, 5)) {
  const context = vm.createContext({
    BACKUP_FORMAT: 'ons-huishouden-backup', state,
    Date: function () { return date; },
    ...globals
  });
  vm.runInContext(code, context);
  return context;
}

test('browser export includes local date and time in the filename and preserves backup contents', async () => {
  const link = { click() { this.clicked = true; }, remove() { this.removed = true; } };
  let blob;
  let revoked;
  const context = setup({
    window: {}, Blob,
    URL: {
      createObjectURL(value) { blob = value; return 'blob:backup'; },
      revokeObjectURL(value) { revoked = value; }
    },
    document: {
      createElement(tag) { assert.equal(tag, 'a'); return link; },
      body: { append(value) { assert.equal(value, link); } }
    },
    setTimeout(callback, delay) { assert.equal(delay, 1000); callback(); }
  });
  context.exportBackup();
  assert.equal(link.download, 'huishouden-backup-2026-01-02-03-04-05.json');
  assert.equal(link.href, 'blob:backup');
  assert.equal(link.clicked, true);
  assert.equal(link.removed, true);
  assert.equal(revoked, 'blob:backup');
  assert.equal(blob.type, 'application/json');
  assert.equal(await blob.text(), expectedContents);
});

test('Android export passes timestamped filename and unchanged contents to the native picker', () => {
  const calls = [];
  const context = setup({
    window: { HouseholdAndroid: { saveBackup(...args) { calls.push(args); } } }
  }, new Date(2026, 10, 21, 17, 20, 57));
  context.exportBackup();
  assert.deepEqual(calls, [['huishouden-backup-2026-11-21-17-20-57.json', expectedContents]]);
});
