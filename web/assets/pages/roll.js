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

  var presets = [];

  function syncCcButton() {
    if (!btnCc) return;
    btnCc.textContent = captionsOn ? "CC ON" : "CC";
    btnCc.className = captionsOn ? "primary" : "";
    btnCc.setAttribute("aria-pressed", captionsOn ? "true" : "false");
  }

  function offsetLabel(raw) {
    var ms = Number(raw);
    if (!Number.isFinite(ms) || ms === 0) return "Offset 0 ms";
    if (ms < 0) return "Video held " + Math.abs(ms) + " ms";
    return "Trigger held " + ms + " ms";
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
            '<div class="pane-cc" hidden aria-live="polite"></div>' +
            '<div class="preview-state muted">idle</div>'
          : '<div class="muted">Preview off</div>') +
        "</div>" +
        '<div class="muted">' +
        api.esc(offsetLabel(ch.splice_insertion_delay_ms)) +
        " · " +
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
