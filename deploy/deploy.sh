#!/bin/sh
# Builds and (re)starts the stack. Run from anywhere; uses the .env at the repo root.
set -eu
cd "$(dirname "$0")/.."
# A new number on every deploy, so the engine moves new rooms to the new actor server.
export RIVET_NODE_VERSION="$(date +%s)"
docker compose -f deploy/compose.yml --env-file .env up -d --build --remove-orphans "$@"
