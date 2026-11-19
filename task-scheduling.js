(function (global) {
'use strict';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function regularOccurrence(task, date) {
  if (task.schedules) return task.schedules.some(part => regularOccurrence(part, date));
  const weekday = date.getDay() || 7;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekly') return task.weekday === weekday;
  if (task.frequency === 'monthly') return task.monthDay === date.getDate();
  if (task.frequency === 'once') return task.date === dateKey(date);
  return task.frequency === 'yearly' && /^\d{4}-\d{2}-\d{2}$/.test(task.date || '') &&
    task.date.slice(5) === dateKey(date).slice(5);
}

function nextOccurrenceOnOrAfter(task, startDate) {
  const limit = addDays(startDate, 1465);
  for (let date = startDate; date <= limit; date = addDays(date, 1)) {
    if (regularOccurrence(task, date)) return date;
  }
  return null;
}

function freeTaskOccurrenceDate(task, selectedDate, freeSince, completed) {
  const start = parseDate(freeSince);
  const end = parseDate(selectedDate);
  if (start > end) return null;
  if (task.frequency === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.date || '')) return null;
    const dueDate = parseDate(task.date);
    if (dueDate < start || dueDate > end) return null;
    const dueDateKey = dateKey(dueDate);
    const completion = completed[`${task.id}|${dueDateKey}`];
    if (!completion) return dueDateKey;
    const completedAt = typeof completion === 'object' &&
      /^\d{4}-\d{2}-\d{2}$/.test(completion.completedAt || '')
      ? completion.completedAt
      : dueDateKey;
    return (completedAt > dueDateKey ? completedAt : dueDateKey) >= selectedDate
      ? dueDateKey
      : null;
  }

  let dueDate = nextOccurrenceOnOrAfter(task, start);
  while (dueDate && dueDate <= end) {
    const dueDateKey = dateKey(dueDate);
    const completion = completed[`${task.id}|${dueDateKey}`];
    if (!completion) return dueDateKey;

    const completedAt = typeof completion === 'object' &&
      /^\d{4}-\d{2}-\d{2}$/.test(completion.completedAt || '')
      ? completion.completedAt
      : dueDateKey;
    const finishedDate = completedAt > dueDateKey ? completedAt : dueDateKey;
    if (finishedDate >= selectedDate) return dueDateKey;

    dueDate = nextOccurrenceOnOrAfter(task, addDays(parseDate(finishedDate), 1));
  }
  return null;
}

function flexibleTaskOccurrenceDate(task, selectedDate, freeSince, completed) {
  const start = parseDate(freeSince);
  const end = parseDate(selectedDate);
  if (task.frequency === 'once') {
    if (start > end || !/^\d{4}-\d{2}-\d{2}$/.test(task.date || '')) return null;
    const dueDate = parseDate(task.date);
    if (dateKey(dueDate) !== task.date || dueDate > end) return null;
    const dueDateKey = dateKey(dueDate);
    const completion = completed[`${task.id}|${dueDateKey}`];
    if (!completion) return dueDateKey;
    const completedAt = typeof completion === 'object' &&
      /^\d{4}-\d{2}-\d{2}$/.test(completion.completedAt || '')
      ? completion.completedAt
      : dueDateKey;
    return (completedAt > dueDateKey ? completedAt : dueDateKey) >= selectedDate
      ? dueDateKey
      : null;
  }
  if (start > end || !['daily', 'weekly', 'monthly', 'yearly'].includes(task.frequency)) return null;

  const periodStart = date => {
    if (task.frequency === 'daily') return date;
    if (task.frequency === 'weekly') {
      const mondayOffset = (date.getDay() + 6) % 7;
      return addDays(date, -mondayOffset);
    }
    if (task.frequency === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1);
    return new Date(date.getFullYear(), 0, 1);
  };
  const nextPeriodStart = date => {
    if (task.frequency === 'daily') return addDays(date, 1);
    if (task.frequency === 'weekly') return addDays(periodStart(date), 7);
    if (task.frequency === 'monthly') return new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return new Date(date.getFullYear() + 1, 0, 1);
  };

  let dueDate = periodStart(start);
  if (dueDate < start) dueDate = start;
  while (dueDate <= end) {
    const dueDateKey = dateKey(dueDate);
    const completion = completed[`${task.id}|${dueDateKey}`];
    if (!completion) return dueDateKey;

    let finishedDate = dueDateKey;
    if (completion.memberCompletions && typeof completion.memberCompletions === 'object') {
      const assignedIds = task.memberIds || (task.memberId ? [task.memberId] : []);
      const memberIds = (Array.isArray(assignedIds) ? assignedIds : [assignedIds]).filter(Boolean);
      const records = (memberIds.length ? memberIds : Object.keys(completion.memberCompletions))
        .map(memberId => completion.memberCompletions[memberId]);
      if (records.some(record => !record)) return dueDateKey;
      for (const record of records) {
        const completedAt = record === true ? dueDateKey :
          typeof record === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(record.completedAt || '')
            ? record.completedAt
            : dueDateKey;
        if (completedAt > finishedDate) finishedDate = completedAt;
      }
    } else {
      const completedAt = typeof completion === 'object' &&
        /^\d{4}-\d{2}-\d{2}$/.test(completion.completedAt || '')
        ? completion.completedAt
        : dueDateKey;
      if (completedAt > finishedDate) finishedDate = completedAt;
    }
    if (finishedDate === selectedDate) return dueDateKey;
    if (finishedDate > selectedDate) return null;

    dueDate = nextPeriodStart(parseDate(finishedDate));
  }
  return null;
}

global.freeTaskOccurrenceDate = freeTaskOccurrenceDate;
global.flexibleTaskOccurrenceDate = flexibleTaskOccurrenceDate;
if (typeof module !== 'undefined') module.exports = { freeTaskOccurrenceDate, flexibleTaskOccurrenceDate };
})(globalThis);
