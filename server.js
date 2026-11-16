'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const mysql = require('mysql2/promise');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');
const { SEED_MEMBERS, SEED_TASKS, SEED_MEAL_IDEAS } = require('./seed');
const { registerCreatedItems } = require('./creation-metadata');
const { childChangesAllowed } = require('./child-permissions');

const scrypt = promisify(scryptCallback);
const app = express();
const router = express.Router();
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'APP_ORIGIN'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} moet ingesteld zijn.`);
}
const origin = new URL(process.env.APP_ORIGIN);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== process.env.APP_ORIGIN) {
  throw new Error('APP_ORIGIN moet een volledige origin zonder afsluitende slash zijn.');
}
const secureCookie = origin.protocol === 'https:';
if (!secureCookie && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('APP_ORIGIN moet HTTPS gebruiken, behalve lokaal.');
}
const basePath = process.env.APP_BASE_PATH || '';
if (basePath && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) {
  throw new Error('APP_BASE_PATH moet leeg zijn of een pad zoals /household zonder afsluitende slash.');
}
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  ...(process.env.DB_SOCKET ? { socketPath: process.env.DB_SOCKET } : {}),
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
  connectionLimit: 10,
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
});

app.disable('x-powered-by');
if (basePath) {
  app.get(basePath, (req, res, next) => {
    if (req.path !== basePath) return next();
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(308, `${basePath}/${query}`);
  });
}
app.use(basePath || '/', router);
app.use((req, res, next) => {
  res.status(404).send('Niet gevonden');
});
router.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store'
  });
  next();
});
router.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin.origin) {
    return res.status(403).json({ error: 'Ongeldige herkomst van het verzoek.' });
  }
  next();
});
router.use('/api', express.json({ limit: '2mb', strict: true }));

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Te veel aanmeldpogingen. Probeer het later opnieuw.' }
});
const hashToken = token => createHash('sha256').update(token).digest('hex');
const cookieName = basePath ? 'household_session' : 'session';
const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: 'strict', path: basePath || '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
const emailValid = email => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const passwordValid = password => typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 1024;
const colorPalettes = new Set(['forest', 'ocean', 'lavender', 'terracotta']);
const notesValid = notes => Array.isArray(notes) && notes.length <= 1000 &&
  new Set(notes.map(note => note?.id)).size === notes.length &&
  notes.every(note => note && typeof note === 'object' && !Array.isArray(note) &&
    typeof note.id === 'string' && Boolean(note.id.trim()) && note.id.length <= 100 && !note.id.includes('|') &&
    typeof note.title === 'string' && Boolean(note.title.trim()) && note.title.length <= 120 &&
    typeof note.description === 'string' && Boolean(note.description.trim()) && note.description.length <= 2000 &&
    typeof note.author === 'string' && Boolean(note.author.trim()) && note.author.length <= 254 &&
    typeof note.archived === 'boolean' &&
    (note.important === undefined || typeof note.important === 'boolean') &&
    (note.authorUserId == null || ['string', 'number'].includes(typeof note.authorUserId)) &&
    (note.editedByUserId == null || ['string', 'number'].includes(typeof note.editedByUserId)) &&
    (note.editedBy == null || typeof note.editedBy === 'string' && note.editedBy.length <= 254) &&
    (note.editedAt == null || typeof note.editedAt === 'string' &&
      (note.editedAt === '' || Number.isFinite(Date.parse(note.editedAt)))));
const customizationLimits = { websiteTitle: 60, brandSubtitle: 40, welcomeTitle: 80, welcomeText: 160, sidebarTitle: 100, sidebarText: 200 };
const defaultCustomization = {
  websiteTitle: 'Ons huishouden',
  brandSubtitle: 'SAMEN THUIS',
  welcomeTitle: 'Fijn dat je er bent',
  welcomeText: 'Samen maken we van ons huis een fijne plek.',
  sidebarTitle: 'Een fijn thuis, doen we samen.',
  sidebarText: 'Een beetje overzicht maakt ruimte voor de leuke dingen.'
};
const initialState = () => ({
  members: SEED_MEMBERS.map(member => ({ ...member, createdAt: new Date().toISOString().slice(0, 10) })),
  tasks: SEED_TASKS, completed: {}, groceries: [], notes: [], mealIdeas: SEED_MEAL_IDEAS,
  customization: { ...defaultCustomization }
});

async function createHousehold(userId, connection, data = initialState(), revision = 1) {
  const [result] = await connection.execute('INSERT INTO households (owner_user_id, data, revision) VALUES (?, ?, ?)', [userId, JSON.stringify(data), revision]);
  await connection.execute("UPDATE users SET household_id = ?, household_role = 'owner' WHERE id = ?", [result.insertId, userId]);
  return result.insertId;
}

async function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  await pool.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
  await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [hashToken(token), userId]);
  res.cookie(cookieName, token, cookieOptions);
}

async function authenticate(req, res, next) {
  const cookies = (req.headers.cookie || '').split(';').map(part => part.trim());
  const token = cookies.find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Meld je opnieuw aan.' });
  const [rows] = await pool.execute('SELECT users.id, users.email, users.household_id, users.household_role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > UTC_TIMESTAMP()', [hashToken(token)]);
  if (!rows.length) return res.status(401).json({ error: 'Meld je opnieuw aan.' });
  req.user = rows[0];
  req.sessionToken = token;
  next();
}

router.post('/api/register', authLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!emailValid(email) || !passwordValid(password)) {
    return res.status(400).json({ error: 'Vul een geldig e-mailadres en een wachtwoord van minimaal 12 tekens in.' });
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
  const connection = await pool.getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO users (email, password_salt, password_hash, data, revision) VALUES (?, ?, ?, ?, 1)', [email, salt, passwordHash, JSON.stringify(initialState())]);
    userId = result.insertId;
    await createHousehold(userId, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Dit e-mailadres is al in gebruik.' });
    throw error;
  } finally {
    connection.release();
  }
  await createSession(res, userId);
  res.status(201).json({ email });
});

router.post('/api/login', authLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!emailValid(email) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) {
    return res.status(400).json({ error: 'Ongeldig e-mailadres of wachtwoord.' });
  }
  const [rows] = await pool.execute('SELECT id, password_salt, password_hash FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const calculated = await scrypt(password, user?.password_salt || '00000000000000000000000000000000', 64);
  const expected = Buffer.from(user?.password_hash || '0'.repeat(128), 'hex');
  if (!timingSafeEqual(calculated, expected) || !user) return res.status(401).json({ error: 'Ongeldig e-mailadres of wachtwoord.' });
  await createSession(res, user.id);
  res.json({ email });
});

router.get('/api/preferences', authenticate, async (req, res) => {
  const [rows] = await pool.execute('SELECT color_palette FROM users WHERE id = ?', [req.user.id]);
  res.json({ colorPalette: rows[0].color_palette });
});

router.put('/api/preferences', authenticate, async (req, res) => {
  const colorPalette = req.body?.colorPalette;
  if (!colorPalettes.has(colorPalette)) {
    return res.status(400).json({ error: 'Kies een geldig kleurenpalet.' });
  }
  await pool.execute('UPDATE users SET color_palette = ? WHERE id = ?', [colorPalette, req.user.id]);
  res.json({ colorPalette });
});

router.post('/api/password-resets', authenticate, authLimit, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!emailValid(email) || email === req.user.email) {
    return res.status(400).json({ error: 'Kies een ander account met een geldig e-mailadres.' });
  }
  if (req.user.household_role === 'child') {
    return res.status(403).json({ error: 'Alleen ouders kunnen wachtwoorden van andere gezinsaccounts resetten.' });
  }
  const token = randomBytes(32).toString('base64url');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      'SELECT id FROM users WHERE email = ? AND household_id = ? FOR UPDATE',
      [email, req.user.household_id]
    );
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Dit account is niet gevonden in je huishouden.' });
    }
    await connection.execute(
      'UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL',
      [users[0].id]
    );
    await connection.execute(
      'INSERT INTO password_resets (token_hash, user_id, household_id, requested_by_user_id, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))',
      [hashToken(token), users[0].id, req.user.household_id, req.user.id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(201).json({ token });
});

router.get('/api/password-resets/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({ error: 'Deze resetlink is ongeldig of verlopen.' });
  const [rows] = await pool.execute(
    'SELECT users.email FROM password_resets JOIN users ON users.id = password_resets.user_id WHERE password_resets.token_hash = ? AND password_resets.used_at IS NULL AND password_resets.expires_at > UTC_TIMESTAMP()',
    [hashToken(token)]
  );
  if (!rows.length) return res.status(404).json({ error: 'Deze resetlink is ongeldig of verlopen.' });
  res.json({ email: rows[0].email });
});

router.post('/api/password-resets/complete', authLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !passwordValid(password)) {
    return res.status(400).json({ error: 'Deze resetlink of dit wachtwoord is ongeldig.' });
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE',
      [hashToken(token)]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Deze resetlink is ongeldig of verlopen.' });
    }
    const userId = rows[0].user_id;
    await connection.execute('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?', [salt, passwordHash, userId]);
    await connection.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await connection.execute('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE token_hash = ?', [hashToken(token)]);
    await connection.execute(
      'UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL',
      [userId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.json({ ok: true });
});

router.post('/api/invitations', authenticate, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role;
  const memberId = req.body?.memberId;
  if (!emailValid(email) || !['parent', 'child'].includes(role) ||
      (memberId !== null && memberId !== undefined && (typeof memberId !== 'string' || !memberId.trim()))) {
    return res.status(400).json({ error: 'Vul een geldig e-mailadres en een rol in.' });
  }
  if (req.user.household_role === 'child') return res.status(403).json({ error: 'Alleen ouders kunnen gezinsleden uitnodigen.' });
  if (memberId) {
    const [households] = await pool.execute('SELECT data FROM households WHERE id = ?', [req.user.household_id]);
    const household = JSON.parse(households[0].data);
    if (!household.members.some(member => member.id === memberId)) {
      return res.status(400).json({ error: 'Kies een bestaand gezinslid of nodig een nieuw gezinslid uit.' });
    }
  }
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'Dit e-mailadres heeft al een account.' });
  const [pending] = await pool.execute('SELECT id FROM invitations WHERE household_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP()', [req.user.household_id, email]);
  if (pending.length) return res.status(409).json({ error: 'Voor dit e-mailadres staat al een uitnodiging open.' });
  const token = randomBytes(32).toString('base64url');
  await pool.execute(
    'INSERT INTO invitations (token_hash, household_id, email, role, member_id, invited_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))',
    [hashToken(token), req.user.household_id, email, role, memberId || null, req.user.id]
  );
  res.status(201).json({ token });
});

router.get('/api/invitations/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({ error: 'Deze uitnodiging is ongeldig of verlopen.' });
  const [rows] = await pool.execute(
    'SELECT email FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP()',
    [hashToken(token)]
  );
  if (!rows.length) return res.status(404).json({ error: 'Deze uitnodiging is ongeldig of verlopen.' });
  res.json({ email: rows[0].email });
});

router.post('/api/invitations/accept', authLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !passwordValid(password)) {
    return res.status(400).json({ error: 'Deze uitnodiging of dit wachtwoord is ongeldig.' });
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
  const connection = await pool.getConnection();
  let userId;
  let email;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, household_id, email, role, member_id FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP() FOR UPDATE',
      [hashToken(token)]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Deze uitnodiging is ongeldig of verlopen.' });
    }
    const invitation = rows[0];
    email = invitation.email;
    const [result] = await connection.execute(
      'INSERT INTO users (email, password_salt, password_hash, data, revision, household_id, household_role) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [invitation.email, salt, passwordHash, JSON.stringify(initialState()), invitation.household_id, invitation.role]
    );
    userId = result.insertId;
    if (invitation.member_id) {
      const [households] = await connection.execute('SELECT data, revision FROM households WHERE id = ? FOR UPDATE', [invitation.household_id]);
      const data = JSON.parse(households[0].data);
      const member = data.members.find(item => item.id === invitation.member_id);
      if (!member) {
        await connection.rollback();
        return res.status(409).json({ error: 'Het gekozen gezinslid bestaat niet meer.' });
      }
      member.email = invitation.email;
      await connection.execute('UPDATE households SET data = ?, revision = revision + 1 WHERE id = ?', [JSON.stringify(data), invitation.household_id]);
    }
    await connection.execute('UPDATE invitations SET accepted_at = UTC_TIMESTAMP() WHERE id = ?', [invitation.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Dit e-mailadres heeft al een account.' });
    throw error;
  } finally {
    connection.release();
  }
  await createSession(res, userId);
  res.status(201).json({ email });
});

router.get('/api/household', authenticate, async (req, res) => {
  const [members] = await pool.execute(
    "SELECT id, email, household_role AS role FROM users WHERE household_id = ? ORDER BY FIELD(household_role, 'owner', 'partner', 'child'), email",
    [req.user.household_id]
  );
  const [invitations] = await pool.execute(
    "SELECT id, email, role, DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt FROM invitations WHERE household_id = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY id DESC",
    [req.user.household_id]
  );
  res.json({
    members: members.map(member => ({ ...member, canReset: req.user.household_role !== 'child' && member.id !== req.user.id })),
    invitations,
    canInvite: req.user.household_role !== 'child'
  });
});

router.delete('/api/invitations/:id', authenticate, async (req, res) => {
  if (req.user.household_role === 'child' || !/^\d+$/.test(req.params.id)) {
    return res.status(403).json({ error: 'Deze uitnodiging kan niet worden ingetrokken.' });
  }
  const [result] = await pool.execute('DELETE FROM invitations WHERE id = ? AND household_id = ? AND accepted_at IS NULL', [req.params.id, req.user.household_id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Deze uitnodiging is niet meer beschikbaar.' });
  res.json({ ok: true });
});

router.post('/api/logout', authenticate, async (req, res) => {
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(req.sessionToken)]);
  res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/api/state', authenticate, async (req, res) => {
  const [rows] = await pool.execute('SELECT data, revision FROM households WHERE id = ?', [req.user.household_id]);
  res.json({ email: req.user.email, role: req.user.household_role, data: JSON.parse(rows[0].data), revision: rows[0].revision });
});

router.put('/api/state', authenticate, async (req, res) => {
  const { data, revision } = req.body || {};
  const notesInvalid = data?.notes !== undefined && !notesValid(data.notes);
  if (!Number.isSafeInteger(revision) || revision < 1 || !data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.members) || !Array.isArray(data.tasks) || !Array.isArray(data.groceries) ||
      !Array.isArray(data.mealIdeas) || !data.completed || typeof data.completed !== 'object' || Array.isArray(data.completed) ||
      notesInvalid) {
    return res.status(400).json({ error: 'Ongeldige gegevens of revisie.' });
  }
  const [currentRows] = await pool.execute('SELECT data FROM households WHERE id = ? AND revision = ?', [req.user.household_id, revision]);
  if (!currentRows.length) return res.status(409).json({ error: 'De gegevens zijn ondertussen op een ander apparaat gewijzigd.' });
  const currentData = JSON.parse(currentRows[0].data);
  if (req.user.household_role === 'child' && !childChangesAllowed(currentData, data, defaultCustomization)) {
    return res.status(403).json({ error: 'Je hebt geen toestemming voor deze wijziging.' });
  }
  const previousNotes = currentData.notes || [];
  const submittedNotes = data.notes || previousNotes;
  const author = currentData.members.find(member =>
    typeof member.email === 'string' && member.email.toLowerCase() === req.user.email.toLowerCase())?.name || req.user.email;
  const previousById = new Map(previousNotes.map(note => [note.id, note]));
  const notes = submittedNotes.map(note => {
    const previous = previousById.get(note.id);
    if (!previous) return { ...note, important: note.important === true, author, authorUserId: req.user.id, archived: false, editedBy: '', editedByUserId: '', editedAt: '' };
    const important = note.important === undefined ? previous.important === true : note.important;
    const changed = note.title !== previous.title || note.description !== previous.description || important !== (previous.important === true);
    const editorIsAuthor = previous.authorUserId != null
      ? String(previous.authorUserId) === String(req.user.id)
      : author === previous.author;
    return {
      ...note,
      important,
      author: previous.author,
      authorUserId: previous.authorUserId,
      editedBy: changed ? (editorIsAuthor ? '' : author) : previous.editedBy || '',
      editedByUserId: changed ? (editorIsAuthor ? '' : req.user.id) : previous.editedByUserId || '',
      editedAt: changed ? (editorIsAuthor ? '' : new Date().toISOString()) : previous.editedAt || ''
    };
  });
  const createdAt = new Date().toISOString().slice(0, 10);
  let nextData = { ...data, notes };
  for (const collection of ['tasks', 'groceries', 'mealIdeas', 'notes']) {
    nextData[collection] = registerCreatedItems(currentData[collection], nextData[collection], req.user.id, createdAt);
  }
  if (data.customization !== undefined) {
    if (!data.customization || typeof data.customization !== 'object' || Array.isArray(data.customization) ||
        Object.entries(customizationLimits).some(([key, limit]) =>
          typeof data.customization[key] !== 'string' || !data.customization[key].trim() || data.customization[key].length > limit)) {
      return res.status(400).json({ error: 'De persoonlijke teksten bevatten ongeldige gegevens.' });
    }
  } else {
    nextData.customization = currentData.customization || { ...defaultCustomization };
  }
  const [result] = await pool.execute('UPDATE households SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [JSON.stringify(nextData), req.user.household_id, revision]);
  if (!result.affectedRows) return res.status(409).json({ error: 'De gegevens zijn ondertussen op een ander apparaat gewijzigd.' });
  res.json({ revision: revision + 1 });
});

for (const file of ['index.html', 'style.css', 'seed.js', 'app.js']) {
  router.get(file === 'index.html' ? ['/', '/index.html'] : `/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}
router.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'De gegevens zijn te groot.' : status === 400 ? 'Ongeldig verzoek.' : 'Er is een serverfout opgetreden.' });
});

async function start() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
    password_salt CHAR(32) NOT NULL,
    password_hash CHAR(128) NOT NULL,
    data LONGTEXT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    color_palette VARCHAR(20) NOT NULL DEFAULT 'forest'
  ) ENGINE=InnoDB`);
  const [userColumns] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'");
  if (!userColumns.some(column => column.COLUMN_NAME === 'color_palette')) {
    await pool.query("ALTER TABLE users ADD COLUMN color_palette VARCHAR(20) NOT NULL DEFAULT 'forest'");
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  const [columns] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'");
  const columnNames = new Set(columns.map(column => column.COLUMN_NAME));
  if (!columnNames.has('household_id')) await pool.query('ALTER TABLE users ADD COLUMN household_id BIGINT UNSIGNED NULL');
  if (!columnNames.has('household_role')) await pool.query('ALTER TABLE users ADD COLUMN household_role VARCHAR(16) NULL');
  const [indexes] = await pool.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'household_id'");
  if (!indexes.length) await pool.query('ALTER TABLE users ADD INDEX (household_id)');
  await pool.query(`CREATE TABLE IF NOT EXISTS households (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    owner_user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    data LONGTEXT NOT NULL,
    revision INT UNSIGNED NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS invitations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    household_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    role VARCHAR(16) NOT NULL,
    invited_by_user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    accepted_at DATETIME NULL,
    INDEX (household_id, email),
    FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    household_id BIGINT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    INDEX (user_id, used_at),
    INDEX (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  const [invitationColumns] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invitations'");
  if (!invitationColumns.some(column => column.COLUMN_NAME === 'member_id')) {
    await pool.query('ALTER TABLE invitations ADD COLUMN member_id TEXT NULL AFTER role');
  }
  const [unassignedUsers] = await pool.execute('SELECT id, data, revision FROM users WHERE household_id IS NULL');
  for (const user of unassignedUsers) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute('SELECT household_id FROM users WHERE id = ? FOR UPDATE', [user.id]);
      if (existing[0]?.household_id == null) {
        await createHousehold(user.id, connection, JSON.parse(user.data), user.revision);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  await pool.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
  const port = Number(process.env.PORT || 3000);
  app.listen(port, process.env.IP || process.env.HOST || '127.0.0.1', () => console.log(`Server luistert op poort ${port}`));
}

start().catch(error => {
  console.error('Server starten mislukt:', error);
  process.exitCode = 1;
});
