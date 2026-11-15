const STORAGE_KEY = 'ons-huishouden-v1';
const THEME_KEY = 'ons-huishouden-thema';
const BACKUP_FORMAT = 'ons-huishouden-backup';
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const FREQUENCIES = { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', occasional: 'Sporadisch' };
const initialState = () => ({
  members: ['Papa', 'Mama', 'Stella', 'Tilde', 'Eljot'].map((name, index) => ({ id: `member-${index + 1}`, name, birthDate: null })),
  tasks: structuredClone(SEED_TASKS),
  completed: {},
  groceries: []
});

function normalizeTask(task) {
  return {
    ...task,
    memberId: task.memberId ?? '',
    weekday: task.weekday ?? 1,
    monthDay: task.monthDay ?? 1,
    date: task.date ?? '',
    group: task.group ?? '',
    dailyAssignments: task.dailyAssignments ?? Object.fromEntries((task.days || []).map(day => [day, task.memberId || ''])),
    weeklyAssignments: task.weeklyAssignments ?? {
      even: task.week === 'odd' ? '' : task.memberId || '',
      odd: task.week === 'even' ? '' : task.memberId || ''
    }
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : initialState();
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.members) || !parsed.completed || typeof parsed.completed !== 'object') {
      throw new Error('Ongeldige opgeslagen gegevens');
    }
    if (parsed.groceries !== undefined && !Array.isArray(parsed.groceries)) throw new Error('Ongeldige boodschappenlijst');
    parsed.groceries ??= [];
    parsed.tasks = parsed.tasks.map(normalizeTask);
    return parsed;
  } catch (error) {
    console.error('Gegevens laden mislukt:', error);
    alert('De opgeslagen gegevens konden niet worden geladen. Controleer de browseropslag; wijzigingen worden niet opgeslagen om gegevensverlies te voorkomen.');
    storageAvailable = false;
    const fallback = initialState();
    fallback.tasks = fallback.tasks.map(normalizeTask);
    return fallback;
  }
}

let storageAvailable = true;
let state = loadState();
let selectedDate = dateKey(new Date());
let taskSearch = '';
let frequencyFilter = 'all';
let memberFilter = 'all';
let statusFilter = 'all';
let statusSort = 'none';
let toastTimer;

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const button = document.querySelector('#theme-toggle');
  button.setAttribute('aria-pressed', String(dark));
  button.querySelector('[aria-hidden]').textContent = dark ? '☀' : '☾';
  button.querySelector('.theme-text').textContent = dark ? 'Licht' : 'Donker';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#17231c' : '#f6f7f2';
}

function initializeTheme() {
  try {
    applyTheme(localStorage.getItem(THEME_KEY));
  } catch (error) {
    console.error('Thema laden mislukt:', error);
    alert('De opgeslagen weergavevoorkeur kon niet worden geladen.');
    applyTheme('light');
  }
}

function save(nextState = state) {
  if (!storageAvailable) {
    alert('Opslaan is niet mogelijk omdat de opgeslagen gegevens niet konden worden geladen.');
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return true;
  } catch (error) {
    console.error('Gegevens opslaan mislukt:', error);
    alert('Opslaan is mislukt. Controleer of browseropslag beschikbaar is en probeer opnieuw.');
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

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

function monday(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

function isoWeek(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const first = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc - first) / 86400000 + 1) / 7);
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat('nl-BE', options).format(date);
}

function memberFor(task) {
  return state.members.find(member => member.id === task.memberId);
}

function schedulesFor(task) {
  return task.schedules || [task];
}

function frequencyLabel(task) {
  return task.schedules ? 'Gecombineerd' : FREQUENCIES[task.frequency];
}

function assignedMemberIds(task) {
  if (task.schedules) return [...new Set(task.schedules.flatMap(assignedMemberIds))];
  const ids = task.frequency === 'daily' ? Object.values(task.dailyAssignments) :
    task.frequency === 'weekly' ? Object.values(task.weeklyAssignments) : [task.memberId];
  return [...new Set(ids.filter(id => id && state.members.some(member => member.id === id)))];
}

function memberOn(task, date) {
  if (task.schedules) {
    const schedule = task.schedules.find(part => occursOn(part, date));
    return schedule ? memberOn(schedule, date) : undefined;
  }
  let id = task.memberId;
  if (task.frequency === 'daily') id = task.dailyAssignments[date.getDay() || 7];
  if (task.frequency === 'weekly') id = task.weeklyAssignments[isoWeek(date) % 2 === 0 ? 'even' : 'odd'];
  return state.members.find(member => member.id === id);
}

function occursOn(task, date) {
  if (task.schedules) return task.schedules.some(part => occursOn(part, date));
  if (!memberOn(task, date)) return false;
  const weekday = date.getDay() || 7;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekly') return task.weekday === weekday;
  if (task.frequency === 'monthly') return task.monthDay === date.getDate();
  return task.frequency === 'occasional' && task.date === dateKey(date);
}

function isScheduled(task) {
  return schedulesFor(task).some(schedule => {
    if (schedule.frequency === 'daily') {
      return DAYS.some((_, index) => state.members.some(member => member.id === schedule.dailyAssignments[index + 1]));
    }
    if (schedule.frequency === 'weekly') {
      return Number.isInteger(schedule.weekday) && schedule.weekday >= 1 && schedule.weekday <= 7 &&
        ['even', 'odd'].some(week => state.members.some(member => member.id === schedule.weeklyAssignments[week]));
    }
    if (!memberFor(schedule)) return false;
    if (schedule.frequency === 'monthly') return Number.isInteger(schedule.monthDay) && schedule.monthDay >= 1 && schedule.monthDay <= 31;
    if (schedule.frequency === 'occasional' && /^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) {
      const date = parseDate(schedule.date);
      return !Number.isNaN(date.getTime()) && dateKey(date) === schedule.date;
    }
    return false;
  });
}

function tasksOn(date) {
  return state.tasks.filter(task => occursOn(task, date));
}

function birthdaysOn(date) {
  return state.members.filter(member => {
    if (!member.birthDate || !validBackupDate(member.birthDate)) return false;
    const birthDate = parseDate(member.birthDate);
    if (date.getFullYear() <= birthDate.getFullYear()) return false;
    const leapBirthday = birthDate.getMonth() === 1 && birthDate.getDate() === 29;
    const leapYear = new Date(date.getFullYear(), 1, 29).getMonth() === 1;
    const month = leapBirthday && !leapYear ? 2 : birthDate.getMonth();
    const day = leapBirthday && !leapYear ? 1 : birthDate.getDate();
    return date.getMonth() === month && date.getDate() === day;
  });
}

function completionKey(task, date) {
  return `${task.id}|${dateKey(date)}`;
}

function isDone(task, date) {
  return Boolean(state.completed[completionKey(task, date)]);
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

function avatar(member, index) {
  const initials = member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return `<span class="avatar c${index % 5}">${escapeHtml(initials)}</span>`;
}

function memberDetails(member) {
  const today = new Date();
  if (member.birthDate) {
    const birthDate = parseDate(member.birthDate);
    const birthdayPending = today.getMonth() < birthDate.getMonth() ||
      (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate());
    return `${today.getFullYear() - birthDate.getFullYear() - Number(birthdayPending)} jaar`;
  }
  if (member.birthYear != null) return `${today.getFullYear() - member.birthYear} jaar (op basis van geboortejaar)`;
  if (member.age != null) return `Eerder opgegeven leeftijd: ${member.age} jaar`;
  return 'Geboortedatum nog niet ingevuld';
}

function taskMenu(task) {
  const id = escapeHtml(task.id);
  const title = escapeHtml(task.title);
  return `<button type="button" class="task-action" data-action="edit-task" data-id="${id}" aria-label="${title} bewerken">···</button>`;
}

function taskSchedule(task) {
  if (task.schedules) return task.schedules.map(part => `${FREQUENCIES[part.frequency]}: ${part.frequency === 'monthly' || part.frequency === 'occasional' ? `${memberFor(part)?.name || 'Niet toegewezen'} · ` : ''}${taskSchedule(part)}`).join(' | ');
  if (task.frequency === 'daily') {
    const days = DAYS.map((day, index) => {
      const member = state.members.find(item => item.id === task.dailyAssignments[index + 1]);
      return member ? `${day}: ${member.name}` : '';
    }).filter(Boolean);
    return days.length ? days.join(' · ') : 'Nog niet ingepland';
  }
  if (task.frequency === 'weekly') {
    const weeks = ['even', 'odd'].map(parity => {
      const member = state.members.find(item => item.id === task.weeklyAssignments[parity]);
      return member ? `${parity === 'even' ? 'even' : 'oneven'}: ${member.name}` : '';
    }).filter(Boolean);
    return weeks.length ? `${DAYS[task.weekday - 1]} · ${weeks.join(' · ')}` : 'Nog niet ingepland';
  }
  if (!memberFor(task)) return 'Nog niet toegewezen';
  if (task.frequency === 'monthly') return `Dag ${task.monthDay} van de maand`;
  return task.date ? formatDate(parseDate(task.date), { day: 'numeric', month: 'long', year: 'numeric' }) : 'Nog geen datum gekozen';
}

function renderDashboard() {
  const date = parseDate(selectedDate);
  const start = monday(date);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const weekTasks = weekDates.flatMap(day => tasksOn(day).map(task => ({ task, day })));
  const done = weekTasks.filter(item => isDone(item.task, item.day)).length;
  const todayTasks = tasksOn(date);
  const birthdays = birthdaysOn(date);
  const week = isoWeek(date);
  const range = `${formatDate(start, { day: 'numeric', month: 'short' })} – ${formatDate(weekDates[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `
    <div class="page-heading"><div><h1>Fijn dat je er bent <span style="color:#9cbd9f">✳</span></h1><p>Samen maken we van ons huis een fijne plek.</p></div><button class="button" data-action="new-task"><span class="plus">+</span> Taak toevoegen</button></div>
    <section class="hero">
      <div class="hero-copy"><div class="eyebrow">SAMEN VOOR EEN FIJN THUIS</div><h2>Een opgeruimd huis,<br><em>een beetje meer rust.</em></h2><p>Alle taken en plannen voor jullie gezin, overzichtelijk op één plek.</p></div>
      <span class="hero-badge">♡ &nbsp; SAMEN DOEN</span>
      <div class="hero-art" aria-hidden="true"><svg viewBox="0 0 260 210" fill="none" stroke="currentColor" stroke-width="2"><circle cx="142" cy="104" r="77"/><path d="M75 132l67-57 67 57M90 119v65h104v-65M129 184v-40h27v40M65 184h154"/><path d="M48 183c-3-25-10-37-23-44 20 2 29 14 29 35m-6 10c4-26 14-38 27-43-10 14-15 28-15 43M217 184c1-21 7-35 21-43-6 16-9 27-9 43"/><path d="M95 60l3-10 4 10 10 3-10 4-4 10-3-10-10-4zM200 71l2-7 3 7 7 3-7 3-3 7-2-7-7-3z"/></svg></div>
    </section>
    <div class="stats">
      <div class="stat"><span class="stat-icon">◷</span><div><strong>${weekTasks.length}</strong><small>Gepland deze week</small></div></div>
      <div class="stat"><span class="stat-icon">✓</span><div><strong>${done}</strong><small>Afgerond deze week</small></div></div>
      <div class="stat"><span class="stat-icon">♧</span><div><strong>${state.members.length}</strong><small>Gezinsleden</small></div></div>
    </div>
    <div class="dashboard-grid">
      <section><div class="section-heading"><div><h2>De week in beeld</h2><p>Een klein beetje planning, een groot verschil.</p></div><button class="text-button" data-action="today">Vandaag</button></div>
        <div class="panel"><div class="calendar-head"><div><strong>Week ${week} <span style="color:#9eaca0;font-weight:400">· ${week % 2 ? 'oneven' : 'even'} week</span></strong><small>${escapeHtml(range)}</small></div><div class="calendar-controls"><button class="icon-button" data-action="previous-week" aria-label="Vorige week">‹</button><button class="icon-button" data-action="next-week" aria-label="Volgende week">›</button></div></div>
          <div class="weekdays">${weekDates.map(day => {
            const dayBirthdays = birthdaysOn(day);
            const label = `${formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}${dayBirthdays.length ? ` · ${dayBirthdays.length} ${dayBirthdays.length === 1 ? 'verjaardag' : 'verjaardagen'}` : ''}`;
            return `<button class="day ${dateKey(day) === selectedDate ? 'selected' : ''}" data-action="select-day" data-date="${dateKey(day)}" aria-label="${escapeHtml(label)}" aria-pressed="${dateKey(day) === selectedDate}"><span class="day-name">${DAYS[(day.getDay() + 6) % 7]}</span><span class="day-number">${day.getDate()}</span><span class="day-markers"><span class="day-dot" style="${tasksOn(day).length ? '' : 'visibility:hidden'}"></span>${dayBirthdays.length ? '<span class="birthday-marker" aria-hidden="true">🎂</span>' : ''}</span></button>`;
          }).join('')}</div>
          <div class="day-detail"><div class="day-detail-head"><strong>${escapeHtml(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong><span>${todayTasks.length} ${todayTasks.length === 1 ? 'taak' : 'taken'}</span></div>
            ${birthdays.map(member => `<div class="birthday-row"><span class="birthday-icon" aria-hidden="true">🎂</span><div><strong>Verjaardag van ${escapeHtml(member.name)}</strong><small>${date.getFullYear() - parseDate(member.birthDate).getFullYear()} jaar</small></div></div>`).join('')}
            ${todayTasks.map(task => `<div class="task-row ${isDone(task, date) ? 'done' : ''}"><input class="check" type="checkbox" data-action="complete" data-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)} afronden" ${isDone(task, date) ? 'checked' : ''}><div class="task-info"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(memberOn(task, date).name)} · ${frequencyLabel(task)}</small></div>${taskMenu(task)}</div>`).join('')}
            ${!todayTasks.length && !birthdays.length ? `<div class="empty"><span class="empty-icon">☼</span><strong>Een lekker lege planning</strong>Plan een taak in en hij verschijnt hier.</div>` : ''}
          </div>
        </div>
      </section>
      <section><div class="section-heading"><div><h2>Ons gezin</h2><p>Samen staan we sterker.</p></div><a class="text-button" href="#gezin">Bekijken →</a></div>
        <div class="panel family-panel">${state.members.length ? state.members.map((member, index) => `<div class="family-row">${avatar(member, index)}<div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberDetails(member))}</small></div><button class="task-action family-arrow" data-action="edit-member" data-id="${escapeHtml(member.id)}" aria-label="${escapeHtml(member.name)} bewerken">›</button></div>`).join('') : '<div class="empty">Voeg een gezinslid toe om te beginnen.</div>'}</div>
        <div class="tip"><span class="tip-icon">✧</span><div><strong>Goed om te weten</strong><p>De taken uit jullie lijst staan al klaar. Wijs ze toe en kies wanneer ze terugkomen.</p><a class="text-button" href="#taken" style="padding-left:0">Bekijk alle taken →</a></div></div>
      </section>
    </div>`;
}

function renderTasks() {
  const filtered = state.tasks.filter(task => task.title.toLocaleLowerCase('nl').includes(taskSearch.toLocaleLowerCase('nl')) &&
    (frequencyFilter === 'all' || schedulesFor(task).some(part => part.frequency === frequencyFilter)) &&
    (memberFilter === 'all' || (memberFilter === 'unassigned' ? assignedMemberIds(task).length === 0 : assignedMemberIds(task).includes(memberFilter))) &&
    (statusFilter === 'all' || isScheduled(task) === (statusFilter === 'scheduled')));
  if (statusSort !== 'none') {
    filtered.sort((a, b) => (Number(isScheduled(a)) - Number(isScheduled(b))) * (statusSort === 'unscheduled-first' ? 1 : -1));
  }
  const sortLabel = statusSort === 'none' ? 'niet gesorteerd' : statusSort === 'scheduled-first' ? 'ingepland eerst' : 'niet ingepland eerst';
  return `<div class="page-heading"><div><h1>Alle taken</h1><p>Alles wat er thuis gebeurt, op één plek.</p></div><button class="button" data-action="new-task"><span class="plus">+</span> Taak toevoegen</button></div>
    <div class="list-toolbar"><input class="search" id="task-search" type="search" placeholder="Zoek een taak..." aria-label="Zoek een taak" value="${escapeHtml(taskSearch)}"><select id="frequency-filter" aria-label="Filter op frequentie"><option value="all">Alle frequenties</option>${Object.entries(FREQUENCIES).map(([value, label]) => `<option value="${value}" ${frequencyFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="member-filter" aria-label="Filter op gezinslid"><option value="all">Iedereen</option><option value="unassigned" ${memberFilter === 'unassigned' ? 'selected' : ''}>Niet toegewezen</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}" ${memberFilter === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter op planningsstatus"><option value="all">Alle statussen</option><option value="scheduled" ${statusFilter === 'scheduled' ? 'selected' : ''}>Ingepland</option><option value="unscheduled" ${statusFilter === 'unscheduled' ? 'selected' : ''}>Niet ingepland</option></select></div>
    <div class="list-summary">${filtered.length} ${filtered.length === 1 ? 'taak' : 'taken'}</div><div class="panel list-panel"><table class="task-table"><thead><tr><th scope="col">Taak</th><th scope="col" class="status-column" aria-sort="${statusSort === 'none' ? 'none' : statusSort === 'scheduled-first' ? 'ascending' : 'descending'}"><button type="button" class="status-sort" data-action="sort-status" aria-label="Sorteer op planningsstatus, ${sortLabel}">Status <span aria-hidden="true">${statusSort === 'none' ? '↕' : statusSort === 'scheduled-first' ? '↑' : '↓'}</span></button></th><th scope="col" class="frequency-column">Frequentie</th></tr></thead><tbody>${filtered.length ? filtered.map(task => {
      const scheduled = isScheduled(task);
      const status = scheduled ? 'Ingepland' : 'Niet ingepland';
      return `<tr class="task-list-row" data-action="edit-task" data-id="${escapeHtml(task.id)}"><td><button type="button" class="task-list-item" aria-label="${escapeHtml(task.title)} — ${status} — bewerken"><span class="stat-icon" style="width:34px;height:34px;font-size:15px">✓</span><span class="task-info"><strong>${escapeHtml(task.title)}</strong><small>${!task.schedules && (task.frequency === 'monthly' || task.frequency === 'occasional') ? `${escapeHtml(memberFor(task)?.name || 'Niet toegewezen')} · ` : ''}${escapeHtml(taskSchedule(task))}${task.group ? ` · ${escapeHtml(task.group)}` : ''}</small></span></button></td><td class="status-column"><span class="schedule-status ${scheduled ? 'scheduled' : 'unscheduled'}">${status}</span></td><td class="frequency-column"><span class="frequency-tag">${frequencyLabel(task)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="3"><div class="empty" style="margin:20px 0">Geen taken gevonden.</div></td></tr>'}</tbody></table></div>`;
}

function renderFamily() {
  return `<div class="page-heading"><div><h1>Ons gezin</h1><p>Iedereen draagt op zijn eigen manier bij.</p></div><button class="button" data-action="new-member"><span class="plus">+</span> Gezinslid toevoegen</button></div>
    <div class="members-grid">${state.members.map((member, index) => `<div class="panel member-card">${avatar(member, index)}<h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(memberDetails(member))} · ${state.tasks.filter(task => assignedMemberIds(task).includes(member.id)).length} toegewezen taken</p><button class="text-button" data-action="edit-member" data-id="${escapeHtml(member.id)}">Gegevens bewerken →</button></div>`).join('')}</div>`;
}

function renderGroceries() {
  const remaining = state.groceries.filter(item => !item.done).length;
  return `<div class="page-heading"><div><h1>Boodschappen</h1><p>Wat is op, of wat wil je graag in huis halen?</p></div></div>
    <div class="panel groceries-panel">
      <form id="groceries-form" class="groceries-form"><label class="sr-only" for="grocery-name">Boodschap</label><input id="grocery-name" name="name" required maxlength="120" placeholder="Voeg iets toe aan de lijst"><button class="button" type="submit"><span class="plus">+</span> Toevoegen</button></form>
      <p class="list-summary">${remaining} ${remaining === 1 ? 'boodschap' : 'boodschappen'} te halen</p>
      ${state.groceries.length ? state.groceries.map(item => `<div class="task-row ${item.done ? 'done' : ''}"><input type="checkbox" class="check" data-action="grocery-done" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} gekocht" ${item.done ? 'checked' : ''}><div class="task-info"><strong>${escapeHtml(item.name)}</strong></div><button type="button" class="text-button grocery-delete" data-action="delete-grocery" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} verwijderen">Verwijderen</button></div>`).join('') : '<div class="empty"><strong>Je lijst is leeg</strong>Voeg toe wat jullie nodig hebben.</div>'}
    </div>`;
}

function renderBackup() {
  return `<div class="page-heading"><div><h1>Back-up</h1><p>Bewaar je gegevens veilig of zet een eerdere back-up terug.</p></div></div>
    <div class="panel backup-panel"><h2>Back-up downloaden</h2><p>Download een JSON-bestand met gezinsleden, taken, planningen, afvinkjes en boodschappen. Bewaar dit bestand op een veilige plek: het bevat persoonlijke gegevens.</p><button class="button" data-action="export-backup">Back-up downloaden</button></div>
    <div class="panel backup-panel"><h2>Back-up terugzetten</h2><p>Een back-up terugzetten vervangt de huidige gegevens in deze browser. Download eventueel eerst een back-up van de huidige gegevens.</p><label for="backup-file" class="field-label">JSON-bestand kiezen</label><input id="backup-file" type="file" accept=".json,application/json"><button class="button secondary" data-action="import-backup">Back-up terugzetten</button></div>`;
}

function render() {
  const view = ['overzicht', 'taken', 'gezin', 'backup', 'boodschappen'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overzicht';
  document.querySelector('#content').innerHTML = view === 'taken' ? renderTasks() : view === 'gezin' ? renderFamily() : view === 'backup' ? renderBackup() : view === 'boodschappen' ? renderGroceries() : renderDashboard();
  document.querySelectorAll('.navigation a').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  document.querySelector('#breadcrumb-current').textContent = view === 'gezin' ? 'ONS GEZIN' : view === 'taken' ? 'ALLE TAKEN' : view === 'backup' ? 'BACK-UP' : view === 'boodschappen' ? 'BOODSCHAPPEN' : 'OVERZICHT';
  document.querySelector('#nav-count').textContent = state.tasks.length;
  document.querySelector('#today-label').textContent = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function validBackupDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}

function validateBackup(backup) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const optionalString = value => value == null || typeof value === 'string';
  const id = value => typeof value === 'string' && value.trim() !== '' && !value.includes('|');
  if (!object(backup) || backup.format !== BACKUP_FORMAT || backup.version !== 1 || !object(backup.data)) throw new Error('Onbekend back-upformaat of versie.');
  const data = backup.data;
  if (!Array.isArray(data.members) || !Array.isArray(data.tasks) || !object(data.completed)) throw new Error('Gezinsleden, taken of afvinkjes ontbreken.');
  const memberIds = new Set();
  for (const member of data.members) {
    if (!object(member) || !id(member.id) || memberIds.has(member.id) || typeof member.name !== 'string' || !member.name.trim() ||
      (member.birthDate != null && (!validBackupDate(member.birthDate) || member.birthDate > dateKey(new Date()))) ||
      (member.birthYear != null && (!Number.isInteger(member.birthYear) || member.birthYear < 1900 || member.birthYear > new Date().getFullYear())) ||
      (member.age != null && (!Number.isInteger(member.age) || member.age < 0 || member.age > 130))) throw new Error('Een gezinslid bevat ongeldige gegevens.');
    memberIds.add(member.id);
  }
  const validAssignment = value => value === '' || id(value);
  const validSchedule = schedule => {
    if (!object(schedule) || !Object.hasOwn(FREQUENCIES, schedule.frequency) || !optionalString(schedule.memberId) ||
      (schedule.memberId && !validAssignment(schedule.memberId)) ||
      (schedule.days != null && (!Array.isArray(schedule.days) || !schedule.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7))) ||
      (schedule.week != null && !['all', 'even', 'odd'].includes(schedule.week)) ||
      (schedule.weekday != null && (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7)) ||
      (schedule.monthDay != null && (!Number.isInteger(schedule.monthDay) || schedule.monthDay < 1 || schedule.monthDay > 31)) ||
      (schedule.date != null && schedule.date !== '' && !validBackupDate(schedule.date))) return false;
    if (schedule.dailyAssignments != null && (!object(schedule.dailyAssignments) ||
      !Object.entries(schedule.dailyAssignments).every(([day, value]) => /^[1-7]$/.test(day) && validAssignment(value)))) return false;
    if (schedule.weeklyAssignments != null && (!object(schedule.weeklyAssignments) ||
      !['even', 'odd'].every(week => validAssignment(schedule.weeklyAssignments[week])))) return false;
    return true;
  };
  const taskIds = new Set();
  for (const task of data.tasks) {
    if (!object(task) || !id(task.id) || taskIds.has(task.id) || typeof task.title !== 'string' || !task.title.trim() ||
      !optionalString(task.group) || !validSchedule(task) ||
      (task.schedules != null && (!Array.isArray(task.schedules) || !task.schedules.length ||
        !task.schedules.every(part => validSchedule(part) && typeof part.title === 'string' && part.title.trim())))) {
      throw new Error('Een taak bevat ongeldige gegevens of een ongeldig schema.');
    }
    taskIds.add(task.id);
  }
  for (const [key, value] of Object.entries(data.completed)) {
    const parts = key.split('|');
    if (parts.length !== 2 || !taskIds.has(parts[0]) || !validBackupDate(parts[1]) || typeof value !== 'boolean') throw new Error('Een afvinkje bevat ongeldige gegevens.');
  }
  if (data.groceries !== undefined && !Array.isArray(data.groceries)) throw new Error('De boodschappenlijst is ongeldig.');
  const groceryIds = new Set();
  for (const item of data.groceries ?? []) {
    if (!object(item) || !id(item.id) || groceryIds.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.done !== 'boolean') {
      throw new Error('Een boodschap bevat ongeldige gegevens.');
    }
    groceryIds.add(item.id);
  }
  return { ...data, groceries: data.groceries ?? [], tasks: data.tasks.map(task => {
    const normalized = normalizeTask(task);
    if (normalized.schedules) normalized.schedules = normalized.schedules.map(normalizeTask);
    return normalized;
  }) };
}

function exportBackup() {
  if (!storageAvailable) {
    alert('De gegevens zijn niet beschikbaar voor een back-up omdat ze niet konden worden geladen.');
    return;
  }
  const backup = { format: BACKUP_FORMAT, version: 1, data: state };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `huishouden-backup-${dateKey(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup() {
  const file = document.querySelector('#backup-file').files[0];
  if (!file) { alert('Kies eerst een JSON-back-upbestand.'); return; }
  let restored;
  try {
    restored = validateBackup(JSON.parse(await file.text()));
  } catch (error) {
    console.error('Back-up lezen mislukt:', error);
    alert(`De back-up kon niet worden teruggezet: ${error.message}`);
    return;
  }
  if (!confirm('De huidige gegevens in deze browser worden volledig vervangen. Wil je deze back-up terugzetten?')) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
  } catch (error) {
    console.error('Back-up opslaan mislukt:', error);
    alert('De back-up kon niet worden opgeslagen. De huidige gegevens zijn niet vervangen.');
    return;
  }
  state = restored;
  storageAvailable = true;
  taskSearch = '';
  frequencyFilter = 'all';
  memberFilter = 'all';
  statusFilter = 'all';
  statusSort = 'none';
  render();
  showToast('Back-up teruggezet');
}

function memberSelect(name, id) {
  return `<select id="${name}" name="${name}"><option value="">Niet ingepland</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}" ${id === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select>`;
}

function scheduleFields(task) {
  if (task.frequency === 'daily') return `<div class="field full"><span class="field-label">Gezinslid per dag</span><span class="field-help">Kies per dag één gezinslid. Dagen zonder gezinslid worden niet ingepland.</span><div class="assignment-grid">${DAYS.map((day, index) => `<div class="field"><label for="day-${index + 1}">${day}</label>${memberSelect(`day-${index + 1}`, task.dailyAssignments[index + 1])}</div>`).join('')}</div></div>`;
  if (task.frequency === 'weekly') return `<div class="field full"><label for="weekday">Dag van de week</label><select id="weekday" name="weekday">${DAYS.map((day, index) => `<option value="${index + 1}" ${task.weekday === index + 1 ? 'selected' : ''}>${day}</option>`).join('')}</select><span class="field-help">Kies per soort week één gezinslid. Laat een week leeg om die over te slaan.</span></div><div class="field"><label for="week-even">Even weken</label>${memberSelect('week-even', task.weeklyAssignments.even)}</div><div class="field"><label for="week-odd">Oneven weken</label>${memberSelect('week-odd', task.weeklyAssignments.odd)}</div>`;
  const memberField = `<div class="field full"><label for="memberId">Gezinslid</label>${memberSelect('memberId', task.memberId)}</div>`;
  if (task.frequency === 'monthly') return `${memberField}<div class="field full"><label for="monthDay">Dag van de maand</label><input id="monthDay" name="monthDay" type="number" min="1" max="31" value="${task.monthDay}" required><span class="field-help">Bestaat deze dag niet in een maand, dan wordt de taak die maand overgeslagen.</span></div>`;
  return `${memberField}<div class="field full"><label for="date">Datum (optioneel)</label><input id="date" name="date" type="date" value="${escapeHtml(task.date)}"><span class="field-help">Zonder datum blijft de taak in de takenlijst staan.</span></div>`;
}

function readSchedule(task, data) {
  if (task.frequency === 'daily') {
    task.dailyAssignments = Object.fromEntries(DAYS.map((_, index) => [index + 1, String(data.get(`day-${index + 1}`) || '')]));
  } else if (task.frequency === 'weekly') {
    task.weekday = Number(data.get('weekday'));
    task.weeklyAssignments = { even: String(data.get('week-even') || ''), odd: String(data.get('week-odd') || '') };
  } else {
    task.memberId = String(data.get('memberId') || '');
    if (task.frequency === 'monthly') task.monthDay = Number(data.get('monthDay')) || 1;
    if (task.frequency === 'occasional') task.date = String(data.get('date') || '');
  }
}

function openTask(id) {
  const existing = state.tasks.find(task => task.id === id);
  const task = existing ? structuredClone(existing) : normalizeTask({ title: '', frequency: 'daily', group: '', memberId: '', days: [], week: 'all', weekday: 1, monthDay: 1, date: '' });
  let scheduleIndex = 0;
  let activeSchedule = task.schedules ? task.schedules[0] : task;
  document.querySelector('#modal-content').innerHTML = `<form id="task-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">${existing ? 'Taak bewerken' : 'Nieuwe taak'}</h2><p>Maak het samen een beetje makkelijker.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div>
    <div class="form-grid"><div class="field full"><label for="title">Naam van de taak</label><input id="title" name="title" value="${escapeHtml(task.title)}" required maxlength="200" placeholder="Bijvoorbeeld: tafel afruimen"></div>
    ${task.schedules ? `<div class="field full"><label for="schedule-index">Schema bewerken</label><select id="schedule-index">${task.schedules.map((part, index) => `<option value="${index}">${index + 1}. ${escapeHtml(part.title)} (${FREQUENCIES[part.frequency]})</option>`).join('')}</select><span class="field-help">Bij overlap heeft het eerste passende schema voorrang. Wijzigingen aan alle schema's worden samen opgeslagen.</span></div>` : ''}
    <div class="field full"><label for="frequency">Frequentie</label><select id="frequency" name="frequency">${Object.entries(FREQUENCIES).map(([value, label]) => `<option value="${value}" ${activeSchedule.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div id="schedule-fields" class="field full" style="display:contents">${scheduleFields(activeSchedule)}</div></div>
    <div class="modal-actions">${existing ? '<button type="button" class="button danger" data-action="delete-task">Verwijderen</button>' : ''}<button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#task-form');
  form.elements.frequency.addEventListener('change', () => {
    readSchedule(activeSchedule, new FormData(form));
    activeSchedule.frequency = form.elements.frequency.value;
    document.querySelector('#schedule-fields').innerHTML = scheduleFields(activeSchedule);
  });
  form.querySelector('#schedule-index')?.addEventListener('change', event => {
    const monthDay = form.querySelector('#monthDay');
    if (monthDay && !monthDay.reportValidity()) { event.target.value = String(scheduleIndex); return; }
    readSchedule(activeSchedule, new FormData(form));
    scheduleIndex = Number(event.target.value);
    activeSchedule = task.schedules[scheduleIndex];
    form.elements.frequency.value = activeSchedule.frequency;
    document.querySelector('#schedule-fields').innerHTML = scheduleFields(activeSchedule);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title')).trim();
    if (!title) { form.elements.title.setCustomValidity('Vul een naam in.'); form.elements.title.reportValidity(); return; }
    readSchedule(activeSchedule, data);
    const updated = { ...task, id: existing?.id || crypto.randomUUID(), title };
    if (existing) state.tasks[state.tasks.indexOf(existing)] = updated;
    else state.tasks.push(updated);
    if (save()) { document.querySelector('#modal').close(); render(); showToast('Taak opgeslagen'); }
  });
  form.elements.title.addEventListener('input', () => form.elements.title.setCustomValidity(''));
  form.querySelector('[data-action="delete-task"]')?.addEventListener('click', () => {
    if (!confirm(`Weet je zeker dat je "${existing.title}" wilt verwijderen?`)) return;
    state.tasks = state.tasks.filter(item => item.id !== existing.id);
    Object.keys(state.completed).filter(key => key.startsWith(`${existing.id}|`)).forEach(key => delete state.completed[key]);
    if (save()) { document.querySelector('#modal').close(); render(); showToast('Taak verwijderd'); }
  });
  document.querySelector('#modal').showModal();
}

function openMember(id) {
  const existing = state.members.find(member => member.id === id);
  document.querySelector('#modal-content').innerHTML = `<form id="member-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">${existing ? 'Gezinslid bewerken' : 'Gezinslid toevoegen'}</h2><p>Iedereen hoort erbij.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div>
    <div class="form-grid"><div class="field"><label for="member-name">Naam</label><input id="member-name" name="name" required maxlength="80" value="${escapeHtml(existing?.name || '')}"></div><div class="field"><label for="birth-date">Geboortedatum</label><input id="birth-date" name="birthDate" type="date" min="1900-01-01" max="${dateKey(new Date())}" value="${escapeHtml(existing?.birthDate || '')}">${!existing?.birthDate && existing?.birthYear != null ? `<span class="field-help">Eerder opgegeven geboortejaar: ${escapeHtml(existing.birthYear)}. Vul de volledige geboortedatum in voor de juiste leeftijd.</span>` : !existing?.birthDate && existing?.age != null ? `<span class="field-help">Eerder opgegeven leeftijd: ${escapeHtml(existing.age)} jaar. Vul de geboortedatum in om dit te vervangen.</span>` : ''}</div></div>
    <div class="modal-actions">${existing ? '<button type="button" class="button danger" data-action="delete-member">Verwijderen</button>' : ''}<button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#member-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.setCustomValidity('Vul een naam in.'); form.elements.name.reportValidity(); return; }
    const birthDate = form.elements.birthDate.value || null;
    const member = { ...existing, id: existing?.id || crypto.randomUUID(), name, birthDate };
    if (birthDate !== null) { delete member.birthYear; delete member.age; }
    if (existing) state.members[state.members.indexOf(existing)] = member;
    else state.members.push(member);
    if (save()) { document.querySelector('#modal').close(); render(); showToast('Gezinslid opgeslagen'); }
  });
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  form.querySelector('[data-action="delete-member"]')?.addEventListener('click', () => {
    if (!confirm(`${existing.name} verwijderen? Toegewezen taken blijven behouden, maar worden niet meer ingepland.`)) return;
    state.members = state.members.filter(member => member.id !== existing.id);
    state.tasks.forEach(task => {
      for (const part of schedulesFor(task)) {
        if (part.memberId === existing.id) part.memberId = '';
        for (const assignments of [part.dailyAssignments, part.weeklyAssignments]) {
          Object.keys(assignments).forEach(key => { if (assignments[key] === existing.id) assignments[key] = ''; });
        }
      }
    });
    if (save()) { document.querySelector('#modal').close(); render(); showToast('Gezinslid verwijderd'); }
  });
  document.querySelector('#modal').showModal();
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'new-task') openTask();
  if (action === 'edit-task') openTask(button.dataset.id);
  if (action === 'sort-status') {
    statusSort = statusSort === 'scheduled-first' ? 'unscheduled-first' : 'scheduled-first';
    render();
    document.querySelector('[data-action="sort-status"]').focus();
  }
  if (action === 'export-backup') exportBackup();
  if (action === 'import-backup') importBackup();
  if (action === 'delete-grocery') {
    const nextState = { ...state, groceries: state.groceries.filter(item => item.id !== button.dataset.id) };
    if (save(nextState)) { state = nextState; render(); showToast('Boodschap verwijderd'); }
  }
  if (action === 'new-member') openMember();
  if (action === 'edit-member') openMember(button.dataset.id);
  if (action === 'close-modal') document.querySelector('#modal').close();
  if (action === 'select-day') { selectedDate = button.dataset.date; render(); }
  if (action === 'today') { selectedDate = dateKey(new Date()); render(); }
  if (action === 'previous-week' || action === 'next-week') { selectedDate = dateKey(addDays(parseDate(selectedDate), action === 'previous-week' ? -7 : 7)); render(); }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.action === 'grocery-done') {
    const nextState = { ...state, groceries: state.groceries.map(item => item.id === target.dataset.id ? { ...item, done: target.checked } : item) };
    if (save(nextState)) { state = nextState; render(); }
    else target.checked = !target.checked;
  }
  if (target.dataset.action === 'complete') {
    const task = state.tasks.find(item => item.id === target.dataset.id);
    if (!task) return;
    const key = completionKey(task, parseDate(selectedDate));
    if (target.checked) state.completed[key] = true;
    else delete state.completed[key];
    if (save()) render();
  }
  if (target.id === 'frequency-filter') { frequencyFilter = target.value; render(); }
  if (target.id === 'member-filter') { memberFilter = target.value; render(); }
  if (target.id === 'status-filter') { statusFilter = target.value; render(); }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'groceries-form') return;
  event.preventDefault();
  const input = event.target.elements.name;
  const name = input.value.trim();
  if (!name) { input.setCustomValidity('Vul een boodschap in.'); input.reportValidity(); return; }
  const nextState = { ...state, groceries: [...state.groceries, { id: crypto.randomUUID(), name, done: false }] };
  if (save(nextState)) { state = nextState; render(); document.querySelector('#grocery-name').focus(); }
});

document.addEventListener('input', event => {
  if (event.target.id === 'grocery-name') event.target.setCustomValidity('');
  if (event.target.id !== 'task-search') return;
  taskSearch = event.target.value;
  const position = event.target.selectionStart;
  render();
  const search = document.querySelector('#task-search');
  search.focus();
  search.setSelectionRange(position, position);
});

window.addEventListener('hashchange', render);
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  } catch (error) {
    console.error('Thema opslaan mislukt:', error);
    alert('De weergavevoorkeur kon niet worden opgeslagen. Controleer de browseropslag.');
  }
});
window.addEventListener('storage', event => {
  if (event.key === THEME_KEY || event.key === null) applyTheme(event.newValue);
});
initializeTheme();
render();
