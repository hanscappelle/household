'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validTaskAssignments } = require('../seed');

test('empty assignment placeholders are valid, but malformed member IDs are not', () => {
  assert.equal(validTaskAssignments(''), true);
  assert.equal(validTaskAssignments(['']), true);
  assert.equal(validTaskAssignments(['member-1', '']), true);
  assert.equal(validTaskAssignments(['', '']), false);
  assert.equal(validTaskAssignments(['member-1', 'member-1']), false);
  assert.equal(validTaskAssignments(['member|1']), false);
  assert.equal(validTaskAssignments(['  ']), false);
});
