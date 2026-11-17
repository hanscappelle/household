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

global.freeTaskOccurrenceDate = freeTaskOccurrenceDate;
if (typeof module !== 'undefined') module.exports = { freeTaskOccurrenceDate };
})(globalThis);
