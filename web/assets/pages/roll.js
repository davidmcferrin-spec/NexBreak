"use strict";
(function () {
  var api = window.NexBreakAPI;
  var whep = window.NexBreakWHEP;
  var vuApi = window.NexBreakVu;
  var grid = document.getElementById("roll-grid");
  var btnVu = document.getElementById("btn-vu");
  var btnMute = document.getElementById("btn-mute");
  var volEl = document.getElementById("volume");
  var volPct = document.getElementById("vol-pct");

  var players = [];
  var cards = []; // { ch, el, path, vu, video }
  var presets = [];
  var listenPath = null; // which card's audio is armed (click to select)
  var vuOn = vuApi ? vuApi.getVisiblePref() : true;
  var userMuted = vuApi ? vuApi.getMutedPref() : true;

  function offsetLabel(raw) {
    var ms = Number(raw);
    if (!Number.isFinite(ms) || ms === 0) return "Offset 0 ms";
    if (ms < 0) return "Video held " + Math.abs(ms) + " ms";
    return "Trigger held " + ms + " ms";
  }

  function paintVuBtn() {
    if (!btnVu) return;
    btnVu.classList.toggle("active", vuOn);
    btnVu.classList.toggle("primary", vuOn);
    btnVu.setAttribute("aria-pressed", vuOn ? "true" : "false");
  }

  function paintMuteBtn() {
    if (!btnMute) return;
    var muted = userMuted || !listenPath;
    btnMute.classList.toggle("active", muted);
    btnMute.classList.toggle("primary", !muted);
    btnMute.textContent = muted ? "Muted" : "Mute";
    btnMute.setAttribute("aria-pressed", muted ? "true" : "false");
  }

  function paintVolume() {
    if (!vuApi || !volEl) return;
    var v = vuApi.getVolumePref();
    volEl.value = String(Math.round(v * 100));
    if (volPct) volPct.textContent = Math.round(v * 100) + "%";
  }

  function syncListen() {
    cards.forEach(function (c) {
      if (!c.vu) return;
      var on = !userMuted && listenPath === c.path;
      c.vu.setListen(on, { persist: false });
      c.el.classList.toggle("listening", on);
    });
    paintMuteBtn();
  }

  function selectListen(path) {
    if (!path) return;
    if (listenPath === path && !userMuted) {
      // Toggle mute when re-clicking the active card.
      userMuted = true;
      if (vuApi) vuApi.setMutedPref(true);
    } else {
      listenPath = path;
      userMuted = false;
      if (vuApi) vuApi.setMutedPref(false);
      if (vuApi) vuApi.resume();
    }
    syncListen();
  }

  function teardown() {
    cards.forEach(function (c) {
      if (c.vu) {
        try {
          c.vu.detach();
        } catch (e) {}
      }
    });
    cards = [];
    players.forEach(function (p) {
      try {
        p.disconnect();
      } catch (e) {}
    });
    players = [];
  }

  async function fire(channelId, preset, btn) {
    btn.disabled = true;
    try {
      var body = { processing_channel_id: channelId };
      if (preset && preset.slug) body.preset = preset.slug;
      else if (preset && preset.splice_type) body.splice_type = preset.splice_type;
      var res = await api.post("/v1/splice", body);
      if (!res.ok || !res.data || !res.data.ok) {
        api.toast((res.data && res.data.error) || "Splice failed", "error");
        return;
      }
      api.toast(
        (preset && preset.label ? preset.label + " · " : "") +
          "event " +
          (res.data.event_id != null ? res.data.event_id : "—") +
          " · delay " +
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
    var [proc, preview, pr] = await Promise.all([
      api.get("/v1/processing"),
      api.get("/v1/preview"),
      api.get("/v1/splice/presets?enabled=1"),
    ]);
    if (!proc.ok || !proc.data) {
      grid.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    presets = (pr.ok && pr.data && pr.data.presets) || [];
    if (!presets.length) {
      presets = [
        { slug: "roll", label: "ROLL", splice_type: "splice_start_immediate" },
        { slug: "end", label: "END", splice_type: "splice_end_immediate" },
        { slug: "cancel", label: "CANCEL", splice_type: "splice_cancel" },
      ];
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
            '<div class="preview-state muted">idle</div>'
          : '<div class="muted">Preview off</div>') +
        "</div>" +
        '<div class="muted">' +
        api.esc(offsetLabel(ch.splice_insertion_delay_ms)) +
        " · " +
        api.esc(path) +
        (previewOn ? " · click card for audio" : "") +
        '</div><div class="bar"></div>';

      var entry = { ch: ch, el: card, path: path, vu: null, video: null };

      if (previewOn) {
        var video = card.querySelector("video");
        var slot = card.querySelector(".preview-slot");
        var stateEl = card.querySelector(".preview-state");
        entry.video = video;

        if (vuApi && slot) {
          entry.vu = vuApi.attach({
            container: slot,
            video: video,
            listen: false,
            layout: "stereo",
            stereoOnly: true,
            visible: vuOn,
            volume: vuApi.getVolumePref(),
          });
        }

        var player = whep.create(video, {
          path: path,
          whepPort: whepPort,
          onState: function (s) {
            stateEl.textContent = s.message;
            stateEl.className =
              "preview-state " +
              (s.kind === "ok" ? "ok" : s.kind === "bad" ? "bad" : "muted");
          },
          onStream: function (stream) {
            if (entry.vu) entry.vu.setStream(stream, "stereo");
          },
        });
        players.push(player);
        player.connect();

        card.addEventListener("click", function (ev) {
          if (ev.target.closest("button, select, input, .nexbreak-vu")) return;
          selectListen(path);
        });
        video.title = "Click card to listen / mute";
      }

      var bar = card.querySelector(".bar");
      presets.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t.label || t.slug;
        var st = t.splice_type || "";
        if (st.indexOf("start") >= 0) b.className = "roll";
        if (st === "splice_cancel") b.className = "danger";
        b.addEventListener("click", function () {
          fire(ch.id, t, b);
        });
        bar.appendChild(b);
      });

      var asrPolicy = ch.caption_policy || (Number(ch.captioning_enabled) ? "auto" : "off");
      var asrBtn = document.createElement("button");
      asrBtn.type = "button";
      asrBtn.textContent =
        asrPolicy === "force_asr" ? "Force ASR" : asrPolicy === "off" ? "CC Off" : "CC Auto";
      asrBtn.className = asrPolicy === "off" ? "" : "primary";
      asrBtn.title =
        "Cycle caption policy: Auto → Force ASR → Off. Force ASR inserts CEA-608 on egress (H.264).";
      asrBtn.addEventListener("click", async function () {
        var order = ["auto", "force_asr", "off"];
        var idx = order.indexOf(asrPolicy);
        var next = order[(idx + 1) % order.length];
        asrBtn.disabled = true;
        var res = await api.post("/v1/processing/" + ch.id + "/captioning", {
          policy: next,
        });
        asrBtn.disabled = false;
        if (!res.ok || !res.data || !res.data.ok) {
          api.toast((res.data && res.data.error) || "Caption policy failed", "error");
          return;
        }
        asrPolicy = next;
        asrBtn.textContent =
          asrPolicy === "force_asr" ? "Force ASR" : asrPolicy === "off" ? "CC Off" : "CC Auto";
        asrBtn.className = asrPolicy === "off" ? "" : "primary";
        var rt = res.data.runtime || {};
        api.toast(
          "Policy " +
            asrPolicy +
            (rt.effective_mode ? " · " + rt.effective_mode : "") +
            (rt.source_has_cc != null ? " · source CC " + (rt.source_has_cc ? "yes" : "no") : ""),
          "success"
        );
      });
      bar.appendChild(asrBtn);

      cards.push(entry);
      grid.appendChild(card);
    });

    syncListen();
  }

  if (btnVu && vuApi) {
    paintVuBtn();
    btnVu.addEventListener("click", function () {
      vuOn = !vuOn;
      vuApi.setVisiblePref(vuOn);
      paintVuBtn();
      cards.forEach(function (c) {
        if (c.vu) c.vu.setVisible(vuOn);
      });
    });
  }

  if (btnMute && vuApi) {
    paintMuteBtn();
    btnMute.addEventListener("click", function () {
      if (!listenPath && cards.length) {
        // First unmute: pick first preview card.
        var first = cards.find(function (c) {
          return c.vu;
        });
        if (first) listenPath = first.path;
      }
      userMuted = !userMuted;
      vuApi.setMutedPref(userMuted);
      if (!userMuted) vuApi.resume();
      syncListen();
    });
  }

  if (volEl && vuApi) {
    paintVolume();
    volEl.addEventListener("input", function () {
      var v = (parseInt(volEl.value, 10) || 0) / 100;
      vuApi.setVolumePref(v);
      cards.forEach(function (c) {
        if (c.vu) c.vu.setVolume(v);
      });
      paintVolume();
      if (v > 0 && userMuted) {
        userMuted = false;
        vuApi.setMutedPref(false);
        if (!listenPath) {
          var first = cards.find(function (c) {
            return c.vu;
          });
          if (first) listenPath = first.path;
        }
        vuApi.resume();
        syncListen();
      }
      vuApi.resume();
    });
  }

  window.addEventListener("beforeunload", teardown);
  paintVuBtn();
  paintMuteBtn();
  paintVolume();
  load();
})();
