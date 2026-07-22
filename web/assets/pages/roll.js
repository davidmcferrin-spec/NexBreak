"use strict";
(function () {
  var api = window.NexBreakAPI;
  var whep = window.NexBreakWHEP;
  var grid = document.getElementById("roll-grid");
  var players = [];

  var SPLICE_TYPES = [
    { value: "splice_start_immediate", label: "ROLL" },
    { value: "splice_end_immediate", label: "END" },
    { value: "splice_cancel", label: "CANCEL" },
  ];

  function teardown() {
    players.forEach(function (p) {
      try {
        p.disconnect();
      } catch (e) {}
    });
    players = [];
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
      card.innerHTML =
        '<div class="title"><strong>' +
        api.esc(ch.name) +
        '</strong><span class="badge dim">' +
        api.esc(ch.input_type) +
        "</span></div>" +
        '<div class="preview-slot">' +
        (previewOn
          ? '<video playsinline autoplay muted></video><div class="preview-state muted">idle</div>'
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

      var capOn = Number(ch.captioning_enabled) === 1;
      var capBtn = document.createElement("button");
      capBtn.type = "button";
      capBtn.textContent = capOn ? "CC ON" : "CC OFF";
      capBtn.className = capOn ? "primary" : "";
      capBtn.title = "Toggle closed captioning / Vosk for this stream only";
      capBtn.addEventListener("click", async function () {
        var next = !capOn;
        capBtn.disabled = true;
        var res = await api.post("/v1/processing/" + ch.id + "/captioning", {
          enabled: next ? 1 : 0,
        });
        capBtn.disabled = false;
        if (!res.ok || !res.data || !res.data.ok) {
          api.toast((res.data && res.data.error) || "Caption toggle failed", "error");
          return;
        }
        capOn = next;
        capBtn.textContent = capOn ? "CC ON" : "CC OFF";
        capBtn.className = capOn ? "primary" : "";
        var rt = res.data.runtime || {};
        api.toast(
          capOn
            ? "Captions on · Vosk " + (rt.running ? "running" : "starting")
            : "Captions bypassed · Vosk stopped",
          "success"
        );
      });
      bar.appendChild(capBtn);

      grid.appendChild(card);
    });
  }

  window.addEventListener("beforeunload", teardown);
  load();
})();
