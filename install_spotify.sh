#!/usr/bin/env bash
set -euo pipefail

echo
echo "=============================================="
echo "   MMM-TuAsistente-Spotify"
echo "   INSTALADOR LIBRESPOT"
echo "=============================================="
echo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LIBRESPOT_VERSION="v0.8.0"
LIBRESPOT_URL="https://github.com/librespot-org/librespot.git"

LIBRESPOT_DIR="/opt/tuasistente/librespot"
LIBRESPOT_BIN="$LIBRESPOT_DIR/target/release/librespot"
LIBRESPOT_CACHE="/home/pi/.config/tuasistente/librespot"
LIBRESPOT_SERVICE="/etc/systemd/system/tuasistente-spotify.service"
SOCKET="/tmp/tuasistente-spotify.sock"

EVENT_HANDLER="$SCRIPT_DIR/spotify_event_handler.sh"
EVENT_HANDLER_INSTALL="/opt/tuasistente/bin/spotify_event_handler.sh"
EVENTS="/tmp/tuasistente-spotify-events.ndjson"

# ============================================================
# ARQUITECTURA
# ============================================================

ARCH="$(uname -m)"

case "$ARCH" in
    aarch64|arm64)
        echo "[OK] Arquitectura compatible: $ARCH"
        ;;
    *)
        echo "[ERROR] LibreSpot requiere ARM64/aarch64."
        echo "[ERROR] Arquitectura: $ARCH"
        exit 1
        ;;
esac

# ============================================================
# DEPENDENCIAS
# ============================================================

echo
echo "[INFO] Comprobando dependencias..."

if ! command -v git >/dev/null 2>&1 ||
   ! command -v cargo >/dev/null 2>&1; then

    echo "[INFO] Instalando dependencias..."

    sudo apt-get update

    sudo apt-get install -y \
        git \
        curl \
        build-essential \
        libasound2-dev

    if ! command -v cargo >/dev/null 2>&1; then

        if ! command -v rustup >/dev/null 2>&1; then
            curl --proto '=https' --tlsv1.2 -sSf \
                https://sh.rustup.rs |
                sh -s -- -y
        fi

        source "$HOME/.cargo/env"
    fi
fi

command -v git >/dev/null 2>&1 || {
    echo "[ERROR] git no está disponible."
    exit 1
}

command -v cargo >/dev/null 2>&1 || {
    echo "[ERROR] cargo no está disponible."
    exit 1
}

echo "[OK] $(cargo --version)"

# ============================================================
# DIRECTORIO
# ============================================================

sudo mkdir -p /opt/tuasistente
sudo chown -R pi:pi /opt/tuasistente

# ============================================================
# LIBRESPOT
# ============================================================

if [[ -d "$LIBRESPOT_DIR/.git" ]]; then

    echo
    echo "[OK] Repositorio LibreSpot existente."

    cd "$LIBRESPOT_DIR"

    if git diff --quiet -- src/main.rs; then

        echo "[INFO] Source limpio."

        git fetch --tags --quiet

        if git rev-parse --verify "refs/tags/$LIBRESPOT_VERSION" >/dev/null 2>&1; then
            git checkout --quiet "$LIBRESPOT_VERSION"
            echo "[OK] LibreSpot fijado en $LIBRESPOT_VERSION."
        else
            echo "[ERROR] No se encontró el tag $LIBRESPOT_VERSION."
            exit 1
        fi

    else

        echo "[OK] Se detectaron modificaciones locales en main.rs."
        echo "[INFO] Se conservará la integración TuAsistente."
    fi

else

    echo
    echo "[INFO] Clonando LibreSpot $LIBRESPOT_VERSION..."

    sudo rm -rf "$LIBRESPOT_DIR"

    git clone \
        --depth 1 \
        --branch "$LIBRESPOT_VERSION" \
        "$LIBRESPOT_URL" \
        "$LIBRESPOT_DIR"

    sudo chown -R pi:pi "$LIBRESPOT_DIR"

    echo "[OK] LibreSpot descargado."
fi

cd "$LIBRESPOT_DIR"

echo
echo "[INFO] Estado del repositorio:"
git status --short

echo
echo "[INFO] Commit LibreSpot:"
git rev-parse --short HEAD

# ============================================================
# PARCHE
# ============================================================

echo
echo "[INFO] Aplicando integración TuAsistente..."

python3 \
    "$SCRIPT_DIR/librespot_tuasistente_patch.py" \
    "$LIBRESPOT_DIR"

echo "[OK] Integración TuAsistente comprobada."

# ============================================================
# COMPILACIÓN
# ============================================================

NEED_BUILD=false

if [[ ! -x "$LIBRESPOT_BIN" ]]; then
    NEED_BUILD=true
    echo "[INFO] No existe el binario LibreSpot."

elif [[ "$LIBRESPOT_DIR/src/main.rs" -nt "$LIBRESPOT_BIN" ]]; then
    NEED_BUILD=true
    echo "[INFO] main.rs es más reciente que el binario."
    echo "[INFO] Será necesaria una recompilación."

else
    echo "[OK] Binario LibreSpot actualizado."
fi

if [[ "$NEED_BUILD" == true ]]; then

    echo
    echo "[INFO] Compilando LibreSpot con integración TuAsistente..."
    echo "[INFO] Puede tardar varios minutos en ARM64."

    cargo clean
    cargo build --release

else

    echo
    echo "[OK] No es necesaria una recompilación."
fi

if [[ ! -x "$LIBRESPOT_BIN" ]]; then
    echo "[ERROR] No existe el binario compilado."
    exit 1
fi

echo "[OK] Binario LibreSpot listo."

# ============================================================
# CACHE SPOTIFY
# ============================================================

echo
echo "[INFO] Preparando cache Spotify..."

mkdir -p "$LIBRESPOT_CACHE"
chmod 700 "$LIBRESPOT_CACHE"

echo "[OK] Cache: $LIBRESPOT_CACHE"

# ============================================================
# EVENTOS DE REPRODUCCIÓN
# ============================================================

echo
echo "[INFO] Preparando eventos de reproducción..."

if [[ ! -f "$EVENT_HANDLER" ]]; then
    echo "[ERROR] No existe el handler de eventos:"
    echo "        $EVENT_HANDLER"
    exit 1
fi

sudo mkdir -p /opt/tuasistente/bin

sudo cp \
    "$EVENT_HANDLER" \
    "$EVENT_HANDLER_INSTALL"

sudo chown pi:pi "$EVENT_HANDLER_INSTALL"
sudo chmod 755 "$EVENT_HANDLER_INSTALL"

touch "$EVENTS"
chmod 644 "$EVENTS"

echo "[OK] Handler de eventos instalado:"
echo "     $EVENT_HANDLER_INSTALL"

echo "[OK] Registro de eventos:"
echo "     $EVENTS"

# ============================================================
# SERVICIO
# ============================================================

echo
echo "[INFO] Instalando servicio systemd..."

sudo tee "$LIBRESPOT_SERVICE" >/dev/null <<'SERVICE'
[Unit]
Description=TuAsistente Spotify LibreSpot
After=pipewire.service wireplumber.service
Wants=pipewire.service wireplumber.service

[Service]
Type=simple
User=pi
Group=pi

Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=PIPEWIRE_REMOTE=pipewire-0

ExecStart=/opt/tuasistente/librespot/target/release/librespot \
    --name TuAsistente \
    --backend rodio \
    --device pipewire \
    --system-cache /home/pi/.config/tuasistente/librespot \
    --onevent /opt/tuasistente/bin/spotify_event_handler.sh

Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable tuasistente-spotify.service >/dev/null

echo "[OK] Servicio instalado con eventos LibreSpot."

# ============================================================
# ARRANQUE
# ============================================================

echo
echo "[INFO] Reiniciando LibreSpot..."

sudo rm -f "$SOCKET"

sudo systemctl restart tuasistente-spotify.service

sleep 3

if ! systemctl is-active --quiet tuasistente-spotify.service; then

    echo "[ERROR] LibreSpot no arrancó."

    sudo systemctl status \
        tuasistente-spotify.service \
        --no-pager \
        -n 40

    exit 1
fi

echo "[OK] Servicio LibreSpot activo."

# ============================================================
# COMPROBAR EVENTOS EN EL SERVICIO
# ============================================================

echo
echo "[INFO] Comprobando configuración --onevent..."

EXEC_START="$(systemctl show tuasistente-spotify.service -p ExecStart --value)"

if [[ "$EXEC_START" == *"--onevent /opt/tuasistente/bin/spotify_event_handler.sh"* ]]; then
    echo "[OK] --onevent configurado correctamente."
else
    echo "[ERROR] --onevent no está configurado en el servicio."
    exit 1
fi

# ============================================================
# SOCKET
# ============================================================

for i in {1..10}; do
    if [[ -S "$SOCKET" ]]; then
        break
    fi
    sleep 1
done

if [[ ! -S "$SOCKET" ]]; then

    echo "[ERROR] No apareció:"
    echo "        $SOCKET"

    sudo journalctl \
        -u tuasistente-spotify.service \
        --since "1 minute ago" \
        --no-pager \
        -o cat

    exit 1
fi

echo "[OK] Socket Spotify: $SOCKET"

# ============================================================
# PRUEBA FUNCIONAL DEL CONTROL
# ============================================================

echo
echo "[INFO] Probando control Spotify..."

if command -v socat >/dev/null 2>&1; then

    PAUSE_RESULT="$(printf 'pause\n' | socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null || true)"
    PLAY_RESULT="$(printf 'play\n' | socat - UNIX-CONNECT:"$SOCKET" 2>/dev/null || true)"

    echo "[INFO] pause -> ${PAUSE_RESULT:-SIN RESPUESTA}"
    echo "[INFO] play  -> ${PLAY_RESULT:-SIN RESPUESTA}"

    if [[ "$PAUSE_RESULT" == "OK" && "$PLAY_RESULT" == "OK" ]]; then
        echo "[OK] Control Spotify funcionando."

    elif [[ "$PAUSE_RESULT" == "ERROR NOT_CONNECTED" ||
            "$PLAY_RESULT" == "ERROR NOT_CONNECTED" ]]; then
        echo "[INFO] Socket funcionando, pero Spotify aún no está conectado."

    else
        echo "[ERROR] El socket existe pero el control no respondió correctamente."
        exit 1
    fi

else

    echo "[AVISO] socat no está instalado."
    echo "[AVISO] Se omite la prueba funcional."
fi

# ============================================================
# AUTENTICACIÓN
# ============================================================

echo

if find "$LIBRESPOT_CACHE" -type f -print -quit 2>/dev/null |
   grep -q .; then

    echo "[OK] Autenticación Spotify existente conservada."

else

    echo "[INFO] Spotify todavía no está autenticado."
    echo
    echo "En Spotify selecciona el dispositivo:"
    echo
    echo "        TuAsistente"
    echo
    echo "La autenticación se realizará mediante Spotify Connect."
fi

echo
echo "=============================================="
echo "   SPOTIFY / LIBRESPOT LISTO"
echo "=============================================="
echo
