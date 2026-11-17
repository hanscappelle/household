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
  if ((removedMembers(base, local) && !equal(base.tasks, remote.tasks)) ||
      (removedMembers(base, remote) && !equal(base.tasks, local.tasks))) conflict();

  const collections = new Set(['members', 'tasks', 'groceries', 'mealIdeas', 'notes']);
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    let value;
    if (collections.has(key)) value = mergeList(base[key], local[key], remote[key]);
    else if (key === 'completed' || key === 'customization') value = mergeMap(base[key], local[key], remote[key]);
    else value = mergeValue(base[key], local[key], remote[key]);
    if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { SEED_MEMBERS, SEED_TASKS, SEED_MEAL_IDEAS, normalizeTask, validTaskAssignments, mergeHouseholdState };
}
