# Realist Reels — Phase 1 app

Real accounts, uploads, likes, comments, follows — Express + node:sqlite, original code.

## Run
```
./start.sh          # starts server on port 3737 (nohup; survives this session)
node seed.js        # (re)seed creator accounts + Paul's reels — safe to re-run
```
Server log: `server.log`. Database: `data/realist-reels.db`. Uploads: `uploads/`.

## Status (2026-10-23)
- Backend + frontend complete; end-to-end tested locally (signup, login, feed, like, comment, follow, following-feed, upload, video range streaming, wrong-password rejection) — all passed. Test data cleaned out.
- Seeded creators: @gullygamez (4 full reels), @realistreacts (channel intro). Their passwords are locked random — Paul claims/renames them when admin tools land.
- HOSTING GAP: the app is NOT on a public URL yet. This VM's internet egress is HTTP-proxy-only, so Cloudflare Tunnel (TLS handshake fails), localhost.run SSH and localtunnel all fail from here. Next step is a real host (Render/Railway/Fly.io free tier) using Paul's realistpplays@gmail.com, or a Tailscale Funnel with Paul's approval tap. Code is deploy-ready: `PORT` env, single `node server.js`, no build step.
- Note: server runs via nohup — if the VM is replaced it needs `./start.sh` again (or move to the real host, which removes this fragility).
