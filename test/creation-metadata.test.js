'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerCreatedItems } = require('../creation-metadata');

test('new item metadata is assigned by the server and existing metadata is immutable', () => {
  const previous = [
    { id: 'existing', createdAt: '2026-02-01', createdByUserId: 7 },
    { id: 'legacy', name: 'Old item' }
  ];
  const submitted = [
    { id: 'existing', createdAt: '2026-11-16', createdByUserId: 99 },
    { id: 'legacy', createdAt: '2026-11-16', createdByUserId: 99 },
    { id: 'new', createdAt: '2000-01-01', createdByUserId: 99 }
  ];

  const result = registerCreatedItems(previous, submitted, 12, '2026-11-16');

  assert.deepEqual(result.map(item => [item.id, item.createdAt, item.createdByUserId]), [
    ['existing', '2026-02-01', 7],
    ['legacy', undefined, undefined],
    ['new', '2026-11-16', 12]
  ]);
});
