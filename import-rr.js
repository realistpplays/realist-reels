// Import a day's Realist Reacts videos into Realist Reels.
// Usage: node import-rr.js <baseUrl> <dayFolder>   (dayFolder = .../realist-reacts/daily/YYYY-MM-DD)
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const [base, dayFolder] = process.argv.slice(2);
if (!base || !dayFolder) { console.error('usage: node import-rr.js <baseUrl> <dayFolder>'); process.exit(1); }
const key = fs.readFileSync(path.join(__dirname, '.import-key'), 'utf8').trim();
const statePath = path.join(__dirname, 'import-state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const NAMES = { music: 'Music', transfers: 'Transfer Talk', football: 'Football', realtalk: 'Real Talk', gaming: 'Gaming', viral: 'Viral Reacts', comedy: 'Comedy Skit', skit2: 'Skit' };
(async () => {
  let done = 0, skipped = 0;
  for (const slot of Object.keys(NAMES)) {
    const dir = path.join(dayFolder, slot);
    if (!fs.existsSync(dir)) continue;
    const video = fs.readdirSync(dir).find(f => /-mobile\.mp4$/.test(f)) || fs.readdirSync(dir).find(f => /\.mp4$/.test(f) && !/work/.test(f));
    if (!video) { console.log(slot, ': no video'); skipped++; continue; }
    let caption = 'Realist Reacts — ' + NAMES[slot];
    const script = path.join(dayFolder, 'scripts', slot + '.txt');
    if (fs.existsSync(script)) {
      const first = fs.readFileSync(script, 'utf8').split(/\n+/).map(x => x.trim()).filter(Boolean)[0] || '';
      if (first) caption = (NAMES[slot] + ': ' + first).slice(0, 300);
    }
    const idKey = crypto.createHash('sha1').update(base + '|rr|' + dir + '/' + video + '|' + caption).digest('hex');
    if (state[idKey]) { console.log(slot, ': already imported'); skipped++; continue; }
    const fd = new FormData();
    fd.append('video', new Blob([fs.readFileSync(path.join(dir, video))], { type: 'video/mp4' }), video);
    fd.append('handle', 'realistreacts'); fd.append('channel', 'REALIST REACTS'); fd.append('caption', caption);
    const r = await fetch(base.replace(/\/$/, '') + '/api/import', { method: 'POST', headers: { 'x-import-key': key }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(slot, ': FAILED', r.status, j.error || ''); continue; }
    state[idKey] = { reelId: j.reel.id, at: new Date().toISOString() };
    console.log(slot, ': imported as reel', j.reel.id); done++;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`RR import complete: ${done} new, ${skipped} skipped`);
})();
