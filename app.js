const THEME_KEY = 'ons-huishouden-thema';
const BACKUP_FORMAT = 'ons-huishouden-backup';
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const FREQUENCIES = { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', occasional: 'Sporadisch' };
const CUSTOM_TEXT_DEFAULTS = {
  websiteTitle: 'Ons huishouden',
  brandSubtitle: 'SAMEN THUIS',
  welcomeTitle: 'Fijn dat je er bent',
  welcomeText: 'Samen maken we van ons huis een fijne plek.',
  sidebarTitle: 'Een fijn thuis, doen we samen.',
  sidebarText: 'Een beetje overzicht maakt ruimte voor de leuke dingen.'
};
const CUSTOM_TEXT_LIMITS = { websiteTitle: 60, brandSubtitle: 40, welcomeTitle: 80, welcomeText: 160, sidebarTitle: 100, sidebarText: 200 };

function validateMealIdeas(ideas, members) {
  if (!Array.isArray(ideas)) throw new Error('De lijst met kookinspiratie is ongeldig.');
  const memberIds = new Set(members.map(member => member.id));
  const ids = new Set();
  for (const idea of ideas) {
    if (!idea || typeof idea !== 'object' || Array.isArray(idea) ||
      typeof idea.id !== 'string' || !idea.id.trim() || idea.id.includes('|') || ids.has(idea.id) ||
      typeof idea.name !== 'string' || !idea.name.trim() || idea.name.length > 120 ||
      !Array.isArray(idea.wishedBy) || new Set(idea.wishedBy).size !== idea.wishedBy.length ||
      !idea.wishedBy.every(id => typeof id === 'string' && memberIds.has(id))) {
      throw new Error('Een gerecht bevat ongeldige gegevens of onbekende gezinsleden.');
    }
    ids.add(idea.id);
  }
}

function normalizeTask(task) {
  return {
    ...task,
    important: task.important === true,
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

let state = null;
let revision = null;
let householdInfo = { members: [], invitations: [], canInvite: false };
let createdInvitationUrl = '';
let createdPasswordResetUrl = '';
let createdPasswordResetEmail = '';
let saving = false;
let needsRecovery = false;
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

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Het verzoek is mislukt.');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function save(nextState = state) {
  const attempted = structuredClone(nextState);
  saving = true;
  document.querySelector('#app').inert = true;
  document.querySelector('#modal').inert = true;
  try {
    const result = await api('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: attempted, revision })
    });
    revision = result.revision;
    return true;
  } catch (error) {
    console.error('Gegevens opslaan mislukt:', error);
    state = attempted;
    needsRecovery = true;
    document.querySelector('#modal').close();
    document.querySelector('#recovery-message').textContent = `De wijziging is niet bevestigd: ${error.message}`;
    document.querySelector('#recovery').hidden = false;
    return false;
  } finally {
    saving = false;
    if (!needsRecovery) {
      document.querySelector('#app').inert = false;
      document.querySelector('#modal').inert = false;
    }
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
  const memberLoads = state.members.map(member => ({
    member,
    count: todayTasks.filter(task => memberOn(task, date)?.id === member.id).length
  }));
  const maxLoad = Math.max(0, ...memberLoads.map(item => item.count));
  const week = isoWeek(date);
  const range = `${formatDate(start, { day: 'numeric', month: 'short' })} – ${formatDate(weekDates[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `
    <div class="page-heading"><div><h1>${escapeHtml(state.customization.welcomeTitle)} <span style="color:#9cbd9f">✳</span></h1><p>${escapeHtml(state.customization.welcomeText)}</p></div><button class="button" data-action="new-task"><span class="plus">+</span> Taak toevoegen</button></div>
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
            const count = tasksOn(day).length;
            const label = `${formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })} · ${count} ${count === 1 ? 'taak' : 'taken'}${dayBirthdays.length ? ` · ${dayBirthdays.length} ${dayBirthdays.length === 1 ? 'verjaardag' : 'verjaardagen'}` : ''}`;
            return `<button class="day ${dateKey(day) === selectedDate ? 'selected' : ''}" data-action="select-day" data-date="${dateKey(day)}" aria-label="${escapeHtml(label)}" aria-pressed="${dateKey(day) === selectedDate}"><span class="day-name">${DAYS[(day.getDay() + 6) % 7]}</span><span class="day-number">${day.getDate()}</span><span class="day-markers" aria-hidden="true">${count ? `<span class="day-dot"></span><span class="day-task-count">${count}</span>` : ''}${dayBirthdays.length ? '<span class="birthday-marker">🎂</span>' : ''}</span></button>`;
          }).join('')}</div>
          <div class="day-detail"><div class="day-detail-head"><strong>${escapeHtml(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong><span>${todayTasks.length} ${todayTasks.length === 1 ? 'taak' : 'taken'}</span></div>
            ${birthdays.map(member => `<div class="birthday-row"><span class="birthday-icon" aria-hidden="true">🎂</span><div><strong>Verjaardag van ${escapeHtml(member.name)}</strong><small>${date.getFullYear() - parseDate(member.birthDate).getFullYear()} jaar</small></div></div>`).join('')}
            ${todayTasks.map(task => `<div class="task-row ${isDone(task, date) ? 'done' : ''}"><input class="check" type="checkbox" data-action="complete" data-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)} afronden" ${isDone(task, date) ? 'checked' : ''}><div class="task-info"><strong>${escapeHtml(task.title)}${task.important ? '<span class="important-icon" title="Belangrijke taak" aria-label="Belangrijke taak"><svg viewBox="0 0 24 24" focusable="false"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z"/></svg></span>' : ''}</strong><small>${escapeHtml(memberOn(task, date).name)} · ${frequencyLabel(task)}</small></div>${taskMenu(task)}</div>`).join('')}
            ${!todayTasks.length && !birthdays.length ? `<div class="empty"><span class="empty-icon">☼</span><strong>Een lekker lege planning</strong>Plan een taak in en hij verschijnt hier.</div>` : ''}
            ${memberLoads.length ? `<div class="daily-load"><strong>Verdeling per gezinslid</strong><ul>${memberLoads.map(({ member, count }) => `<li><span class="load-name">${escapeHtml(member.name)}</span><span class="load-track" aria-hidden="true"><span class="load-bar" style="width:${maxLoad ? count / maxLoad * 100 : 0}%"></span></span><span class="load-count">${count} ${count === 1 ? 'taak' : 'taken'}</span></li>`).join('')}</ul></div>` : ''}
          </div>
        </div>
      </section>
      <section><div class="section-heading"><div><h2>Ons gezin</h2><p>Samen staan we sterker.</p></div><a class="text-button" href="#gezin">Bekijken →</a></div>
        <div class="panel family-panel">${state.members.length ? state.members.map((member, index) => `<div class="family-row">${avatar(member, index)}<div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberDetails(member))}${member.email ? ` · ${escapeHtml(member.email)}` : ''}</small></div></div>`).join('') : '<div class="empty">Voeg een gezinslid toe om te beginnen.</div>'}</div>
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
    <div class="list-toolbar"><div class="search"><input id="task-search" type="search" placeholder="Zoek een taak..." aria-label="Zoek een taak" value="${escapeHtml(taskSearch)}">${taskSearch ? '<button type="button" class="search-clear" data-action="clear-task-search" aria-label="Zoekveld leegmaken">×</button>' : ''}</div><select id="frequency-filter" aria-label="Filter op frequentie"><option value="all">Alle frequenties</option>${Object.entries(FREQUENCIES).map(([value, label]) => `<option value="${value}" ${frequencyFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="member-filter" aria-label="Filter op gezinslid"><option value="all">Iedereen</option><option value="unassigned" ${memberFilter === 'unassigned' ? 'selected' : ''}>Niet toegewezen</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}" ${memberFilter === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter op planningsstatus"><option value="all">Alle statussen</option><option value="scheduled" ${statusFilter === 'scheduled' ? 'selected' : ''}>Ingepland</option><option value="unscheduled" ${statusFilter === 'unscheduled' ? 'selected' : ''}>Niet ingepland</option></select></div>
    <div class="list-summary">${filtered.length} ${filtered.length === 1 ? 'taak' : 'taken'}</div><div class="panel list-panel"><table class="task-table"><thead><tr><th scope="col">Taak</th><th scope="col" class="status-column" aria-sort="${statusSort === 'none' ? 'none' : statusSort === 'scheduled-first' ? 'ascending' : 'descending'}"><button type="button" class="status-sort" data-action="sort-status" aria-label="Sorteer op planningsstatus, ${sortLabel}">Status <span aria-hidden="true">${statusSort === 'none' ? '↕' : statusSort === 'scheduled-first' ? '↑' : '↓'}</span></button></th><th scope="col" class="frequency-column">Frequentie</th></tr></thead><tbody>${filtered.length ? filtered.map(task => {
      const scheduled = isScheduled(task);
      const status = scheduled ? 'Ingepland' : 'Niet ingepland';
      return `<tr class="task-list-row" data-action="edit-task" data-id="${escapeHtml(task.id)}"><td><button type="button" class="task-list-item" aria-label="${escapeHtml(task.title)}${task.important ? ' — belangrijk' : ''} — ${status} — bewerken"><span class="stat-icon" style="width:34px;height:34px;font-size:15px">✓</span><span class="task-info"><strong>${escapeHtml(task.title)}${task.important ? '<span class="important-icon" title="Belangrijke taak" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z"/></svg></span>' : ''}</strong><small>${!task.schedules && (task.frequency === 'monthly' || task.frequency === 'occasional') ? `${escapeHtml(memberFor(task)?.name || 'Niet toegewezen')} · ` : ''}${escapeHtml(taskSchedule(task))}${task.group ? ` · ${escapeHtml(task.group)}` : ''}</small></span></button></td><td class="status-column"><span class="schedule-status ${scheduled ? 'scheduled' : 'unscheduled'}">${status}</span></td><td class="frequency-column"><span class="frequency-tag">${frequencyLabel(task)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="3"><div class="empty" style="margin:20px 0">Geen taken gevonden.</div></td></tr>'}</tbody></table></div>`;
}

function renderFamily() {
  const roles = { owner: 'Ouder', parent: 'Ouder', partner: 'Ouder', child: 'Kind' };
  return `<div class="page-heading"><div><h1>Ons gezin</h1><p>Iedereen draagt op zijn eigen manier bij.</p></div><button class="button" data-action="new-member"><span class="plus">+</span> Gezinslid toevoegen</button></div>
    <div class="members-grid">${state.members.map((member, index) => `<div class="panel member-card">${avatar(member, index)}<h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(memberDetails(member))}${member.email ? `<br>${escapeHtml(member.email)}` : ''}<br>${state.tasks.filter(task => assignedMemberIds(task).includes(member.id)).length} toegewezen taken</p><button class="text-button" data-action="edit-member" data-id="${escapeHtml(member.id)}">Gegevens bewerken →</button></div>`).join('')}</div>
    <section class="household-access">
      <div class="section-heading"><div><h2>Samen in hetzelfde dashboard</h2><p>Nodig je partner of kinderen uit met hun eigen e-mailadres en wachtwoord.</p></div></div>
      <div class="panel backup-panel">
        <h2>Gezinsaccounts</h2>
        <div class="household-account-list">${householdInfo.members.map(member => `<div class="family-row"><span class="avatar">${escapeHtml(member.email.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(member.email)}</strong><small>${roles[member.role] || 'Gezinslid'} · eigen login</small></div>${member.canReset ? `<button type="button" class="text-button" data-action="create-password-reset" data-email="${escapeHtml(member.email)}">Wachtwoord resetten</button>` : ''}</div>`).join('')}</div>
        ${householdInfo.invitations.length ? `<h3 class="invite-list-title">Openstaande uitnodigingen</h3>${householdInfo.invitations.map(invite => `<div class="family-row"><div><strong>${escapeHtml(invite.email)}</strong><small>${roles[invite.role]} · geldig tot ${escapeHtml(new Date(invite.expiresAt).toLocaleDateString('nl-BE'))}</small></div>${householdInfo.canInvite ? `<button type="button" class="text-button" data-action="revoke-invitation" data-id="${escapeHtml(invite.id)}">Intrekken</button>` : ''}</div>`).join('')}` : ''}
        ${householdInfo.canInvite ? `<form id="household-invite-form" class="invite-form">
          <label for="invite-member">Gezinslid</label><select id="invite-member" name="memberId"><option value="">Nieuw gezinslid</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}${member.email ? ` · ${escapeHtml(member.email)}` : ''}</option>`).join('')}</select>
          <label for="invite-role">Rol voor de login</label><select id="invite-role" name="role"><option value="parent">Ouder</option><option value="child">Kind</option></select>
          <label for="invite-new-email">E-mailadres voor de login</label><input id="invite-new-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="naam@voorbeeld.nl">
          <span class="field-help invite-help">Kies een bestaand gezinslid om het account eraan te koppelen, of laat ‘Nieuw gezinslid’ staan en kies alleen de rol.</span>
          <button class="button" type="submit">Uitnodigingslink maken</button><div id="household-invite-error" role="alert"></div>
        </form>` : '<p class="field-help">Alleen ouders kunnen nieuwe gezinsleden uitnodigen.</p>'}
        <div id="created-invitation" class="created-invitation" ${createdInvitationUrl ? '' : 'hidden'}>
          <label for="created-invitation-url">Deel deze link binnen je gezin</label><input id="created-invitation-url" readonly value="${escapeHtml(createdInvitationUrl)}">
          <button type="button" class="button secondary" data-action="copy-invitation">Link kopiëren</button><p>De link is 7 dagen geldig. De ontvanger stelt zelf een wachtwoord in.</p>
        </div>
        <div id="created-password-reset" class="created-invitation" ${createdPasswordResetUrl ? '' : 'hidden'}>
          <label for="created-password-reset-url">Resetlink voor ${escapeHtml(createdPasswordResetEmail)}</label><input id="created-password-reset-url" readonly value="${escapeHtml(createdPasswordResetUrl)}">
          <button type="button" class="button secondary" data-action="copy-password-reset">Link kopiëren</button><p>Deel deze link rechtstreeks met de gebruiker. De link is eenmalig geldig voor 1 uur; daarna kiest de gebruiker zelf een nieuw wachtwoord. Na de reset worden bestaande sessies beëindigd.</p>
        </div>
      </div>
    </section>`;
}

function renderGroceries() {
  const remaining = state.groceries.filter(item => !item.done).length;
  return `<div class="page-heading"><div><h1>Boodschappen</h1><p>Wat is op, of wat wil je graag in huis halen?</p></div></div>
    <div class="panel groceries-panel">
      <form id="groceries-form" class="groceries-form"><label class="sr-only" for="grocery-name">Boodschap</label><input id="grocery-name" name="name" required maxlength="120" placeholder="Voeg iets toe aan de lijst"><button class="button" type="submit"><span class="plus">+</span> Toevoegen</button></form>
      <p class="list-summary">${remaining} ${remaining === 1 ? 'boodschap' : 'boodschappen'} te halen</p>
      ${state.groceries.length ? state.groceries.map(item => `<div class="task-row ${item.done ? 'done' : ''}"><input type="checkbox" class="check" data-action="grocery-done" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} gekocht" ${item.done ? 'checked' : ''}><div class="task-info"><strong>${escapeHtml(item.name)}</strong></div><button type="button" class="grocery-urgent" data-action="toggle-grocery-urgent" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} dringend" aria-pressed="${item.urgent === true}" title="${item.urgent ? 'Dringend: klik om te wijzigen' : 'Markeer als dringend'}"><span aria-hidden="true">${item.urgent ? '⚑' : '⚐'}</span><span class="grocery-urgent-label">${item.urgent ? 'Dringend' : 'Niet dringend'}</span></button><button type="button" class="text-button grocery-delete" data-action="delete-grocery" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} verwijderen">Verwijderen</button></div>`).join('') : '<div class="empty"><strong>Je lijst is leeg</strong>Voeg toe wat jullie nodig hebben.</div>'}
    </div>`;
}

function renderMealIdeas() {
  const sortedIdeas = [...state.mealIdeas].sort((a, b) => b.wishedBy.length - a.wishedBy.length);
  return `<div class="page-heading"><div><h1>Kookinspiratie</h1><p>Bewaar gerechten en ontdek waar iedereen zin in heeft.</p></div></div>
    <div class="panel groceries-panel">
      <form id="meal-ideas-form" class="groceries-form"><label class="sr-only" for="meal-idea-name">Gerecht of voeding</label><input id="meal-idea-name" name="name" required maxlength="120" placeholder="Voeg een gerecht of voeding toe"><button class="button" type="submit"><span class="plus">+</span> Toevoegen</button></form>
      ${sortedIdeas.length ? sortedIdeas.map(idea => `<div class="meal-idea"><strong class="meal-name">${escapeHtml(idea.name)}</strong>
        ${state.members.length ? `<fieldset class="meal-wishes"><legend class="sr-only">Wie heeft er zin in ${escapeHtml(idea.name)}?</legend>${state.members.map(member => `<label><input type="checkbox" class="check" data-action="meal-wish" data-id="${escapeHtml(idea.id)}" data-member-id="${escapeHtml(member.id)}" ${idea.wishedBy.includes(member.id) ? 'checked' : ''}><span>${escapeHtml(member.name)}</span></label>`).join('')}</fieldset>` : '<p class="meal-empty-members">Voeg een gezinslid toe om wensen aan te duiden.</p>'}
        <span class="meal-count ${idea.wishedBy.length > state.members.length / 2 ? 'majority' : ''}">${idea.wishedBy.length} ${idea.wishedBy.length === 1 ? 'persoon' : 'personen'}${idea.wishedBy.length > state.members.length / 2 ? ' · Meerderheid' : ''}</span>
        <button type="button" class="text-button meal-delete" data-action="delete-meal-idea" data-id="${escapeHtml(idea.id)}" aria-label="${escapeHtml(idea.name)} verwijderen">Verwijderen</button></div>`).join('') : '<div class="empty"><strong>Nog geen kookinspiratie</strong>Voeg een gerecht of voeding toe.</div>'}
    </div>`;
}

function renderBackup() {
  return `<div class="page-heading"><div><h1>Instellingen</h1><p>Personaliseer de teksten en beheer de back-up van jullie gezinsgegevens.</p></div></div>
    <form id="customization-form" class="panel backup-panel">
      <h2>Teksten personaliseren</h2>
      <p>Deze teksten zijn zichtbaar voor iedereen in jullie gezinsdashboard.</p>
      <div class="form-grid">
        <div class="field"><label for="custom-website-title">Titel van de website</label><input id="custom-website-title" name="websiteTitle" required maxlength="${CUSTOM_TEXT_LIMITS.websiteTitle}" value="${escapeHtml(state.customization.websiteTitle)}"></div>
        <div class="field"><label for="custom-brand-subtitle">Ondertekst van het logo</label><input id="custom-brand-subtitle" name="brandSubtitle" required maxlength="${CUSTOM_TEXT_LIMITS.brandSubtitle}" value="${escapeHtml(state.customization.brandSubtitle)}"></div>
        <div class="field"><label for="custom-welcome-title">Welkomsttitel</label><input id="custom-welcome-title" name="welcomeTitle" required maxlength="${CUSTOM_TEXT_LIMITS.welcomeTitle}" value="${escapeHtml(state.customization.welcomeTitle)}"></div>
        <div class="field"><label for="custom-welcome-text">Korte welkomsttekst</label><input id="custom-welcome-text" name="welcomeText" required maxlength="${CUSTOM_TEXT_LIMITS.welcomeText}" value="${escapeHtml(state.customization.welcomeText)}"></div>
        <div class="field"><label for="custom-sidebar-title">Kleine boodschap: titel</label><input id="custom-sidebar-title" name="sidebarTitle" required maxlength="${CUSTOM_TEXT_LIMITS.sidebarTitle}" value="${escapeHtml(state.customization.sidebarTitle)}"></div>
        <div class="field"><label for="custom-sidebar-text">Kleine boodschap: tekst</label><input id="custom-sidebar-text" name="sidebarText" required maxlength="${CUSTOM_TEXT_LIMITS.sidebarText}" value="${escapeHtml(state.customization.sidebarText)}"></div>
      </div>
      <div class="modal-actions"><button type="button" class="button secondary" data-action="reset-customization">Standaardteksten herstellen</button><button type="submit" class="button">Teksten opslaan</button></div>
    </form>
    <div class="panel backup-panel"><h2>Back-up downloaden</h2><p>Download een JSON-bestand met gezinsleden, taken, planningen, afvinkjes, boodschappen en kookinspiratie. Bewaar dit bestand op een veilige plek: het bevat persoonlijke gegevens.</p><button class="button" data-action="export-backup">Back-up downloaden</button></div>
    <div class="panel backup-panel"><h2>Back-up terugzetten</h2><p>Een back-up terugzetten vervangt de huidige gegevens van je account. Download eventueel eerst een back-up van de huidige gegevens.</p><label for="backup-file" class="field-label">JSON-bestand kiezen</label><input id="backup-file" type="file" accept=".json,application/json"><button class="button secondary" data-action="import-backup">Back-up terugzetten</button></div>`;
}

function renderHelp() {
  return `<div class="page-heading"><div><h1>Help</h1><p>Praktische uitleg over het gebruik van jullie huishoudapp.</p></div></div>
    <div class="help-content">
      <section class="panel help-panel"><h2>Aanmelden en samen gebruiken</h2>
        <p>Log in met je e-mailadres en wachtwoord. Een ouder kan via <a href="#gezin">Ons gezin</a> een partner of kind uitnodigen met een persoonlijke link. De genodigde kiest zelf een wachtwoord. Een geaccepteerde uitnodiging geeft toegang tot hetzelfde gezinsdashboard.</p>
        <p>Is een gezinslid het wachtwoord vergeten? Een ouder kan bij <a href="#gezin">Gezinsaccounts</a> een eenmalige resetlink maken en deze rechtstreeks met die gebruiker delen. De link verloopt na een uur; de gebruiker kiest zelf het nieuwe wachtwoord.</p>
        <p>De uitnodigingslink is zeven dagen geldig. Deel hem alleen met de bedoelde persoon. Kindaccounts kunnen het dashboard gebruiken, maar geen gezinsleden uitnodigen of uitnodigingen intrekken.</p>
      </section>
      <section class="panel help-panel"><h2>Overzicht en taken</h2>
        <p>Op <a href="#overzicht">Overzicht</a> zie je de weekplanning, taken en verjaardagen. Kies een dag in de agenda of gebruik de pijlen om naar een andere week te gaan. Vink een taak af wanneer die klaar is.</p>
        <p>Op <a href="#taken">Alle taken</a> kun je een taak openen om de planning te wijzigen. Kies per dag, week, maand of eenmalige datum wie de taak uitvoert. Markeer in het taakformulier belangrijke taken; die herken je aan het label <strong>Belangrijk</strong>. Gebruik de zoekbalk en filters om taken terug te vinden.</p>
      </section>
      <section class="panel help-panel"><h2>Gezinsleden</h2>
        <p>Voeg op <a href="#gezin">Ons gezin</a> gezinsleden toe en bewerk hun naam, geboortedatum en optioneel e-mailadres. Een geboortedatum wordt gebruikt om de leeftijd te tonen en verjaardagen op het overzicht te markeren.</p>
        <p>Om iemand een eigen login te geven, kies je bij de uitnodiging een bestaand gezinslid of maak je een uitnodiging voor een nieuw gezinslid. Vul het login-e-mailadres in en deel de link. Na acceptatie wordt het e-mailadres van een gekoppeld gezinslid gelijk aan het e-mailadres van de login.</p>
      </section>
      <section class="panel help-panel"><h2>Boodschappen en kookinspiratie</h2>
        <p>Op <a href="#boodschappen">Boodschappen</a> voeg je producten toe. Vink ze af na aankoop, markeer ze zo nodig als dringend of verwijder ze als ze niet meer nodig zijn.</p>
        <p>Op <a href="#kookinspiratie">Kookinspiratie</a> bewaar je gerechten en vink je per gezinslid aan wie er zin in heeft. De lijst sorteert gerechten met de meeste wensen bovenaan.</p>
      </section>
      <section class="panel help-panel"><h2>Instellingen en gegevens bewaren</h2>
        <p>Bij <a href="#instellingen">Instellingen</a> pas je de websitetitel, de ondertekst van het logo en de welkomst- en zijpaneelteksten aan. Deze teksten zijn zichtbaar voor het hele gezin.</p>
        <p>Je kunt daar ook een JSON-back-up downloaden of terugzetten. Terugzetten vervangt de huidige gezinsgegevens; maak eventueel eerst een back-up. Bewaar het bestand veilig, want het bevat persoonlijke gegevens.</p>
      </section>
      <section class="panel help-panel"><h2>Wijzigingen op meerdere apparaten</h2>
        <p>Wijzigingen worden op de server opgeslagen en zijn beschikbaar voor alle gezinsaccounts. Een ander geopend tabblad wordt niet automatisch bijgewerkt; herlaad de pagina voordat je daar verder werkt. Bij gelijktijdige wijzigingen kan de app een conflict melden. Herlaad dan om de meest recente gegevens te bekijken.</p>
      </section>
    </div>`;
}

function render() {
  if (!state) return;
  const requestedView = location.hash.slice(1);
  if (requestedView === 'backup') {
    location.hash = 'instellingen';
    return;
  }
  const view = ['overzicht', 'taken', 'gezin', 'instellingen', 'help', 'boodschappen', 'kookinspiratie'].includes(requestedView) ? requestedView : 'overzicht';
  document.querySelector('#content').innerHTML = view === 'taken' ? renderTasks() : view === 'gezin' ? renderFamily() : view === 'instellingen' ? renderBackup() : view === 'help' ? renderHelp() : view === 'boodschappen' ? renderGroceries() : view === 'kookinspiratie' ? renderMealIdeas() : renderDashboard();
  document.querySelector('#brand-title').textContent = state.customization.websiteTitle;
  document.querySelector('#brand-subtitle').textContent = state.customization.brandSubtitle;
  document.querySelector('.brand').setAttribute('aria-label', `${state.customization.websiteTitle}, naar overzicht`);
  document.querySelector('#auth-title').textContent = state.customization.websiteTitle;
  document.title = `${state.customization.websiteTitle} — samen voor een fijn thuis`;
  document.querySelector('#sidebar-custom-title').textContent = state.customization.sidebarTitle;
  document.querySelector('#sidebar-custom-text').textContent = state.customization.sidebarText;
  document.querySelectorAll('.navigation a').forEach(link => link.classList.toggle('active', link.dataset.view === view));
  document.querySelector('#breadcrumb-current').textContent = view === 'gezin' ? 'ONS GEZIN' : view === 'taken' ? 'ALLE TAKEN' : view === 'instellingen' ? 'INSTELLINGEN' : view === 'help' ? 'HELP' : view === 'boodschappen' ? 'BOODSCHAPPEN' : view === 'kookinspiratie' ? 'KOOKINSPIRATIE' : 'OVERZICHT';
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
  if (data.customization != null && (!object(data.customization) ||
      Object.entries(CUSTOM_TEXT_LIMITS).some(([key, limit]) => data.customization[key] !== undefined &&
        (typeof data.customization[key] !== 'string' || !data.customization[key].trim() || data.customization[key].length > limit)))) {
    throw new Error('De persoonlijke teksten bevatten ongeldige gegevens.');
  }
  const memberIds = new Set();
  for (const member of data.members) {
    if (!object(member) || !id(member.id) || memberIds.has(member.id) || typeof member.name !== 'string' || !member.name.trim() ||
      (member.email != null && (typeof member.email !== 'string' || member.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email))) ||
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
      (task.important !== undefined && typeof task.important !== 'boolean') ||
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
    if (!object(item) || !id(item.id) || groceryIds.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.done !== 'boolean' || (item.urgent !== undefined && typeof item.urgent !== 'boolean')) {
      throw new Error('Een boodschap bevat ongeldige gegevens.');
    }
    groceryIds.add(item.id);
  }
  if (data.mealIdeas !== undefined) validateMealIdeas(data.mealIdeas, data.members);
  return { ...data, customization: { ...CUSTOM_TEXT_DEFAULTS, ...data.customization }, groceries: data.groceries ?? [], mealIdeas: data.mealIdeas === undefined ? [] : data.mealIdeas, tasks: data.tasks.map(task => {
    const normalized = normalizeTask(task);
    if (normalized.schedules) normalized.schedules = normalized.schedules.map(normalizeTask);
    return normalized;
  }) };
}

function exportBackup() {
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
  if (!confirm('De huidige gegevens van je account worden volledig vervangen. Wil je deze back-up terugzetten?')) return;
  if (!await save(restored)) return;
  state = restored;
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
  const task = existing ? normalizeTask(structuredClone(existing)) : normalizeTask({ title: '', frequency: 'daily', group: '', memberId: '', days: [], week: 'all', weekday: 1, monthDay: 1, date: '' });
  let scheduleIndex = 0;
  let activeSchedule = task.schedules ? task.schedules[0] : task;
  document.querySelector('#modal-content').innerHTML = `<form id="task-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">${existing ? 'Taak bewerken' : 'Nieuwe taak'}</h2><p>Maak het samen een beetje makkelijker.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div>
    <div class="form-grid"><div class="field full"><label for="title">Naam van de taak</label><input id="title" name="title" value="${escapeHtml(task.title)}" required maxlength="200" placeholder="Bijvoorbeeld: tafel afruimen"></div>
    <div class="field full"><label class="important-checkbox"><input type="checkbox" name="important" ${task.important ? 'checked' : ''}> Markeer als belangrijk</label></div>
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title')).trim();
    if (!title) { form.elements.title.setCustomValidity('Vul een naam in.'); form.elements.title.reportValidity(); return; }
    readSchedule(activeSchedule, data);
    const updated = { ...task, id: existing?.id || crypto.randomUUID(), title, important: data.has('important') };
    if (existing) state.tasks[state.tasks.indexOf(existing)] = updated;
    else state.tasks.push(updated);
    if (await save()) { document.querySelector('#modal').close(); render(); showToast('Taak opgeslagen'); }
  });
  form.elements.title.addEventListener('input', () => form.elements.title.setCustomValidity(''));
  form.querySelector('[data-action="delete-task"]')?.addEventListener('click', async () => {
    if (!confirm(`Weet je zeker dat je "${existing.title}" wilt verwijderen?`)) return;
    state.tasks = state.tasks.filter(item => item.id !== existing.id);
    Object.keys(state.completed).filter(key => key.startsWith(`${existing.id}|`)).forEach(key => delete state.completed[key]);
    if (await save()) { document.querySelector('#modal').close(); render(); showToast('Taak verwijderd'); }
  });
  document.querySelector('#modal').showModal();
}

function openMember(id) {
  const existing = state.members.find(member => member.id === id);
  document.querySelector('#modal-content').innerHTML = `<form id="member-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">${existing ? 'Gezinslid bewerken' : 'Gezinslid toevoegen'}</h2><p>Iedereen hoort erbij.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div>
    <div class="form-grid"><div class="field"><label for="member-name">Naam</label><input id="member-name" name="name" required maxlength="80" value="${escapeHtml(existing?.name || '')}"></div><div class="field"><label for="birth-date">Geboortedatum</label><input id="birth-date" name="birthDate" type="date" min="1900-01-01" max="${dateKey(new Date())}" value="${escapeHtml(existing?.birthDate || '')}">${!existing?.birthDate && existing?.birthYear != null ? `<span class="field-help">Eerder opgegeven geboortejaar: ${escapeHtml(existing.birthYear)}. Vul de volledige geboortedatum in voor de juiste leeftijd.</span>` : !existing?.birthDate && existing?.age != null ? `<span class="field-help">Eerder opgegeven leeftijd: ${escapeHtml(existing.age)} jaar. Vul de geboortedatum in om dit te vervangen.</span>` : ''}</div><div class="field full"><label for="member-email">E-mailadres (optioneel)</label><input id="member-email" name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(existing?.email || '')}" placeholder="naam@voorbeeld.nl"><span class="field-help">Het e-mailadres waarmee dit gezinslid inlogt, indien diegene een eigen account heeft.</span></div></div>
    <div class="modal-actions">${existing ? '<button type="button" class="button danger" data-action="delete-member">Verwijderen</button>' : ''}<button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#member-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.setCustomValidity('Vul een naam in.'); form.elements.name.reportValidity(); return; }
    const birthDate = form.elements.birthDate.value || null;
    const email = form.elements.email.value.trim().toLowerCase();
    if (email && !form.elements.email.validity.valid) {
      form.elements.email.setCustomValidity('Vul een geldig e-mailadres in.');
      form.elements.email.reportValidity();
      return;
    }
    form.elements.email.setCustomValidity('');
    const member = { ...existing, id: existing?.id || crypto.randomUUID(), name, birthDate, email: email || null };
    if (birthDate !== null) { delete member.birthYear; delete member.age; }
    if (existing) state.members[state.members.indexOf(existing)] = member;
    else state.members.push(member);
    if (await save()) { document.querySelector('#modal').close(); render(); showToast('Gezinslid opgeslagen'); }
  });
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  form.elements.email.addEventListener('input', () => form.elements.email.setCustomValidity(''));
  form.querySelector('[data-action="delete-member"]')?.addEventListener('click', async () => {
    if (!confirm(`${existing.name} verwijderen? Toegewezen taken blijven behouden, maar worden niet meer ingepland.`)) return;
    const nextState = {
      ...state,
      members: state.members.filter(member => member.id !== existing.id),
      tasks: structuredClone(state.tasks),
      mealIdeas: state.mealIdeas.map(idea => ({ ...idea, wishedBy: idea.wishedBy.filter(id => id !== existing.id) }))
    };
    nextState.tasks.forEach(task => {
      for (const part of schedulesFor(task)) {
        if (part.memberId === existing.id) part.memberId = '';
        for (const assignments of [part.dailyAssignments, part.weeklyAssignments]) {
          Object.keys(assignments).forEach(key => { if (assignments[key] === existing.id) assignments[key] = ''; });
        }
      }
    });
    if (await save(nextState)) { state = nextState; document.querySelector('#modal').close(); render(); showToast('Gezinslid verwijderd'); }
  });
  document.querySelector('#modal').showModal();
}

document.addEventListener('click', async event => {
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
  if (action === 'clear-task-search') {
    taskSearch = '';
    render();
    document.querySelector('#task-search').focus();
  }
  if (action === 'export-backup') exportBackup();
  if (action === 'import-backup') await importBackup();
  if (action === 'reset-customization') {
    const nextState = { ...state, customization: { ...CUSTOM_TEXT_DEFAULTS } };
    if (await save(nextState)) {
      state = nextState;
      render();
      showToast('Standaardteksten hersteld');
    }
  }
  if (action === 'toggle-grocery-urgent') {
    const nextState = { ...state, groceries: state.groceries.map(item => item.id === button.dataset.id ? { ...item, urgent: !item.urgent } : item) };
    if (await save(nextState)) {
      state = nextState;
      render();
      [...document.querySelectorAll('[data-action="toggle-grocery-urgent"]')].find(item => item.dataset.id === button.dataset.id)?.focus();
    }
  }
  if (action === 'delete-grocery') {
    const nextState = { ...state, groceries: state.groceries.filter(item => item.id !== button.dataset.id) };
    if (await save(nextState)) { state = nextState; render(); showToast('Boodschap verwijderd'); }
  }
  if (action === 'delete-meal-idea') {
    const nextState = { ...state, mealIdeas: state.mealIdeas.filter(idea => idea.id !== button.dataset.id) };
    if (await save(nextState)) { state = nextState; render(); showToast('Gerecht verwijderd'); }
  }
  if (action === 'new-member') openMember();
  if (action === 'edit-member') openMember(button.dataset.id);
  if (action === 'copy-invitation') {
    try {
      await navigator.clipboard.writeText(createdInvitationUrl);
      showToast('Uitnodigingslink gekopieerd');
    } catch (error) {
      console.error('Uitnodigingslink kopiëren mislukt:', error);
      showToast('Kopiëren is niet gelukt. Selecteer de link om deze te kopiëren.');
      document.querySelector('#created-invitation-url')?.select();
    }
  }
  if (action === 'create-password-reset') {
    button.disabled = true;
    try {
      const result = await api('api/password-resets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: button.dataset.email })
      });
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('wachtwoord-reset', result.token);
      createdPasswordResetUrl = url.toString();
      createdPasswordResetEmail = button.dataset.email;
      render();
      showToast('Resetlink aangemaakt');
    } catch (error) {
      console.error('Resetlink maken mislukt:', error);
      showToast(`Resetlink maken is niet gelukt: ${error.message}`);
      button.disabled = false;
    }
  }
  if (action === 'copy-password-reset') {
    try {
      await navigator.clipboard.writeText(createdPasswordResetUrl);
      showToast('Resetlink gekopieerd');
    } catch (error) {
      console.error('Resetlink kopiëren mislukt:', error);
      showToast('Kopiëren is niet gelukt. Selecteer de link om deze te kopiëren.');
      document.querySelector('#created-password-reset-url')?.select();
    }
  }
  if (action === 'revoke-invitation') {
    button.disabled = true;
    try {
      await api(`api/invitations/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
      householdInfo.invitations = householdInfo.invitations.filter(invite => String(invite.id) !== button.dataset.id);
      render();
      showToast('Uitnodiging ingetrokken');
    } catch (error) {
      console.error('Uitnodiging intrekken mislukt:', error);
      button.disabled = false;
      showToast(`Uitnodiging intrekken is niet gelukt: ${error.message}`);
    }
  }
  if (action === 'close-modal') document.querySelector('#modal').close();
  if (action === 'select-day') { selectedDate = button.dataset.date; render(); }
  if (action === 'today') { selectedDate = dateKey(new Date()); render(); }
  if (action === 'previous-week' || action === 'next-week') { selectedDate = dateKey(addDays(parseDate(selectedDate), action === 'previous-week' ? -7 : 7)); render(); }
});

document.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.action === 'meal-wish') {
    const nextState = { ...state, mealIdeas: state.mealIdeas.map(idea => idea.id === target.dataset.id ? {
      ...idea, wishedBy: target.checked ? [...idea.wishedBy, target.dataset.memberId] : idea.wishedBy.filter(id => id !== target.dataset.memberId)
    } : idea) };
    if (await save(nextState)) {
      state = nextState;
      render();
      [...document.querySelectorAll('[data-action="meal-wish"]')].find(input => input.dataset.id === target.dataset.id && input.dataset.memberId === target.dataset.memberId)?.focus();
    } else target.checked = !target.checked;
  }
  if (target.dataset.action === 'grocery-done') {
    const nextState = { ...state, groceries: state.groceries.map(item => item.id === target.dataset.id ? { ...item, done: target.checked } : item) };
    if (await save(nextState)) { state = nextState; render(); }
    else target.checked = !target.checked;
  }
  if (target.dataset.action === 'complete') {
    const task = state.tasks.find(item => item.id === target.dataset.id);
    if (!task) return;
    const key = completionKey(task, parseDate(selectedDate));
    if (target.checked) state.completed[key] = true;
    else delete state.completed[key];
    if (await save()) render();
  }
  if (target.id === 'frequency-filter') { frequencyFilter = target.value; render(); }
  if (target.id === 'member-filter') { memberFilter = target.value; render(); }
  if (target.id === 'status-filter') { statusFilter = target.value; render(); }
});

document.addEventListener('change', event => {
  if (event.target.id !== 'invite-member') return;
  const member = state.members.find(item => item.id === event.target.value);
  const email = document.querySelector('#invite-new-email');
  email.value = member?.email || '';
});

document.addEventListener('submit', async event => {
  if (event.target.id === 'customization-form') {
    event.preventDefault();
    const form = event.target;
    const customization = Object.fromEntries(Object.keys(CUSTOM_TEXT_LIMITS).map(key => [key, form.elements[key].value.trim()]));
    const invalidEntry = Object.entries(customization).find(([key, value]) => !value || value.length > CUSTOM_TEXT_LIMITS[key]);
    if (invalidEntry) {
      const input = form.elements[invalidEntry[0]];
      input.setCustomValidity('Vul een tekst in die binnen de aangegeven lengte past.');
      input.reportValidity();
      return;
    }
    const nextState = { ...state, customization };
    if (await save(nextState)) {
      state = nextState;
      render();
      showToast('Persoonlijke teksten opgeslagen');
    }
    return;
  }
  if (event.target.id === 'household-invite-form') {
    event.preventDefault();
    const form = event.target;
    const errorBox = form.querySelector('#household-invite-error');
    errorBox.textContent = '';
    form.inert = true;
    try {
      const result = await api('api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.elements.email.value,
          role: form.elements.role.value,
          memberId: form.elements.memberId.value || null
        })
      });
      const url = new URL(location.href);
      url.search = '';
      url.searchParams.set('uitnodiging', result.token);
      createdInvitationUrl = url.toString();
      let refreshError;
      try {
        householdInfo = await api('api/household');
      } catch (error) {
        refreshError = error;
        console.error('Gezinsaccounts vernieuwen mislukt:', refreshError);
      }
      render();
      showToast(refreshError
        ? `Uitnodiging is gemaakt, maar de lijst kon niet worden vernieuwd: ${refreshError.message}`
        : 'Uitnodigingslink aangemaakt');
    } catch (error) {
      console.error('Uitnodiging maken mislukt:', error);
      errorBox.textContent = error.message;
      form.inert = false;
    }
    return;
  }
  if (!['groceries-form', 'meal-ideas-form'].includes(event.target.id)) return;
  event.preventDefault();
  const input = event.target.elements.name;
  const name = input.value.trim();
  const meal = event.target.id === 'meal-ideas-form';
  if (!name) { input.setCustomValidity(meal ? 'Vul een gerecht of voeding in.' : 'Vul een boodschap in.'); input.reportValidity(); return; }
  const nextState = meal
    ? { ...state, mealIdeas: [...state.mealIdeas, { id: crypto.randomUUID(), name, wishedBy: [] }] }
    : { ...state, groceries: [...state.groceries, { id: crypto.randomUUID(), name, done: false, urgent: false }] };
  if (await save(nextState)) { state = nextState; render(); document.querySelector(meal ? '#meal-idea-name' : '#grocery-name').focus(); }
});

document.addEventListener('input', event => {
  if (event.target.id === 'grocery-name' || event.target.id === 'meal-idea-name') event.target.setCustomValidity('');
  if (event.target.form?.id === 'customization-form') event.target.setCustomValidity('');
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

async function openAccount() {
  const result = await api('api/state');
  householdInfo = await api('api/household');
  state = validateBackup({ format: BACKUP_FORMAT, version: 1, data: result.data });
  revision = result.revision;
  document.querySelector('#account-email').textContent = result.email;
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#invite-screen').hidden = true;
  document.querySelector('#app').hidden = false;
  if (new URLSearchParams(location.search).has('uitnodiging')) {
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }
  render();
}

const authForm = document.querySelector('#auth-form');
const inviteToken = new URLSearchParams(location.search).get('uitnodiging');
const inviteForm = document.querySelector('#invite-form');
const passwordResetToken = new URLSearchParams(location.search).get('wachtwoord-reset');
const passwordResetForm = document.querySelector('#password-reset-form');
const authEmail = authForm.elements.email;
const authError = document.querySelector('#auth-error');
authEmail.addEventListener('invalid', () => {
  authError.textContent = 'Vul een geldig e-mailadres in.';
});
authEmail.addEventListener('input', () => {
  authError.textContent = '';
});
if (passwordResetToken) {
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#password-reset-screen').hidden = false;
  passwordResetForm.inert = true;
  api(`api/password-resets/${encodeURIComponent(passwordResetToken)}`).then(result => {
    document.querySelector('#password-reset-description').textContent = `Kies een nieuw wachtwoord voor ${result.email}.`;
  }).catch(error => {
    console.error('Resetlink laden mislukt:', error);
    document.querySelector('#password-reset-error').textContent = error.message;
    passwordResetForm.querySelector('button[type="submit"]').disabled = true;
  }).finally(() => { passwordResetForm.inert = false; });
} else if (inviteToken) {
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#invite-screen').hidden = false;
  inviteForm.inert = true;
  api(`api/invitations/${encodeURIComponent(inviteToken)}`).then(invitation => {
    inviteForm.elements.email.value = invitation.email;
  }).catch(error => {
    console.error('Uitnodiging laden mislukt:', error);
    document.querySelector('#invite-error').textContent = error.message;
    inviteForm.querySelector('button[type="submit"]').disabled = true;
  }).finally(() => { inviteForm.inert = false; });
} else {
  authForm.inert = true;
  openAccount().catch(error => {
    if (error.status !== 401) {
      console.error('Account laden mislukt:', error);
      document.querySelector('#auth-error').textContent = `Gegevens laden mislukt: ${error.message}`;
    }
  }).finally(() => { authForm.inert = false; });
}

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  const action = event.submitter?.value || 'login';
  const data = new FormData(authForm);
  const errorBox = document.querySelector('#auth-error');
  errorBox.textContent = '';
  const email = String(data.get('email') || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorBox.textContent = 'Vul een geldig e-mailadres in.';
    authEmail.focus();
    return;
  }
  authForm.inert = true;
  try {
    await api(`api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: data.get('password') })
    });
    authForm.reset();
    await openAccount();
  } catch (error) {
    console.error('Aanmelden mislukt:', error);
    errorBox.textContent = error.message;
  } finally {
    authForm.inert = false;
  }
});

inviteForm.addEventListener('submit', async event => {
  event.preventDefault();
  document.querySelector('#invite-error').textContent = '';
  inviteForm.inert = true;
  try {
    await api('api/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, password: inviteForm.elements.password.value })
    });
    inviteForm.reset();
    await openAccount();
  } catch (error) {
    console.error('Uitnodiging accepteren mislukt:', error);
    document.querySelector('#invite-error').textContent = error.message;
  } finally {
    inviteForm.inert = false;
  }
});

passwordResetForm.addEventListener('submit', async event => {
  event.preventDefault();
  document.querySelector('#password-reset-error').textContent = '';
  passwordResetForm.inert = true;
  try {
    await api('api/password-resets/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: passwordResetToken, password: passwordResetForm.elements.password.value })
    });
    passwordResetForm.reset();
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    document.querySelector('#password-reset-screen').hidden = true;
    document.querySelector('#auth-screen').hidden = false;
    document.querySelector('#auth-error').textContent = 'Je wachtwoord is gewijzigd. Log in met je nieuwe wachtwoord.';
  } catch (error) {
    console.error('Wachtwoord resetten mislukt:', error);
    document.querySelector('#password-reset-error').textContent = error.message;
  } finally {
    passwordResetForm.inert = false;
  }
});

document.querySelector('#logout').addEventListener('click', async () => {
  document.querySelector('#app').inert = true;
  try {
    await api('api/logout', { method: 'POST' });
    state = null;
    revision = null;
    householdInfo = { members: [], invitations: [], canInvite: false };
    createdInvitationUrl = '';
    createdPasswordResetUrl = '';
    createdPasswordResetEmail = '';
    document.querySelector('#app').hidden = true;
    document.querySelector('#auth-screen').hidden = false;
    document.querySelector('#content').replaceChildren();
    document.querySelector('#account-email').textContent = '';
    document.querySelector('#auth-error').textContent = '';
  } catch (error) {
    console.error('Uitloggen mislukt:', error);
    alert(`Uitloggen is niet gelukt: ${error.message}`);
  } finally {
    document.querySelector('#app').inert = false;
  }
});
document.querySelector('#recovery-export').addEventListener('click', exportBackup);
document.querySelector('#recovery-reload').addEventListener('click', () => {
  needsRecovery = false;
  location.reload();
});
window.addEventListener('beforeunload', event => {
  if (saving || needsRecovery) event.preventDefault();
});
