"use strict";
(function () {
  var api = window.NexBreakAPI;
  var whep = window.NexBreakWHEP;
  var cc = window.NexBreakCC;
  var grid = document.getElementById("roll-grid");
  var btnCc = document.getElementById("btn-cc");
  var players = [];
  var ccClients = [];
  var captionsOn = cc ? cc.getPref() : false;

  var SPLICE_TYPES = [
    { value: "splice_start_immediate", label: "ROLL" },
    { value: "splice_end_immediate", label: "END" },
    { value: "splice_cancel", label: "CANCEL" },
  ];

  function syncCcButton() {
    if (!btnCc) return;
    btnCc.textContent = captionsOn ? "CC ON" : "CC";
    btnCc.className = captionsOn ? "primary" : "";
    btnCc.setAttribute("aria-pressed", captionsOn ? "true" : "false");
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

  async function fire(channelId, spliceType, btn) {
    btn.disabled = true;
    try {
      var res = await api.post("/v1/splice", {
        processing_channel_id: channelId,
        splice_type: spliceType,
      });
      if (!res.ok || !res.data || !res.data.ok) {
        api.toast((res.data && res.data.error) || "Splice failed", "error");
        return;
      }
      api.toast(
        "Injected · delay " +
          (res.data.delay_ms || 0) +
          " ms · audit #" +
          res.data.audit_id,
        "success"
      );
    } catch (err) {
      api.toast(String(err.message || err), "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function load() {
    teardown();
    var [proc, preview] = await Promise.all([
      api.get("/v1/processing"),
      api.get("/v1/preview"),
    ]);
    if (!proc.ok || !proc.data) {
      grid.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }

    var whepPort =
      (preview.data && preview.data.whep_port) || window.NEXBREAK_WHEP_PORT || 8889;
    var pathById = {};
    ((preview.data && preview.data.channels) || []).forEach(function (c) {
      pathById[c.id] = c;
    });

    var channels = (proc.data.channels || []).filter(function (c) {
      return Number(c.enabled) === 1;
    });
    if (!channels.length) {
      grid.innerHTML = '<div class="empty">No enabled processing channels</div>';
      return;
    }

    grid.innerHTML = "";
    channels.forEach(function (ch) {
      var meta = pathById[ch.id] || {};
      var path = meta.preview_path || "nb" + ch.service_name;
      var previewOn = meta.preview_enabled == null || Number(meta.preview_enabled) === 1;

      var card = document.createElement("div");
      card.className = "channel-card";
      card.dataset.path = path;
      card.innerHTML =
        '<div class="title"><strong>' +
        api.esc(ch.name) +
        '</strong><span class="badge dim">' +
        api.esc(ch.input_type) +
        "</span></div>" +
        '<div class="preview-slot">' +
        (previewOn
          ? '<video playsinline autoplay muted></video>' +
            '<div class="pane-cc" hidden aria-live="polite"></div>' +
            '<div class="preview-state muted">idle</div>'
          : '<div class="muted">Preview off</div>') +
        "</div>" +
        '<div class="muted">Delay ' +
        api.esc(String(ch.splice_insertion_delay_ms)) +
        " ms · " +
        api.esc(path) +
        '</div><div class="bar"></div>';

      if (previewOn) {
        var video = card.querySelector("video");
        var stateEl = card.querySelector(".preview-state");
        var ccEl = card.querySelector(".pane-cc");
        var player = whep.create(video, {
          path: path,
          whepPort: whepPort,
          onState: function (s) {
            stateEl.textContent = s.message;
            stateEl.className =
              "preview-state " +
              (s.kind === "ok" ? "ok" : s.kind === "bad" ? "bad" : "muted");
          },
        });
        players.push(player);
        player.connect();

        video.addEventListener("click", function () {
          video.muted = !video.muted;
          if (!video.muted) video.play().catch(function () {});
        });
        video.title = "Click to mute/unmute";

        if (cc) {
          var client = cc.connect(function (cue) {
            cc.renderOverlay(ccEl, cue, captionsOn);
          });
          client.setPath(path);
          ccClients.push(client);
        }
      }

      var bar = card.querySelector(".bar");
      SPLICE_TYPES.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t.label;
        if (t.value === "splice_start_immediate") b.className = "roll";
        if (t.value === "splice_cancel") b.className = "danger";
        b.addEventListener("click", function () {
          fire(ch.id, t.value, b);
        });
        bar.appendChild(b);
      });

      var asrOn = Number(ch.captioning_enabled) === 1;
      var asrBtn = document.createElement("button");
      asrBtn.type = "button";
      asrBtn.textContent = asrOn ? "ASR ON" : "ASR";
      asrBtn.className = asrOn ? "primary" : "";
      asrBtn.title = "Toggle live ASR caption generation for this stream (Vosk)";
      asrBtn.addEventListener("click", async function () {
        var next = !asrOn;
        asrBtn.disabled = true;
        var res = await api.post("/v1/processing/" + ch.id + "/captioning", {
          enabled: next ? 1 : 0,
        });
        asrBtn.disabled = false;
        if (!res.ok || !res.data || !res.data.ok) {
          api.toast((res.data && res.data.error) || "Caption toggle failed", "error");
          return;
        }
        asrOn = next;
        asrBtn.textContent = asrOn ? "ASR ON" : "ASR";
        asrBtn.className = asrOn ? "primary" : "";
        var rt = res.data.runtime || {};
        api.toast(
          asrOn
            ? "ASR on · Vosk " + (rt.running ? "running" : "starting")
            : "ASR bypassed · Vosk stopped",
          "success"
        );
      });
      bar.appendChild(asrBtn);

      grid.appendChild(card);
    });
  }

  if (btnCc && cc) {
    syncCcButton();
    btnCc.addEventListener("click", function () {
      captionsOn = !captionsOn;
      cc.setPref(captionsOn);
      syncCcButton();
      if (!captionsOn) {
        grid.querySelectorAll(".pane-cc").forEach(function (el) {
          cc.renderOverlay(el, { clear: true }, false);
        });
        return;
      }
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
            cc.renderOverlay(card.querySelector(".pane-cc"), data, true);
          })
          .catch(function () {});
      });
    });
  }

  window.addEventListener("beforeunload", teardown);
  load();
})();
