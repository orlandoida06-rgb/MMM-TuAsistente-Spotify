# MMM-TuAsistente-Spotify

Módulo independiente para MagicMirror² que integra Spotify mediante OAuth y LibreSpot.

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
- ⏱️ La interfaz desaparece automáticamente después de 10 segundos cuando no hay reproducción.

## Instalación

```bash
cd ~/MagicMirror/modules
git clone https://github.com/orlandoida06-rgb/MMM-TuAsistente-Spotify.git
cd MMM-TuAsistente-Spotify
npm install
