#!/usr/bin/env python3

from pathlib import Path
import sys

MAIN = Path("/opt/tuasistente/librespot/src/main.rs")

if not MAIN.exists():
    print("[ERROR] No existe src/main.rs de LibreSpot")
    sys.exit(1)

text = MAIN.read_text()

# ============================================================
# YA APLICADO
# ============================================================

if "TuAsistente Spotify control socket" in text:
    print("[OK] Parche TuAsistente ya aplicado.")
    sys.exit(0)

# ============================================================
# IMPORTS
# ============================================================

old = """use tokio::{
    io::AsyncBufReadExt,
    sync::Semaphore,
};"""

new = """use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixListener,
    sync::{mpsc, oneshot, Semaphore},
};"""

if old in text:
    text = text.replace(old, new, 1)

else:
    # Variante por si el formato del upstream cambia ligeramente.
    if "AsyncWriteExt" not in text:
        marker = "use tokio::{"
        pos = text.find(marker)

        if pos == -1:
            print("[ERROR] No se encontró el bloque use tokio.")
            sys.exit(1)

        end = text.find("};", pos)

        if end == -1:
            print("[ERROR] No se encontró el final del bloque use tokio.")
            sys.exit(1)

        block = text[pos:end + 2]

        if "AsyncBufReadExt" not in block:
            print("[ERROR] El bloque tokio no coincide con LibreSpot v0.8.0.")
            sys.exit(1)

        block = block.replace(
            "io::AsyncBufReadExt",
            "io::{AsyncBufReadExt, AsyncWriteExt}"
        )

        block = block.replace(
            "sync::Semaphore",
            "net::UnixListener,\n    sync::{mpsc, oneshot, Semaphore}"
        )

        text = text[:pos] + block + text[end + 2:]

# ============================================================
# CONSTANTE
# ============================================================

constant = 'const TUASISTENTE_SPOTIFY_SOCKET: &str = "/tmp/tuasistente-spotify.sock";'

if constant not in text:

    marker = "const "

    pos = text.find(marker)

    if pos == -1:
        print("[ERROR] No se encontró zona de constantes.")
        sys.exit(1)

    text = (
        text[:pos]
        + constant
        + "\n"
        + text[pos:]
    )

# ============================================================
# SOCKET + CANAL
# ============================================================

marker = """    let mut session = Session::new(setup.session_config.clone(), setup.cache.clone());"""

if marker not in text:
    print("[ERROR] No se encontró el punto de inserción del socket.")
    sys.exit(1)

socket_code = r'''
    // ============================================================
    // TUASISTENTE SPOTIFY CONTROL SOCKET
    // ============================================================

    let _ = std::fs::remove_file(TUASISTENTE_SPOTIFY_SOCKET);

    let control_listener =
        UnixListener::bind(TUASISTENTE_SPOTIFY_SOCKET)
            .expect("No se pudo crear el socket Spotify TuAsistente");

    if let Err(e) = std::fs::set_permissions(
        TUASISTENTE_SPOTIFY_SOCKET,
        std::os::unix::fs::PermissionsExt::from_mode(0o660),
    ) {
        warn!("No se pudieron ajustar permisos del socket Spotify: {e}");
    }

    info!(
        "TuAsistente Spotify control socket: {}",
        TUASISTENTE_SPOTIFY_SOCKET
    );

    let (control_tx, mut control_rx) =
        mpsc::channel::<(String, oneshot::Sender<String>)>(16);

    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match control_listener.accept().await {
                Ok(value) => value,
                Err(e) => {
                    error!("Error aceptando conexión del socket Spotify: {e}");
                    continue;
                }
            };

            let mut command = String::new();

            let read_result = {
                let mut reader = BufReader::new(&mut stream);
                reader.read_line(&mut command).await
            };

            if let Err(e) = read_result {
                let _ = stream
                    .write_all(format!("ERROR READ {e}\n").as_bytes())
                    .await;
                continue;
            }

            let command = command.trim().to_lowercase();

            if command.is_empty() {
                let _ = stream.write_all(b"ERROR EMPTY\n").await;
                continue;
            }

            let (reply_tx, reply_rx) = oneshot::channel();

            if control_tx.send((command, reply_tx)).await.is_err() {
                let _ = stream.write_all(b"ERROR CONTROL\n").await;
                break;
            }

            match reply_rx.await {
                Ok(response) => {
                    let _ = stream.write_all(response.as_bytes()).await;
                }
                Err(_) => {
                    let _ = stream.write_all(b"ERROR RESPONSE\n").await;
                }
            }
        }
    });

'''

text = text.replace(
    marker,
    socket_code + marker,
    1
)

# ============================================================
# CONTROL DENTRO DEL SELECT
# ============================================================

select_marker = """        tokio::select! {
"""

if select_marker not in text:
    print("[ERROR] No se encontró tokio::select! principal.")
    sys.exit(1)

control_branch = r'''            control = control_rx.recv() => {
                if let Some((command, reply_tx)) = control {
                    let response = if let Some(ref spirc) = spirc {
                        match command.as_str() {
                            "play" => match spirc.play() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            "pause" => match spirc.pause() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            "next" => match spirc.next() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            "prev" | "previous" => match spirc.prev() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            "volume_up" => match spirc.volume_up() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            "volume_down" => match spirc.volume_down() {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {e}\n"),
                            },

                            _ => "ERROR UNKNOWN_COMMAND\n".to_string(),
                        }
                    } else {
                        "ERROR NOT_CONNECTED\n".to_string()
                    };

                    let _ = reply_tx.send(response);
                }
            },

'''

text = text.replace(
    select_marker,
    select_marker + control_branch,
    1
)

MAIN.write_text(text)

print("[OK] Parche TuAsistente aplicado correctamente.")
print("[OK] Socket: /tmp/tuasistente-spotify.sock")
