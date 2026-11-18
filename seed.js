const SEED_MEMBERS = [
  { id: 'member-1', name: 'Mama', birthDate: null },
  { id: 'member-2', name: 'Papa', birthDate: null },
  { id: 'member-3', name: 'Kind', birthDate: null }
];

const SEED_MEAL_IDEAS = [
  { id: 'example-meal-pasta', name: 'Pasta met groenten', wishedBy: [] },
  { id: 'example-meal-soup', name: 'Groentesoep', wishedBy: [] },
  { id: 'example-meal-wraps', name: 'Wraps met bonen', wishedBy: [] },
  { id: 'example-meal-pancakes', name: 'Pannenkoeken', wishedBy: [] }
];

const SEED_TASKS = [
  {
    id: 'example-cooking',
    title: 'Koken',
    frequency: 'daily',
    dailyAssignments: { 1: 'member-1', 2: 'member-2', 3: 'member-1', 4: 'member-2', 5: 'member-1', 6: 'member-2', 7: 'member-1' }
  },
  {
    id: 'example-table',
    title: 'Tafel dekken',
    frequency: 'daily',
    dailyAssignments: { 1: 'member-3', 2: 'member-3', 3: 'member-3', 4: 'member-3', 5: 'member-3', 6: 'member-3', 7: 'member-3' }
  },
  {
    id: 'example-dishes',
    title: 'Afwas opruimen',
    frequency: 'daily',
    dailyAssignments: { 1: 'member-2', 2: 'member-1', 3: 'member-2', 4: 'member-1', 5: 'member-2', 6: 'member-1', 7: 'member-2' }
  },
  {
    id: 'example-vacuum',
    title: 'Stofzuigen',
    frequency: 'weekly',
    weekday: 6,
    weeklyAssignments: { even: 'member-1', odd: 'member-2' }
  },
  {
    id: 'example-laundry',
    title: 'Was doen',
    frequency: 'weekly',
    weekday: 3,
    weeklyAssignments: { even: 'member-2', odd: 'member-1' }
  },
  {
    id: 'example-room',
    title: 'Kamer opruimen',
    frequency: 'weekly',
    weekday: 6,
    weeklyAssignments: { even: 'member-3', odd: 'member-3' }
  },
  {
    id: 'example-fridge',
    title: 'Koelkast schoonmaken',
    frequency: 'monthly',
    memberId: 'member-1',
    monthDay: 1
  },
  {
    id: 'example-windows',
    title: 'Ramen wassen',
    frequency: 'yearly'
  }
];

function normalizeTask(task) {
  const hasMultipleAssignments = value => Array.isArray(value) && value.length > 1;
  const normalizeIds = ids => (Array.isArray(ids) ? ids : ids ? [ids] : []).filter(id => id !== '');
  const normalizeAssignments = assignments => Object.fromEntries(
    Object.entries(assignments).map(([key, ids]) => [key, normalizeIds(ids)])
  );
  const memberIds = normalizeIds(task.memberIds ?? task.memberId);
  const dailyAssignments = normalizeAssignments(task.dailyAssignments ?? Object.fromEntries((task.days || []).map(day => [day, task.memberId || ''])));
  const weeklyAssignments = normalizeAssignments(task.weeklyAssignments ?? {
    even: task.week === 'odd' ? '' : task.memberId || '',
    odd: task.week === 'even' ? '' : task.memberId || ''
  });
  const legacyMultipleAssignments = hasMultipleAssignments(memberIds) ||
    Object.values(dailyAssignments).some(hasMultipleAssignments) ||
    Object.values(weeklyAssignments).some(hasMultipleAssignments) ||
    (task.schedules || []).some(part => normalizeTask(part).allowMultipleMembers);
  return {
    ...task,
    frequency: task.frequency === 'occasional' ? 'yearly' : task.frequency,
    important: task.important === true,
    freeToTake: task.freeToTake === true,
    flexibleSchedule: task.flexibleSchedule === true,
    allowMultipleMembers: task.allowMultipleMembers === true || legacyMultipleAssignments,
    memberId: memberIds[0] ?? '',
    memberIds,
    weekday: task.weekday ?? 1,
    monthDay: task.monthDay ?? 1,
    date: task.date ?? '',
    group: task.group ?? '',
    dailyAssignments,
    weeklyAssignments
  };
}

function validTaskAssignments(value) {
  const validId = id => typeof id === 'string' && id.trim() !== '' && !id.includes('|');
  return Array.isArray(value)
    ? new Set(value).size === value.length && value.every(id => id === '' || validId(id))
    : value === '' || validId(value);
}

function appointmentMemberIds(appointment) {
  return appointment.memberIds ?? (appointment.memberId ? [appointment.memberId] : []);
}

function removeAppointmentMember(appointment, memberId) {
  const remove = item => !appointmentMemberIds(item).includes(memberId) ? item
    : Object.hasOwn(item, 'memberIds')
      ? { ...item, memberIds: item.memberIds.filter(id => id !== memberId) }
      : { ...item, memberId: '' };
  const result = remove(appointment);
  if (!appointment.recurrence?.exceptions) return result;
  return { ...result, recurrence: { ...appointment.recurrence, exceptions: Object.fromEntries(
    Object.entries(appointment.recurrence.exceptions).map(([date, item]) => [date, item ? remove(item) : null])
  ) } };
}

function appointmentDateValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 100) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validAppointments(appointments, members) {
  if (!Array.isArray(appointments) || !Array.isArray(members) ||
      members.some(member => !member || typeof member !== 'object')) return false;
  const memberIds = new Set(members.map(member => member.id));
  const ids = new Set();
  const validDate = appointmentDateValid;
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validItem = item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.id !== 'string' || !item.id.trim() || item.id.includes('|') ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 ||
        typeof item.allDay !== 'boolean' || !validDate(item.startDate) || !validDate(item.endDate) ||
        (Object.hasOwn(item, 'memberIds')
          ? Object.hasOwn(item, 'memberId') || !Array.isArray(item.memberIds) ||
            new Set(item.memberIds).size !== item.memberIds.length ||
            !item.memberIds.every(id => typeof id === 'string' && id.trim() && !id.includes('|') && memberIds.has(id))
          : typeof item.memberId !== 'string' || (item.memberId !== '' && !memberIds.has(item.memberId))) ||
        (item.allDay ? item.startTime !== '' || item.endTime !== '' || item.endDate < item.startDate :
          !validTime(item.startTime) || !validTime(item.endTime) ||
          `${item.endDate}T${item.endTime}` <= `${item.startDate}T${item.startTime}`)) return false;
    return true;
  };
  return appointments.every(item => {
    if (!validItem(item) || ids.has(item.id)) return false;
    if (item.recurrence !== undefined) {
      const rule = item.recurrence;
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
          !['weekly', 'biweekly', 'monthly', 'yearly'].includes(rule.frequency) ||
          typeof rule.until !== 'string' || (rule.until !== '' && (!validDate(rule.until) || rule.until < item.startDate)) ||
          !rule.exceptions || typeof rule.exceptions !== 'object' || Array.isArray(rule.exceptions) ||
          !Object.entries(rule.exceptions).every(([date, exception]) => validDate(date) &&
            (exception === null || validItem(exception) && exception.id === item.id && exception.recurrence === undefined))) return false;
    }
    ids.add(item.id);
    return true;
  });
}

function appointmentOccurrences(appointment, from, to) {
  if (!appointment.recurrence) return appointment.startDate <= to &&
    (appointmentOnDate(appointment, from) || appointment.startDate >= from) ? [appointment] : [];
  const rule = appointment.recurrence;
  const dayMs = 86400000;
  const asDate = key => new Date(`${key}T00:00:00Z`);
  const dateString = date => date.toISOString().slice(0, 10);
  const start = asDate(appointment.startDate);
  const duration = (asDate(appointment.endDate) - start) / dayMs;
  const earliest = new Date(asDate(from).getTime() - duration * dayMs);
  const limit = asDate(to);
  const results = [];
  const addOccurrence = occurrenceStart => {
    const key = dateString(occurrenceStart);
    if (key < appointment.startDate || rule.until && key > rule.until) return;
    if (Object.hasOwn(rule.exceptions, key)) return;
    const end = new Date(occurrenceStart.getTime() + duration * dayMs);
    if (end.getUTCFullYear() > 9999) return;
    const occurrence = { ...appointment, startDate: key, endDate: dateString(end), occurrenceDate: key };
    if (occurrence.startDate <= to && (appointmentOnDate(occurrence, from) || occurrence.startDate >= from)) results.push(occurrence);
  };
  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const interval = (rule.frequency === 'weekly' ? 7 : 14) * dayMs;
    const periods = Math.max(0, Math.ceil((earliest - start) / interval));
    for (let day = new Date(start.getTime() + periods * interval); day <= limit; day = new Date(day.getTime() + interval)) addOccurrence(day);
  } else {
    const interval = rule.frequency === 'yearly' ? 12 : 1;
    const difference = (earliest.getUTCFullYear() - start.getUTCFullYear()) * 12 + earliest.getUTCMonth() - start.getUTCMonth();
    let index = Math.max(0, Math.floor(difference / interval));
    for (;; index++) {
      const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index * interval, 1));
      if (month > limit || month.getUTCFullYear() > 9999) break;
      const day = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), start.getUTCDate()));
      if (day.getUTCMonth() === month.getUTCMonth()) addOccurrence(day);
    }
  }
  for (const [key, exception] of Object.entries(rule.exceptions)) {
    if (exception && exception.startDate <= to && (appointmentOnDate(exception, from) || exception.startDate >= from)) {
      results.push({ ...exception, occurrenceDate: key });
    }
  }
  return results;
}

function appointmentOnDate(appointment, date) {
  return appointment.startDate <= date && (appointment.allDay
    ? appointment.endDate >= date
    : appointment.endDate > date || appointment.endDate === date && appointment.endTime !== '00:00');
}

// seed.js is also served by older server versions that do not know state-merge.js.
function mergeHouseholdState(base, local, remote) {
  const conflict = () => { throw new Error('Dezelfde gegevens zijn op meerdere apparaten gewijzigd.'); };
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  const mergeValue = (previous, changed, latest) => {
    if (equal(changed, previous)) return latest;
    if (equal(latest, previous) || equal(changed, latest)) return changed;
    return conflict();
  };
  const mergeMap = (previous, changed, latest) => {
    const entries = [];
    for (const key of new Set([...Object.keys(previous), ...Object.keys(changed), ...Object.keys(latest)])) {
      const value = mergeValue(
        Object.hasOwn(previous, key) ? previous[key] : undefined,
        Object.hasOwn(changed, key) ? changed[key] : undefined,
        Object.hasOwn(latest, key) ? latest[key] : undefined
      );
      if (value !== undefined) entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  };
  const mergeList = (previous, changed, latest) => {
    const toMap = list => {
      if (!Array.isArray(list) || list.some(item => !item || typeof item.id !== 'string') ||
          new Set(list.map(item => item.id)).size !== list.length) return conflict();
      return Object.fromEntries(list.map(item => [item.id, item]));
    };
    const oldMap = toMap(previous);
    const localMap = toMap(changed);
    const remoteMap = toMap(latest);
    for (const list of [changed, latest]) {
      const surviving = list.filter(item => Object.hasOwn(oldMap, item.id)).map(item => item.id);
      if (!equal(surviving, previous.filter(item => surviving.includes(item.id)).map(item => item.id))) return conflict();
    }
    const merged = mergeMap(oldMap, localMap, remoteMap);
    const order = [...latest.map(item => item.id), ...changed.map(item => item.id).filter(id => !Object.hasOwn(remoteMap, id))];
    return order.filter(id => Object.hasOwn(merged, id)).map(id => merged[id]);
  };

  const removedMembers = (before, after) => before.members.some(member => !after.members.some(item => item.id === member.id));
  if ((removedMembers(base, local) && (!equal(base.tasks, remote.tasks) || !equal(base.appointments || [], remote.appointments || []))) ||
      (removedMembers(base, remote) && (!equal(base.tasks, local.tasks) || !equal(base.appointments || [], local.appointments || [])))) conflict();

  const collections = new Set(['members', 'tasks', 'groceries', 'mealIdeas', 'notes', 'appointments']);
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    let value;
    if (collections.has(key)) value = mergeList(base[key] ?? [], local[key] ?? [], remote[key] ?? []);
    else if (key === 'completed' || key === 'customization') value = mergeMap(base[key], local[key], remote[key]);
    else value = mergeValue(base[key], local[key], remote[key]);
    if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { SEED_MEMBERS, SEED_TASKS, SEED_MEAL_IDEAS, normalizeTask, validTaskAssignments, validAppointments, appointmentMemberIds, removeAppointmentMember, appointmentOnDate, appointmentOccurrences, mergeHouseholdState };
}
