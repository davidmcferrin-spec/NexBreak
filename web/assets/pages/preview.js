"use strict";
(function () {
  var api = window.NexBreakAPI;
  var whep = window.NexBreakWHEP;
  var grid = document.getElementById("preview-grid");
  var players = [];

  function teardown() {
    players.forEach(function (p) {
      try {
        p.disconnect();
      } catch (e) {}
    });
    players = [];
  }

  async function load() {
    teardown();
    var res = await api.get("/v1/preview");
    if (!res.ok || !res.data) {
      grid.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var port = res.data.whep_port || window.NEXBREAK_WHEP_PORT || 8889;
    document.getElementById("whep-hint").textContent =
      "WHEP " + whep.whepBase(port) + "/<path>/whep";

    var channels = (res.data.channels || []).filter(function (c) {
      return Number(c.preview_enabled) === 1;
    });
    if (!channels.length) {
      grid.innerHTML = '<div class="empty">No preview-enabled channels</div>';
      return;
    }

    grid.innerHTML = "";
    channels.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "channel-card";
      card.innerHTML =
        '<div class="title"><strong>' +
        api.esc(ch.name) +
        '</strong><span class="badge dim">' +
        api.esc(ch.preview_path) +
        "</span></div>" +
        '<div class="preview-slot"><video playsinline autoplay muted></video>' +
        '<div class="preview-state muted">idle</div></div>' +
        '<div class="bar">' +
        '<button type="button" class="primary" data-act="play">Play</button>' +
        '<button type="button" data-act="stop">Stop</button>' +
        '<button type="button" data-act="unmute">Unmute</button>' +
        "</div>";

      var video = card.querySelector("video");
      var stateEl = card.querySelector(".preview-state");
      var player = whep.create(video, {
        path: ch.preview_path,
        whepPort: port,
        onState: function (s) {
          stateEl.textContent = s.message;
          stateEl.className =
            "preview-state " + (s.kind === "ok" ? "ok" : s.kind === "bad" ? "bad" : "muted");
        },
      });
      players.push(player);

      card.querySelector('[data-act="play"]').addEventListener("click", function () {
        player.connect();
      });
      card.querySelector('[data-act="stop"]').addEventListener("click", function () {
        player.disconnect();
      });
      card.querySelector('[data-act="unmute"]').addEventListener("click", function () {
        video.muted = !video.muted;
        this.textContent = video.muted ? "Unmute" : "Mute";
      });

      grid.appendChild(card);
      // Auto-connect so the page is immediately useful
      player.connect();
    });
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  window.addEventListener("beforeunload", teardown);
  load();
})();
