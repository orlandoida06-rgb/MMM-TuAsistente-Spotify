Module.register("MMM-TuAsistente-Spotify", {

  defaults: {
    socketPath: "/tmp/tuasistente-spotify.sock",
    updateInterval: 3000,
    showWhenDisconnected: true
  },

  start: function () {

    Log.info(
      "[MMM-TuAsistente-Spotify] Iniciando módulo"
    );

    this.spotify = {
      connected: false,
      authenticated: false,
      playing: false,
      loading: false,
      title: "",
      artist: "",
      album: "",
      cover: "",
      volume: 0
    };

    this.searchResults = [];
    this.searchQuery = "";
    this.searchLoading = false;
    this.searchError = "";

    // ========================================================
    // TEMPORIZADOR DE OCULTACIÓN SPOTIFY
    // ========================================================

    this.spotifyHideTimer = null;
    this.spotifyHidden = false;
    this.sendSocketNotification(
      "SPOTIFY_INIT",
      {
        socketPath: this.config.socketPath
      }
    );
  },

  getStyles: function () {

    return [
      "MMM-TuAsistente-Spotify.css"
    ];
  },

  getDom: function () {

    // Si Spotify está oculto por falta de reproducción,
    // devolvemos un contenedor vacío.
    if (
      this.spotifyHidden &&
      this.spotify.authenticated &&
      !this.spotify.playing
    ) {

      const hidden =
        document.createElement("div");

      hidden.className =
        "tuasistente-spotify-hidden";

      return hidden;
    }

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "tuasistente-spotify";

    /* ========================================================
       HEADER
       ====================================================== */

    const title =
      document.createElement("div");

    title.className =
      "tuasistente-spotify-title";

    title.innerHTML =
      "Spotify";

    wrapper.appendChild(title);

    /* ========================================================
       AUTH
       ====================================================== */

    if (!this.spotify.authenticated) {

      const authBox =
        document.createElement("div");

      authBox.className =
        "spotify-auth-box";

      const authText =
        document.createElement("div");

      authText.className =
        "spotify-auth-text";

      authText.innerHTML =
        "Conecta tu cuenta de Spotify";

      authBox.appendChild(authText);

      const authButton =
        document.createElement("button");

      authButton.className =
        "spotify-auth-button";

      authButton.innerHTML =
        "🎵 Conectar con Spotify";

      authButton.onclick = () => {

        this.sendSocketNotification(
          "SPOTIFY_AUTH"
        );
      };

      authBox.appendChild(authButton);

      wrapper.appendChild(authBox);

    } else {

      /* ======================================================
         SEARCH STATUS
         ==================================================== */

      if (this.searchLoading) {

        const loading =
          document.createElement("div");

        loading.className =
          "spotify-search-status";

        loading.innerHTML =
          "Buscando...";

        wrapper.appendChild(
          loading
        );
      }

      if (this.searchError) {

        const error =
          document.createElement("div");

        error.className =
          "spotify-search-error";

        error.innerHTML =
          this.searchError;

        wrapper.appendChild(
          error
        );
      }

      /* ======================================================
         SEARCH RESULTS
         ==================================================== */

      if (
        this.searchResults &&
        this.searchResults.length
      ) {

        const results =
          document.createElement("div");

        results.className =
          "spotify-search-results";

        this.searchResults.forEach(
          result => {

            const item =
              document.createElement("div");

            item.className =
              "spotify-search-result";

            item.onclick = () => {

              this.playResult(
                result
              );
            };

            if (result.cover) {

              const cover =
                document.createElement("img");

              cover.className =
                "spotify-result-cover";

              cover.src =
                this.getCoverUrl(result.cover);

              cover.alt =
                "";

              item.appendChild(
                cover
              );
            }

            const info =
              document.createElement("div");

            info.className =
              "spotify-result-info";

            const song =
              document.createElement("div");

            song.className =
              "spotify-result-title";

            song.textContent =
              result.title;

            const artist =
              document.createElement("div");

            artist.className =
              "spotify-result-artist";

            artist.textContent =
              result.artist;

            const album =
              document.createElement("div");

            album.className =
              "spotify-result-album";

            album.textContent =
              result.album;

            info.appendChild(song);
            info.appendChild(artist);
            info.appendChild(album);

            item.appendChild(info);

            results.appendChild(
              item
            );
          }
        );

        wrapper.appendChild(
          results
        );
      }
    }

    /* ========================================================
       CURRENT TRACK
       ====================================================== */

    const current =
      document.createElement("div");

    current.className =
      "spotify-current";

    if (this.spotify.cover) {

      const cover =
        document.createElement("img");

      cover.className =
        "spotify-current-cover";

      cover.src =
        this.getCoverUrl(this.spotify.cover);

      cover.alt =
        "";

      current.appendChild(
        cover
      );
    }

    const currentInfo =
      document.createElement("div");

    currentInfo.className =
      "spotify-current-info";

    const currentTitle =
      document.createElement("div");

    currentTitle.className =
      "spotify-song";

    currentTitle.textContent =
      this.spotify.title ||
      "No hay reproducción activa";

    const currentArtist =
      document.createElement("div");

    currentArtist.className =
      "spotify-artist";

    currentArtist.textContent =
      this.spotify.artist || "";

    const currentAlbum =
      document.createElement("div");

    currentAlbum.className =
      "spotify-album";

    currentAlbum.textContent =
      this.spotify.album || "";

    currentInfo.appendChild(
      currentTitle
    );

    currentInfo.appendChild(
      currentArtist
    );

    currentInfo.appendChild(
      currentAlbum
    );

    current.appendChild(
      currentInfo
    );

    wrapper.appendChild(
      current
    );

    /* ========================================================
       CONTROLS
       ====================================================== */

    if (this.spotify.authenticated) {

      const controls =
        document.createElement("div");

      controls.className =
        "tuasistente-spotify-controls";

      const previous =
        document.createElement("button");

      previous.innerHTML =
        "⏮";

      previous.onclick = () => {

        this.sendSocketNotification(
          "SPOTIFY_COMMAND",
          "prev"
        );
      };

      const play =
        document.createElement("button");

      play.innerHTML =
        this.spotify.playing
          ? "⏸"
          : "▶";

      play.onclick = () => {

        this.sendSocketNotification(
          "SPOTIFY_COMMAND",
          "play_pause"
        );
      };

      const next =
        document.createElement("button");

      next.innerHTML =
        "⏭";

      next.onclick = () => {

        this.sendSocketNotification(
          "SPOTIFY_COMMAND",
          "next"
        );
      };

      controls.appendChild(
        previous
      );

      controls.appendChild(
        play
      );

      controls.appendChild(
        next
      );

      wrapper.appendChild(
        controls
      );
    }

    return wrapper;
  },

  /* ==========================================================
     TEMPORIZADOR SPOTIFY
   ======================================================== */

  clearSpotifyHideTimer: function () {

    if (this.spotifyHideTimer) {

      clearTimeout(
        this.spotifyHideTimer
      );

      this.spotifyHideTimer = null;
    }
  },

  scheduleSpotifyHide: function () {

    this.clearSpotifyHideTimer();

    this.spotifyHideTimer =
      setTimeout(() => {

        // Si ha vuelto a reproducir durante
        // la cuenta atrás, no ocultamos nada.
        if (this.spotify.playing) {

          this.spotifyHideTimer = null;
          return;
        }

        this.spotifyHidden = true;
        this.spotifyHideTimer = null;

        this.updateDom(300);

      }, 10000);
  },

  /* ==========================================================
     SEARCH
   ======================================================== */

  doSearch: function () {

    const query =
      this.searchQuery.trim();

    if (!query) {
      return;
    }

    this.searchLoading = true;
    this.searchError = "";
    this.searchResults = [];

    this.updateDom();

    this.sendSocketNotification(
      "SPOTIFY_SEARCH",
      query
    );
  },

  /* ==========================================================
     PLAY RESULT
   ======================================================== */

  playResult: function (result) {

    if (!result || !result.uri) {
      return;
    }

    this.searchLoading = true;
    this.updateDom();

    this.sendSocketNotification(
      "SPOTIFY_PLAY_URI",
      result.uri
    );
  },

  /* ==========================================================
     SOCKET
   ======================================================== */

  // ========================================================
  // PROXY LOCAL PARA PORTADAS DE SPOTIFY
  // ========================================================

  getCoverUrl: function (url) {

    if (!url) {
      return "";
    }

    if (
      /^https:\/\/i\.scdn\.co\/image\//.test(url)
    ) {

      return (
        "http://127.0.0.1:8888/cover?url=" +
        encodeURIComponent(url)
      );
    }

    return url;
  },

  socketNotificationReceived:
    function (
      notification,
      payload
    ) {

      if (
        notification ===
        "SPOTIFY_STATE"
      ) {

        this.spotify =
          Object.assign(
            {},
            this.spotify,
            payload
          );

        console.log(
          "[MMM-TuAsistente-Spotify] ESTADO:",
          JSON.stringify({
            title: this.spotify.title,
            artist: this.spotify.artist,
            uri: this.spotify.uri,
            cover: this.spotify.cover,
            playing: this.spotify.playing
          })
        );

        // ====================================================
        // CONTROL DE VISIBILIDAD
        // ====================================================

        if (this.spotify.playing) {

          // Está reproduciendo:
          // mostramos Spotify inmediatamente.
          this.spotifyHidden = false;

          this.clearSpotifyHideTimer();

        } else if (this.spotify.authenticated) {

          // No está reproduciendo:
          // empezamos una cuenta atrás de 10 segundos.
          this.spotifyHidden = false;

          this.scheduleSpotifyHide();
        }

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_CONNECTED"
      ) {

        this.spotify.connected =
          true;

        this.spotifyHidden = false;

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_DISCONNECTED"
      ) {

        this.spotify.connected =
          false;

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_AUTH_STATE"
      ) {

        this.spotify.authenticated =
          !!payload.authenticated;

        if (this.spotify.authenticated) {
          this.spotifyHidden = false;
          this.clearSpotifyHideTimer();
        }

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_AUTH_URL"
      ) {

        if (payload) {

          window.open(
            payload,
            "_blank"
          );
        }

        return;
      }

      if (
        notification ===
        "SPOTIFY_AUTH_SUCCESS"
      ) {

        this.spotify.authenticated =
          true;

        this.spotifyHidden = false;
        this.clearSpotifyHideTimer();

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_SEARCH_RESULTS"
      ) {

        this.searchLoading =
          false;

        this.searchError =
          "";

        this.searchResults =
          payload || [];

        this.updateDom();

        return;
      }

      if (
        notification ===
        "SPOTIFY_SEARCH_ERROR"
      ) {

        this.searchLoading =
          false;

        this.searchError =
          payload || "Error buscando en Spotify";

        this.updateDom();

        return;
      }
    }

});
