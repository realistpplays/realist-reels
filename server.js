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
try { db.exec('ALTER TABLE reels ADD COLUMN shares INTEGER DEFAULT 0'); } catch (e) {}
db.exec(`CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER, actor_id INTEGER, type TEXT, reel_id INTEGER, text TEXT DEFAULT '', created INTEGER, read INTEGER DEFAULT 0);`);
function notify(userId, actorId, type, reelId, text) {
  if (userId === actorId) return;
  db.prepare('INSERT INTO notifications(user_id,actor_id,type,reel_id,text,created) VALUES(?,?,?,?,?,?)').run(userId, actorId, type, reelId || null, (text || '').slice(0, 140), Date.now());
}

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
    shares: r.shares || 0,
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
  else {
    db.prepare(`INSERT INTO ${table}(user_id,reel_id) VALUES(?,?)`).run(req.userId, rid);
    if (table === 'likes') { const r0 = db.prepare('SELECT user_id FROM reels WHERE id=?').get(rid); if (r0) notify(r0.user_id, req.userId, 'like', rid, 'liked your reel'); }
  }
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
  const owner = db.prepare('SELECT user_id FROM reels WHERE id=?').get(+req.params.id);
  if (owner) notify(owner.user_id, req.userId, 'comment', +req.params.id, text);
  res.json({ comment: { id: info.lastInsertRowid, text, created: Date.now(), user: { handle: getUser(req.userId).handle, name: getUser(req.userId).name } } });
});
app.post('/api/users/:handle/follow', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE handle=?').get(req.params.handle);
  if (!u) return res.status(404).json({ error: 'no such user' });
  if (u.id === req.userId) return res.status(400).json({ error: 'cannot follow yourself' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower=? AND following=?').get(req.userId, u.id);
  if (has) db.prepare('DELETE FROM follows WHERE follower=? AND following=?').run(req.userId, u.id);
  else { db.prepare('INSERT INTO follows(follower,following) VALUES(?,?)').run(req.userId, u.id); notify(u.id, req.userId, 'follow', null, 'started following you'); }
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

// ---------- phase 2: shares, notifications, discover, import ----------
app.post('/api/reels/:id/share', auth, (req, res) => {
  db.prepare('UPDATE reels SET shares=COALESCE(shares,0)+1 WHERE id=?').run(+req.params.id);
  const reel = db.prepare('SELECT * FROM reels WHERE id=?').get(+req.params.id);
  res.json({ reel: reelOut(reel, req.userId) });
});
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT n.*, u.handle, u.name FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.created DESC LIMIT 60').all(req.userId);
  const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(req.userId).n;
  res.json({ unread, notifications: rows.map(n => ({ id: n.id, type: n.type, reel_id: n.reel_id, text: n.text, created: n.created, read: !!n.read, actor: { handle: n.handle, name: n.name } })) });
});
app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.userId);
  res.json({ ok: true });
});
app.get('/api/discover', auth, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  let users = [], reels = [];
  if (q) {
    users = db.prepare('SELECT * FROM users WHERE lower(handle) LIKE ? OR lower(name) LIKE ? LIMIT 12').all('%' + q + '%', '%' + q + '%').map(pub);
    reels = db.prepare('SELECT * FROM reels WHERE lower(caption) LIKE ? OR lower(channel) LIKE ? ORDER BY created DESC LIMIT 30').all('%' + q + '%', '%' + q + '%');
  } else {
    reels = db.prepare('SELECT r.*, (SELECT COUNT(*) FROM likes l WHERE l.reel_id=r.id) lc FROM reels r ORDER BY lc DESC, r.created DESC LIMIT 30').all();
  }
  const tagRows = db.prepare("SELECT caption FROM reels").all();
  const tags = {};
  tagRows.forEach(r => { (r.caption.match(/#[A-Za-z0-9_]+/g) || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; }); });
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count }));
  res.json({ users, reels: reels.map(r => reelOut(r, req.userId)), topTags });
});
app.post('/api/import', upload.single('video'), (req, res) => {
  const key = process.env.IMPORT_KEY;
  if (!key || req.headers['x-import-key'] !== key) return res.status(403).json({ error: 'import not authorised' });
  if (!req.file) return res.status(400).json({ error: 'No video received' });
  const u = db.prepare('SELECT * FROM users WHERE handle=?').get((req.body.handle || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'creator not found' });
  const info = db.prepare('INSERT INTO reels(user_id,channel,file,caption,sound,created) VALUES(?,?,?,?,?,?)')
    .run(u.id, (req.body.channel || '').slice(0, 40), req.file.filename, (req.body.caption || '').slice(0, 500), '', Date.now());
  res.json({ reel: reelOut(db.prepare('SELECT * FROM reels WHERE id=?').get(info.lastInsertRowid), u.id) });
});

// ---------- Muse-style interest Feed dashboard ----------
// Paul's interests as data — new interests/sources get added here (his brief: "in the future I'll add more").
const INTERESTS = [
  { id: 'football', label: 'Football', angle: 'Realist Reacts / Football Fix', feeds: [
    { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' } ] },
  { id: 'gaming', label: 'Gaming', angle: 'Gully Games', feeds: [
    { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
    { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', match: ['game', 'gaming', 'xbox', 'playstation', 'nintendo', 'fortnite', 'gta', 'roblox', 'minecraft'] } ] },
  { id: 'music', label: 'UK Rap & Music', angle: 'Realist Reacts (music)', feeds: [
    { name: 'BBC Ents & Arts', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', match: ['rap', 'drill', 'grime', 'hip-hop', 'hip hop', 'album', 'rapper', 'music', 'song', 'gig', 'festival', 'chart'] } ] },
  { id: 'viral', label: 'Viral & Real Talk', angle: 'Realist Reacts / Real Talk', feeds: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' } ] },
  { id: 'grafting', label: 'Grafting & Money', angle: 'Real Talk', feeds: [
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' } ] },
  { id: 'creator', label: 'Creator Tech', angle: 'Creator growth', feeds: [
    { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', match: ['ai', 'artificial intelligence', 'youtube', 'tiktok', 'instagram', 'video', 'creator', 'streaming', 'social media'] } ] },
];
const feedCache = { at: 0, items: [] };
const xmlDec = t => (t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
function parseRSS(xml, source) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const grab = tag => { const mm = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>')); return mm ? xmlDec(mm[1]) : ''; };
    const title = grab('title'); let link = grab('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/); link = lm ? lm[1] : ''; }
    const when = Date.parse(grab('pubDate')) || Date.now();
    out.push({ title, link, summary: grab('description').slice(0, 220), source, published: when });
    if (out.length >= 25) break;
  }
  return out;
}
async function refreshNews() {
  if (Date.now() - feedCache.at < 15 * 60 * 1000 && feedCache.items.length) return feedCache.items;
  const jobs = [];
  for (const interest of INTERESTS) for (const f of interest.feeds) jobs.push((async () => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(f.url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'RealistReels/1.0' } });
      clearTimeout(t);
      if (!r.ok) return [];
      const items = parseRSS(await r.text(), f.name);
      return items.filter(it => {
        if (!f.match) return true;
        const h = (it.title + ' ' + it.summary).toLowerCase();
        return f.match.some(k => h.includes(k));
      }).map(it => ({ ...it, category: interest.id, categoryLabel: interest.label, angle: interest.angle }));
    } catch (e) { return []; }
  })());
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set(); const ded = [];
  for (const it of all.sort((a, b) => b.published - a.published)) {
    const k = it.title.toLowerCase().slice(0, 60);
    if (seen.has(k) || !it.title) continue;
    seen.add(k); ded.push(it);
  }
  feedCache.at = Date.now(); feedCache.items = ded.slice(0, 80);
  return feedCache.items;
}
app.get('/api/newsfeed', auth, async (req, res) => {
  const items = await refreshNews();
  const cat = (req.query.cat || 'all');
  res.json({ interests: INTERESTS.map(i => ({ id: i.id, label: i.label })), items: cat === 'all' ? items : items.filter(i => i.category === cat), updated: feedCache.at });
});

app.listen(PORT, () => console.log('Realist Reels Phase 1 listening on ' + PORT));
