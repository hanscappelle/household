const THEME_KEY = 'ons-huishouden-thema';
const BACKUP_FORMAT = 'ons-huishouden-backup';
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const FREQUENCIES = { daily: 'Dagelijks', weekly: 'Wekelijks', monthly: 'Maandelijks', yearly: 'Jaarlijks' };
const COLOR_PALETTES = [
  { id: 'forest', label: 'Bosgroen', description: 'De oorspronkelijke groene tinten' },
  { id: 'ocean', label: 'Oceaanblauw', description: 'Frisse blauw- en zeetinten' },
  { id: 'lavender', label: 'Lavendel', description: 'Zachte paarse tinten' },
  { id: 'terracotta', label: 'Terracotta', description: 'Warme aardetinten' }
];
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

let state = null;
let revision = null;
let savedState = null;
let householdInfo = { members: [], invitations: [], canInvite: false };
let createdInvitationUrl = '';
let createdPasswordResetUrl = '';
let createdPasswordResetEmail = '';
let accountEmail = '';
let currentUserId = '';
let currentRole = '';
const isChild = () => currentRole === 'child';
let demoMode = false;
let themeBeforeDemo = 'light';
let colorPalette = 'forest';
let saving = false;
let needsRecovery = false;
let selectedDate = dateKey(new Date());
let taskSearch = '';
let frequencyFilter = 'all';
let memberFilter = 'all';
let statusFilter = 'all';
let statusSort = 'none';
let pendingTaskCompletion = null;
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

function applyColorPalette(palette) {
  colorPalette = palette;
  document.documentElement.dataset.palette = palette;
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
  if (demoMode) throw new Error('Deze accountfunctie is niet beschikbaar in de demomodus.');
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Het verzoek is mislukt.');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function save(nextState = state, { mergeOnConflict = true } = {}) {
  if (demoMode) return true;
  const attempted = structuredClone(nextState);
  saving = true;
  let writeConfirmed = false;
  document.querySelector('#app').inert = true;
  document.querySelector('#modal').inert = true;
  try {
    let candidate = attempted;
    let candidateRevision = revision;
    for (let attempt = 0; attempt < 4; attempt++) {
      let result;
      try {
        result = await api('api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: candidate, revision: candidateRevision })
        });
      } catch (error) {
        if (error.status !== 409 || !mergeOnConflict || attempt === 3) throw error;
        const latest = await api('api/state');
        if (latest.email !== accountEmail || latest.role !== currentRole) {
          throw new Error('Het aangemelde account is gewijzigd. Herlaad voordat je verdergaat.');
        }
        const remote = validateBackup({ format: BACKUP_FORMAT, version: 1, data: latest.data });
        candidate = validateBackup({
          format: BACKUP_FORMAT,
          version: 1,
          data: mergeHouseholdState(savedState, attempted, remote)
        });
        candidateRevision = latest.revision;
        continue;
      }
      writeConfirmed = true;
      if (!Number.isSafeInteger(result.revision) || result.revision !== candidateRevision + 1) {
        throw new Error('De server gaf een ongeldige revisie terug.');
      }
      if (result.data === undefined) {
        const latest = await api('api/state');
        if (latest.email !== accountEmail || latest.role !== currentRole) {
          throw new Error('Het aangemelde account is gewijzigd. Herlaad voordat je verdergaat.');
        }
        if (!Number.isSafeInteger(latest.revision) || latest.revision < result.revision) {
          throw new Error('De server gaf een verouderde of ongeldige revisie terug.');
        }
        result = latest;
      }
      const confirmed = validateBackup({ format: BACKUP_FORMAT, version: 1, data: result.data });
      for (const key of Object.keys(nextState)) delete nextState[key];
      Object.assign(nextState, confirmed);
      state = nextState;
      savedState = structuredClone(confirmed);
      revision = result.revision;
      return true;
    }
  } catch (error) {
    console.error('Gegevens opslaan mislukt:', error);
    state = attempted;
    needsRecovery = true;
    document.querySelector('#modal').close();
    document.querySelector('#recovery-title').textContent = writeConfirmed
      ? 'Opgeslagen gegevens niet geladen'
      : 'Opslaan niet bevestigd';
    document.querySelector('#recovery-message').textContent = writeConfirmed
      ? `De wijziging is opgeslagen, maar de opgeslagen gegevens konden niet worden geladen: ${error.message}`
      : `De wijziging is niet bevestigd: ${error.message}`;
    document.querySelector('#recovery-export').hidden = isChild();
    document.querySelector('#recovery-advice').textContent = writeConfirmed
      ? 'Herlaad om de meest recente gegevens op de server te bekijken.'
      : isChild()
        ? 'Herlaad om de gegevens op de server te bekijken. Je laatste wijziging is mogelijk niet opgeslagen.'
        : 'Download eventueel eerst een back-up van je laatste wijziging. Herlaad daarna om de gegevens op de server te bekijken. Een back-up terugzetten vervangt ook de nieuwere gegevens op de server.';
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

function capitalizeFirst(value) {
  const characters = Array.from(value.trim());
  if (!characters.length) return '';
  characters[0] = characters[0].toLocaleUpperCase('nl-BE');
  return characters.join('');
}

function capitalizedField(input) {
  const value = capitalizeFirst(input.value);
  if (input.maxLength >= 0 && value.length > input.maxLength) {
    input.setCustomValidity('De tekst is na het toevoegen van een hoofdletter te lang.');
    input.reportValidity();
    return null;
  }
  return value;
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

function membersForAssignment(ids) {
  return (Array.isArray(ids) ? ids : ids ? [ids] : [])
    .map(id => state.members.find(member => member.id === id))
    .filter(Boolean);
}

function schedulesFor(task) {
  return task.schedules || [task];
}

function frequencyLabel(task) {
  if (task.flexibleSchedule) {
    return `${FREQUENCIES[task.frequency]} · Vrij in te plannen${task.freeToTake ? ' · Voor iedereen' : ''}`;
  }
  return task.schedules ? 'Gecombineerd' : FREQUENCIES[task.frequency];
}

function assignedMemberIds(task) {
  if (task.freeToTake) return [];
  if (task.flexibleSchedule) return (task.memberIds || (task.memberId ? [task.memberId] : []))
    .filter(id => state.members.some(member => member.id === id));
  if (task.schedules) return [...new Set(task.schedules.flatMap(assignedMemberIds))];
  const assignments = task.frequency === 'daily' ? Object.values(task.dailyAssignments) :
    task.frequency === 'weekly' ? Object.values(task.weeklyAssignments) : [task.memberIds || (task.memberId ? [task.memberId] : [])];
  return [...new Set(assignments.flatMap(ids => Array.isArray(ids) ? ids : ids ? [ids] : [])
    .filter(id => state.members.some(member => member.id === id)))];
}

function membersOn(task, date) {
  if (task.freeToTake) return [];
  if (task.flexibleSchedule) return membersForAssignment(task.memberIds || (task.memberId ? [task.memberId] : []));
  if (task.schedules) {
    const schedule = task.schedules.find(part => occursOn(part, date));
    return schedule ? membersOn(schedule, date) : [];
  }
  let ids = task.memberIds || (task.memberId ? [task.memberId] : []);
  if (task.frequency === 'daily') ids = task.dailyAssignments[date.getDay() || 7];
  if (task.frequency === 'weekly') ids = task.weeklyAssignments[isoWeek(date) % 2 === 0 ? 'even' : 'odd'];
  return (Array.isArray(ids) ? ids : ids ? [ids] : [])
    .map(id => state.members.find(member => member.id === id))
    .filter(Boolean);
}

function occursOn(task, date) {
  if (task.flexibleSchedule) {
    return Boolean(globalThis.flexibleTaskOccurrenceDate(
      task, dateKey(date), task.flexibleSince || task.createdAt || dateKey(date), state.completed
    )) && (task.freeToTake || membersOn(task, date).length > 0);
  }
  if (task.freeToTake) {
    return schedulesFor(task).some(schedule => {
      if (schedule.frequency === 'daily') return true;
      if (schedule.frequency === 'weekly') return schedule.weekday === (date.getDay() || 7);
      if (schedule.frequency === 'monthly') return schedule.monthDay === date.getDate();
      return schedule.frequency === 'yearly' && schedule.date?.slice(5) === dateKey(date).slice(5);
    });
  }
  if (task.schedules) return task.schedules.some(part => occursOn(part, date));
  if (!membersOn(task, date).length) return false;
  const weekday = date.getDay() || 7;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekly') return task.weekday === weekday;
  if (task.frequency === 'monthly') return task.monthDay === date.getDate();
  return task.frequency === 'yearly' && task.date?.slice(5) === dateKey(date).slice(5);
}

function isScheduled(task) {
  if (task.flexibleSchedule) {
    return Object.hasOwn(FREQUENCIES, task.frequency) && (task.freeToTake || assignedMemberIds(task).length > 0);
  }
  if (task.freeToTake) {
    return schedulesFor(task).some(schedule => {
      if (schedule.frequency === 'daily') return true;
      if (schedule.frequency === 'weekly') return Number.isInteger(schedule.weekday) && schedule.weekday >= 1 && schedule.weekday <= 7;
      if (schedule.frequency === 'monthly') return Number.isInteger(schedule.monthDay) && schedule.monthDay >= 1 && schedule.monthDay <= 31;
      return schedule.frequency === 'yearly' && /^\d{4}-\d{2}-\d{2}$/.test(schedule.date || '') &&
        validBackupDate(schedule.date);
    });
  }
  return schedulesFor(task).some(schedule => {
    if (schedule.frequency === 'daily') {
      return DAYS.some((_, index) => membersForAssignment(schedule.dailyAssignments[index + 1]).length);
    }
    if (schedule.frequency === 'weekly') {
      return Number.isInteger(schedule.weekday) && schedule.weekday >= 1 && schedule.weekday <= 7 &&
        ['even', 'odd'].some(week => membersForAssignment(schedule.weeklyAssignments[week]).length);
    }
    if (!membersForAssignment(schedule.memberIds || (schedule.memberId ? [schedule.memberId] : [])).length) return false;
    if (schedule.frequency === 'monthly') return Number.isInteger(schedule.monthDay) && schedule.monthDay >= 1 && schedule.monthDay <= 31;
    if (schedule.frequency === 'yearly' && /^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) {
      const date = parseDate(schedule.date);
      return !Number.isNaN(date.getTime()) && dateKey(date) === schedule.date;
    }
    return false;
  });
}

function tasksOn(date) {
  const selectedDateKey = dateKey(date);
  return state.tasks.filter(task => task.flexibleSchedule
    ? Boolean(globalThis.flexibleTaskOccurrenceDate(task, selectedDateKey, task.flexibleSince || task.createdAt || selectedDateKey, state.completed)) &&
      (task.freeToTake || membersOn(task, date).length > 0)
    : task.freeToTake
      ? Boolean(globalThis.freeTaskOccurrenceDate(task, selectedDateKey, task.freeSince || task.createdAt || selectedDateKey, state.completed))
      : occursOn(task, date));
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
  const occurrenceDate = task.flexibleSchedule
    ? globalThis.flexibleTaskOccurrenceDate(task, dateKey(date), task.flexibleSince || task.createdAt || dateKey(date), state.completed)
    : task.freeToTake
      ? globalThis.freeTaskOccurrenceDate(task, dateKey(date), task.freeSince || task.createdAt || dateKey(date), state.completed)
      : dateKey(date);
  return `${task.id}|${occurrenceDate || dateKey(date)}`;
}

function isDone(task, date, memberId) {
  const completion = state.completed[completionKey(task, date)];
  if (!completion || typeof completion !== 'object' || !completion.memberCompletions) return Boolean(completion);
  if (memberId) return Boolean(completion.memberCompletions[memberId]);
  const members = membersOn(task, date);
  return members.length > 0 && members.every(member => Boolean(completion.memberCompletions[member.id]));
}

function completionDate(value) {
  return value && typeof value === 'object' && validBackupDate(value.completedAt)
    ? value.completedAt
    : null;
}

function isLate(task, date, memberId) {
  const completion = state.completed[completionKey(task, date)];
  const record = completion?.memberCompletions
    ? completion.memberCompletions[memberId]
    : completion;
  const completedAt = completionDate(record);
  return completedAt !== null && completedAt > dateKey(date);
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

function mealAvatar(idea) {
  const initials = idea.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const color = [...idea.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5;
  return `<span class="avatar c${color} meal-avatar" aria-hidden="true">${escapeHtml(initials)}</span>`;
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

function currentMember() {
  return state.members.find(item => item.email?.toLowerCase() === accountEmail.toLowerCase());
}

function currentAuthorName() {
  return currentMember()?.name || accountEmail;
}

function taskMenu(task) {
  if (isChild()) return '';
  const id = escapeHtml(task.id);
  const title = escapeHtml(task.title);
  return `<button type="button" class="task-action" data-action="edit-task" data-id="${id}" aria-label="${title} bewerken">···</button>`;
}

function taskSchedule(task) {
  if (task.flexibleSchedule) {
    if (task.freeToTake) return 'Vrij in te plannen · Voor iedereen';
    const members = membersForAssignment(task.memberIds || (task.memberId ? [task.memberId] : []));
    return `Vrij in te plannen${members.length ? ` · ${members.map(member => member.name).join(', ')}` : ''}`;
  }
  if (task.freeToTake) return 'Voor iedereen';
  if (task.schedules) return task.schedules.map(part => `${FREQUENCIES[part.frequency]}: ${part.frequency === 'monthly' || part.frequency === 'yearly' ? `${membersForAssignment(part.memberIds || (part.memberId ? [part.memberId] : [])).map(member => member.name).join(', ') || 'Niet toegewezen'} · ` : ''}${taskSchedule(part)}`).join(' | ');
  if (task.frequency === 'daily') {
    const days = DAYS.map((day, index) => {
      const members = membersForAssignment(task.dailyAssignments[index + 1]);
      return members.length ? `${day}: ${members.map(member => member.name).join(', ')}` : '';
    }).filter(Boolean);
    return days.length ? days.join(' · ') : 'Nog niet ingepland';
  }
  if (task.frequency === 'weekly') {
    const weeks = ['even', 'odd'].map(parity => {
      const members = membersForAssignment(task.weeklyAssignments[parity]);
      return members.length ? `${parity === 'even' ? 'even' : 'oneven'}: ${members.map(member => member.name).join(', ')}` : '';
    }).filter(Boolean);
    return weeks.length ? `${DAYS[task.weekday - 1]} · ${weeks.join(' · ')}` : 'Nog niet ingepland';
  }
  if (!membersForAssignment(task.memberIds || (task.memberId ? [task.memberId] : [])).length) return 'Nog niet toegewezen';
  if (task.frequency === 'monthly') return `Dag ${task.monthDay} van de maand`;
  return task.date ? formatDate(parseDate(task.date), { day: 'numeric', month: 'long' }) : 'Nog geen datum gekozen';
}

function renderLoadDistribution(title, loads) {
  const maxLoad = Math.max(0, ...loads.map(item => item.count));
  return `<section class="daily-load"><strong>${escapeHtml(title)}</strong><ul>${loads.map(({ member, count }) => `<li><span class="load-name">${escapeHtml(member.name)}</span><span class="load-track" aria-hidden="true"><span class="load-bar" style="width:${maxLoad ? count / maxLoad * 100 : 0}%"></span></span><span class="load-count">${count} ${count === 1 ? 'taak' : 'taken'}</span></li>`).join('')}</ul></section>`;
}

function speakButton(action, id, text, title, speechText, visibleLabel = '') {
  if (!isChild()) return '';
  const speechData = speechText ? ` data-speech-text="${escapeHtml(speechText)}"` : '';
  return `<button type="button" class="task-speak" data-action="${escapeHtml(action)}" data-id="${escapeHtml(id)}"${speechData} aria-label="${escapeHtml(text)} voorlezen" title="${escapeHtml(title)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>${visibleLabel ? `<span>${escapeHtml(visibleLabel)}</span>` : ''}</button>`;
}

function taskSpeechText(task, done, date) {
  let scheduledFor = '';
  if (date && task.freeToTake && task.flexibleSchedule) {
    scheduledFor = 'Deze taak is voor iedereen en blijft deze periode in de planning staan tot ze is afgerond.';
  } else if (date && task.freeToTake) scheduledFor = 'Deze taak is voor iedereen.';
  else if (date) {
    const members = membersOn(task, date).map(member => member.name);
    scheduledFor = members.length
      ? `Deze taak is ingepland voor ${members.join(', ')}.`
      : 'Deze taak is niet aan een gezinslid toegewezen.';
  }
  return `${task.title}.${task.important ? ' Belangrijke taak.' : ''} ${done ? 'Deze taak is al uitgevoerd.' : 'Deze taak is nog niet uitgevoerd.'} ${scheduledFor}`;
}

function mealSpeechText(idea, rank = [...state.mealIdeas]
  .sort((a, b) => b.wishedBy.length - a.wishedBy.length)
  .findIndex(item => item.id === idea.id) + 1) {
  const members = state.members.filter(member => idea.wishedBy.includes(member.id)).map(member => member.name);
  const interest = members.length
    ? `${idea.name}. Zin in dit gerecht: ${members.join(', ')}.`
    : `${idea.name}. Nog niemand heeft aangegeven zin te hebben in dit gerecht.`;
  return `${interest} Dit gerecht staat op plek ${rank}.`;
}

function renderTaskRows(tasks, date, memberId) {
  return tasks.map(task => {
    const done = memberId ? isDone(task, date, memberId) : isDone(task, date);
    const memberData = memberId ? ` data-member-id="${escapeHtml(memberId)}"` : '';
    return `<div class="task-row planned-task-row ${done ? 'done' : ''}"><label class="task-completion"><input class="check" type="checkbox" data-action="complete" data-id="${escapeHtml(task.id)}"${memberData} aria-label="${escapeHtml(task.title)} afronden" ${done ? 'checked' : ''}><span class="task-info"><strong>${escapeHtml(task.title)}${task.important ? '<span class="important-icon" title="Belangrijke taak" aria-label="Belangrijke taak"><svg viewBox="0 0 16 16" focusable="false"><circle cx="8" cy="8" r="7"/><path class="important-icon-mark" d="M8 3.8v5.1M8 11.5v.1"/></svg></span>' : ''}</strong><small>${frequencyLabel(task)}</small>${isLate(task, date, memberId) ? '<small class="late-label">Te laat uitgevoerd</small>' : ''}</span></label>${speakButton('speak-task', task.id, task.title, 'Taak voorlezen', taskSpeechText(task, done))}${taskMenu(task)}</div>`;
  }).join('');
}

function confirmTaskCompletion(task, date, memberId) {
  pendingTaskCompletion = { taskId: task.id, date: dateKey(date), memberId };
  const currentlyDone = memberId ? isDone(task, date, memberId) : isDone(task, date);
  const dialog = document.querySelector('#modal');
  const taskSpeech = `${taskSpeechText(task, currentlyDone, date)} Gebruik de groene knop als je deze taak al gedaan hebt, de rode knop wanneer je deze nog moet doen.`;
  document.querySelector('#modal-content').innerHTML = `<div class="modal-inner task-confirmation"><div class="modal-head"><div><h2 id="modal-title">Heb je deze taak al uitgevoerd?</h2></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div><div class="task-confirmation-title"><strong>${escapeHtml(task.title)}</strong>${speakButton('speak-task', task.id, task.title, 'Taak voorlezen', taskSpeech)}${task.important ? '<span>Belangrijke taak</span>' : ''}</div><div class="modal-actions task-confirm-actions"><button type="button" class="button" data-action="task-completion-answer" data-checked="true"><span aria-hidden="true">✓</span> Ja</button><button type="button" class="button secondary" data-action="task-completion-answer" data-checked="false"><span aria-hidden="true">✕</span> Nee</button></div></div>`;
  dialog.showModal();
  dialog.querySelector('.modal-actions [data-action="task-completion-answer"]').focus();
}

async function updateTaskCompletion({ taskId, date, memberId, checked }) {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) return;
  const selectedDate = parseDate(date);
  const key = completionKey(task, selectedDate);
  const existing = state.completed[key];
  const assignedMemberIds = membersOn(task, selectedDate).map(member => member.id);
  const usesMemberCompletions = !task.freeToTake &&
    (Boolean(existing?.memberCompletions) || assignedMemberIds.length > 1);
  if (usesMemberCompletions) {
    if (!assignedMemberIds.includes(memberId)) {
      console.error('De afgevinkte gezinslid hoort niet bij deze taak.');
      render();
      return;
    }
    const memberCompletions = existing?.memberCompletions
      ? Object.entries(existing.memberCompletions).filter(([id]) => id !== memberId)
      : assignedMemberIds.filter(id => id !== memberId).map(id => [id, existing]);
    if (checked) {
      const completion = { completedAt: dateKey(new Date()) };
      if (demoMode) {
        const member = currentMember();
        if (member) completion.completedByMemberId = member.id;
      } else {
        completion.completedByUserId = currentUserId;
      }
      memberCompletions.push([memberId, completion]);
    }
    const records = Object.fromEntries(memberCompletions);
    if (Object.keys(records).length) state.completed[key] = { memberCompletions: records };
    else delete state.completed[key];
  } else if (checked) {
    const completion = { completedAt: dateKey(new Date()) };
    if (demoMode) {
      const member = currentMember();
      if (member) completion.completedByMemberId = member.id;
    } else {
      completion.completedByUserId = currentUserId;
    }
    state.completed[key] = completion;
  } else delete state.completed[key];
  if (await save()) render();
}

function speakText(text) {
  if (typeof window.HouseholdAndroid?.speakTask === 'function') {
    try {
      window.HouseholdAndroid.speakTask(text);
    } catch (error) {
      console.error('Voorlezen mislukt:', error);
      showToast('Voorlezen is niet gelukt. Controleer de spraakinstellingen van je apparaat.');
    }
    return;
  }
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    showToast('Voorlezen is niet beschikbaar op dit apparaat.');
    return;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'nl-BE';
    utterance.onerror = event => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      console.error('Voorlezen mislukt:', event.error);
      showToast('Voorlezen is niet gelukt. Controleer de spraakinstellingen van je apparaat.');
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('Voorlezen mislukt:', error);
    showToast('Voorlezen is niet gelukt. Controleer de spraakinstellingen van je apparaat.');
  }
}

function speakItem(action, id, speechText) {
  const item = (action === 'speak-task' ? state.tasks :
    action === 'speak-member' ? state.members :
      action === 'speak-meal' ? state.mealIdeas : state.notes)
    .find(entry => entry.id === id);
  if (!item) {
    console.error('De tekst om voor te lezen is niet gevonden.');
    showToast('De tekst om voor te lezen kon niet worden gevonden.');
    return;
  }
  speakText(action === 'speak-task' ? speechText || taskSpeechText(item, false) :
    action === 'speak-meal' ? speechText || mealSpeechText(item) :
      action === 'speak-member' ? item.name : `${item.title}. ${item.description}`);
}

function memberStatistics(member) {
  if (!validBackupDate(member.createdAt)) return null;
  const start = parseDate(member.createdAt);
  const end = parseDate(dateKey(new Date()));
  let scheduled = 0;
  let completed = 0;
  let completedLate = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    for (const task of state.tasks) {
      if (occursOn(task, date) && membersOn(task, date).some(assigned => assigned.id === member.id)) {
        scheduled += 1;
        if (isDone(task, date, member.id)) completed += 1;
        if (isLate(task, date, member.id)) completedLate += 1;
      }
    }
  }
  const creator = demoMode ? member.id : householdInfo.members.find(item =>
    item.email.toLowerCase() === member.email?.toLowerCase())?.id;
  const collections = [
    { key: 'tasks', label: 'Aangemaakte taken' },
    { key: 'groceries', label: 'Aangemaakte boodschappen' },
    { key: 'mealIdeas', label: 'Aangemaakte gerechten' },
    { key: 'notes', label: 'Aangemaakte berichten' }
  ];
  const creations = collections.map(({ key, label }) => {
    const inRange = (state[key] || []).filter(item =>
      validBackupDate(item.createdAt) && item.createdAt >= member.createdAt && item.createdAt <= dateKey(end) &&
      (demoMode ? typeof item.createdByMemberId === 'string' : item.createdByUserId != null));
    const count = inRange.filter(item => creator != null && (demoMode
      ? item.createdByMemberId === creator
      : String(item.createdByUserId) === String(creator))).length;
    return { label, count, percentage: inRange.length ? Math.round(count / inRange.length * 100) : 0 };
  });
  return { scheduled, completed, completedLate, creations };
}

function localCreationMetadata() {
  const metadata = { createdAt: dateKey(new Date()) };
  if (demoMode) {
    const member = currentMember();
    if (member) metadata.createdByMemberId = member.id;
  } else {
    metadata.createdByUserId = currentUserId;
  }
  return metadata;
}

function createdDateLabel(member) {
  return validBackupDate(member.createdAt)
    ? formatDate(parseDate(member.createdAt), { day: 'numeric', month: 'long', year: 'numeric' })
    : 'datum niet bekend';
}

function renderMemberStatistics(member) {
  const statistics = memberStatistics(member);
  return `<div class="page-heading"><div><h1>Statistieken: ${escapeHtml(member.name)}</h1><p>${statistics ? `Vanaf ${createdDateLabel(member)} tot en met vandaag.` : 'De aanmaakdatum van dit gezinslid is nog niet bekend.'}</p></div><a class="button secondary" href="#gezin">← Terug naar ons gezin</a></div>
    ${statistics ? `<div class="stats member-statistics">
      <div class="stat"><span class="stat-icon">◷</span><div><strong>${statistics.scheduled}</strong><small>Ingeplande taken</small></div></div>
      <div class="stat"><span class="stat-icon">✓</span><div><strong>${statistics.completed}</strong><small>Uitgevoerde taken</small></div></div>
      <div class="stat"><span class="stat-icon">!</span><div><strong>${statistics.completedLate}</strong><small>Te laat uitgevoerde taken</small></div></div>
      ${statistics.creations.map(({ label, count, percentage }) => `<div class="stat"><span class="stat-icon">＋</span><div><strong>${count}</strong><small>${escapeHtml(label)} · ${percentage}% van gezin</small></div></div>`).join('')}
    </div><p class="member-statistics-note">Taken zijn geteld op basis van de huidige planning en opgeslagen afvinkjes. Te laat uitgevoerde taken worden toegerekend aan de gezinsleden voor wie ze op de geplande dag waren ingepland, ongeacht wie ze heeft afgevinkt. De percentages zijn het aandeel van alle geregistreerde aanmaakacties in die categorie sinds de aanmaakdatum. Oudere items zonder makerregistratie tellen niet mee. Voor makerstatistieken moet het account via het e-mailadres aan een gezinslid zijn gekoppeld.</p>` : '<div class="panel member-statistics-empty">Er zijn nog geen statistieken te berekenen. Vul de aanmaakdatum in via <a href="#gezin">Ons gezin</a> → <strong>Gegevens bewerken</strong>.</div>'}`;
}

function renderDashboard() {
  const date = parseDate(selectedDate);
  const today = parseDate(dateKey(new Date()));
  const start = monday(date);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const weekTasks = weekDates.flatMap(day => tasksOn(day).map(task => ({ task, day })));
  const importantTasks = weekTasks.filter(item => item.task.important).length;
  const todayTasks = tasksOn(date);
  const plannedTasksToday = tasksOn(today);
  const doneToday = plannedTasksToday.filter(task => isDone(task, today)).length;
  const birthdays = birthdaysOn(date);
  const memberLoads = state.members.map((member, index) => ({
    member,
    index,
    tasks: todayTasks.filter(task => membersOn(task, date).some(assigned => assigned.id === member.id))
  }));
  const freeTasks = todayTasks.filter(task => task.freeToTake);
  const dailyLoads = memberLoads.map(({ member, tasks }) => ({ member, count: tasks.length }));
  const weeklyLoads = state.members.map(member => ({
    member,
    count: weekTasks.filter(({ task, day }) => membersOn(task, day).some(assigned => assigned.id === member.id)).length
  }));
  const week = isoWeek(date);
  const range = `${formatDate(start, { day: 'numeric', month: 'short' })} – ${formatDate(weekDates[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `
    <div class="page-heading"><div><h1>${escapeHtml(state.customization.welcomeTitle)} <span style="color:#9cbd9f">✳</span></h1><p>${escapeHtml(state.customization.welcomeText)}</p></div>${isChild() ? '' : '<button class="button" data-action="new-task"><span class="plus">+</span> Taak toevoegen</button>'}</div>
    <section class="hero">
      <button type="button" class="hero-copy hero-today" data-action="today" aria-label="Weekplanner op vandaag zetten"><div class="eyebrow">SAMEN VOOR EEN FIJN THUIS</div><h2>Een opgeruimd huis,<br><em>een beetje meer rust.</em></h2><p>Alle taken en plannen voor jullie gezin, overzichtelijk op één plek.</p></button>
      <span class="hero-badge">♡ &nbsp; SAMEN DOEN</span>
      <div class="hero-art" aria-hidden="true"><svg viewBox="0 0 260 210" fill="none" stroke="currentColor" stroke-width="2"><circle cx="142" cy="104" r="77"/><path d="M75 132l67-57 67 57M90 119v65h104v-65M129 184v-40h27v40M65 184h154"/><path d="M48 183c-3-25-10-37-23-44 20 2 29 14 29 35m-6 10c4-26 14-38 27-43-10 14-15 28-15 43M217 184c1-21 7-35 21-43-6 16-9 27-9 43"/><path d="M95 60l3-10 4 10 10 3-10 4-4 10-3-10-10-4zM200 71l2-7 3 7 7 3-7 3-3 7-2-7-7-3z"/></svg></div>
    </section>
    <div class="stats">
      <div class="stat"><span class="stat-icon">◷</span><div><strong>${plannedTasksToday.length}</strong><small>Geplande taken vandaag</small></div></div>
      <div class="stat"><span class="stat-icon">✓</span><div><strong>${doneToday}</strong><small>Afgerond vandaag</small></div></div>
      <div class="stat"><span class="stat-icon">!</span><div><strong>${importantTasks}</strong><small>Belangrijke taken deze week</small></div></div>
    </div>
    <div class="dashboard-grid">
      <section><div class="section-heading"><div><h2>De week in beeld</h2><p>Een klein beetje planning, een groot verschil.</p></div><button class="button" data-action="today">Vandaag</button></div>
        <div class="panel"><div class="calendar-head"><div><strong>Week ${week} <span style="color:#9eaca0;font-weight:400">· ${week % 2 ? 'oneven' : 'even'} week</span></strong><small>${escapeHtml(range)}</small></div><div class="calendar-controls"><button class="icon-button" data-action="previous-week" aria-label="Vorige week">‹</button><button class="icon-button" data-action="next-week" aria-label="Volgende week">›</button></div></div>
          <div class="weekdays">${weekDates.map(day => {
            const dayBirthdays = birthdaysOn(day);
            const count = tasksOn(day).length;
            const label = `${formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })} · ${count} ${count === 1 ? 'taak' : 'taken'}${dayBirthdays.length ? ` · ${dayBirthdays.length} ${dayBirthdays.length === 1 ? 'verjaardag' : 'verjaardagen'}` : ''}`;
            return `<button class="day ${dateKey(day) === selectedDate ? 'selected' : ''}" data-action="select-day" data-date="${dateKey(day)}" aria-label="${escapeHtml(label)}" aria-pressed="${dateKey(day) === selectedDate}"><span class="day-name">${DAYS[(day.getDay() + 6) % 7]}</span><span class="day-number">${day.getDate()}</span><span class="day-markers" aria-hidden="true">${count ? `<span class="day-dot"></span><span class="day-task-count">${count}</span>` : ''}${dayBirthdays.length ? '<span class="birthday-marker">🎂</span>' : ''}</span></button>`;
          }).join('')}</div>
          <div class="day-detail"><div class="day-detail-head"><strong>${escapeHtml(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong><span>${todayTasks.length} ${todayTasks.length === 1 ? 'taak' : 'taken'}</span></div>
            ${birthdays.map(member => `<div class="birthday-row"><span class="birthday-icon" aria-hidden="true">🎂</span><div><strong>Verjaardag van ${escapeHtml(member.name)}</strong><small>${date.getFullYear() - parseDate(member.birthDate).getFullYear()} jaar</small></div></div>`).join('')}
            ${memberLoads.filter(group => group.tasks.length).map(({ member, index, tasks }) => `<section class="day-task-group"><div class="day-task-member"><h3 class="day-task-member-heading"><span aria-hidden="true">${avatar(member, index)}</span><span>${escapeHtml(member.name)}</span></h3>${speakButton('speak-member', member.id, member.name, 'Naam voorlezen')}</div>${renderTaskRows(tasks, date, member.id)}</section>`).join('')}
            ${freeTasks.length ? `<section class="day-task-group"><h3>Voor iedereen</h3>${renderTaskRows(freeTasks, date)}</section>` : ''}
            ${!todayTasks.length && !birthdays.length ? `<div class="empty"><span class="empty-icon">☼</span><strong>Een lekker lege planning</strong>Plan een taak in en hij verschijnt hier.</div>` : ''}
          </div>
        </div>
      </section>
      <section><div class="section-heading"><div><h2>Ons gezin</h2><p>Samen staan we sterker.</p></div><a class="text-button" href="#gezin">Bekijken →</a></div>
        <div class="panel family-panel">${state.members.length ? state.members.map((member, index) => `<div class="family-row">${avatar(member, index)}<div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(memberDetails(member))}${member.email ? ` · ${escapeHtml(member.email)}` : ''}</small></div></div>`).join('') : '<div class="empty">Voeg een gezinslid toe om te beginnen.</div>'}</div>
        ${memberLoads.length ? `<div class="load-distributions">${renderLoadDistribution('Verdeling per gezinslid · dag', dailyLoads)}${renderLoadDistribution('Verdeling per gezinslid · week', weeklyLoads)}</div>` : ''}
        <div class="tip"><span class="tip-icon">✧</span><div><strong>Goed om te weten</strong><p>De taken uit jullie lijst staan al klaar. Wijs ze toe, plan ze vrij in of kies voor iedereen.</p><a class="text-button" href="#taken" style="padding-left:0">Bekijk alle taken →</a></div></div>
      </section>
      <section class="dashboard-notes"><div class="section-heading"><div><h2>Notities</h2><p>Deel een mededeling met het gezin.</p></div><div class="note-section-actions"><a class="text-button" href="#notitiearchief">Archief beheren →</a><button type="button" class="button" data-action="new-note"><span class="plus">+</span> Notitie toevoegen</button></div></div>
        <div class="panel notes-panel">
          <div class="note-list">${renderNoteCards(state.notes.filter(note => !note.archived), 'active')}</div>
        </div>
      </section>
    </div>`;
}

function renderNoteCards(notes, type) {
  if (!notes.length) {
    return type === 'active'
      ? '<div class="empty"><strong>Nog geen notities</strong>Plaats hieronder een notitie voor het gezin.</div>'
      : '<div class="empty"><strong>Het archief is leeg</strong>Gearchiveerde notities verschijnen hier.</div>';
  }
  const sortedNotes = [...notes].sort((a, b) => Number(b.important === true) - Number(a.important === true));
  return sortedNotes.map(note => {
    const noteId = escapeHtml(note.id);
    const actions = type === 'active'
      ? `<button type="button" data-action="edit-note" data-id="${noteId}">Bewerken</button><button type="button" data-action="archive-note" data-id="${noteId}">Archiveren</button>`
      : `<button type="button" data-action="restore-note" data-id="${noteId}">Herstellen</button><button type="button" data-action="delete-note" data-id="${noteId}">Definitief verwijderen</button>`;
    return `<article class="note-card ${note.important ? 'important-note' : ''}"><div class="note-card-heading"><h3>${note.important ? '<span class="note-important-mark" aria-label="Belangrijke notitie" title="Belangrijke notitie">!</span>' : ''}${escapeHtml(note.title)}</h3><div class="note-card-actions">${type === 'active' ? speakButton('speak-note', note.id, note.title, 'Notitie voorlezen') : ''}${isChild() ? '' : `<div class="note-menu-wrap"><button type="button" class="note-menu-trigger" data-action="toggle-note-menu" aria-label="Acties voor ${escapeHtml(note.title)}" aria-expanded="false">⋯</button><div class="note-actions-menu" hidden>${actions}</div></div>`}</div></div><p>${escapeHtml(note.description).replace(/\n/g, '<br>')}</p><small>Door ${escapeHtml(note.author)}${note.editedBy ? ` · Bewerkt door ${escapeHtml(note.editedBy)}${note.editedAt ? ` op ${escapeHtml(new Date(note.editedAt).toLocaleString('nl-BE'))}` : ''}` : ''}</small></article>`;
  }).join('');
}

function renderNoteArchive() {
  const archived = state.notes.filter(note => note.archived);
  return `<div class="page-heading"><div><h1>Notitiearchief</h1><p>${isChild() ? 'Bekijk gearchiveerde notities.' : 'Herstel een gearchiveerde notitie of verwijder die definitief.'}</p></div><a class="button secondary" href="#overzicht">Terug naar overzicht</a></div>
    <div class="panel notes-panel"><div class="note-list">${renderNoteCards(archived, 'archived')}</div></div>`;
}

function closeNoteMenus() {
  document.querySelectorAll('.note-actions-menu:not([hidden])').forEach(menu => {
    menu.hidden = true;
    menu.parentElement.querySelector('.note-menu-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function openNewNote() {
  document.querySelector('#modal-content').innerHTML = `<form id="note-create-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">Nieuwe notitie</h2><p>Deel een bericht met het gezin.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div><div class="form-grid"><div class="field full"><label for="note-title">Titel</label><input id="note-title" name="title" required maxlength="120" placeholder="Titel van de notitie"></div><div class="field full"><label for="note-description">Beschrijving</label><textarea id="note-description" name="description" required maxlength="2000" rows="5" placeholder="Schrijf een notitie voor het gezin"></textarea></div><div class="field full"><label class="note-important-option"><input type="checkbox" name="important"><span>Markeer als belangrijk</span></label></div></div><div id="note-error" role="alert"></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Notitie plaatsen</button></div></form>`;
  document.querySelector('#modal').showModal();
  document.querySelector('#note-title').focus();
}

function openNote(id) {
  const existing = state.notes.find(note => note.id === id);
  if (!existing) return;
  document.querySelector('#modal-content').innerHTML = `<form id="note-edit-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">Notitie bewerken</h2><p>Door ${escapeHtml(existing.author)}</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div><div class="form-grid"><div class="field full"><label for="edit-note-title">Titel</label><input id="edit-note-title" name="title" required maxlength="120" value="${escapeHtml(existing.title)}"></div><div class="field full"><label for="edit-note-description">Beschrijving</label><textarea id="edit-note-description" name="description" required maxlength="2000" rows="5">${escapeHtml(existing.description)}</textarea></div><div class="field full"><label class="note-important-option"><input type="checkbox" name="important" ${existing.important ? 'checked' : ''}><span>Markeer als belangrijk</span></label></div></div><div class="modal-actions"><button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#note-edit-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const title = capitalizedField(form.elements.title);
    if (title === null) return;
    const description = form.elements.description.value.trim();
    if (!title || !description) {
      const field = title ? form.elements.description : form.elements.title;
      field.setCustomValidity('Vul een titel en beschrijving in.');
      field.reportValidity();
      return;
    }
    const editor = currentAuthorName();
    const editedByAuthor = existing.authorUserId != null
      ? String(existing.authorUserId) === currentUserId
      : editor === existing.author;
    const important = form.elements.important.checked;
    const changed = title !== existing.title || description !== existing.description || important !== (existing.important === true);
    const updated = {
      ...existing,
      title,
      description,
      important,
      editedBy: changed ? (editedByAuthor ? '' : editor) : existing.editedBy,
      editedByUserId: changed ? (editedByAuthor ? '' : currentUserId) : existing.editedByUserId,
      editedAt: changed ? (editedByAuthor ? '' : new Date().toISOString()) : existing.editedAt
    };
    const nextState = { ...state, notes: state.notes.map(note => note.id === existing.id ? updated : note) };
    if (await save(nextState)) {
      state = nextState;
      document.querySelector('#modal').close();
      render();
      showToast('Notitie opgeslagen');
    }
  });
  document.querySelector('#modal').showModal();
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
  return `<div class="page-heading"><div><h1>Alle taken</h1><p>Alles wat er thuis gebeurt, op één plek.</p></div>${isChild() ? '' : '<button class="button" data-action="new-task"><span class="plus">+</span> Taak toevoegen</button>'}</div>
    <div class="list-toolbar"><div class="search"><input id="task-search" type="search" placeholder="Zoek een taak..." aria-label="Zoek een taak" value="${escapeHtml(taskSearch)}">${taskSearch ? '<button type="button" class="search-clear" data-action="clear-task-search" aria-label="Zoekveld leegmaken">×</button>' : ''}</div><select id="frequency-filter" aria-label="Filter op frequentie"><option value="all">Alle frequenties</option>${Object.entries(FREQUENCIES).map(([value, label]) => `<option value="${value}" ${frequencyFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="member-filter" aria-label="Filter op gezinslid"><option value="all">Iedereen</option><option value="unassigned" ${memberFilter === 'unassigned' ? 'selected' : ''}>Niet toegewezen</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}" ${memberFilter === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter op planningsstatus"><option value="all">Alle statussen</option><option value="scheduled" ${statusFilter === 'scheduled' ? 'selected' : ''}>Ingepland</option><option value="unscheduled" ${statusFilter === 'unscheduled' ? 'selected' : ''}>Niet ingepland</option></select></div>
    <div class="list-summary">${filtered.length} ${filtered.length === 1 ? 'taak' : 'taken'}</div><div class="panel list-panel"><table class="task-table"><thead><tr><th scope="col">Taak</th><th scope="col" class="status-column" aria-sort="${statusSort === 'none' ? 'none' : statusSort === 'scheduled-first' ? 'ascending' : 'descending'}"><button type="button" class="status-sort" data-action="sort-status" aria-label="Sorteer op planningsstatus, ${sortLabel}">Status <span aria-hidden="true">${statusSort === 'none' ? '↕' : statusSort === 'scheduled-first' ? '↑' : '↓'}</span></button></th><th scope="col" class="frequency-column">Frequentie</th></tr></thead><tbody>${filtered.length ? filtered.map(task => {
      const scheduled = isScheduled(task);
      const status = scheduled ? 'Ingepland' : 'Niet ingepland';
      const taskTag = isChild() ? 'div' : 'button';
      return `<tr class="${isChild() ? '' : 'task-list-row'}" ${isChild() ? '' : `data-action="edit-task" data-id="${escapeHtml(task.id)}"`}><td><${taskTag} ${isChild() ? '' : `type="button" aria-label="${escapeHtml(task.title)}${task.important ? ' — belangrijk' : ''} — ${status} — bewerken"`} class="task-list-item"><span class="stat-icon" style="width:34px;height:34px;font-size:15px">✓</span><span class="task-info"><strong>${escapeHtml(task.title)}${task.important ? '<span class="important-icon" title="Belangrijke taak" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><circle cx="8" cy="8" r="7"/><path class="important-icon-mark" d="M8 3.8v5.1M8 11.5v.1"/></svg></span>' : ''}</strong><small>${!task.schedules && (task.frequency === 'monthly' || task.frequency === 'yearly') ? `${membersForAssignment(task.memberIds || (task.memberId ? [task.memberId] : [])).map(member => member.name).join(', ') || 'Niet toegewezen'} · ` : ''}${escapeHtml(taskSchedule(task))}${task.group ? ` · ${escapeHtml(task.group)}` : ''}</small></span></${taskTag}></td><td class="status-column"><span class="schedule-status ${scheduled ? 'scheduled' : 'unscheduled'}">${status}</span></td><td class="frequency-column"><span class="frequency-tag">${frequencyLabel(task)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="3"><div class="empty" style="margin:20px 0">Geen taken gevonden.</div></td></tr>'}</tbody></table></div>`;
}

function renderFamily() {
  const roles = { owner: 'Ouder', parent: 'Ouder', partner: 'Ouder', child: 'Kind' };
  return `<div class="page-heading"><div><h1>Ons gezin</h1><p>Iedereen draagt op zijn eigen manier bij.</p></div>${isChild() ? '' : '<button class="button" data-action="new-member"><span class="plus">+</span> Gezinslid toevoegen</button>'}</div>
    <div class="members-grid">${state.members.map((member, index) => `<div class="panel member-card">${avatar(member, index)}<h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(memberDetails(member))}${member.email ? `<br>${escapeHtml(member.email)}` : ''}<br>${state.tasks.filter(task => assignedMemberIds(task).includes(member.id)).length} toegewezen taken</p><p class="member-created"><strong>Aangemaakt:</strong> ${escapeHtml(createdDateLabel(member))}</p><a class="text-button member-stats-link" href="#statistieken/${encodeURIComponent(member.id)}">Statistieken bekijken →</a>${isChild() ? '' : `<button class="text-button" data-action="edit-member" data-id="${escapeHtml(member.id)}">Gegevens bewerken →</button>`}</div>`).join('')}</div>
    ${demoMode ? '<div class="panel backup-panel"><h2>Gezinsaccounts</h2><p>Uitnodigingen en wachtwoordreset zijn beschikbaar nadat je een account hebt aangemaakt.</p></div>' : `<section class="household-access">
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
    </section>`}`;
}

function renderGroceries() {
  const remaining = state.groceries.filter(item => !item.done).length;
  const sortedGroceries = [...state.groceries].sort((a, b) => Number(a.done) - Number(b.done) || Number(b.urgent === true) - Number(a.urgent === true));
  return `<div class="page-heading"><div><h1>Boodschappen</h1><p>Wat is op, of wat wil je graag in huis halen?</p></div></div>
    <div class="panel groceries-panel">
      <form id="groceries-form" class="groceries-form"><label class="sr-only" for="grocery-name">Boodschap</label><input id="grocery-name" name="name" required maxlength="120" placeholder="Voeg iets toe aan de lijst"><button class="button" type="submit"><span class="plus">+</span> Toevoegen</button></form>
      <p class="list-summary">${remaining} ${remaining === 1 ? 'boodschap' : 'boodschappen'} te halen</p>
      ${sortedGroceries.length ? sortedGroceries.map(item => `<div class="task-row ${item.done ? 'done' : ''}"><input type="checkbox" class="check" data-action="grocery-done" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} gekocht" ${item.done ? 'checked' : ''}><div class="task-info"><strong>${escapeHtml(item.name)}</strong></div>${isChild() ? (item.urgent ? '<span class="grocery-urgent-label">Dringend</span>' : '') : `<button type="button" class="grocery-urgent" data-action="toggle-grocery-urgent" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} dringend" aria-pressed="${item.urgent === true}" title="${item.urgent ? 'Dringend: klik om te wijzigen' : 'Markeer als dringend'}"><span aria-hidden="true">${item.urgent ? '⚑' : '⚐'}</span><span class="grocery-urgent-label">${item.urgent ? 'Dringend' : 'Niet dringend'}</span></button><button type="button" class="text-button grocery-delete" data-action="delete-grocery" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} verwijderen">Verwijderen</button>`}</div>`).join('') : '<div class="empty"><strong>Je lijst is leeg</strong>Voeg toe wat jullie nodig hebben.</div>'}
    </div>`;
}

function renderMealIdeas() {
  const sortedIdeas = [...state.mealIdeas].sort((a, b) => b.wishedBy.length - a.wishedBy.length);
  return `<div class="page-heading"><div><h1>Kookinspiratie</h1><p>Bewaar gerechten en ontdek waar iedereen zin in heeft.</p></div></div>
    <div class="panel groceries-panel meal-ideas-panel">
      <form id="meal-ideas-form" class="groceries-form"><label class="sr-only" for="meal-idea-name">Gerecht of voeding</label><input id="meal-idea-name" name="name" required maxlength="120" placeholder="Voeg een gerecht of voeding toe"><button class="button" type="submit"><span class="plus">+</span> Toevoegen</button></form>
      ${sortedIdeas.length ? `<div class="meal-ideas-list">${sortedIdeas.map((idea, index) => `<div class="meal-idea"><div class="meal-title"><span class="meal-rank" aria-label="Rang ${index + 1}">${index + 1}.</span>${mealAvatar(idea)}<div class="meal-heading"><strong class="meal-name">${escapeHtml(idea.name)}</strong><a class="recipe-search" href="https://www.google.com/search?${new URLSearchParams({ q: `recept ${idea.name}` })}" target="_blank" rel="noopener noreferrer">Recept zoeken ↗</a></div>${speakButton('speak-meal', idea.id, idea.name, 'Gerecht voorlezen', mealSpeechText(idea, index + 1))}</div>
        ${state.members.length ? `<fieldset class="meal-wishes"><legend class="sr-only">Wie heeft er zin in ${escapeHtml(idea.name)}?</legend>${state.members.map(member => `<label><input type="checkbox" class="check" data-action="meal-wish" data-id="${escapeHtml(idea.id)}" data-member-id="${escapeHtml(member.id)}" ${idea.wishedBy.includes(member.id) ? 'checked' : ''}><span>${escapeHtml(member.name)}</span></label>`).join('')}</fieldset>` : '<p class="meal-empty-members">Voeg een gezinslid toe om wensen aan te duiden.</p>'}
        <span class="meal-count ${idea.wishedBy.length > state.members.length / 2 ? 'majority' : ''}">${idea.wishedBy.length} ${idea.wishedBy.length === 1 ? 'persoon' : 'personen'}${idea.wishedBy.length > state.members.length / 2 ? ' · Meerderheid' : ''}</span>
        ${isChild() ? '' : `<button type="button" class="text-button meal-delete" data-action="delete-meal-idea" data-id="${escapeHtml(idea.id)}" aria-label="${escapeHtml(idea.name)} verwijderen">Verwijderen</button>`}</div>`).join('')}</div>` : '<div class="empty"><strong>Nog geen kookinspiratie</strong>Voeg een gerecht of voeding toe.</div>'}
    </div>`;
}

function renderBackup() {
  return `<div class="page-heading"><div><h1>Instellingen</h1><p>${isChild() ? 'Kies jouw kleurenpalet.' : 'Personaliseer de teksten en beheer de back-up van jullie gezinsgegevens.'}</p></div></div>
    <form id="palette-form" class="panel backup-panel palette-panel">
      <h2>Jouw kleurenpalet</h2>
      <p>${demoMode ? 'Probeer een kleurenpalet uit voor deze tijdelijke demo.' : 'Deze keuze geldt alleen voor jouw login en verandert de weergave voor de rest van het gezin niet.'}</p>
      <div class="palette-options" role="radiogroup" aria-label="Kleurenpalet">${COLOR_PALETTES.map(palette => `<label class="palette-option ${colorPalette === palette.id ? 'selected' : ''}"><input type="radio" name="colorPalette" value="${palette.id}" ${colorPalette === palette.id ? 'checked' : ''}><span class="palette-preview" data-palette="${palette.id}" aria-hidden="true"><i></i><i></i><i></i></span><span class="palette-option-copy"><strong>${palette.label}</strong><small>${palette.description}</small></span></label>`).join('')}</div>
      <div id="palette-error" role="alert"></div>
      <button class="button" type="submit">Kleurenpalet opslaan</button>
    </form>
    ${isChild() ? '' : `<form id="customization-form" class="panel backup-panel">
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
    ${demoMode ? '<div class="panel backup-panel"><h2>Back-up</h2><p>Back-ups downloaden en terugzetten zijn beschikbaar met een account, niet in de demo.</p></div>' : `<div class="panel backup-panel"><h2>Back-up downloaden</h2><p>Download een JSON-bestand met gezinsleden, taken, planningen, afvinkjes, boodschappen, kookinspiratie en notities. Bewaar dit bestand op een veilige plek: het bevat persoonlijke gegevens.</p><button class="button" data-action="export-backup">Back-up downloaden</button></div>
    <div class="panel backup-panel"><h2>Back-up terugzetten</h2><p>Een back-up terugzetten vervangt de huidige gegevens van je account. Download eventueel eerst een back-up van de huidige gegevens.</p><label for="backup-file" class="field-label">JSON-bestand kiezen</label><input id="backup-file" type="file" accept=".json,application/json"><button class="button secondary" data-action="import-backup">Back-up terugzetten</button></div>`}`}`;
}

function renderHelp() {
  return `<div class="page-heading"><div><h1>Help</h1><p>Praktische uitleg over het gebruik van jullie huishoudapp.</p></div></div>
    <div class="help-content">
      ${demoMode ? '<section class="panel help-panel"><h2>Demomodus</h2><p>Je gebruikt fictieve gegevens. Wijzigingen en je kleurenkeuze blijven alleen tijdens deze demo in dit tabblad. Bij afsluiten of herladen verdwijnen ze. Uitnodigingen, wachtwoordreset en back-ups zijn alleen beschikbaar met een account.</p></section>' : ''}
      <section class="panel help-panel"><h2>Aanmelden en samen gebruiken</h2>
        <p>Log in met je e-mailadres en wachtwoord. Een ouder kan via <a href="#gezin">Ons gezin</a> een partner of kind uitnodigen met een persoonlijke link. De genodigde kiest zelf een wachtwoord. Een geaccepteerde uitnodiging geeft toegang tot hetzelfde gezinsdashboard.</p>
        <p>Is een gezinslid het wachtwoord vergeten? Een ouder kan bij <a href="#gezin">Gezinsaccounts</a> een eenmalige resetlink maken en deze rechtstreeks met die gebruiker delen. De link verloopt na een uur; de gebruiker kiest zelf het nieuwe wachtwoord.</p>
        <p>De uitnodigingslink is zeven dagen geldig. Deel hem alleen met de bedoelde persoon. Kindaccounts kunnen geen bestaande gezinsleden bewerken of verwijderen, gezinsleden uitnodigen of uitnodigingen intrekken. Ze kunnen taken alleen afvinken, boodschappen en gerechten toevoegen en afvinken, en notities plaatsen. Bestaande boodschappen, gerechten en notities verwijderen of wijzigen is voorbehouden aan ouders.</p>
      </section>
      <section class="panel help-panel"><h2>Overzicht en taken</h2>
        <p>Op <a href="#overzicht">Overzicht</a> zie je de weekplanning, taken en verjaardagen. Kies een dag in de agenda of gebruik de pijlen om naar een andere week te gaan. De taken van de gekozen dag staan gegroepeerd per verantwoordelijke. Vink een taak af wanneer die klaar is.</p>
        <p>Naast de weekplanning zie je de gezinsleden; daaronder staan gedeelde notities als post-its. Kies <strong>Notitie toevoegen</strong> om in een venster een titel en beschrijving in te vullen. De auteur wordt automatisch ingevuld. Zet eventueel <strong>Markeer als belangrijk</strong> aan; dit staat standaard uit. Belangrijke notities krijgen een uitroepteken en staan bovenaan.</p>
        <p>Open het driepuntjesmenu op een post-it om die te bewerken of te archiveren. Bij bewerken door een ander gezinslid worden diens naam en bewerktijd vermeld. Gearchiveerde notities verdwijnen van het overzicht. Via <a href="#notitiearchief">Notitiearchief</a> kun je ze herstellen of definitief verwijderen.</p>
        <p>Op <a href="#taken">Alle taken</a> kun je een taak openen om de planning te wijzigen. Kies per dag, week, maand of eenmalige datum wie de taak uitvoert. Standaard wijs je de taak aan één gezinslid toe; zet <strong>Gedeelde taak</strong> aan om meerdere personen te selecteren. Zet <strong>Vrij in te plannen</strong> aan om een taak zonder vaste dag te plannen; de taak blijft deze periode in de planning staan tot ze is afgerond. Je kunt dit combineren met <strong>Voor iedereen</strong>. De taak verschijnt dan onderaan de planning, zonder verantwoordelijke. Na afronden verschijnt ze weer in de volgende periode. Zonder die combinatie verschijnt de taak op de reguliere frequentiedag en schuift ze dagelijks door zolang die openstaat. Markeer in het taakformulier belangrijke taken; die herken je aan het label <strong>Belangrijk</strong>. Gebruik de zoekbalk en filters om taken terug te vinden.</p>
        <p>Vink je een taak na de geplande dag af, dan krijgt die het label <strong>Te laat uitgevoerd</strong>. Bij elk gezinslid kun je via <strong>Statistieken bekijken</strong> zien hoeveel taken die persoon te laat ingepland had; dit wordt niet gekoppeld aan het account dat de taak heeft afgevinkt.</p>
      </section>
      <section class="panel help-panel"><h2>Gezinsleden</h2>
        <p>Voeg op <a href="#gezin">Ons gezin</a> gezinsleden toe en bewerk hun naam, geboortedatum en optioneel e-mailadres. Een geboortedatum wordt gebruikt om de leeftijd te tonen en verjaardagen op het overzicht te markeren.</p>
        <p>Om iemand een eigen login te geven, kies je bij de uitnodiging een bestaand gezinslid of maak je een uitnodiging voor een nieuw gezinslid. Vul het login-e-mailadres in en deel de link. Na acceptatie wordt het e-mailadres van een gekoppeld gezinslid gelijk aan het e-mailadres van de login.</p>
      </section>
      <section class="panel help-panel"><h2>Boodschappen en kookinspiratie</h2>
        <p>Op <a href="#boodschappen">Boodschappen</a> voeg je producten toe. Vink ze af na aankoop, markeer ze zo nodig als dringend of verwijder ze als ze niet meer nodig zijn.</p>
        <p>Op <a href="#kookinspiratie">Kookinspiratie</a> bewaar je gerechten en vink je per gezinslid aan wie er zin in heeft. De lijst sorteert gerechten met de meeste wensen bovenaan. Gebruik **Recept zoeken** bij een gerecht om online recepten ervoor te vinden.</p>
      </section>
      <section class="panel help-panel"><h2>Instellingen en gegevens bewaren</h2>
        <p>Ouders kunnen bij <a href="#instellingen">Instellingen</a> de websitetitel, de ondertekst van het logo en de welkomst- en zijpaneelteksten aanpassen en back-ups beheren. Kindaccounts zien alleen de kleurinstellingen. De teksten zijn zichtbaar voor het hele gezin.</p>
        <p>Kies bij Instellingen een van de kleurenpaletten <strong>Bosgroen</strong>, <strong>Oceaanblauw</strong>, <strong>Lavendel</strong> of <strong>Terracotta</strong>. Het kleurenpalet wordt per login bewaard, geldt ook in donkere modus en verandert niets voor andere gezinsleden. De keuze wordt niet opgenomen in een back-up.</p>
        <p>Je kunt daar ook een JSON-back-up downloaden of terugzetten. Terugzetten vervangt de huidige gezinsgegevens; maak eventueel eerst een back-up. Bewaar het bestand veilig, want het bevat persoonlijke gegevens.</p>
      </section>
      <section class="panel help-panel"><h2>Wijzigingen op meerdere apparaten</h2>
        <p>Wijzigingen worden op de server opgeslagen en zijn beschikbaar voor alle gezinsaccounts. Een ander geopend tabblad wordt niet automatisch bijgewerkt. Bij het opslaan probeert de app afzonderlijke wijzigingen automatisch samen te voegen. Als dezelfde gegevens gewijzigd zijn of samenvoegen niet veilig is, meldt de app een conflict. Herlaad dan om de meest recente gegevens te bekijken.</p>
      </section>
    </div>`;
}

function render() {
  if (!state) return;
  const accountName = document.querySelector('#account-name');
  const member = currentMember();
  accountName.textContent = demoMode ? '' : member?.name || 'Gezinslid';
  accountName.title = !demoMode && !member ? 'Vul je inlogadres in bij je gegevens onder Ons gezin.' : '';
  const [requestedView, encodedMemberId] = location.hash.slice(1).split('/');
  if (requestedView === 'backup') {
    location.hash = 'instellingen';
    return;
  }
  let statisticsMember;
  if (requestedView === 'statistieken' && encodedMemberId) {
    try {
      const memberId = decodeURIComponent(encodedMemberId);
      statisticsMember = state.members.find(item => item.id === memberId);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  const view = statisticsMember ? 'statistieken' : ['overzicht', 'taken', 'gezin', 'instellingen', 'help', 'boodschappen', 'kookinspiratie', 'notitiearchief'].includes(requestedView) ? requestedView : 'overzicht';
  document.querySelector('#content').innerHTML = view === 'taken' ? renderTasks() : view === 'gezin' ? renderFamily() : view === 'statistieken' ? renderMemberStatistics(statisticsMember) : view === 'instellingen' ? renderBackup() : view === 'help' ? renderHelp() : view === 'boodschappen' ? renderGroceries() : view === 'kookinspiratie' ? renderMealIdeas() : view === 'notitiearchief' ? renderNoteArchive() : renderDashboard();
  document.querySelector('#brand-title').textContent = state.customization.websiteTitle;
  document.querySelector('#brand-subtitle').textContent = state.customization.brandSubtitle;
  document.querySelector('.brand').setAttribute('aria-label', `${state.customization.websiteTitle}, naar overzicht`);
  document.querySelector('#auth-title').textContent = state.customization.websiteTitle;
  document.title = `${state.customization.websiteTitle} — samen voor een fijn thuis`;
  document.querySelector('#sidebar-custom-title').textContent = state.customization.sidebarTitle;
  document.querySelector('#sidebar-custom-text').textContent = state.customization.sidebarText;
  document.querySelectorAll('.navigation a').forEach(link => link.classList.toggle('active', link.dataset.view === (view === 'statistieken' ? 'gezin' : view)));
  document.querySelector('#breadcrumb-current').textContent = view === 'gezin' ? 'ONS GEZIN' : view === 'statistieken' ? 'ONS GEZIN / STATISTIEKEN' : view === 'taken' ? 'ALLE TAKEN' : view === 'instellingen' ? 'INSTELLINGEN' : view === 'help' ? 'HELP' : view === 'boodschappen' ? 'BOODSCHAPPEN' : view === 'kookinspiratie' ? 'KOOKINSPIRATIE' : view === 'notitiearchief' ? 'NOTITIEARCHIEF' : 'OVERZICHT';
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
    (member.createdAt != null && (!validBackupDate(member.createdAt) || member.createdAt > dateKey(new Date()))) ||
    (member.birthDate != null && (!validBackupDate(member.birthDate) || member.birthDate > dateKey(new Date()))) ||
      (member.birthYear != null && (!Number.isInteger(member.birthYear) || member.birthYear < 1900 || member.birthYear > new Date().getFullYear())) ||
      (member.age != null && (!Number.isInteger(member.age) || member.age < 0 || member.age > 130))) throw new Error('Een gezinslid bevat ongeldige gegevens.');
    memberIds.add(member.id);
  }
  const validAssignment = value => value === '' || id(value);
  const validAssignments = validTaskAssignments;
  const validSchedule = schedule => {
    if (!object(schedule) || (!Object.hasOwn(FREQUENCIES, schedule.frequency) && schedule.frequency !== 'occasional') || !optionalString(schedule.memberId) ||
      (schedule.memberId && !validAssignment(schedule.memberId)) ||
      (schedule.freeToTake !== undefined && typeof schedule.freeToTake !== 'boolean') ||
      (schedule.freeSince != null && (!validBackupDate(schedule.freeSince) || schedule.freeSince > dateKey(new Date()))) ||
      (schedule.flexibleSince != null && (!validBackupDate(schedule.flexibleSince) || schedule.flexibleSince > dateKey(new Date()))) ||
      (schedule.allowMultipleMembers !== undefined && typeof schedule.allowMultipleMembers !== 'boolean') ||
      (schedule.memberIds != null && (!Array.isArray(schedule.memberIds) ||
        !validAssignments(schedule.memberIds))) ||
      (schedule.days != null && (!Array.isArray(schedule.days) || !schedule.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7))) ||
      (schedule.week != null && !['all', 'even', 'odd'].includes(schedule.week)) ||
      (schedule.weekday != null && (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7)) ||
      (schedule.monthDay != null && (!Number.isInteger(schedule.monthDay) || schedule.monthDay < 1 || schedule.monthDay > 31)) ||
      (schedule.date != null && schedule.date !== '' && !validBackupDate(schedule.date))) return false;
    if (schedule.dailyAssignments != null && (!object(schedule.dailyAssignments) ||
      !Object.entries(schedule.dailyAssignments).every(([day, value]) => /^[1-7]$/.test(day) && validAssignments(value)))) return false;
    if (schedule.weeklyAssignments != null && (!object(schedule.weeklyAssignments) ||
      !['even', 'odd'].every(week => validAssignments(schedule.weeklyAssignments[week])))) return false;
    return true;
  };
  const taskIds = new Set();
  for (const task of data.tasks) {
    if (!object(task) || !id(task.id) || taskIds.has(task.id) || typeof task.title !== 'string' || !task.title.trim() ||
      !optionalString(task.group) || !validSchedule(task) ||
      (task.important !== undefined && typeof task.important !== 'boolean') ||
      (task.flexibleSchedule !== undefined && typeof task.flexibleSchedule !== 'boolean') ||
      (task.schedules != null && (!Array.isArray(task.schedules) || !task.schedules.length ||
        !task.schedules.every(part => validSchedule(part) && typeof part.title === 'string' && part.title.trim())))) {
      const taskLabel = typeof task?.title === 'string' && task.title.trim() ? ` "${task.title}"` : '';
      throw new Error(`Taak${taskLabel} bevat ongeldige gegevens of een ongeldig schema.`);
    }
    taskIds.add(task.id);
  }
  for (const [key, value] of Object.entries(data.completed)) {
    const parts = key.split('|');
    const completionKeys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
    const validActor = actor => actor == null || typeof actor === 'string' && actor.trim() !== '' ||
      typeof actor === 'number' && Number.isSafeInteger(actor) && actor > 0;
    const validRecord = record => {
      if (!object(record)) return false;
      const fields = Object.keys(record);
      return fields.length >= 1 && fields.every(field =>
        ['completedAt', 'completedByUserId', 'completedByMemberId'].includes(field)) &&
        validBackupDate(record.completedAt) &&
        validActor(record.completedByUserId) && validActor(record.completedByMemberId);
    };
    const validMemberCompletions = value && object(value.memberCompletions) &&
      completionKeys.length === 1 && completionKeys[0] === 'memberCompletions' &&
      Object.keys(value.memberCompletions).length > 0 &&
      Object.entries(value.memberCompletions).every(([memberId, record]) =>
        id(memberId) && (record === true || validRecord(record)));
    if (parts.length !== 2 || !taskIds.has(parts[0]) || !validBackupDate(parts[1]) ||
        typeof value !== 'boolean' && !validMemberCompletions && !validRecord(value)) {
      throw new Error('Een afvinkje bevat ongeldige gegevens.');
    }
  }
  if (data.groceries !== undefined && !Array.isArray(data.groceries)) throw new Error('De boodschappenlijst is ongeldig.');
  const groceryIds = new Set();
  for (const item of data.groceries ?? []) {
    if (!object(item) || !id(item.id) || groceryIds.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.done !== 'boolean' || (item.urgent !== undefined && typeof item.urgent !== 'boolean')) {
      throw new Error('Een boodschap bevat ongeldige gegevens.');
    }
    groceryIds.add(item.id);
  }
  if (data.notes !== undefined) {
    if (!Array.isArray(data.notes)) throw new Error('De notities zijn ongeldig.');
    const noteIds = new Set();
    for (const note of data.notes) {
      if (!object(note) || !id(note.id) || noteIds.has(note.id) ||
        typeof note.title !== 'string' || !note.title.trim() || note.title.length > 120 ||
        typeof note.description !== 'string' || !note.description.trim() || note.description.length > 2000 ||
        typeof note.author !== 'string' || !note.author.trim() || note.author.length > 254 ||
        typeof note.archived !== 'boolean' ||
        (note.important !== undefined && typeof note.important !== 'boolean') ||
        (note.authorUserId != null && !['string', 'number'].includes(typeof note.authorUserId)) ||
        (note.editedByUserId != null && !['string', 'number'].includes(typeof note.editedByUserId)) ||
        (note.editedBy != null && (typeof note.editedBy !== 'string' || note.editedBy.length > 254)) ||
        (note.editedAt != null && (typeof note.editedAt !== 'string' || (note.editedAt !== '' && !Number.isFinite(Date.parse(note.editedAt)))))) {
        throw new Error('Een notitie bevat ongeldige gegevens.');
      }
      noteIds.add(note.id);
    }
  }
  if (data.mealIdeas !== undefined) validateMealIdeas(data.mealIdeas, data.members);
  return { ...data, customization: { ...CUSTOM_TEXT_DEFAULTS, ...data.customization }, groceries: data.groceries ?? [], notes: (data.notes ?? []).map(note => ({ ...note, important: note.important === true })), mealIdeas: data.mealIdeas === undefined ? [] : data.mealIdeas, tasks: data.tasks.map(task => {
    const normalized = normalizeTask(task);
    if (normalized.schedules) normalized.schedules = normalized.schedules.map(normalizeTask);
    return normalized;
  }) };
}

function exportBackup() {
  const backup = { format: BACKUP_FORMAT, version: 1, data: state };
  const contents = JSON.stringify(backup, null, 2);
  const filename = `huishouden-backup-${dateKey(new Date())}.json`;
  if (window.HouseholdAndroid?.saveBackup) {
    window.HouseholdAndroid.saveBackup(filename, contents);
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
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
  if (!await save(restored, { mergeOnConflict: false })) return;
  state = restored;
  taskSearch = '';
  frequencyFilter = 'all';
  memberFilter = 'all';
  statusFilter = 'all';
  statusSort = 'none';
  render();
  showToast('Back-up teruggezet');
}

function assignmentChoices(name, selectedIds, allowMultipleMembers) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : selectedIds ? [selectedIds] : []);
  if (!allowMultipleMembers) {
    const selectedId = selected.values().next().value || '';
    return `<select name="${name}"><option value="">Niet ingepland</option>${state.members.map(member => `<option value="${escapeHtml(member.id)}" ${selectedId === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select>`;
  }
  return `<div class="member-assignment-list">${state.members.length ? state.members.map(member => `<label><input type="checkbox" name="${name}" value="${escapeHtml(member.id)}" ${selected.has(member.id) ? 'checked' : ''}><span>${escapeHtml(member.name)}</span></label>`).join('') : '<span class="field-help">Voeg eerst een gezinslid toe.</span>'}</div>`;
}

function scheduleFields(task, allowMultipleMembers = false, freeToTake = false, flexibleSchedule = false) {
  const memberWord = allowMultipleMembers ? 'Gezinsleden' : 'Gezinslid';
  const selectionHelp = allowMultipleMembers
    ? 'Selecteer iedereen die de taak uitvoert; elk gezinslid vinkt de taak apart af'
    : 'Kies wie de taak uitvoert';
  if (freeToTake) {
    if (flexibleSchedule) {
      const period = task.frequency === 'daily' ? 'dag' : task.frequency === 'weekly' ? 'week' : task.frequency === 'monthly' ? 'maand' : 'jaar';
      return `<div class="field full"><span class="field-help">Deze taak is voor iedereen. Ze staat onderaan de planning en blijft deze ${period} staan tot ze is afgerond.</span></div>`;
    }
    if (task.frequency === 'daily') return '<div class="field full"><span class="field-help">Deze taak verschijnt dagelijks onderaan de planning en schuift door tot iemand hem afvinkt.</span></div>';
    if (task.frequency === 'weekly') return `<div class="field full"><label for="weekday">Dag van de week</label><select id="weekday" name="weekday">${DAYS.map((day, index) => `<option value="${index + 1}" ${task.weekday === index + 1 ? 'selected' : ''}>${day}</option>`).join('')}</select><span class="field-help">De taak verschijnt wekelijks op deze dag en schuift daarna dagelijks door tot iemand hem afvinkt.</span></div>`;
    if (task.frequency === 'monthly') return `<div class="field full"><label for="monthDay">Dag van de maand</label><input id="monthDay" name="monthDay" type="number" min="1" max="31" value="${task.monthDay}" required><span class="field-help">Bestaat deze dag niet in een maand, dan wordt de taak die maand overgeslagen. Een open taak schuift dagelijks door tot iemand hem afvinkt.</span></div>`;
    return `<div class="field full"><label for="date">Dag en maand</label><input id="date" name="date" type="date" value="${escapeHtml(task.date)}"><span class="field-help">De taak verschijnt jaarlijks op deze dag en maand; het gekozen jaar wordt genegeerd. Een open taak schuift dagelijks door tot iemand hem afvinkt.</span></div>`;
  }
  if (flexibleSchedule) {
    const period = task.frequency === 'daily' ? 'dag' : task.frequency === 'weekly' ? 'week' : task.frequency === 'monthly' ? 'maand' : 'jaar';
    const memberField = `<div class="field full"><span class="field-label">${memberWord}</span>${assignmentChoices('memberIds', task.memberIds || (task.memberId ? [task.memberId] : []), allowMultipleMembers)}<span class="field-help">${selectionHelp}. Er is geen vaste dag: de taak blijft deze ${period} in de planning staan tot ze is afgerond.</span></div>`;
    return memberField;
  }
  if (task.frequency === 'daily') return `<div class="field full"><span class="field-label">${memberWord} per dag</span><span class="field-help">${selectionHelp}. Laat een dag leeg om die over te slaan.</span><div class="assignment-grid">${DAYS.map((day, index) => `<div class="field"><span class="field-label">${day}</span>${assignmentChoices(`day-${index + 1}`, task.dailyAssignments[index + 1], allowMultipleMembers)}</div>`).join('')}</div></div>`;
  if (task.frequency === 'weekly') return `<div class="field full"><label for="weekday">Dag van de week</label><select id="weekday" name="weekday">${DAYS.map((day, index) => `<option value="${index + 1}" ${task.weekday === index + 1 ? 'selected' : ''}>${day}</option>`).join('')}</select><span class="field-help">${selectionHelp} per soort week. Laat een week leeg om die over te slaan.</span></div><div class="field"><span class="field-label">Even weken</span>${assignmentChoices('week-even', task.weeklyAssignments.even, allowMultipleMembers)}</div><div class="field"><span class="field-label">Oneven weken</span>${assignmentChoices('week-odd', task.weeklyAssignments.odd, allowMultipleMembers)}</div>`;
  const memberField = `<div class="field full"><span class="field-label">${memberWord}</span>${assignmentChoices('memberIds', task.memberIds || (task.memberId ? [task.memberId] : []), allowMultipleMembers)}<span class="field-help">${selectionHelp}</span></div>`;
  if (task.frequency === 'monthly') return `${memberField}<div class="field full"><label for="monthDay">Dag van de maand</label><input id="monthDay" name="monthDay" type="number" min="1" max="31" value="${task.monthDay}" required><span class="field-help">Bestaat deze dag niet in een maand, dan wordt de taak die maand overgeslagen.</span></div>`;
  return `${memberField}<div class="field full"><label for="date">Dag en maand (optioneel)</label><input id="date" name="date" type="date" value="${escapeHtml(task.date)}"><span class="field-help">De taak wordt jaarlijks op deze dag en maand ingepland; het gekozen jaar wordt genegeerd. Zonder datum blijft de taak in de takenlijst staan.</span></div>`;
}

function readSchedule(task, data, allowMultipleMembers, freeToTake = false, flexibleSchedule = false) {
  const assignmentIds = name => {
    const ids = [...new Set(data.getAll(name).map(String).filter(id => id !== ''))];
    return allowMultipleMembers ? ids : ids.slice(0, 1);
  };
  if (flexibleSchedule) {
    task.memberIds = assignmentIds('memberIds');
    task.memberId = task.memberIds[0] || '';
    return;
  }
  if (task.frequency === 'daily') {
    if (!freeToTake) task.dailyAssignments = Object.fromEntries(DAYS.map((_, index) => [index + 1, assignmentIds(`day-${index + 1}`)]));
  } else if (task.frequency === 'weekly') {
    task.weekday = Number(data.get('weekday'));
    if (!freeToTake) task.weeklyAssignments = {
      even: assignmentIds('week-even'),
      odd: assignmentIds('week-odd')
    };
  } else {
    if (!freeToTake) {
      task.memberIds = assignmentIds('memberIds');
      task.memberId = task.memberIds[0] || '';
    }
    if (task.frequency === 'monthly') task.monthDay = Number(data.get('monthDay')) || 1;
    if (task.frequency === 'yearly') task.date = String(data.get('date') || '');
  }
}

function clearTaskAssignments(task) {
  for (const schedule of task.schedules ? [task, ...task.schedules] : [task]) {
    schedule.memberIds = [];
    schedule.memberId = '';
    schedule.dailyAssignments = Object.fromEntries(DAYS.map((_, index) => [index + 1, []]));
    schedule.weeklyAssignments = { even: [], odd: [] };
  }
}

function openTask(id) {
  const existing = state.tasks.find(task => task.id === id);
  const task = existing ? normalizeTask(structuredClone(existing)) : normalizeTask({ title: '', frequency: 'daily', group: '', memberId: '', days: [], week: 'all', weekday: 1, monthDay: 1, date: '' });
  const initiallyFreeToTake = task.freeToTake;
  const initiallyFlexibleSchedule = task.flexibleSchedule;
  let scheduleIndex = 0;
  let activeSchedule = task.schedules ? task.schedules[0] : task;
  document.querySelector('#modal-content').innerHTML = `<form id="task-form" class="modal-inner"><div class="modal-head"><div><h2 id="modal-title">${existing ? 'Taak bewerken' : 'Nieuwe taak'}</h2><p>Maak het samen een beetje makkelijker.</p></div><button type="button" class="close" data-action="close-modal" aria-label="Sluiten">×</button></div>
    <div class="form-grid"><div class="field full"><label for="title">Naam van de taak</label><input id="title" name="title" value="${escapeHtml(task.title)}" required maxlength="200" placeholder="Bijvoorbeeld: tafel afruimen"></div>
    <div class="task-options-row"><div class="field"><label for="frequency">Frequentie</label><select id="frequency" name="frequency">${Object.entries(FREQUENCIES).map(([value, label]) => `<option value="${value}" ${activeSchedule.frequency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="task-flag-options"><label class="important-checkbox"><input type="checkbox" name="important" ${task.important ? 'checked' : ''}> Markeer als belangrijk</label><label class="important-checkbox"><input type="checkbox" name="freeToTake" ${task.freeToTake ? 'checked' : ''}> Voor iedereen</label><label class="important-checkbox"><input type="checkbox" name="flexibleSchedule" ${task.flexibleSchedule ? 'checked' : ''}> Vrij in te plannen</label><label id="multiple-members-option" class="important-checkbox" style="${task.freeToTake ? 'display:none' : ''}"><input type="checkbox" name="allowMultipleMembers" ${task.allowMultipleMembers ? 'checked' : ''}> Gedeelde taak</label></div></div>
    ${task.schedules ? `<div class="field full"><label for="schedule-index">Schema bewerken</label><select id="schedule-index">${task.schedules.map((part, index) => `<option value="${index}">${index + 1}. ${escapeHtml(part.title)} (${FREQUENCIES[part.frequency]})</option>`).join('')}</select><span class="field-help">Bij overlap heeft het eerste passende schema voorrang. Wijzigingen aan alle schema's worden samen opgeslagen.</span></div>` : ''}
      <div id="schedule-fields" class="field full" style="display:contents">${scheduleFields(activeSchedule, task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule)}</div></div>
    <div class="modal-actions">${existing ? '<button type="button" class="button danger" data-action="delete-task">Verwijderen</button>' : ''}<button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#task-form');
    const renderActiveSchedule = () => {
      document.querySelector('#schedule-fields').innerHTML = scheduleFields(activeSchedule, task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
      document.querySelector('#multiple-members-option').style.display = task.freeToTake ? 'none' : '';
    };
    form.elements.frequency.addEventListener('change', () => {
      readSchedule(activeSchedule, new FormData(form), task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
      activeSchedule.frequency = form.elements.frequency.value;
      renderActiveSchedule();
    });
    form.elements.freeToTake.addEventListener('change', () => {
      readSchedule(activeSchedule, new FormData(form), task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
      task.freeToTake = form.elements.freeToTake.checked;
      if (task.freeToTake) clearTaskAssignments(task);
      renderActiveSchedule();
    });
    form.elements.flexibleSchedule.addEventListener('change', () => {
      readSchedule(activeSchedule, new FormData(form), task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
      if (form.elements.flexibleSchedule.checked && !task.flexibleSchedule) {
        const assignedIds = activeSchedule.frequency === 'daily'
          ? Object.values(activeSchedule.dailyAssignments).flat()
          : activeSchedule.frequency === 'weekly'
            ? Object.values(activeSchedule.weeklyAssignments).flat()
            : activeSchedule.memberIds;
        const uniqueAssignedIds = [...new Set(assignedIds)];
        activeSchedule.memberIds = task.allowMultipleMembers ? uniqueAssignedIds : uniqueAssignedIds.slice(0, 1);
        activeSchedule.memberId = activeSchedule.memberIds[0] || '';
      }
      task.flexibleSchedule = form.elements.flexibleSchedule.checked;
      renderActiveSchedule();
    });
    form.elements.allowMultipleMembers.addEventListener('change', () => {
      readSchedule(activeSchedule, new FormData(form), task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
      task.allowMultipleMembers = form.elements.allowMultipleMembers.checked;
      if (!task.allowMultipleMembers) {
        for (const schedule of schedulesFor(task)) {
          schedule.memberIds = (schedule.memberIds || (schedule.memberId ? [schedule.memberId] : [])).slice(0, 1);
          schedule.memberId = schedule.memberIds[0] || '';
          for (const assignments of [schedule.dailyAssignments, schedule.weeklyAssignments]) {
            Object.keys(assignments).forEach(key => {
              const ids = Array.isArray(assignments[key]) ? assignments[key] : assignments[key] ? [assignments[key]] : [];
              assignments[key] = ids.slice(0, 1);
            });
          }
        }
      }
      renderActiveSchedule();
    });
  form.querySelector('#schedule-index')?.addEventListener('change', event => {
    const monthDay = form.querySelector('#monthDay');
    if (monthDay && !monthDay.reportValidity()) { event.target.value = String(scheduleIndex); return; }
    readSchedule(activeSchedule, new FormData(form), task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
    scheduleIndex = Number(event.target.value);
    activeSchedule = task.schedules[scheduleIndex];
    form.elements.frequency.value = activeSchedule.frequency;
    renderActiveSchedule();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const title = capitalizedField(form.elements.title);
    if (title === null) return;
    if (!title) { form.elements.title.setCustomValidity('Vul een naam in.'); form.elements.title.reportValidity(); return; }
    task.allowMultipleMembers = form.elements.allowMultipleMembers.checked;
    readSchedule(activeSchedule, data, task.allowMultipleMembers, task.freeToTake, task.flexibleSchedule);
    const updated = { ...task, id: existing?.id || crypto.randomUUID(), title, important: data.has('important'),
      ...(!existing ? localCreationMetadata() : {}) };
    updated.freeToTake = data.has('freeToTake');
    updated.flexibleSchedule = data.has('flexibleSchedule');
    if (updated.freeToTake) {
      clearTaskAssignments(updated);
      updated.freeSince = initiallyFreeToTake
        ? task.freeSince || task.createdAt || dateKey(new Date())
        : dateKey(new Date());
    } else {
      delete updated.freeSince;
    }
    if (updated.flexibleSchedule) {
      updated.flexibleSince = initiallyFlexibleSchedule
        ? task.flexibleSince || task.createdAt || dateKey(new Date())
        : dateKey(new Date());
    } else delete updated.flexibleSince;
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
    <div class="form-grid"><div class="field"><label for="member-name">Naam</label><input id="member-name" name="name" required maxlength="80" value="${escapeHtml(existing?.name || '')}"></div><div class="field"><label for="birth-date">Geboortedatum</label><input id="birth-date" name="birthDate" type="date" min="1900-01-01" max="${dateKey(new Date())}" value="${escapeHtml(existing?.birthDate || '')}">${!existing?.birthDate && existing?.birthYear != null ? `<span class="field-help">Eerder opgegeven geboortejaar: ${escapeHtml(existing.birthYear)}. Vul de volledige geboortedatum in voor de juiste leeftijd.</span>` : !existing?.birthDate && existing?.age != null ? `<span class="field-help">Eerder opgegeven leeftijd: ${escapeHtml(existing.age)} jaar. Vul de geboortedatum in om dit te vervangen.</span>` : ''}</div>${existing ? `<div class="field"><label for="member-created-at">Aangemaakt op</label><input id="member-created-at" name="createdAt" type="date" max="${dateKey(new Date())}" value="${escapeHtml(existing.createdAt || '')}"><span class="field-help">Bij oudere gezinsleden kan de datum ontbreken. Vul hier de juiste datum in als je die weet.</span></div>` : ''}<div class="field full"><label for="member-email">E-mailadres (optioneel)</label><input id="member-email" name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(existing?.email || '')}" placeholder="naam@voorbeeld.nl"><span class="field-help">Het e-mailadres waarmee dit gezinslid inlogt, indien diegene een eigen account heeft.</span></div></div>
    <div class="modal-actions">${existing ? '<button type="button" class="button danger" data-action="delete-member">Verwijderen</button>' : ''}<button type="button" class="button secondary" data-action="close-modal">Annuleren</button><button type="submit" class="button">Opslaan</button></div></form>`;
  const form = document.querySelector('#member-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = capitalizedField(form.elements.name);
    if (name === null) return;
    if (!name) { form.elements.name.setCustomValidity('Vul een naam in.'); form.elements.name.reportValidity(); return; }
    const birthDate = form.elements.birthDate.value || null;
    const email = form.elements.email.value.trim().toLowerCase();
    if (email && !form.elements.email.validity.valid) {
      form.elements.email.setCustomValidity('Vul een geldig e-mailadres in.');
      form.elements.email.reportValidity();
      return;
    }
    form.elements.email.setCustomValidity('');
    const member = { ...existing, id: existing?.id || crypto.randomUUID(), name, birthDate, email: email || null, createdAt: existing ? form.elements.createdAt.value : dateKey(new Date()) };
    if (!member.createdAt) delete member.createdAt;
    if (birthDate !== null) { delete member.birthYear; delete member.age; }
    if (existing) state.members[state.members.indexOf(existing)] = member;
    else state.members.push(member);
    if (await save()) { document.querySelector('#modal').close(); render(); showToast('Gezinslid opgeslagen'); }
  });
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  form.elements.email.addEventListener('input', () => form.elements.email.setCustomValidity(''));
  form.querySelector('[data-action="delete-member"]')?.addEventListener('click', async () => {
    if (!confirm(`${existing.name} verwijderen? De toewijzing aan deze persoon wordt verwijderd; andere toewijzingen blijven behouden.`)) return;
    const nextState = {
      ...state,
      members: state.members.filter(member => member.id !== existing.id),
      tasks: structuredClone(state.tasks),
      mealIdeas: state.mealIdeas.map(idea => ({ ...idea, wishedBy: idea.wishedBy.filter(id => id !== existing.id) }))
    };
    nextState.tasks.forEach(task => {
      for (const part of schedulesFor(task)) {
        part.memberIds = (part.memberIds || (part.memberId ? [part.memberId] : [])).filter(id => id !== existing.id);
        part.memberId = part.memberIds[0] || '';
        for (const assignments of [part.dailyAssignments, part.weeklyAssignments]) {
          Object.keys(assignments).forEach(key => {
            const ids = Array.isArray(assignments[key]) ? assignments[key] : assignments[key] ? [assignments[key]] : [];
            assignments[key] = ids.filter(id => id !== existing.id);
          });
        }
      }
    });
    if (await save(nextState)) { state = nextState; document.querySelector('#modal').close(); render(); showToast('Gezinslid verwijderd'); }
  });
  document.querySelector('#modal').showModal();
}

document.addEventListener('focusin', event => {
  if (!event.target.closest('.note-menu-wrap')) closeNoteMenus();
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const trigger = document.querySelector('.note-menu-trigger[aria-expanded="true"]');
  if (trigger) {
    closeNoteMenus();
    trigger.focus();
  }
});

const modalDialog = document.querySelector('#modal');
modalDialog.addEventListener('close', () => {
  pendingTaskCompletion = null;
});
modalDialog.addEventListener('click', event => {
  if (event.target === modalDialog) modalDialog.close();
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) {
    if (!event.target.closest('.note-menu-wrap')) closeNoteMenus();
    return;
  }
  const action = button.dataset.action;
  if (isChild() && ['new-task', 'edit-task', 'new-member', 'edit-member', 'export-backup', 'import-backup', 'reset-customization', 'toggle-grocery-urgent', 'delete-grocery', 'delete-meal-idea', 'edit-note', 'archive-note', 'restore-note', 'delete-note'].includes(action)) return;
  if (action === 'toggle-note-menu') {
    const shouldOpen = button.getAttribute('aria-expanded') !== 'true';
    closeNoteMenus();
    if (shouldOpen) {
      button.parentElement.querySelector('.note-actions-menu').hidden = false;
      button.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  closeNoteMenus();
  if (action === 'speak-task' || action === 'speak-member' || action === 'speak-meal' || action === 'speak-note') speakItem(action, button.dataset.id, button.dataset.speechText);
  if (action === 'new-note') openNewNote();
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
  if (action === 'edit-note') openNote(button.dataset.id);
  if (action === 'archive-note' || action === 'restore-note') {
    const archived = action === 'archive-note';
    const nextState = {
      ...state,
      notes: state.notes.map(note => note.id === button.dataset.id ? { ...note, archived } : note)
    };
    if (await save(nextState)) {
      state = nextState;
      render();
      showToast(archived ? 'Notitie gearchiveerd' : 'Notitie hersteld');
    }
  }
  if (action === 'delete-note') {
    const note = state.notes.find(item => item.id === button.dataset.id);
    if (!note || !confirm(`Notitie "${note.title}" definitief verwijderen?`)) return;
    const nextState = { ...state, notes: state.notes.filter(item => item.id !== note.id) };
    if (await save(nextState)) {
      state = nextState;
      render();
      showToast('Notitie definitief verwijderd');
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
  if (action === 'close-modal') {
    pendingTaskCompletion = null;
    document.querySelector('#modal').close();
  }
  if (action === 'task-completion-answer') {
    const pending = pendingTaskCompletion;
    pendingTaskCompletion = null;
    document.querySelector('#modal').close();
    if (pending) await updateTaskCompletion({ ...pending, checked: button.dataset.checked === 'true' });
  }
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
    const date = parseDate(selectedDate);
    const memberId = target.dataset.memberId;
    const checked = target.checked;
    if (isChild()) {
      target.checked = memberId ? isDone(task, date, memberId) : isDone(task, date);
      confirmTaskCompletion(task, date, memberId);
      return;
    }
    await updateTaskCompletion({ taskId: task.id, date: dateKey(date), memberId, checked });
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
  if (event.target.id === 'note-create-form') {
    event.preventDefault();
    const form = event.target;
    const errorBox = form.querySelector('#note-error');
    errorBox.textContent = '';
    const title = capitalizedField(form.elements.title);
    if (title === null) return;
    const description = form.elements.description.value.trim();
    if (!title || !description) {
      const field = title ? form.elements.description : form.elements.title;
      field.setCustomValidity('Vul een titel en beschrijving in.');
      field.reportValidity();
      return;
    }
    form.inert = true;
    const note = {
      id: crypto.randomUUID(),
      title,
      description,
      ...localCreationMetadata(),
      important: form.elements.important.checked,
      author: currentAuthorName(),
      authorUserId: currentUserId,
      archived: false,
      editedBy: '',
      editedByUserId: '',
      editedAt: ''
    };
    const nextState = { ...state, notes: [...state.notes, note] };
    if (await save(nextState)) {
      state = nextState;
      document.querySelector('#modal').close();
      render();
      showToast('Notitie geplaatst');
    }
    return;
  }
  if (event.target.id === 'palette-form') {
    event.preventDefault();
    const form = event.target;
    const paletteError = form.querySelector('#palette-error');
    paletteError.textContent = '';
    const selectedPalette = form.elements.colorPalette.value;
    if (demoMode) {
      if (!COLOR_PALETTES.some(palette => palette.id === selectedPalette)) {
        paletteError.textContent = 'Kies een geldig kleurenpalet.';
        return;
      }
      applyColorPalette(selectedPalette);
      render();
      showToast('Kleurenpalet toegepast voor deze demo');
      return;
    }
    form.inert = true;
    try {
      const result = await api('api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorPalette: selectedPalette })
      });
      applyColorPalette(result.colorPalette);
      render();
      showToast('Kleurenpalet opgeslagen voor jouw login');
    } catch (error) {
      console.error('Kleurenpalet opslaan mislukt:', error);
      paletteError.textContent = `Kleurenpalet opslaan is niet gelukt: ${error.message}`;
      form.inert = false;
    }
    return;
  }
  if (event.target.id === 'customization-form') {
    event.preventDefault();
    if (isChild()) return;
    const form = event.target;
    const customization = {};
    for (const key of Object.keys(CUSTOM_TEXT_LIMITS)) {
      const value = capitalizedField(form.elements[key]);
      if (value === null) return;
      customization[key] = value;
    }
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
  const name = capitalizedField(input);
  if (name === null) return;
  const meal = event.target.id === 'meal-ideas-form';
  if (!name) { input.setCustomValidity(meal ? 'Vul een gerecht of voeding in.' : 'Vul een boodschap in.'); input.reportValidity(); return; }
  const nextState = meal
    ? { ...state, mealIdeas: [...state.mealIdeas, { id: crypto.randomUUID(), name, wishedBy: [], ...localCreationMetadata() }] }
    : { ...state, groceries: [...state.groceries, { id: crypto.randomUUID(), name, done: false, urgent: false, ...localCreationMetadata() }] };
  if (await save(nextState)) { state = nextState; render(); document.querySelector(meal ? '#meal-idea-name' : '#grocery-name').focus(); }
});

document.addEventListener('input', event => {
  if (event.target.id === 'grocery-name' || event.target.id === 'meal-idea-name') event.target.setCustomValidity('');
  if (event.target.form?.id === 'note-create-form' || event.target.form?.id === 'note-edit-form') event.target.setCustomValidity('');
  if (event.target.form?.id === 'customization-form') event.target.setCustomValidity('');
  if (event.target.id !== 'task-search') return;
  taskSearch = event.target.value;
  const position = event.target.selectionStart;
  render();
  const search = document.querySelector('#task-search');
  search.focus();
  search.setSelectionRange(position, position);
});

document.addEventListener('change', event => {
  if (event.target.name !== 'colorPalette') return;
  document.querySelectorAll('.palette-option').forEach(option => {
    option.classList.toggle('selected', option.querySelector('input').checked);
  });
});

window.addEventListener('hashchange', render);
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (demoMode) {
    applyTheme(theme);
    return;
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  } catch (error) {
    console.error('Thema opslaan mislukt:', error);
    alert('De weergavevoorkeur kon niet worden opgeslagen. Controleer de browseropslag.');
  }
});
window.addEventListener('storage', event => {
  if (!demoMode && (event.key === THEME_KEY || event.key === null)) applyTheme(event.newValue);
});
initializeTheme();

function startDemo() {
  const demoData = {
    members: SEED_MEMBERS.map(member => ({ ...member, createdAt: dateKey(new Date()) })),
    tasks: SEED_TASKS.map((task, index) => ({ ...task, important: index === 0 })),
    completed: {},
    groceries: [
      { id: 'demo-milk', name: 'Melk', done: false, urgent: true },
      { id: 'demo-bread', name: 'Brood', done: false, urgent: false }
    ],
    mealIdeas: SEED_MEAL_IDEAS,
    notes: [{ id: 'demo-note', title: 'Welkom bij de demo', description: 'Probeer gerust taken, boodschappen en notities uit.', author: 'Demogebruiker', authorUserId: 'demo', important: true, archived: false }]
  };
  state = validateBackup({ format: BACKUP_FORMAT, version: 1, data: structuredClone(demoData) });
  demoMode = true;
  themeBeforeDemo = document.documentElement.dataset.theme;
  revision = null;
  accountEmail = 'Demogebruiker';
  currentUserId = 'demo';
  currentRole = 'owner';
  householdInfo = { members: [], invitations: [], canInvite: false };
  applyColorPalette('forest');
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#app').hidden = false;
  document.querySelector('#demo-banner').hidden = false;
  document.querySelector('#logout').textContent = 'Demo afsluiten';
  document.querySelector('#account-name').textContent = '';
  history.replaceState(null, '', `${location.pathname}#overzicht`);
  render();
}

async function openAccount() {
  const result = await api('api/state');
  householdInfo = await api('api/household');
  const preferences = await api('api/preferences');
  state = validateBackup({ format: BACKUP_FORMAT, version: 1, data: result.data });
  savedState = structuredClone(state);
  revision = result.revision;
  accountEmail = result.email;
  currentRole = result.role;
  currentUserId = String(householdInfo.members.find(member => member.email.toLowerCase() === result.email.toLowerCase())?.id || '');
  applyColorPalette(preferences.colorPalette);
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
const authPassword = authForm.elements.password;
const authPasswordToggle = document.querySelector('#auth-password-toggle');
function setAuthPasswordVisible(visible) {
  authPassword.type = visible ? 'text' : 'password';
  const label = visible ? 'Wachtwoord verbergen' : 'Wachtwoord weergeven';
  authPasswordToggle.setAttribute('aria-label', label);
  authPasswordToggle.setAttribute('aria-pressed', String(visible));
  authPasswordToggle.title = label;
}
authPasswordToggle.addEventListener('click', () => setAuthPasswordVisible(authPassword.type === 'password'));
authForm.addEventListener('reset', () => setAuthPasswordVisible(false));
const authError = document.querySelector('#auth-error');
document.querySelector('#start-demo').addEventListener('click', startDemo);
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
    if (!demoMode) await api('api/logout', { method: 'POST' });
    else {
      demoMode = false;
      applyTheme(themeBeforeDemo);
      document.querySelector('#demo-banner').hidden = true;
      document.querySelector('#logout').textContent = 'Uitloggen';
      selectedDate = dateKey(new Date());
      taskSearch = '';
      frequencyFilter = 'all';
      memberFilter = 'all';
      statusFilter = 'all';
      statusSort = 'none';
      history.replaceState(null, '', location.pathname);
    }
    state = null;
    revision = null;
    savedState = null;
    householdInfo = { members: [], invitations: [], canInvite: false };
    createdInvitationUrl = '';
    createdPasswordResetUrl = '';
    createdPasswordResetEmail = '';
    document.querySelector('#app').hidden = true;
    document.querySelector('#auth-screen').hidden = false;
    setAuthPasswordVisible(false);
    document.querySelector('#content').replaceChildren();
    document.querySelector('#account-name').textContent = '';
    document.querySelector('#account-name').title = '';
    document.querySelector('#auth-title').textContent = CUSTOM_TEXT_DEFAULTS.websiteTitle;
    document.title = `${CUSTOM_TEXT_DEFAULTS.websiteTitle} — samen voor een fijn thuis`;
    accountEmail = '';
    currentUserId = '';
    currentRole = '';
    colorPalette = 'forest';
    document.documentElement.dataset.palette = colorPalette;
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
