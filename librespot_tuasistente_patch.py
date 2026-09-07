#!/usr/bin/env python3

from pathlib import Path
import re
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
    # YA PARCHEADO
    # ------------------------------------------------------------

    if "TuAsistente Spotify control socket" in text:
        print("[OK] Parche TuAsistente ya aplicado.")
        return

    # ------------------------------------------------------------
    # IMPORTS
    # ------------------------------------------------------------

    # UnixListener + mpsc + oneshot
    if "use tokio::net::UnixListener;" not in text:
        anchor = "use tokio::sync::Semaphore;"
        if anchor in text:
            text = text.replace(
                anchor,
                "use tokio::io::{AsyncBufReadExt, AsyncWriteExt};\n"
                "use tokio::net::UnixListener;\n"
                "use tokio::sync::{mpsc, oneshot, Semaphore};",
                1,
            )
        else:
            fail("No se encontró el import tokio::sync::Semaphore.")

    # El código utiliza PermissionsExt para chmod 660.
    if "use std::os::unix::fs::PermissionsExt;" not in text:
        anchor = "use std::{"
        if anchor in text:
            text = text.replace(
                anchor,
                "use std::os::unix::fs::PermissionsExt;\n"
                "use std::{",
                1,
            )
        else:
            fail("No se encontró el bloque std:: para añadir PermissionsExt.")


    # ------------------------------------------------------------
    # SOCKET + CANAL DE CONTROL
    # ------------------------------------------------------------

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
                let mut reader = tokio::io::BufReader::new(&mut stream);
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

    # ------------------------------------------------------------
    # PUNTO DE INSERCIÓN
    # ------------------------------------------------------------

    # En LibreSpot v0.8.0 actual el player se crea justo antes
    # de la primera tokio::select! principal.
    select_marker = "        tokio::select! {"

    if select_marker not in text:
        fail("No se encontró tokio::select! principal.")

    # Insertamos el socket justo antes del loop principal.
    # Esto garantiza que spirc/control_rx estén disponibles para
    # la rama de control.
    loop_marker = "    loop {\n" + select_marker

    if loop_marker not in text:
        fail("No se encontró el loop principal de LibreSpot.")

    text = text.replace(
        loop_marker,
        socket_block + "    loop {\n" + select_marker,
        1,
    )

    # ------------------------------------------------------------
    # RAMA DE CONTROL DENTRO DEL tokio::select!
    # ------------------------------------------------------------

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

    # Solo insertar la rama una vez.
    if "request = control_rx.recv()" not in text:
        text = text.replace(
            select_marker,
            select_marker + "\n" + control_branch,
            1,
        )

    # ------------------------------------------------------------
    # ESCRIBIR
    # ------------------------------------------------------------

    source.write_text(text)

    print("[OK] Parche TuAsistente aplicado.")
    print(f"[OK] Socket: {SOCKET}")


if __name__ == "__main__":
    main()
