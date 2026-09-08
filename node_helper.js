const NodeHelper = require("node_helper");
const net = require("net");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

module.exports = NodeHelper.create({

  start: function () {

    console.log("[MMM-TuAsistente-Spotify] Node helper iniciado");

    this.socketPath = "/tmp/tuasistente-spotify.sock";
    this.eventsPath = "/tmp/tuasistente-spotify-events.ndjson";

    // OAuth se configura desde config.js mediante SPOTIFY_INIT.
    this.oauthConfigPath = __dirname + "/spotify.oauth.json";
    this.tokenPath = __dirname + "/spotify.token.json";

    this.oauthConfig = {
      clientId: "",
      clientSecret: "",
      redirectUri: "http://127.0.0.1:8888/callback"
    };

    this.spotify = {
      connected: false,
      authenticated: false,
      librespotAuthenticated: false,
      playing: false,
      loading: false,
      title: "",
      artist: "",
      album: "",
      uri: "",
      cover: "",
      position: 0,
      duration: 0,
      volume: 0,
      shuffle: false,
      repeat: false
    };

    this.eventsPosition = 0;
    this.oauthPending = null;

    // Caché de portadas obtenidas directamente desde Spotify
    this.coverCache = new Map();

    // OAuth se configura desde config.js mediante SPOTIFY_INIT.
    this.loadToken();
    this.startOAuthServer();
    this.startEventsWatcher();

    // ========================================================
    // LIBRESPOT - ESTADO DE AUTENTICACIÓN
    // ========================================================
    // La cuenta de Spotify la gestiona LibreSpot mediante
    // Spotify Connect/Zeroconf. No usamos OAuth del módulo.
    // ========================================================

    this.checkLibrespotAuth();

    this.librespotAuthTimer = setInterval(() => {
      this.checkLibrespotAuth();
    }, 2000);

    setTimeout(() => {
      this.sendAuthState();
    }, 1000);
  },

  // ========================================================
  // COMPROBAR AUTENTICACIÓN REAL DE LIBRESPOT
  // ========================================================
  checkLibrespotAuth: function () {

    const fs = require("fs");
    const { execFile } = require("child_process");

    const credentialsPath =
      "/home/pi/.config/tuasistente/librespot/credentials.json";

    const socketPath =
      "/tmp/tuasistente-spotify.sock";

    const credentialsExist =
      fs.existsSync(credentialsPath);

    const socketExists =
      fs.existsSync(socketPath);

    execFile(
      "systemctl",
      [
        "is-active",
        "tuasistente-spotify.service"
      ],
      (error, stdout) => {

        const serviceActive =
          !error &&
          stdout.trim() === "active";

        const librespotAuthenticated =
          serviceActive &&
          socketExists &&
          credentialsExist;

        const changed =
          this.spotify.librespotAuthenticated !== librespotAuthenticated ||
          this.spotify.connected !== serviceActive;

        this.spotify.librespotAuthenticated =
          librespotAuthenticated;

        this.spotify.connected =
          serviceActive;

        if (changed) {

          console.log(
            "[MMM-TuAsistente-Spotify] LibreSpot -> " +
            (librespotAuthenticated
              ? "Spotify conectado"
              : "Spotify esperando conexión")
          );

          this.sendAuthState();
        }
      }
    );
  },

  loadOAuthConfig: function () {

    try {

      if (!fs.existsSync(this.oauthConfigPath)) {
        console.log(
          "[MMM-TuAsistente-Spotify] OAuth se configurará desde config.js"
        );
        return;
      }

      const fileConfig = JSON.parse(
        fs.readFileSync(this.oauthConfigPath, "utf8")
      );

      this.oauthConfig = {
        ...this.oauthConfig,
        ...fileConfig
      };

      if (!this.oauthConfig.clientId) {
        console.error(
          "[MMM-TuAsistente-Spotify] Client ID no configurado"
        );
        return;
      }

      this.oauthConfig.redirectUri =
        this.oauthConfig.redirectUri ||
        "http://127.0.0.1:8888/callback";

      console.log(
        "[MMM-TuAsistente-Spotify] OAuth configurado"
      );

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error leyendo OAuth:",
        err.message
      );
    }
  },

  loadToken: function () {

    try {

      if (!fs.existsSync(this.tokenPath)) {
        return;
      }

      this.token = JSON.parse(
        fs.readFileSync(this.tokenPath, "utf8")
      );

      if (this.token && this.token.access_token) {
        this.spotify.authenticated = true;

        console.log(
          "[MMM-TuAsistente-Spotify] Token Spotify encontrado"
        );
      }

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error leyendo token:",
        err.message
      );

      this.token = null;
    }
  },

  saveToken: function (tokenData) {

    this.token = tokenData;

    fs.writeFileSync(
      this.tokenPath,
      JSON.stringify(tokenData, null, 2),
      { mode: 0o600 }
    );

    this.spotify.authenticated = true;

    console.log(
      "[MMM-TuAsistente-Spotify] Token Spotify guardado"
    );

    this.sendAuthState();
  },

  base64Url: function (buffer) {

    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },

  createCodeVerifier: function () {

    return this.base64Url(
      crypto.randomBytes(64)
    );
  },

  createCodeChallenge: function (verifier) {

    return this.base64Url(
      crypto
        .createHash("sha256")
        .update(verifier)
        .digest()
    );
  },

  createState: function () {

    return this.base64Url(
      crypto.randomBytes(32)
    );
  },

  startOAuthServer: function () {

    const app = express();

    app.get("/auth", (req, res) => {

      const url = this.createAuthUrl();

      if (!url) {
        return res
          .status(500)
          .type("text/plain")
          .send("OAuth no configurado");
      }

      res
        .type("text/plain")
        .send(url);
    });

    app.post("/voice-search", express.json(), async (req, res) => {

      const query = String(req.body?.query || "").trim();

      if (!query) {
        return res.status(400).json({
          ok: false,
          error: "empty_query"
        });
      }

      try {
        console.log(
          `[MMM-TuAsistente-Spotify] 🎤 Búsqueda por voz: ${query}`
        );

        const results = await this.searchSpotify(query);

        if (!Array.isArray(results) || results.length === 0) {
          this.sendSocketNotification("SPOTIFY_SEARCH_ERROR", {
            query: query,
            error: "no_results"
          });

          return res.status(404).json({
            ok: false,
            error: "no_results"
          });
        }

        this.sendSocketNotification("SPOTIFY_SEARCH_RESULTS", {
          query: query,
          results: results
        });

        await this.playSpotifyUri(results[0].uri);

        console.log(
          `[MMM-TuAsistente-Spotify] ▶️ Reproduciendo: ${results[0].title}`
        );

        return res.json({
          ok: true,
          query: query,
          result: results[0]
        });

      } catch (error) {
        console.error(
          "[MMM-TuAsistente-Spotify] ❌ Error búsqueda por voz:",
          error
        );

        this.sendSocketNotification("SPOTIFY_SEARCH_ERROR", {
          query: query,
          error: error.message
        });

        return res.status(500).json({
          ok: false,
          error: error.message
        });
      }
    });

    // Proxy local para portadas de Spotify.
    // Evita que Electron tenga que cargar directamente i.scdn.co.
    app.get("/cover", async (req, res) => {

      try {

        const imageUrl =
          String(req.query.url || "").trim();

        if (
          !imageUrl ||
          !/^https:\/\/i\.scdn\.co\/image\//.test(imageUrl)
        ) {
          return res.status(400).send("URL de portada inválida");
        }

        const response =
          await fetch(imageUrl);

        if (!response.ok) {
          console.error(
            "[MMM-TuAsistente-Spotify] Error descargando portada:",
            response.status
          );

          return res.status(response.status).send(
            "No se pudo obtener la portada"
          );
        }

        const contentType =
          response.headers.get("content-type") ||
          "image/jpeg";

        const buffer =
          Buffer.from(
            await response.arrayBuffer()
          );

        res.setHeader(
          "Content-Type",
          contentType
        );

        res.setHeader(
          "Cache-Control",
          "public, max-age=86400"
        );

        res.setHeader(
          "Access-Control-Allow-Origin",
          "*"
        );

        res.send(buffer);

      } catch (err) {

        console.error(
          "[MMM-TuAsistente-Spotify] Error proxy portada:",
          err.message
        );

        res.status(500).send(
          "Error obteniendo portada"
        );
      }
    });

    app.get("/callback", async (req, res) => {

      try {

        if (req.query.error) {

          res.send(`
            <html>
            <body style="font-family:Arial;text-align:center;padding:50px">
              <h2>Spotify no autorizado</h2>
              <p>${req.query.error}</p>
              <p>Puedes cerrar esta ventana.</p>
            </body>
            </html>
          `);

          return;
        }

        const code = req.query.code;
        const state = req.query.state;

        if (!code || !state) {
          res.status(400).send("Falta code o state");
          return;
        }

        if (
          !this.oauthPending ||
          state !== this.oauthPending.state
        ) {

          console.error(
            "[MMM-TuAsistente-Spotify] State OAuth inválido"
          );

          res.status(400).send("Estado OAuth inválido");
          return;
        }

        const verifier =
          this.oauthPending.codeVerifier;

        this.oauthPending = null;

        const body = new URLSearchParams();

        body.set(
          "client_id",
          this.oauthConfig.clientId
        );

        if (this.oauthConfig.clientSecret) {
          body.set(
            "client_secret",
            this.oauthConfig.clientSecret
          );
        }

        body.set(
          "grant_type",
          "authorization_code"
        );

        body.set(
          "code",
          code
        );

        body.set(
          "redirect_uri",
          this.oauthConfig.redirectUri
        );

        body.set(
          "code_verifier",
          verifier
        );

        const response = await fetch(
          "https://accounts.spotify.com/api/token",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body: body.toString()
          }
        );

        const data = await response.json();

        if (!response.ok) {

          console.error(
            "[MMM-TuAsistente-Spotify] Error OAuth:",
            data.error
          );

          res.status(500).send(
            "Error conectando con Spotify"
          );

          return;
        }

        this.saveToken({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type,
          expires_at:
            Date.now() +
            Number(data.expires_in || 3600) * 1000
        });

        this.sendSocketNotification(
          "SPOTIFY_AUTH_SUCCESS"
        );

        res.send(`
          <html>
          <body style="font-family:Arial;text-align:center;padding:50px">
            <h1>✓ Spotify conectado</h1>
            <p>La cuenta de Spotify está conectada.</p>
            <p>Ya puedes cerrar esta ventana.</p>
          </body>
          </html>
        `);

      } catch (err) {

        console.error(
          "[MMM-TuAsistente-Spotify] Callback OAuth:",
          err.message
        );

        res.status(500).send(
          "Error interno OAuth"
        );
      }
    });

    app.listen(
      8888,
      "127.0.0.1",
      () => {

        console.log(
          "[MMM-TuAsistente-Spotify] OAuth callback activo en 127.0.0.1:8888"
        );
      }
    ).on("error", err => {

      console.error(
        "[MMM-TuAsistente-Spotify] Error servidor OAuth:",
        err.message
      );
    });
  },

  createAuthUrl: function () {

    if (
      !this.oauthConfig ||
      !this.oauthConfig.clientId
    ) {
      return null;
    }

    const codeVerifier =
      this.createCodeVerifier();

    const codeChallenge =
      this.createCodeChallenge(codeVerifier);

    const state =
      this.createState();

    this.oauthPending = {
      state: state,
      codeVerifier: codeVerifier
    };

    const params =
      new URLSearchParams();

    params.set(
      "client_id",
      this.oauthConfig.clientId
    );

    params.set(
      "response_type",
      "code"
    );

    params.set(
      "redirect_uri",
      this.oauthConfig.redirectUri
    );

    params.set(
      "code_challenge_method",
      "S256"
    );

    params.set(
      "code_challenge",
      codeChallenge
    );

    params.set(
      "state",
      state
    );

    params.set(
      "scope",
      "user-read-private"
    );

    return (
      "https://accounts.spotify.com/authorize?" +
      params.toString()
    );
  },

  getAccessToken: async function () {

    if (!this.token) {
      return null;
    }

    if (
      this.token.access_token &&
      this.token.expires_at &&
      Date.now() < this.token.expires_at - 60000
    ) {
      return this.token.access_token;
    }

    if (!this.token.refresh_token) {
      return null;
    }

    try {

      const body = new URLSearchParams();

      body.set("grant_type", "refresh_token");
      body.set("refresh_token", this.token.refresh_token);
      body.set("client_id", this.oauthConfig.clientId);

      if (this.oauthConfig.clientSecret) {
        body.set(
          "client_secret",
          this.oauthConfig.clientSecret
        );
      }

      const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body: body.toString()
        }
      );

      const data = await response.json();

      if (!response.ok) {

        console.error(
          "[MMM-TuAsistente-Spotify] Error renovando token:",
          data.error
        );

        this.spotify.authenticated = false;
        this.sendAuthState();

        return null;
      }

      this.saveToken({
        access_token: data.access_token,
        refresh_token:
          data.refresh_token ||
          this.token.refresh_token,
        token_type: data.token_type,
        expires_at:
          Date.now() +
          Number(data.expires_in || 3600) * 1000
      });

      return this.token.access_token;

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error refresh:",
        err.message
      );

      return null;
    }
  },

  spotifyFetch: async function (url, retry = true) {

    const accessToken =
      await this.getAccessToken();

    if (!accessToken) {
      throw new Error("NO_AUTH");
    }

    const response = await fetch(
      url,
      {
        headers: {
          Authorization:
            "Bearer " + accessToken
        }
      }
    );

    if (
      response.status === 401 &&
      retry
    ) {

      this.token.expires_at = 0;

      await this.getAccessToken();

      return this.spotifyFetch(
        url,
        false
      );
    }

    return response;
  },

  searchSpotify: async function (query) {

    const params = new URLSearchParams();

    params.set("q", query);
    params.set("type", "track");
    params.set("limit", "10");
    params.set("market", "ES");

    const response =
      await this.spotifyFetch(
        "https://api.spotify.com/v1/search?" +
        params.toString()
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message ||
        "Error de Spotify"
      );
    }

    const results = (
      data.tracks?.items || []
    ).map(track => ({
      uri: track.uri,
      title: track.name,
      artist: track.artists
        .map(a => a.name)
        .join(", "),
      album: track.album?.name || "",
      cover:
        track.album?.images?.[0]?.url || "",
      duration:
        Number(track.duration_ms || 0),
      spotifyUrl:
        track.external_urls?.spotify || ""
    }));

    // Guardamos la portada asociada a cada URI de Spotify
    for (const track of results) {
      if (track.uri && track.cover) {
        this.coverCache.set(
          track.uri,
          track.cover
        );
      }
    }

    return results;
  },

  getSpotifyTrackCover: async function (uri) {

    if (!uri) {
      return "";
    }

    const match =
      uri.match(/^spotify:track:([A-Za-z0-9]+)$/);

    if (!match) {
      return "";
    }

    const trackId = match[1];

    // Primero comprobamos la caché
    const cached =
      this.coverCache.get(uri);

    if (cached) {
      return cached;
    }

    try {

      console.log(
        "[MMM-TuAsistente-Spotify] Consultando portada Spotify:",
        trackId
      );

      const response =
        await this.spotifyFetch(
          "https://api.spotify.com/v1/tracks/" +
          trackId
        );

      const data =
        await response.json();

      if (!response.ok) {
        console.error(
          "[MMM-TuAsistente-Spotify] Error obteniendo pista:",
          data.error?.message || response.status
        );
        return "";
      }

      const cover =
        data.album?.images?.[0]?.url || "";

      if (cover) {

        this.coverCache.set(
          uri,
          cover
        );

        console.log(
          "[MMM-TuAsistente-Spotify] PORTADA API:",
          cover
        );
      }

      return cover;

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error portada API:",
        err.message
      );

      return "";
    }
  },

  sendAuthState: function () {

    this.sendSocketNotification(
      "SPOTIFY_AUTH_STATE",
      {
        authenticated:
          !!this.spotify.authenticated,

        oauthAuthenticated:
          !!this.spotify.authenticated,

        librespotAuthenticated:
          !!this.spotify.librespotAuthenticated,

        connected:
          !!this.spotify.connected
      }
    );
  },

  handleSearch: async function (query) {

    query = query.trim();

    if (!query) {
      return;
    }

    if (!this.spotify.authenticated) {

      this.sendSocketNotification(
        "SPOTIFY_SEARCH_ERROR",
        "Spotify no está conectado"
      );

      return;
    }

    try {

      console.log(
        "[MMM-TuAsistente-Spotify] Buscando:",
        query
      );

      const results =
        await this.searchSpotify(query);

      console.log(
        "[MMM-TuAsistente-Spotify] Resultados:",
        results.length
      );

      this.sendSocketNotification(
        "SPOTIFY_SEARCH_RESULTS",
        results
      );

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error búsqueda:",
        err.message
      );

      this.sendSocketNotification(
        "SPOTIFY_SEARCH_ERROR",
        err.message
      );
    }
  },

  playSpotifyUri: function (uri) {

    if (
      !/^spotify:track:[A-Za-z0-9]+$/.test(uri)
    ) {

      console.error(
        "[MMM-TuAsistente-Spotify] URI inválida:",
        uri
      );

      return;
    }

    console.log(
      "[MMM-TuAsistente-Spotify] Reproduciendo:",
      uri
    );

    this.sendCommand(
      "activate",
      response => {

        if (
          !response ||
          !response.startsWith("OK")
        ) {

          console.error(
            "[MMM-TuAsistente-Spotify] No se pudo activar Librespot"
          );

          return;
        }

        setTimeout(() => {

          this.sendCommand(
            "load " + uri,
            loadResponse => {

              console.log(
                "[MMM-TuAsistente-Spotify] LOAD:",
                loadResponse
              );
            }
          );

        }, 300);
      }
    );
  },

  socketNotificationReceived:
    function (notification, payload) {

      if (notification === "SPOTIFY_INIT") {

        if (payload && payload.socketPath) {
          this.socketPath = payload.socketPath;
        }

        if (payload) {
          console.log(
            "[MMM-TuAsistente-Spotify] SPOTIFY_INIT recibido:",
            {
              clientId: !!payload.spotifyClientId,
              clientSecret: !!payload.spotifyClientSecret,
              redirectUri: payload.spotifyRedirectUri || null
            }
          );

          this.oauthConfig = this.oauthConfig || {};

          if (payload.spotifyClientId) {
            this.oauthConfig.clientId =
              payload.spotifyClientId;
          }

          if (payload.spotifyClientSecret) {
            this.oauthConfig.clientSecret =
              payload.spotifyClientSecret;
          }

          if (payload.spotifyRedirectUri) {
            this.oauthConfig.redirectUri =
              payload.spotifyRedirectUri;
          }
        }

        this.sendCommand(
          "activate",
          response => {

            if (
              response &&
              response.startsWith("OK")
            ) {

              this.spotify.connected = true;

              this.sendSocketNotification(
                "SPOTIFY_CONNECTED"
              );

              this.sendState();
            }
          }
        );

        return;
      }

      if (notification === "SPOTIFY_AUTH") {

        const url =
          this.createAuthUrl();

        if (url) {

          const { execFile } =
            require("child_process");

          execFile(
            "env",
            ["DISPLAY=:0", "xdg-open", url],
            error => {

              if (error) {
                console.error(
                  "[MMM-TuAsistente-Spotify] Error abriendo OAuth:",
                  error.message
                );
              }
            }
          );

          this.sendSocketNotification(
            "SPOTIFY_AUTH_URL",
            url
          );
        }

        return;
      }

      if (notification === "SPOTIFY_SEARCH") {

        this.handleSearch(
          String(payload || "")
        );

        return;
      }

      if (notification === "SPOTIFY_PLAY_URI") {

        this.playSpotifyUri(
          String(payload || "")
        );

        return;
      }

      if (notification === "SPOTIFY_COMMAND") {

        this.sendCommand(
          payload,
          response => {

            if (response) {

              console.log(
                "[MMM-TuAsistente-Spotify] Comando:",
                payload,
                "->",
                response
              );
            }
          }
        );

        return;
      }
    },

  sendCommand: function (command, callback) {

    const socket =
      net.createConnection({
        path: this.socketPath
      });

    let response = "";

    socket.on("connect", () => {
      socket.write(command + "\n");
    });

    socket.on("data", data => {
      response += data.toString();
    });

    socket.on("end", () => {

      if (callback) {
        callback(response.trim());
      }
    });

    socket.on("error", err => {

      console.error(
        "[MMM-TuAsistente-Spotify] Socket:",
        err.message
      );

      this.spotify.connected = false;

      this.sendSocketNotification(
        "SPOTIFY_DISCONNECTED"
      );

      if (callback) {
        callback(null);
      }
    });
  },

  startEventsWatcher: function () {

    try {

      /*
       * LibreSpot genera continuamente:
       *
       * /tmp/tuasistente-spotify-events.ndjson
       *
       * El archivo puede no existir todavía cuando arranca
       * MagicMirror, por eso no hacemos return definitivo.
       */

      if (!fs.existsSync(this.eventsPath)) {

        try {
          fs.closeSync(
            fs.openSync(this.eventsPath, "a")
          );
        } catch (err) {
          console.error(
            "[MMM-TuAsistente-Spotify] No se pudo crear cola de eventos:",
            err.message
          );
        }
      }

      if (fs.existsSync(this.eventsPath)) {

        const stats =
          fs.statSync(this.eventsPath);

        this.eventsPosition =
          stats.size;

        fs.watchFile(
          this.eventsPath,
          { interval: 500 },
          () => {
            this.readNewEvents();
          }
        );

        console.log(
          "[MMM-TuAsistente-Spotify] Watcher de LibreSpot activo:",
          this.eventsPath
        );

      }

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error iniciando watcher:",
        err.message
      );
    }
  },

  readNewEvents: function () {

    try {

      if (!fs.existsSync(this.eventsPath)) {
        return;
      }

      const stats =
        fs.statSync(this.eventsPath);

      /*
       * Si LibreSpot ha truncado/recreado la cola,
       * empezamos desde el principio.
       */

      if (
        stats.size <
        this.eventsPosition
      ) {
        this.eventsPosition = 0;
      }

      if (
        stats.size ===
        this.eventsPosition
      ) {
        return;
      }

      const fd =
        fs.openSync(
          this.eventsPath,
          "r"
        );

      const length =
        stats.size -
        this.eventsPosition;

      const buffer =
        Buffer.alloc(length);

      fs.readSync(
        fd,
        buffer,
        0,
        length,
        this.eventsPosition
      );

      fs.closeSync(fd);

      this.eventsPosition =
        stats.size;

      const lines =
        buffer
          .toString("utf8")
          .split("\n")
          .filter(line => line.trim());

      for (const line of lines) {

        try {

          this.processSpotifyEvent(
            JSON.parse(line)
          );

        } catch (err) {

          console.error(
            "[MMM-TuAsistente-Spotify] JSON de LibreSpot inválido:",
            err.message
          );

        }

      }

    } catch (err) {

      console.error(
        "[MMM-TuAsistente-Spotify] Error leyendo eventos:",
        err.message
      );

    }
  },

  processSpotifyEvent: function (event) {

    if (!event || !event.event) {
      return;
    }

    console.log(
      "[MMM-TuAsistente-Spotify] LibreSpot:",
      event.event
    );

    switch (event.event) {

      case "session_connected":

        this.spotify.connected = true;

        break;


      case "session_disconnected":

        this.spotify.connected = false;
        this.spotify.playing = false;
        this.spotify.loading = false;

        break;


      case "loading":

        this.spotify.connected = true;
        this.spotify.loading = true;

        if (event.trackId) {

          this.spotify.uri =
            "spotify:track:" +
            event.trackId;

        }

        break;


      case "track_changed":

        this.spotify.connected = true;
        this.spotify.loading = false;

        this.spotify.title =
          event.name || "";

        this.spotify.artist =
          event.artists || "";

        this.spotify.album =
          event.album || "";

        this.spotify.uri =
          event.uri ||
          (
            event.trackId
              ? "spotify:track:" + event.trackId
              : ""
          );

        this.spotify.position =
          Number(event.positionMs || 0);

        this.spotify.duration =
          Number(event.durationMs || 0);

        this.spotify.volume =
          this.normalizeVolume(event.volume);

        const trackUri =
          this.spotify.uri;

        const librespotCover =
          this.getFirstCover(event.covers);

        const cachedCover =
          trackUri
            ? this.coverCache.get(trackUri) || ""
            : "";

        // Al cambiar de pista nunca conservamos la portada
        // de la canción anterior.
        this.spotify.cover =
          librespotCover ||
          cachedCover ||
          "";

        console.log(
          "[MMM-TuAsistente-Spotify] COVER DEBUG:",
          JSON.stringify({
            uri: this.spotify.uri,
            librespotCover: librespotCover,
            cachedCover: cachedCover,
            finalCover: this.spotify.cover
          })
        );

        // Si LibreSpot no proporciona portada,
        // la obtenemos directamente desde Spotify.
        if (
          !this.spotify.cover &&
          this.spotify.uri
        ) {

          this.getSpotifyTrackCover(
            this.spotify.uri
          ).then(cover => {

            if (cover) {

              this.spotify.cover = cover;

              console.log(
                "[MMM-TuAsistente-Spotify] COVER API ASIGNADA:",
                cover
              );

              this.sendState();
            }

          }).catch(err => {

            console.error(
              "[MMM-TuAsistente-Spotify] Error portada:",
              err.message
            );

          });
        }

        break;


      case "playing":

        this.spotify.connected = true;
        this.spotify.playing = true;
        this.spotify.loading = false;

        break;


      case "paused":

        this.spotify.playing = false;
        this.spotify.loading = false;

        break;


      case "stopped":

        this.spotify.playing = false;
        this.spotify.loading = false;

        break;


      case "volume_changed":

        this.spotify.volume =
          this.normalizeVolume(event.volume);

        break;


      case "shuffle_changed":

        this.spotify.shuffle =
          String(event.shuffle) === "true";

        break;


      case "repeat_changed":

        this.spotify.repeat =
          String(event.repeat) === "true";

        break;


      /*
       * Estos eventos son informativos y no deben
       * alterar el estado de reproducción.
       */

      case "session_client_changed":
      case "auto_play_changed":
      case "filter_explicit_content_changed":

        break;

    }

    this.sendState();
  },

  getFirstCover: function (covers) {

    if (!covers) {
      return "";
    }

    if (Array.isArray(covers)) {
      return covers.find(Boolean) || "";
    }

    if (typeof covers === "string") {

      const value = covers.trim();

      if (!value) {
        return "";
      }

      // LibreSpot puede enviar varias portadas
      // separadas por saltos de línea, comas o espacios.
      const parts = value
        .split(/[\\s,]+/)
        .map(v => v.trim())
        .filter(Boolean);

      for (const part of parts) {
        if (
          part.startsWith("http://") ||
          part.startsWith("https://")
        ) {
          return part;
        }
      }

      return "";
    }

    return "";
  },

  normalizeVolume: function (value) {

    const volume =
      Number(value);

    if (!Number.isFinite(volume)) {
      return 0;
    }

    /*
     * LibreSpot entrega normalmente el volumen
     * como rango 0..65535.
     */

    if (volume > 100) {

      return Math.round(
        Math.max(
          0,
          Math.min(
            100,
            (volume / 65535) * 100
          )
        )
      );

    }

    return Math.round(
      Math.max(
        0,
        Math.min(
          100,
          volume
        )
      )
    );
  },

  sendState: function () {

    this.sendSocketNotification(
      "SPOTIFY_STATE",
      Object.assign({}, this.spotify)
    );
  },

  stop: function () {

    try {
      fs.unwatchFile(
        this.eventsPath
      );
    } catch (err) {}
  }

});
