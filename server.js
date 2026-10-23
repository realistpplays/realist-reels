// Realist Reels — Phase 1 server (accounts, uploads, feed, likes, comments, follows)
// Node 24, Express, node:sqlite. Original code, written for Paul (2026-10-23).
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3737;
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const db = new DatabaseSync(path.join(ROOT, 'data', 'realist-reels.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, handle TEXT UNIQUE, name TEXT, pass TEXT, salt TEXT, bio TEXT DEFAULT '', created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS reels(id INTEGER PRIMARY KEY, user_id INTEGER, channel TEXT, file TEXT, caption TEXT DEFAULT '', sound TEXT DEFAULT '', created INTEGER);
CREATE TABLE IF NOT EXISTS likes(user_id INTEGER, reel_id INTEGER, PRIMARY KEY(user_id, reel_id));
CREATE TABLE IF NOT EXISTS saves(user_id INTEGER, reel_id INTEGER, PRIMARY KEY(user_id, reel_id));
CREATE TABLE IF NOT EXISTS follows(follower INTEGER, following INTEGER, PRIMARY KEY(follower, following));
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, reel_id INTEGER, user_id INTEGER, text TEXT, created INTEGER);
`);

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function makeUser(email, handle, name, pw, bio = '') {
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO users(email,handle,name,pass,salt,bio,created) VALUES(?,?,?,?,?,?,?)')
    .run(email, handle, name, hash(pw, salt), salt, bio, Date.now());
  return info.lastInsertRowid;
}
function auth(req, res, next) {
  const m = (req.headers.cookie || '').match(/rr_token=([a-f0-9]+)/);
  if (!m) return res.status(401).json({ error: 'not signed in' });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(m[1]);
  if (!s) return res.status(401).json({ error: 'session expired' });
  req.userId = s.user_id; req.token = m[1]; next();
}
const pub = u => u && ({ id: u.id, email: u.email, handle: u.handle, name: u.name, bio: u.bio || '' });
const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOADS, { acceptRanges: true }));
app.use(express.static(path.join(ROOT, 'public')));

// ---------- auth ----------
app.post('/api/signup', (req, res) => {
  let { email, password, handle, name } = req.body || {};
  email = (email || '').trim().toLowerCase();
  handle = (handle || '').trim().replace(/^@/, '').toLowerCase();
  name = (name || '').trim() || handle;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password needs 6+ characters' });
  if (!/^[a-z0-9_]{3,24}$/.test(handle)) return res.status(400).json({ error: 'Handle: 3–24 chars, letters/numbers/underscore' });
  if (db.prepare('SELECT id FROM users WHERE email=? OR handle=?').get(email, handle))
    return res.status(400).json({ error: 'That email or handle is already taken' });
  const id = makeUser(email, handle, name, password);
  startSession(res, id);
  res.json({ user: pub(getUser(id)) });
});
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').trim().toLowerCase());
  if (!u || !crypto.timingSafeEqual(Buffer.from(hash(password || '', u.salt)), Buffer.from(u.pass)))
    return res.status(401).json({ error: 'Wrong email or password' });
  startSession(res, u.id);
  res.json({ user: pub(u) });
});
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,created) VALUES(?,?,?)').run(token, userId, Date.now());
  res.setHeader('Set-Cookie', `rr_token=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
}
app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ user: pub(getUser(req.userId)) }));

// ---------- reels ----------
function reelOut(r, me) {
  const u = getUser(r.user_id);
  const c = q => db.prepare(q).get(r.id);
  return {
    id: r.id, file: '/uploads/' + r.file, channel: r.channel || '', caption: r.caption || '',
    sound: r.sound || ('original sound — ' + (u ? u.handle : '')),
    created: r.created,
    user: u ? { handle: u.handle, name: u.name } : null,
    likes: c('SELECT COUNT(*) n FROM likes WHERE reel_id=?').n,
    saves: c('SELECT COUNT(*) n FROM saves WHERE reel_id=?').n,
    shares: 0,
    comments: c('SELECT COUNT(*) n FROM comments WHERE reel_id=?').n,
    liked: !!db.prepare('SELECT 1 FROM likes WHERE user_id=? AND reel_id=?').get(me, r.id),
    saved: !!db.prepare('SELECT 1 FROM saves WHERE user_id=? AND reel_id=?').get(me, r.id),
    following: u ? !!db.prepare('SELECT 1 FROM follows WHERE follower=? AND following=?').get(me, u.id) : false,
    mine: r.user_id === me,
  };
}
app.get('/api/feed', auth, (req, res) => {
  const tab = req.query.tab === 'following' ? 'following' : 'foryou';
  let rows;
  if (tab === 'following')
    rows = db.prepare('SELECT r.* FROM reels r JOIN follows f ON f.following=r.user_id WHERE f.follower=? ORDER BY r.created DESC').all(req.userId);
  else rows = db.prepare('SELECT * FROM reels ORDER BY created DESC').all();
  res.json({ reels: rows.map(r => reelOut(r, req.userId)) });
});
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, f, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(f.originalname || '.mp4')),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, (f.mimetype || '').startsWith('video/') || /\.(mp4|mov|webm)$/i.test(f.originalname)),
});
app.post('/api/reels', auth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video received' });
  const info = db.prepare('INSERT INTO reels(user_id,channel,file,caption,sound,created) VALUES(?,?,?,?,?,?)')
    .run(req.userId, (req.body.channel || '').slice(0, 40), req.file.filename, (req.body.caption || '').slice(0, 300), '', Date.now());
  res.json({ reel: reelOut(db.prepare('SELECT * FROM reels WHERE id=?').get(info.lastInsertRowid), req.userId) });
});
app.post('/api/reels/:id/like', auth, (req, res) => toggle(req, res, 'likes'));
app.post('/api/reels/:id/save', auth, (req, res) => toggle(req, res, 'saves'));
function toggle(req, res, table) {
  const rid = +req.params.id;
  const has = db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? AND reel_id=?`).get(req.userId, rid);
  if (has) db.prepare(`DELETE FROM ${table} WHERE user_id=? AND reel_id=?`).run(req.userId, rid);
  else db.prepare(`INSERT INTO ${table}(user_id,reel_id) VALUES(?,?)`).run(req.userId, rid);
  const reel = db.prepare('SELECT * FROM reels WHERE id=?').get(rid);
  res.json({ reel: reelOut(reel, req.userId) });
}
app.get('/api/reels/:id/comments', auth, (req, res) => {
  const rows = db.prepare('SELECT c.*, u.handle, u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.reel_id=? ORDER BY c.created').all(+req.params.id);
  res.json({ comments: rows.map(c => ({ id: c.id, text: c.text, created: c.created, user: { handle: c.handle, name: c.name } })) });
});
app.post('/api/reels/:id/comments', auth, (req, res) => {
  const text = (req.body.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Empty comment' });
  const info = db.prepare('INSERT INTO comments(reel_id,user_id,text,created) VALUES(?,?,?,?)').run(+req.params.id, req.userId, text, Date.now());
  res.json({ comment: { id: info.lastInsertRowid, text, created: Date.now(), user: { handle: getUser(req.userId).handle, name: getUser(req.userId).name } } });
});
app.post('/api/users/:handle/follow', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE handle=?').get(req.params.handle);
  if (!u) return res.status(404).json({ error: 'no such user' });
  if (u.id === req.userId) return res.status(400).json({ error: 'cannot follow yourself' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower=? AND following=?').get(req.userId, u.id);
  if (has) db.prepare('DELETE FROM follows WHERE follower=? AND following=?').run(req.userId, u.id);
  else db.prepare('INSERT INTO follows(follower,following) VALUES(?,?)').run(req.userId, u.id);
  res.json({ following: !has });
});
app.get('/api/users/:handle', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE handle=?').get(req.params.handle);
  if (!u) return res.status(404).json({ error: 'no such user' });
  const reels = db.prepare('SELECT * FROM reels WHERE user_id=? ORDER BY created DESC').all(u.id);
  res.json({
    user: pub(u),
    followers: db.prepare('SELECT COUNT(*) n FROM follows WHERE following=?').get(u.id).n,
    followingCount: db.prepare('SELECT COUNT(*) n FROM follows WHERE follower=?').get(u.id).n,
    totalLikes: db.prepare('SELECT COUNT(*) n FROM likes l JOIN reels r ON r.id=l.reel_id WHERE r.user_id=?').get(u.id).n,
    following: !!db.prepare('SELECT 1 FROM follows WHERE follower=? AND following=?').get(req.userId, u.id),
    reels: reels.map(r => reelOut(r, req.userId)),
  });
});

// Auto-seed creator content on first boot (e.g. fresh Render deploy)
try {
  const n = db.prepare('SELECT COUNT(*) n FROM reels').get().n;
  if (n === 0) { require('child_process').execSync('node seed.js', { cwd: ROOT, stdio: 'inherit' }); }
} catch (e) { console.error('seed check failed', e.message); }

app.listen(PORT, () => console.log('Realist Reels Phase 1 listening on ' + PORT));
