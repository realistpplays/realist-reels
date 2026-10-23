# Realist Reels — Phase 1 app

Real accounts, uploads, likes, comments, follows — Express + node:sqlite, original code.

## Run
```
./start.sh          # starts server on port 3737 (nohup; survives this session)
node seed.js        # (re)seed creator accounts + Paul's reels — safe to re-run
```
Server log: `server.log`. Database: `data/realist-reels.db`. Uploads: `uploads/`.

## Status (2026-10-23) — LIVE, Phase 2 shipped
- Phase 2 (SPEC: Social) LIVE same day: notifications (like/comment/follow → Inbox page + unread badge), Discover page (search creators/captions, hashtag chips from real captions, trending grid, tap-to-jump into feed), real share counts. Content import: POST /api/import guarded by IMPORT_KEY (set on Render; local copy in .import-key, gitignored) + `import-daily.js` (idempotent; state in import-state.json) — imported today's Gully reels 5–8 live; feed = 9 reels at Phase 2 verification.
- Content sources for the feed: (1) Paul's own pipelines — Gully Games daily folders (video + caption.txt) via the import tool, Realist Reacts dailies can use the same route; (2) in-app uploads from any account; (3) the bundled seed catalogue on fresh deploys.
- Storage: uploaded/seeded video files live on the service filesystem (uploads/), metadata in SQLite. Free-tier ephemerality still applies (see below).

## Status (2026-10-23) — LIVE
- **Public URL: https://realist-reels.onrender.com** (Render free web service "realist-reels", Blueprint from this repo, commit eb1e211). Verified live end-to-end from outside: homepage 200, signup, feed = 5 seeded reels, like persists, video range-stream 206, unauthenticated feed 401.
- Accounts: GitHub @realistpplays (created 2026-10-23, realistpplays@gmail.com, password in Paul's Secure Vault) owns this repo; Render account created via GitHub OAuth on the same account; Render GitHub app has access to this repo only.
- Seeded creators: @gullygamez (4 full reels), @realistreacts (channel intro). Their passwords are locked random — Paul claims/renames them when admin tools land. A "livecheck" test account (id 3) also exists from go-live verification.
- FREE-TIER LIMITS (Render): service spins down after ~15 min idle (≈1 min cold start on next visit); filesystem is ephemeral — user accounts/uploads can reset on restart/redeploy; the 5 seeded reels always return automatically via boot-seed. Removing these limits = Render paid plan + persistent disk, or external storage/DB (Phase 2 decision for Paul).
- Local copy still runs via `./start.sh` (port 3737) for development.
