// Import a day's built reels into Realist Reels via the import API.
// Usage: node import-daily.js <baseUrl> <dayFolder> <handle> <channel>
// Reads .import-key from this folder. Tracks imported items in import-state.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [base, dayFolder, handle, channel, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',').map(s => s.trim()) : null;
if (!base || !dayFolder || !handle) { console.error('usage: node import-daily.js <baseUrl> <dayFolder> <handle> <channel>'); process.exit(1); }
const key = fs.readFileSync(path.join(__dirname, '.import-key'), 'utf8').trim();
const statePath = path.join(__dirname, 'import-state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};

(async () => {
  const dirs = fs.readdirSync(dayFolder).filter(d => /^reel-\d+$/.test(d) && (!only || only.includes(d))).sort();
  let done = 0, skipped = 0;
  for (const d of dirs) {
    const dir = path.join(dayFolder, d);
    const files = fs.readdirSync(dir);
    const video = files.find(f => /-mobile\.mp4$/.test(f)) || files.find(f => /-master\.mp4$/.test(f));
    if (!video) { console.log(d, ': no video, skipped'); skipped++; continue; }
    const caption = fs.existsSync(path.join(dir, 'caption.txt'))
      ? fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim().replace(/\s*\n\s*/g, ' ').slice(0, 480) : '';
    const idKey = crypto.createHash('sha1').update(base + '|' + dir + '/' + video + '|' + caption).digest('hex');
    if (state[idKey] && !process.env.FORCE) { console.log(d, ": already imported"); skipped++; continue; }
    const fd = new FormData();
    fd.append('video', new Blob([fs.readFileSync(path.join(dir, video))], { type: 'video/mp4' }), video);
    fd.append('handle', handle); fd.append('channel', channel || ''); fd.append('caption', caption);
    const r = await fetch(base.replace(/\/$/, '') + '/api/import', { method: 'POST', headers: { 'x-import-key': key }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(d, ': FAILED', r.status, j.error || ''); continue; }
    state[idKey] = { reelId: j.reel.id, at: new Date().toISOString() };
    console.log(d, ': imported as reel', j.reel.id);
    done++;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`import complete: ${done} new, ${skipped} skipped`);
})();
