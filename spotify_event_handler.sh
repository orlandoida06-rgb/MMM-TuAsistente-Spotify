#!/usr/bin/env bash
set -euo pipefail

EVENTS="/tmp/tuasistente-spotify-events.ndjson"

json_escape() {
    printf '%s' "$1" | python3 -c '
import sys,json
print(json.dumps(sys.stdin.read()), end="")
'
}

event="${PLAYER_EVENT:-}"

case "$event" in
    track_changed)
        printf '{"event":"track_changed","trackId":%s,"uri":%s,"name":%s,"artists":%s,"album":%s,"covers":%s,"durationMs":%s}\n' \
            "$(json_escape "${TRACK_ID:-}")" \
            "$(json_escape "${URI:-}")" \
            "$(json_escape "${NAME:-}")" \
            "$(json_escape "${ARTISTS:-}")" \
            "$(json_escape "${ALBUM:-}")" \
            "$(json_escape "${COVERS:-}")" \
            "${DURATION_MS:-0}" >> "$EVENTS"
        ;;

    playing|paused|loading|stopped|end_of_track|preloading|position_correction|seeked)
        printf '{"event":%s,"trackId":%s,"positionMs":%s}\n' \
            "$(json_escape "$event")" \
            "$(json_escape "${TRACK_ID:-}")" \
            "${POSITION_MS:-0}" >> "$EVENTS"
        ;;

    volume_changed)
        printf '{"event":"volume_changed","volume":%s}\n' \
            "${VOLUME:-0}" >> "$EVENTS"
        ;;

    session_connected)
        printf '{"event":"session_connected","connectionId":%s,"userName":%s}\n' \
            "$(json_escape "${CONNECTION_ID:-}")" \
            "$(json_escape "${USER_NAME:-}")" >> "$EVENTS"
        ;;

    session_disconnected)
        printf '{"event":"session_disconnected","connectionId":%s,"userName":%s}\n' \
            "$(json_escape "${CONNECTION_ID:-}")" \
            "$(json_escape "${USER_NAME:-}")" >> "$EVENTS"
        ;;
esac
