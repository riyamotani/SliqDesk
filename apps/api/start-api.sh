#!/bin/sh
# API container start-up: bring the database schema up to date, seed demo
# data (skipped if already present), then start the server.
set -e

npx prisma migrate deploy
node dist/seed.js

# exec replaces the shell, so the server receives Docker's SIGTERM directly
# and can shut down gracefully.
exec node dist/server.js
