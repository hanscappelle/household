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
    frequency: 'occasional'
  }
];

if (typeof module !== 'undefined') {
  module.exports = { SEED_MEMBERS, SEED_TASKS, SEED_MEAL_IDEAS };
}
