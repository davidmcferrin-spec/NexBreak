"use strict";
(function () {
  var api = window.NexBreakAPI;
  var whep = window.NexBreakWHEP;
  var cc = window.NexBreakCC;
  var grid = document.getElementById("preview-grid");
  var btnCc = document.getElementById("btn-cc");
  var players = [];
  var ccClients = [];
  var captionsOn = cc ? cc.getPref() : false;

  function syncCcButton() {
    if (!btnCc) return;
    btnCc.textContent = captionsOn ? "CC ON" : "CC";
    btnCc.className = captionsOn ? "primary" : "";
    btnCc.setAttribute("aria-pressed", captionsOn ? "true" : "false");
  }

  function setMuted(video, muteBtn, muted) {
    video.muted = !!muted;
    if (muteBtn) muteBtn.textContent = video.muted ? "Unmute" : "Mute";
  }

  function teardown() {
    players.forEach(function (p) {
      try {
        p.disconnect();
      } catch (e) {}
    });
    players = [];
    ccClients.forEach(function (c) {
      try {
        c.close();
      } catch (e) {}
    });
    ccClients = [];
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
      "WHEP " + whep.whepBase(port) + "/<path>/whep · click Unmute for audio";

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
      card.dataset.path = ch.preview_path;
      card.innerHTML =
        '<div class="title"><strong>' +
        api.esc(ch.name) +
        '</strong><span class="badge dim">' +
        api.esc(ch.preview_path) +
        "</span></div>" +
        '<div class="preview-slot"><video playsinline autoplay muted></video>' +
        '<div class="pane-cc" hidden aria-live="polite"></div>' +
        '<div class="preview-state muted">idle</div></div>' +
        '<div class="bar">' +
        '<button type="button" class="primary" data-act="play">Play</button>' +
        '<button type="button" data-act="stop">Stop</button>' +
        '<button type="button" data-act="unmute">Unmute</button>' +
        "</div>";

      var video = card.querySelector("video");
      var stateEl = card.querySelector(".preview-state");
      var ccEl = card.querySelector(".pane-cc");
      var muteBtn = card.querySelector('[data-act="unmute"]');
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

      if (cc) {
        var client = cc.connect(function (cue) {
          cc.renderOverlay(ccEl, cue, captionsOn);
        });
        client.setPath(ch.preview_path);
        ccClients.push(client);
      }

      card.querySelector('[data-act="play"]').addEventListener("click", function () {
        player.connect();
        // User gesture: allow audible playback after Play.
        setMuted(video, muteBtn, false);
        video.play().catch(function () {});
      });
      card.querySelector('[data-act="stop"]').addEventListener("click", function () {
        player.disconnect();
      });
      muteBtn.addEventListener("click", function () {
        setMuted(video, muteBtn, !video.muted);
        if (!video.muted) video.play().catch(function () {});
      });
      video.addEventListener("click", function () {
        setMuted(video, muteBtn, !video.muted);
        if (!video.muted) video.play().catch(function () {});
      });

      grid.appendChild(card);
      player.connect();
    });
  }

  if (btnCc && cc) {
    syncCcButton();
    btnCc.addEventListener("click", function () {
      captionsOn = !captionsOn;
      cc.setPref(captionsOn);
      syncCcButton();
      // Re-render current overlays from last SSE by toggling visibility via empty clear
      // if off; when on, next SSE tick paints. Force a snapshot per client path:
      ccClients.forEach(function (client) {
        var path = client.getPath();
        if (!path) return;
        fetch("/cc.php?path=" + encodeURIComponent(path) + "&once=1")
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            if (!data || !data.ok) return;
            var card = grid.querySelector('.channel-card[data-path="' + path + '"]');
            if (!card) return;
            cc.renderOverlay(card.querySelector(".pane-cc"), data, captionsOn);
          })
          .catch(function () {});
      });
      if (!captionsOn) {
        grid.querySelectorAll(".pane-cc").forEach(function (el) {
          cc.renderOverlay(el, { clear: true }, false);
        });
      }
    });
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  window.addEventListener("beforeunload", teardown);
  load();
})();
