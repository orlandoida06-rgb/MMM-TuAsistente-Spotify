#!/usr/bin/env bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$HOME/MagicMirror/config/config.js"

echo
echo "=============================================="
echo "       CONFIGURACIÓN DE SPOTIFY"
echo "=============================================="
echo

CLIENT_ID=""

while [[ -z "$CLIENT_ID" ]]; do
    read -r -p "Spotify Client ID: " CLIENT_ID
    CLIENT_ID="$(printf '%s' "$CLIENT_ID" | tr -d '[:space:]')"

    if [[ -z "$CLIENT_ID" ]]; then
        echo "[ERROR] Debes introducir el Client ID."
    fi
done

cp "$CONFIG" "$CONFIG.bak.spotify"

python3 - "$CONFIG" "$CLIENT_ID" <<'PY'
from pathlib import Path
import sys

config = Path(sys.argv[1])
client_id = sys.argv[2]

s = config.read_text()

marker = 'module: "MMM-TuAsistente-Spotify"'

pos = s.find(marker)

if pos == -1:
    raise SystemExit("[ERROR] No se encontró MMM-TuAsistente-Spotify en config.js")

start = s.rfind("{", 0, pos)

depth = 0
end = None

for i in range(start, len(s)):
    if s[i] == "{":
        depth += 1
    elif s[i] == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break

if end is None:
    raise SystemExit("[ERROR] No se pudo localizar el bloque Spotify")

block = s[start:end]

if "config:" in block:
    import re
    block = re.sub(
        r'spotifyClientId\s*:\s*["\'][^"\']*["\']',
        f'spotifyClientId: "{client_id}"',
        block
    )
else:
    block = block[:-1] + f'''
        config: {{
            spotifyClientId: "{client_id}"
        }}
    }}'''

s = s[:start] + block + s[end:]

config.write_text(s)
PY

echo
echo "[OK] Client ID guardado en config.js"
echo

grep -n -A6 -B2 'MMM-TuAsistente-Spotify' "$CONFIG"

echo
echo "[INFO] Reiniciando MagicMirror..."
pm2 restart mm

echo
echo "[OK] MagicMirror reiniciado."
echo
echo "Ahora la autorización OAuth se realizará desde la pantalla del espejo."
echo
