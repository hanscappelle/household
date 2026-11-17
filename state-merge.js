'use strict';

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

if (typeof module !== 'undefined') module.exports = { mergeHouseholdState };
