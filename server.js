'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const mysql = require('mysql2/promise');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');
const { SEED_MEMBERS, SEED_TASKS, SEED_MEAL_IDEAS } = require('./seed');

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
const initialState = () => ({ members: SEED_MEMBERS, tasks: SEED_TASKS, completed: {}, groceries: [], mealIdeas: SEED_MEAL_IDEAS });

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
  const [rows] = await pool.execute('SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > UTC_TIMESTAMP()', [hashToken(token)]);
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
  let userId;
  try {
    const [result] = await pool.execute('INSERT INTO users (email, password_salt, password_hash, data, revision) VALUES (?, ?, ?, ?, 1)', [email, salt, passwordHash, JSON.stringify(initialState())]);
    userId = result.insertId;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Dit e-mailadres is al in gebruik.' });
    throw error;
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

router.post('/api/logout', authenticate, async (req, res) => {
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(req.sessionToken)]);
  res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/api/state', authenticate, async (req, res) => {
  const [rows] = await pool.execute('SELECT data, revision FROM users WHERE id = ?', [req.user.id]);
  res.json({ email: req.user.email, data: JSON.parse(rows[0].data), revision: rows[0].revision });
});

router.put('/api/state', authenticate, async (req, res) => {
  const { data, revision } = req.body || {};
  if (!Number.isSafeInteger(revision) || revision < 1 || !data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.members) || !Array.isArray(data.tasks) || !Array.isArray(data.groceries) ||
      !Array.isArray(data.mealIdeas) || !data.completed || typeof data.completed !== 'object' || Array.isArray(data.completed)) {
    return res.status(400).json({ error: 'Ongeldige gegevens of revisie.' });
  }
  const [result] = await pool.execute('UPDATE users SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [JSON.stringify(data), req.user.id, revision]);
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
    revision INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.execute('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
  const port = Number(process.env.PORT || 3000);
  app.listen(port, process.env.IP || process.env.HOST || '127.0.0.1', () => console.log(`Server luistert op poort ${port}`));
}

start().catch(error => {
  console.error('Server starten mislukt:', error);
  process.exitCode = 1;
});
