#!/usr/bin/env bash
#
# Starts a throwaway VictoriaLogs of the given release on port 9428, which
# is where the sync script looks for it, and waits until it answers:
#
#   ./scripts/start-victorialogs.sh v1.54.0
#
# Stop it with: docker rm -f lezer-logsql-victorialogs

set -euo pipefail

tag="${1:?usage: start-victorialogs.sh <tag>, for example v1.54.0}"
name="lezer-logsql-victorialogs"

docker rm -f "$name" >/dev/null 2>&1 || true
docker run --detach --rm --name "$name" \
	--publish 127.0.0.1:9428:9428 \
	"victoriametrics/victoria-logs:$tag" >/dev/null

for _ in $(seq 1 30); do
	if curl --silent --fail --output /dev/null http://127.0.0.1:9428/health; then
		echo "VictoriaLogs $tag is up on http://127.0.0.1:9428"
		exit 0
	fi

	sleep 1
done

echo "VictoriaLogs $tag did not start" >&2
docker logs "$name" >&2 || true
exit 1
