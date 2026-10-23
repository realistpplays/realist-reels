// Seed creator accounts + Paul's existing reels (idempotent-ish: skips if reels exist)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, 'data', 'realist-reels.db'));
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function user(email, handle, name, bio) {
  let u = db.prepare('SELECT * FROM users WHERE handle=?').get(handle);
  if (u) return u.id;
  const salt = crypto.randomBytes(16).toString('hex');
  const locked = crypto.randomBytes(24).toString('hex'); // creator accounts are content-seeded; Paul claims them later
  return db.prepare('INSERT INTO users(email,handle,name,pass,salt,bio,created) VALUES(?,?,?,?,?,?,?)')
    .run(email, handle, name, hash(locked, salt), salt, bio, Date.now()).lastInsertRowid;
}
function reel(userId, channel, srcFile, destName, caption) {
  if (db.prepare('SELECT id FROM reels WHERE file=?').get(destName)) return;
  fs.copyFileSync(srcFile, path.join(__dirname, 'uploads', destName));
  db.prepare('INSERT INTO reels(user_id,channel,file,caption,sound,created) VALUES(?,?,?,?,?,?)')
    .run(userId, channel, destName, caption, '', Date.now());
  console.log('seeded', destName);
}
const G = process.env.SEED_DIR || __dirname + '/seed-videos';
const gully = user('gullygamez@realistreels.app', 'gullygamez', 'Gully Gamez', 'Gaming news daily. STAY REAL. STAY FOCUSED.');
reel(gully, 'GULLY GAMES', `${G}/seed-gta-vi-advert.mp4`, 'seed-gta-vi-advert.mp4', "GTA VI's first TV advert is HERE 🎮 Superfans spotted a longer Jason & Lucia moment… and the missing Xbox logo 👀");
reel(gully, 'GULLY GAMES', `${G}/seed-fortnite-iphone.mp4`, 'seed-fortnite-iphone.mp4', "Fortnite is BACK on iPhones in Australia after 6 years — and Apple's walled garden just cracked 🇦🇺🔥");
reel(gully, 'GULLY GAMES', `${G}/seed-fc27-attributes.mp4`, 'seed-fc27-attributes.mp4', "EA just wiped EVERY Pro's Attribute Points in FC 27 overnight 😤 Clubs players — you're rebuilding from scratch today.");
reel(gully, 'GULLY GAMES', `${G}/seed-bioware-wolverine.mp4`, 'seed-bioware-wolverine.mp4', 'EA closed BioWare after 31 years and Wolverine just broke a PlayStation record. Wild week in gaming. 🎮');
const rr = user('realistreacts@realistreels.app', 'realistreacts', 'Realist Reacts', 'Music, football, gaming, real talk — daily.');
reel(rr, 'REALIST REACTS', `${G}/seed-realist-reacts-intro.mp4`, 'seed-realist-reacts-intro.mp4', "I'M HERE — Welcome to Realist Reacts 👋 The channel intro.");
console.log('seed done');
