#!/bin/sh
# Runs once, when the dev volume is first created: adds the throwaway test database.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"$POSTGRES_TEST_DB\" OWNER \"$POSTGRES_USER\""
