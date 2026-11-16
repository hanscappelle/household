'use strict';

const { isDeepStrictEqual } = require('node:util');
const { normalizeTask } = require('./seed');

function normalizedTask(task) {
  const result = normalizeTask(task);
  if (result.schedules) result.schedules = result.schedules.map(normalizeTask);
  return result;
}

function without(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

function validId(id) {
  return typeof id === 'string' && id.trim() !== '' && !id.includes('|');
}

function allowedList(previous, submitted, mutableKeys, validItem, validNew) {
  if (!Array.isArray(submitted)) return false;
  const oldById = new Map(previous.map(item => [item.id, item]));
  const seen = new Set();
  for (const item of submitted) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !validId(item.id) ||
        seen.has(item.id) || !validItem(item)) return false;
    seen.add(item.id);
    const old = oldById.get(item.id);
    if (old ? !isDeepStrictEqual(without(item, mutableKeys), without(old, mutableKeys)) : !validNew(item)) return false;
  }
  return previous.every(item => seen.has(item.id));
}

function childChangesAllowed(previous, submitted, defaultCustomization) {
  if (!allowedList(previous.members, submitted.members, [],
    member => typeof member.name === 'string' && Boolean(member.name.trim()) && member.name.length <= 80,
    member => Object.keys(member).every(key => ['id', 'name', 'birthDate', 'email'].includes(key)))) return false;
  const protectedKeys = ['members', 'tasks', 'completed', 'groceries', 'mealIdeas', 'notes', 'customization'];
  if (!isDeepStrictEqual(without(previous, protectedKeys), without(submitted, protectedKeys))) return false;
  if (!isDeepStrictEqual(previous.tasks.map(normalizedTask), submitted.tasks.map(normalizedTask))) return false;
  if (!isDeepStrictEqual(
    { ...defaultCustomization, ...previous.customization },
    { ...defaultCustomization, ...submitted.customization }
  )) return false;

  const taskIds = new Set(previous.tasks.map(task => task.id));
  if (!Object.entries(submitted.completed).every(([key, value]) => {
    const [id, date, extra] = key.split('|');
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Date(`${date}T00:00:00Z`) : null;
    return extra === undefined && taskIds.has(id) && parsed && !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date && typeof value === 'boolean';
  })) return false;

  const validName = item => typeof item.name === 'string' && Boolean(item.name.trim()) && item.name.length <= 120;
  if (!allowedList(previous.groceries || [], submitted.groceries, ['done'],
    item => validName(item) && typeof item.done === 'boolean' && (item.urgent === undefined || typeof item.urgent === 'boolean'),
    item => item.done === false && item.urgent === false &&
      Object.keys(item).every(key => ['id', 'name', 'done', 'urgent', 'createdAt', 'createdByUserId', 'createdByMemberId'].includes(key)))) return false;

  const memberIds = new Set(submitted.members.map(member => member.id));
  if (!allowedList(previous.mealIdeas || [], submitted.mealIdeas, ['wishedBy'],
    item => validName(item) && Array.isArray(item.wishedBy) && new Set(item.wishedBy).size === item.wishedBy.length &&
      item.wishedBy.every(id => memberIds.has(id)),
    item => item.wishedBy.length === 0 &&
      Object.keys(item).every(key => ['id', 'name', 'wishedBy', 'createdAt', 'createdByUserId', 'createdByMemberId'].includes(key)))) return false;

  const oldNotes = (previous.notes || []).map(note => ({ ...note, important: note.important === true }));
  const newNotes = (submitted.notes || previous.notes || []).map(note => ({ ...note, important: note.important === true }));
  return allowedList(oldNotes, newNotes, [], () => true, note => note.archived === false);
}

module.exports = { childChangesAllowed };
