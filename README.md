# MMM-TuAsistente-Spotify

Módulo para **MagicMirror²** que integra Spotify mediante **OAuth** y **LibreSpot**, con control visual y por voz desde **MMM-TuAsistente**.

## Características

- 🎵 Búsqueda y reproducción de canciones.
- ▶️ Play / Pause.
- ⏭️ Siguiente canción.
- ⏮️ Canción anterior.
- ⏹️ Detener reproducción.
- 🔊 Control de volumen.
- 🖼️ Portada del álbum.
- 🎤 Integración con MMM-TuAsistente para control por voz.
- 🔌 Comunicación mediante socket Unix.
- 📡 Eventos en tiempo real desde LibreSpot.
- ⏱️ La interfaz se oculta automáticamente tras 10 segundos cuando no hay reproducción.

## Instalación recomendada

La instalación principal se realiza desde **MMM-TuAsistente**:

`cd ~/MagicMirror/modules/MMM-TuAsistente`
`sudo ./install.sh`

Al seleccionar **MMM-TuAsistente-Spotify**, el instalador configura automáticamente:

- MMM-TuAsistente-Spotify
- LibreSpot
- Servicio `tuasistente-spotify.service`
- Socket `/tmp/tuasistente-spotify.sock`

## Instalación independiente

`cd ~/MagicMirror/modules`
`git clone https://github.com/orlandoida06-rgb/MMM-TuAsistente-Spotify.git`
`cd MMM-TuAsistente-Spotify`
`npm install`
`./install_spotify.sh`

## Configuración de Spotify

Para configurar OAuth:

`./configure_spotify.sh`

Las credenciales y tokens son privados y no deben subirse al repositorio.

## LibreSpot

El reproductor se ejecuta como servicio:

`tuasistente-spotify.service`

Binario:

`/opt/tuasistente/librespot/target/release/librespot`

Configuración y credenciales:

`/home/pi/.config/tuasistente/librespot/`

## Socket de control

Socket:

`/tmp/tuasistente-spotify.sock`

Comandos disponibles:

`play`
`pause`
`next`
`prev`
`volume_up`
`volume_down`

Ejemplo:

`printf 'play\n' | socat - UNIX-CONNECT:/tmp/tuasistente-spotify.sock`

## Eventos

LibreSpot envía eventos al manejador:

`/opt/tuasistente/bin/spotify_event_handler.sh`

Los eventos se almacenan en:

`/tmp/tuasistente-spotify-events.ndjson`

Se utilizan para actualizar en tiempo real:

- canción actual
- artista
- álbum
- portada
- duración
- estado de reproducción
- volumen
- conexión de Spotify

## Comprobación

`systemctl status tuasistente-spotify.service --no-pager`

`ls -l /tmp/tuasistente-spotify.sock`

`tail -20 /tmp/tuasistente-spotify-events.ndjson`

## Integración con MMM-TuAsistente

El módulo puede recibir órdenes de voz desde MMM-TuAsistente, permitiendo controlar la reproducción sin utilizar la pantalla.

