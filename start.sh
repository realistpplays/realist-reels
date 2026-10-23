#!/bin/bash
# Realist Reels Phase 1 — start/restart the server
cd "$(dirname "$0")"
if pgrep -f "node server.js" > /dev/null; then echo "already running"; else
  nohup node server.js > server.log 2>&1 &
  echo "started on port 3737"
fi
