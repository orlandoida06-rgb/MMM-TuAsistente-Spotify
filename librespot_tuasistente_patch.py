#!/usr/bin/env python3

from pathlib import Path
import sys

SOCKET = "/tmp/tuasistente-spotify.sock"


def fail(message):
    print(f"[ERROR] {message}")
    sys.exit(1)


def main():
    if len(sys.argv) != 2:
        fail("Uso: librespot_tuasistente_patch.py /ruta/al/librespot")

    root = Path(sys.argv[1]).resolve()
    source = root / "src" / "main.rs"

    if not source.exists():
        fail(f"No existe {source}")

    text = source.read_text()

    # ------------------------------------------------------------
    # Ya parcheado
    # ------------------------------------------------------------
    if "TuAsistente Spotify control socket" in text:
        print("[OK] Parche TuAsistente ya aplicado.")
        return

    # ------------------------------------------------------------
    # Imports Tokio
    # ------------------------------------------------------------
    old_import = """use tokio::{
    io::AsyncBufReadExt,
    sync::Semaphore,
};"""

    new_import = """use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixListener,
    sync::{mpsc, oneshot, Semaphore},
};"""

    if old_import in text:
        text = text.replace(old_import, new_import, 1)
    else:
        # Variante usada en algunas revisiones de v0.8.0
        old_import2 = """use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::Semaphore,
};"""

        if old_import2 in text:
            text = text.replace(old_import2, new_import, 1)
        elif "UnixListener" not in text:
            fail("No se encontró un bloque Tokio compatible para aplicar el parche.")

    # ------------------------------------------------------------
    # Socket + canal de control
    # ------------------------------------------------------------
    marker = "    let session = Session::new(session_config);"

    if marker not in text:
        fail("No se encontró el punto de inserción de Session::new().")

    socket_block = r'''    // ------------------------------------------------------------
    // CONTROL LOCAL TUASISTENTE
    // ------------------------------------------------------------
    const TUASISTENTE_SPOTIFY_SOCKET: &str = "/tmp/tuasistente-spotify.sock";

    let _ = std::fs::remove_file(TUASISTENTE_SPOTIFY_SOCKET);

    let control_listener = UnixListener::bind(TUASISTENTE_SPOTIFY_SOCKET)
        .unwrap_or_else(|e| {
            error!(
                "No se pudo crear el socket de control Spotify {}: {}",
                TUASISTENTE_SPOTIFY_SOCKET, e
            );
            exit(1);
        });

    if let Err(e) = std::fs::set_permissions(
        TUASISTENTE_SPOTIFY_SOCKET,
        std::fs::Permissions::from_mode(0o660),
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
                    break;
                }
            };

            let tx = control_tx.clone();

            tokio::spawn(async move {
                let mut reader = BufReader::new(&mut stream);
                let mut command = String::new();

                if reader.read_line(&mut command).await.is_err() {
                    return;
                }

                let command = command.trim().to_lowercase();

                if command.is_empty() {
                    let _ = stream.write_all(b"ERROR EMPTY\n").await;
                    return;
                }

                let (reply_tx, reply_rx) = oneshot::channel();

                if tx.send((command, reply_tx)).await.is_err() {
                    let _ = stream.write_all(b"ERROR CONTROL\n").await;
                    return;
                }

                match reply_rx.await {
                    Ok(response) => {
                        let _ = stream.write_all(response.as_bytes()).await;
                    }
                    Err(_) => {
                        let _ = stream.write_all(b"ERROR CONTROL\n").await;
                    }
                }
            });
        }
    });

'''

    text = text.replace(marker, socket_block + marker, 1)

    # ------------------------------------------------------------
    # Rama de control dentro del tokio::select!
    # ------------------------------------------------------------
    select_marker = "        tokio::select! {"

    if select_marker not in text:
        fail("No se encontró tokio::select! principal.")

    control_branch = r'''            request = control_rx.recv() => {
                if let Some((command, reply)) = request {
                    let response = match spirc.as_ref() {
                        Some(spirc) => {
                            let result = match command.as_str() {
                                "play" => spirc.play(),
                                "pause" => spirc.pause(),
                                "next" => spirc.next(),
                                "prev" => spirc.prev(),
                                "previous" => spirc.prev(),
                                "volume_up" => spirc.volume_up(),
                                "volume_down" => spirc.volume_down(),
                                _ => {
                                    let _ = reply.send(
                                        format!("ERROR UNKNOWN_COMMAND {}\n", command)
                                    );
                                    continue;
                                }
                            };

                            match result {
                                Ok(_) => "OK\n".to_string(),
                                Err(e) => format!("ERROR {}\n", e),
                            }
                        }
                        None => "ERROR NOT_CONNECTED\n".to_string(),
                    };

                    let _ = reply.send(response);
                }
            },

'''

    text = text.replace(
        select_marker,
        select_marker + "\n" + control_branch,
        1,
    )

    source.write_text(text)

    print("[OK] Parche TuAsistente aplicado.")
    print(f"[OK] Socket: {SOCKET}")


if __name__ == "__main__":
    main()
