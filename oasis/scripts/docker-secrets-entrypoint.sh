#!/bin/sh
# Source mounted secret files before running the main entrypoint.
# Secrets mounted at /run/secrets/*.env are loaded as environment variables,
# keeping them out of `docker inspect` output.
for f in /run/secrets/*.env; do
  [ -f "$f" ] && { set -a; . "$f"; set +a; }
done
exec docker-entrypoint.sh "$@"
