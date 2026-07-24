"use strict";
(function () {
  var api = window.NexBreakAPI;
  var procModal = document.getElementById("proc-modal");
  var egrModal = document.getElementById("egr-modal");
  var tipEl = document.getElementById("field-tip");
  var lastProc = [];
  var lastEgr = [];
  var assignments = {}; // egress_channel_id → processing_channel_id
  var unitStatus = {}; // unit name → { state, enabled }
  var tipTimer = null;
  var tipAnchor = null;

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("nb-modal-open");
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (
      (procModal && !procModal.hidden) ||
      (egrModal && !egrModal.hidden)
    ) {
      return;
    }
    document.body.classList.remove("nb-modal-open");
    hideTip();
  }

  function hideTip() {
    if (tipTimer) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }
    tipAnchor = null;
    if (tipEl) tipEl.hidden = true;
  }

  function showTip(anchor) {
    if (!tipEl || !anchor) return;
    var text = anchor.getAttribute("data-help");
    if (!text) return;
    tipEl.textContent = text;
    tipEl.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var tipW = tipEl.offsetWidth || 280;
    var tipH = tipEl.offsetHeight || 60;
    var left = Math.min(
      window.innerWidth - tipW - 12,
      Math.max(12, rect.left)
    );
    var top = rect.bottom + 8;
    if (top + tipH > window.innerHeight - 12) {
      top = Math.max(12, rect.top - tipH - 8);
    }
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }

  function bindHelpTips(root) {
    if (!root) return;
    root.querySelectorAll("[data-help]").forEach(function (el) {
      if (el.dataset.tipBound) return;
      el.dataset.tipBound = "1";
      el.addEventListener("mouseenter", function () {
        hideTip();
        tipAnchor = el;
        tipTimer = setTimeout(function () {
          if (tipAnchor === el) showTip(el);
        }, 2000);
      });
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("focusin", function () {
        hideTip();
        tipAnchor = el;
        tipTimer = setTimeout(function () {
          if (tipAnchor === el) showTip(el);
        }, 2000);
      });
      el.addEventListener("focusout", hideTip);
    });
  }

  function unitName(kind, serviceName) {
    var prefix = kind === "proc" ? "nexbreak-proc@" : "nexbreak-egress@";
    return prefix + String(serviceName);
  }

  function isParked(state, enabled) {
    return enabled === "disabled" && (state === "inactive" || state === "failed");
  }

  function statusMeta(svc) {
    if (!svc) {
      return { cls: "dim", label: "unknown", title: "No systemd status (ops helpers?)" };
    }
    var state = svc.state || "unknown";
    var enabled = svc.enabled || "unknown";
    if (isParked(state, enabled)) {
      return { cls: "dim", label: "disabled", title: "Unit disabled" };
    }
    if (state === "active") {
      return { cls: "ok", label: "running", title: "active · " + enabled };
    }
    if (state === "activating") {
      return { cls: "warn", label: "starting", title: state + " · " + enabled };
    }
    if (state === "deactivating") {
      return { cls: "warn", label: "stopping", title: state + " · " + enabled };
    }
    if (state === "failed") {
      return { cls: "bad", label: "failed", title: "failed · " + enabled };
    }
    if (state === "inactive") {
      return {
        cls: enabled === "enabled" ? "bad" : "dim",
        label: "stopped",
        title: "inactive · " + enabled,
      };
    }
    return { cls: "dim", label: state, title: state + " · " + enabled };
  }

  function statusBadge(kind, channel) {
    var unit = unitName(kind, channel.service_name);
    var meta = statusMeta(unitStatus[unit]);
    return (
      '<span class="status-pill badge ' +
      meta.cls +
      '" title="' +
      api.esc(meta.title + " (" + unit + ")") +
      '">' +
      '<span class="status-dot" aria-hidden="true"></span>' +
      api.esc(meta.label) +
      "</span>"
    );
  }

  function fmtBitrate(ch) {
    var sensed = ch.sensed_bitrate_kbps;
    var out = ch.output_bitrate_kbps;
    if (sensed == null && out == null) return "—";
    var s = sensed != null ? sensed + " in" : "? in";
    var o = out != null ? out + " out" : "? out";
    return s + " / " + o;
  }

  /** ~29.97 fps frame duration used only for the UI hint. */
  var FRAME_MS = 1000 / 29.97;

  function clampOffsetMs(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(-2000, Math.min(2000, Math.round(n)));
  }

  function updateDelayHint() {
    var el = document.getElementById("p-delay-hint");
    var input = document.getElementById("p-delay");
    var valueEl = document.getElementById("p-delay-value");
    if (!input) return;
    var ms = clampOffsetMs(Number(input.value));
    if (String(input.value) !== String(ms)) input.value = String(ms);
    input.setAttribute("aria-valuenow", String(ms));
    var frames = (Math.abs(ms) / FRAME_MS).toFixed(1);
    var signed = (ms > 0 ? "+" : "") + ms + " ms";
    if (valueEl) valueEl.textContent = signed;
    if (!el) return;
    var meaning;
    if (ms > 0) {
      meaning =
        "Trigger held " +
        ms +
        " ms (~" +
        frames +
        " frames @29.97) — splice lands later in video";
    } else if (ms < 0) {
      meaning =
        "Video held " +
        Math.abs(ms) +
        " ms (~" +
        frames +
        " frames) — adds feed latency; splice can land earlier. Pipeline restart on save.";
    } else {
      meaning =
        "No offset — drag left to hold video, right to hold trigger (~33 ms = 1 frame @29.97)";
    }
    el.textContent = meaning;
  }

  /** Shareable URL for an SRT listener egress (clients connect as callers). */
  function srtListenerUrl(port) {
    var p = Number(port);
    if (!p || p < 1 || p > 65535) return "";
    var host = window.location.hostname || "127.0.0.1";
    return "srt://" + host + ":" + p;
  }

  /** Origin-pull HLS playlist URL served by Apache Alias /hls/. */
  function hlsOriginUrl(serviceName) {
    var svc = String(serviceName == null ? "" : serviceName).trim();
    if (!svc) return "";
    return window.location.origin + "/hls/" + encodeURIComponent(svc) + "/index.m3u8";
  }

  /** Best client URL for an egress channel, or "" if none. */
  function egressClientUrl(ch) {
    if (!ch) return "";
    if (ch.output_type === "hls" && (ch.hls_mode || "origin_pull") === "origin_pull") {
      return hlsOriginUrl(ch.service_name);
    }
    if (ch.output_type === "srt" && ch.srt_mode === "listener" && ch.srt_listen_port) {
      return srtListenerUrl(ch.srt_listen_port);
    }
    return "";
  }

  function refreshEgrClientUrl() {
    var box = document.getElementById("egr-client-url");
    var input = document.getElementById("e-client-url");
    var hint = document.getElementById("e-client-url-hint");
    if (!box || !input) return;
    var type = document.getElementById("e-output_type").value;
    var srtMode = document.getElementById("e-srt_mode").value;
    var hlsMode = document.getElementById("e-hls_mode").value;
    var port = document.getElementById("e-srt_listen_port").value;
    var svc = document.getElementById("e-service_name").value;
    var url = "";
    var hintText = "";
    if (type === "srt" && srtMode === "listener") {
      url = srtListenerUrl(port) || "";
      hintText =
        "Players connect as SRT callers to this listener. Hostname comes from your browser address bar.";
    } else if (type === "hls" && hlsMode === "origin_pull") {
      url = hlsOriginUrl(svc) || "";
      hintText =
        "Paste into VLC or a CDN as an HLS origin. Playlist appears after egress is running.";
    }
    input.value = url;
    if (hint) hint.textContent = hintText;
    box.hidden = !url;
  }

  function setBitrateReadout(prefix, ch) {
    var sensed = ch.sensed_bitrate_kbps;
    var out = ch.output_bitrate_kbps;
    var sensedEl = document.getElementById(prefix + "-bitrate-sensed");
    var outEl = document.getElementById(prefix + "-bitrate-out");
    var hidden = document.getElementById(prefix + "-bitrate");
    if (sensedEl) sensedEl.textContent = sensed != null ? String(sensed) : "—";
    if (outEl) outEl.textContent = out != null ? String(out) : "—";
    if (hidden) hidden.value = out != null ? String(out) : "";
  }

  function fillSourceSelect(sel, egressId) {
    if (!sel) return;
    var cur = assignments[egressId];
    var html = '<option value="">— pick input —</option>';
    lastProc.forEach(function (inn) {
      html +=
        '<option value="' +
        api.esc(String(inn.id)) +
        '"' +
        (Number(cur) === Number(inn.id) ? " selected" : "") +
        ">" +
        api.esc(inn.name) +
        " (@" +
        api.esc(inn.service_name) +
        ")</option>";
    });
    sel.innerHTML = html;
  }

  async function applyRouting(egressId, processingId, label, quiet) {
    var pid = Number(processingId);
    var eid = Number(egressId);
    if (!pid) {
      api.toast("Pick a processing source", "error");
      return false;
    }
    if (Number(assignments[eid]) === pid) return true;
    var res = await api.post("/v1/routing", {
      processing_channel_id: pid,
      egress_channel_id: eid,
    });
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Routing failed", "error");
      return false;
    }
    assignments[eid] = pid;
    if (!quiet) api.toast((label || "Egress") + " ← reassigned", "success");
    return true;
  }

  function renderList(el, channels, kind) {
    if (!channels.length) {
      el.innerHTML = '<div class="empty">None</div>';
      return;
    }
    var head =
      kind === "egr"
        ? "<th>Status</th><th>Name</th><th>Type</th><th>Source</th><th>Bitrate</th><th>Svc</th><th></th>"
        : "<th>Status</th><th>Name</th><th>Type</th><th>Bitrate</th><th>Svc</th><th></th>";
    el.innerHTML =
      '<table class="data"><thead><tr>' +
      head +
      "</tr></thead><tbody>" +
      channels
        .map(function (c) {
          var detail = "";
          if (kind === "proc") {
            var pMode = "";
            if (c.input_type === "srt") {
              pMode =
                (c.srt_mode || "caller") +
                (c.srt_mode === "listener"
                  ? " :" + (c.srt_listen_port || "?")
                  : c.srt_remote_host
                    ? " → " + c.srt_remote_host + ":" + (c.srt_remote_port || "?")
                    : "");
            } else if (c.input_type === "rtsp") {
              pMode = (c.rtsp_role || "client_pull") + (c.rtsp_url ? " · " + c.rtsp_url : "");
            } else if (c.input_type === "decklink") {
              pMode = "device " + (c.decklink_device_index != null ? c.decklink_device_index : "?");
            }
            if (pMode) {
              detail =
                '<div class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                api.esc(pMode) +
                "</div>";
            }
          } else if (kind === "egr") {
            var mode =
              c.output_type === "hls"
                ? c.hls_mode || "—"
                : (c.srt_mode || "—") +
                  (c.srt_mode === "listener"
                    ? " :" + (c.srt_listen_port || "?")
                    : c.srt_remote_host
                      ? " → " + c.srt_remote_host + ":" + (c.srt_remote_port || "?")
                      : "");
            detail = '<div class="muted">' + api.esc(mode) + "</div>";
          }
          var extras = "";
          if (kind === "proc") {
            var pol = c.caption_policy || (Number(c.captioning_enabled) ? "auto" : "off");
            if (pol !== "off") {
              extras +=
                ' <span class="badge dim" title="Caption policy">' +
                api.esc(pol) +
                "</span>";
            }
            if (c.preview_enabled == null || Number(c.preview_enabled)) {
              extras += ' <span class="badge dim" title="Preview enabled">PV</span>';
            }
          }
          var actions =
            '<button type="button" data-edit="' +
            c.id +
            '" data-kind="' +
            kind +
            '">Edit</button>';
          if (kind === "egr") {
            var clientUrl = egressClientUrl(c);
            if (clientUrl) {
              actions +=
                ' <button type="button" data-copy-url="' +
                api.esc(clientUrl) +
                '" title="' +
                api.esc(clientUrl) +
                '">Copy URL</button>';
            }
          }
          var sourceCell = "";
          if (kind === "egr") {
            sourceCell =
              '<td><select class="route-source" data-egress-id="' +
              api.esc(String(c.id)) +
              '" title="Processing input that feeds this egress"></select></td>';
          }
          return (
            "<tr><td>" +
            statusBadge(kind, c) +
            "</td><td>" +
            api.esc(c.name) +
            (Number(c.enabled) ? "" : ' <span class="badge dim">cfg off</span>') +
            extras +
            detail +
            "</td><td>" +
            api.esc(c.input_type || c.output_type) +
            "</td>" +
            sourceCell +
            '<td class="muted" title="sensed in / output target">' +
            api.esc(fmtBitrate(c)) +
            '</td><td class="muted">@' +
            api.esc(c.service_name) +
            "</td><td>" +
            actions +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    if (kind === "egr") {
      el.querySelectorAll("select.route-source").forEach(function (sel) {
        fillSourceSelect(sel, Number(sel.getAttribute("data-egress-id")));
        sel.addEventListener("change", async function () {
          var eid = Number(sel.getAttribute("data-egress-id"));
          var egr = lastEgr.find(function (c) {
            return Number(c.id) === eid;
          });
          var ok = await applyRouting(eid, sel.value, egr ? egr.name : "Egress");
          if (!ok) fillSourceSelect(sel, eid);
        });
      });
    }

    el.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-edit"));
        var kindBtn = btn.getAttribute("data-kind");
        if (kindBtn === "proc") openProcEdit(id);
        else openEgrEdit(id);
      });
    });
    el.querySelectorAll("[data-copy-url]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        api.copyText(btn.getAttribute("data-copy-url"));
      });
    });
  }

  function updateProcSummary() {
    var el = document.getElementById("proc-summary");
    if (!el) return;
    var running = 0;
    var failed = 0;
    var total = lastProc.length;
    lastProc.forEach(function (c) {
      var meta = statusMeta(unitStatus[unitName("proc", c.service_name)]);
      if (meta.label === "running") running += 1;
      if (meta.label === "failed" || meta.label === "stopped") failed += 1;
    });
    el.textContent =
      total === 0
        ? ""
        : running + "/" + total + " running" + (failed ? " · " + failed + " down" : "");
    el.className = "panel-meta" + (failed ? " bad" : running === total && total ? " ok" : "");
  }

  function applySrtUrlToFields(url) {
    var m = String(url || "").trim().match(
      /^srt:\/\/([^:/?]+):(\d+)(?:\?([^#]*))?/i
    );
    if (!m) return false;
    var host = m[1];
    var port = m[2];
    var qs = m[3] || "";
    var modeMatch = qs.match(/(?:^|&)mode=(caller|listener|rendezvous)(?:&|$)/i);
    var mode = modeMatch ? modeMatch[1].toLowerCase() : "caller";
    document.getElementById("p-input_type").value = "srt";
    document.getElementById("p-srt_mode").value = mode;
    if (mode === "listener") {
      document.getElementById("p-srt_listen_port").value = port;
      document.getElementById("p-srt_remote_host").value = "";
      document.getElementById("p-srt_remote_port").value = "";
    } else {
      document.getElementById("p-srt_remote_host").value = host;
      document.getElementById("p-srt_remote_port").value = port;
    }
    syncProcFields();
    return true;
  }

  function syncProcFields() {
    var type = document.getElementById("p-input_type").value;
    var srtMode = document.getElementById("p-srt_mode").value;
    var rtspRole = document.getElementById("p-rtsp_role").value;
    document.querySelectorAll(".proc-rtsp").forEach(function (el) {
      el.hidden = type !== "rtsp";
    });
    document.querySelectorAll(".proc-srt").forEach(function (el) {
      el.hidden = type !== "srt";
    });
    document.querySelectorAll(".proc-decklink").forEach(function (el) {
      el.hidden = type !== "decklink";
    });
    document.querySelectorAll(".proc-srt-remote").forEach(function (el) {
      el.hidden = type !== "srt" || srtMode === "listener";
    });
    document.querySelectorAll(".proc-srt-listen").forEach(function (el) {
      el.hidden = type !== "srt" || srtMode !== "listener";
    });
    document.querySelectorAll(".proc-rtsp-url").forEach(function (el) {
      el.hidden = type !== "rtsp" || rtspRole === "server_push";
    });
    var pushWarn = document.getElementById("proc-rtsp-push-warn");
    if (pushWarn) {
      pushWarn.hidden = type !== "rtsp" || rtspRole !== "server_push";
    }
  }

  function openProcEdit(id) {
    var ch = lastProc.find(function (c) {
      return Number(c.id) === id;
    });
    if (!ch) return;
    closeModal(egrModal);
    document.getElementById("p-id").value = ch.id;
    document.getElementById("p-name").value = ch.name || "";
    document.getElementById("p-input_type").value = ch.input_type || "rtsp";
    document.getElementById("p-rtsp_role").value = ch.rtsp_role || "client_pull";
    document.getElementById("p-rtsp_url").value = ch.rtsp_url || "";
    document.getElementById("p-rtsp_transport").value = ch.rtsp_transport || "tcp";
    document.getElementById("p-srt_mode").value = ch.srt_mode || "caller";
    document.getElementById("p-srt_remote_host").value = ch.srt_remote_host || "";
    document.getElementById("p-srt_remote_port").value = ch.srt_remote_port || "";
    document.getElementById("p-srt_listen_port").value = ch.srt_listen_port || "";
    document.getElementById("p-srt_paste").value = "";
    document.getElementById("p-decklink").value =
      ch.decklink_device_index != null ? ch.decklink_device_index : "";
    document.getElementById("p-ingest_mode").value = ch.ingest_mode || "copy";
    document.getElementById("p-delay").value =
      ch.splice_insertion_delay_ms != null ? ch.splice_insertion_delay_ms : 0;
    updateDelayHint();
    document.getElementById("p-scte35_pid").value =
      ch.scte35_pid != null ? ch.scte35_pid : 500;
    document.getElementById("p-feed_port").value = ch.local_feed_port || "";
    setBitrateReadout("p", ch);
    document.getElementById("p-preview_path").value = ch.preview_path || "";
    document.getElementById("p-preview_enabled").value = String(
      ch.preview_enabled == null ? 1 : Number(ch.preview_enabled)
    );
    document.getElementById("p-caption-policy").value =
      ch.caption_policy || (Number(ch.captioning_enabled) ? "auto" : "off");
    document.getElementById("p-enabled").value = String(Number(ch.enabled) || 0);
    var sub = document.getElementById("proc-modal-sub");
    if (sub) {
      sub.textContent = "@" + (ch.service_name || id) + " · #" + id;
    }
    syncProcFields();
    openModal(procModal);
    bindHelpTips(procModal);
    var nameInput = document.getElementById("p-name");
    if (nameInput) nameInput.focus();
  }

  function syncEgrFields() {
    var type = document.getElementById("e-output_type").value;
    var mode = document.getElementById("e-srt_mode").value;
    var hlsMode = document.getElementById("e-hls_mode").value;
    document.querySelectorAll(".egr-srt").forEach(function (el) {
      el.hidden = type !== "srt";
    });
    document.querySelectorAll(".egr-hls").forEach(function (el) {
      el.hidden = type !== "hls";
    });
    document.querySelectorAll(".egr-srt-remote").forEach(function (el) {
      el.hidden = type !== "srt" || mode === "listener";
    });
    document.querySelectorAll(".egr-srt-listen").forEach(function (el) {
      el.hidden = type !== "srt" || mode !== "listener";
    });
    document.querySelectorAll(".egr-hls-push").forEach(function (el) {
      el.hidden = type !== "hls" || hlsMode !== "push_put";
    });
    var hlsWarn = document.getElementById("egr-hls-warn");
    if (hlsWarn) {
      hlsWarn.hidden = type !== "hls" || hlsMode !== "push_put";
    }
    refreshEgrClientUrl();
  }

  function openEgrEdit(id) {
    var ch = lastEgr.find(function (c) {
      return Number(c.id) === id;
    });
    if (!ch) return;
    closeModal(procModal);
    document.getElementById("e-id").value = ch.id;
    document.getElementById("e-service_name").value = ch.service_name || "";
    document.getElementById("e-name").value = ch.name || "";
    document.getElementById("e-output_type").value = ch.output_type || "srt";
    document.getElementById("e-srt_mode").value = ch.srt_mode || "listener";
    document.getElementById("e-srt_remote_host").value = ch.srt_remote_host || "";
    document.getElementById("e-srt_remote_port").value = ch.srt_remote_port || "";
    document.getElementById("e-srt_listen_port").value = ch.srt_listen_port || "";
    document.getElementById("e-hls_mode").value = ch.hls_mode || "origin_pull";
    document.getElementById("e-hls_push_url").value = ch.hls_push_url || "";
    setBitrateReadout("e", ch);
    document.getElementById("e-enabled").value = String(Number(ch.enabled) || 0);
    fillSourceSelect(document.getElementById("e-source"), ch.id);
    var sub = document.getElementById("egr-modal-sub");
    if (sub) {
      sub.textContent = "@" + (ch.service_name || id) + " · #" + id;
    }
    syncEgrFields();
    openModal(egrModal);
    bindHelpTips(egrModal);
    var nameInput = document.getElementById("e-name");
    if (nameInput) nameInput.focus();
  }

  async function fetchUnitStatus() {
    try {
      var res = await fetch("/ops.php?action=services", { cache: "no-store" });
      var data = await res.json().catch(function () {
        return {};
      });
      unitStatus = {};
      if (res.ok && data.ok && Array.isArray(data.services)) {
        data.services.forEach(function (s) {
          unitStatus[s.unit] = s;
        });
      }
    } catch (e) {
      unitStatus = {};
    }
  }

  async function load() {
    // Paint channel tables from controller first; overlay unit pills when ops returns.
    var [proc, egr, routing] = await Promise.all([
      api.get("/v1/processing"),
      api.get("/v1/egress"),
      api.get("/v1/routing"),
    ]);
    if (!proc.ok) {
      document.getElementById("proc-list").innerHTML =
        '<div class="empty">Controller unreachable</div>';
      return;
    }
    lastProc = proc.data.channels || [];
    lastEgr = (egr.data && egr.data.channels) || [];
    assignments = {};
    if (routing.ok) {
      (routing.data.assignments || []).forEach(function (a) {
        assignments[a.egress_channel_id] = a.processing_channel_id;
      });
    }
    renderList(document.getElementById("proc-list"), lastProc, "proc");
    renderList(document.getElementById("egr-list"), lastEgr, "egr");
    updateProcSummary();
    fetchUnitStatus().then(function () {
      renderList(document.getElementById("proc-list"), lastProc, "proc");
      renderList(document.getElementById("egr-list"), lastEgr, "egr");
    });
  }

  document.querySelectorAll("[data-close-proc]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeModal(procModal);
    });
  });
  document.querySelectorAll("[data-close-egr]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeModal(egrModal);
    });
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (procModal && !procModal.hidden) closeModal(procModal);
    else if (egrModal && !egrModal.hidden) closeModal(egrModal);
  });

  document.getElementById("p-input_type").addEventListener("change", syncProcFields);
  document.getElementById("p-srt_mode").addEventListener("change", syncProcFields);
  document.getElementById("p-rtsp_role").addEventListener("change", syncProcFields);
  document.getElementById("p-rtsp_url").addEventListener("change", function () {
    var v = document.getElementById("p-rtsp_url").value;
    if (/^srt:\/\//i.test(v)) {
      applySrtUrlToFields(v);
      api.toast("Detected srt:// URL — switched input type to SRT", "info");
    }
  });
  document.getElementById("p-srt_paste").addEventListener("change", function () {
    var v = document.getElementById("p-srt_paste").value;
    if (applySrtUrlToFields(v)) {
      document.getElementById("p-srt_paste").value = "";
      api.toast("Parsed SRT URL into host/port fields", "info");
    }
  });
  document.getElementById("e-output_type").addEventListener("change", syncEgrFields);
  document.getElementById("e-srt_mode").addEventListener("change", syncEgrFields);
  document.getElementById("e-hls_mode").addEventListener("change", syncEgrFields);
  document.getElementById("e-srt_listen_port").addEventListener("input", refreshEgrClientUrl);
  document.getElementById("btn-egr-copy-url").addEventListener("click", function () {
    var url = document.getElementById("e-client-url").value;
    api.copyText(url);
  });

  document.getElementById("btn-proc-save").addEventListener("click", async function () {
    var id = document.getElementById("p-id").value;
    var inputType = document.getElementById("p-input_type").value;
    var rtspUrl = document.getElementById("p-rtsp_url").value || null;
    var srtPaste = document.getElementById("p-srt_paste").value || "";
    // Apply srt:// paste even if the user never blurred the field.
    if (srtPaste && /^srt:\/\//i.test(srtPaste)) {
      applySrtUrlToFields(srtPaste);
      document.getElementById("p-srt_paste").value = "";
      inputType = "srt";
    } else if (rtspUrl && /^srt:\/\//i.test(rtspUrl)) {
      applySrtUrlToFields(rtspUrl);
      inputType = "srt";
      rtspUrl = null;
    }
    var body = {
      name: document.getElementById("p-name").value,
      input_type: inputType,
      rtsp_role: document.getElementById("p-rtsp_role").value,
      rtsp_url: inputType === "rtsp" ? rtspUrl : null,
      rtsp_transport: document.getElementById("p-rtsp_transport").value,
      srt_mode: document.getElementById("p-srt_mode").value,
      srt_remote_host: (document.getElementById("p-srt_remote_host").value || "").trim() || null,
      srt_remote_port: document.getElementById("p-srt_remote_port").value
        ? Number(document.getElementById("p-srt_remote_port").value)
        : null,
      srt_listen_port: document.getElementById("p-srt_listen_port").value
        ? Number(document.getElementById("p-srt_listen_port").value)
        : null,
      decklink_device_index: document.getElementById("p-decklink").value
        ? Number(document.getElementById("p-decklink").value)
        : null,
      ingest_mode: document.getElementById("p-ingest_mode").value,
      splice_insertion_delay_ms: clampOffsetMs(
        Number(document.getElementById("p-delay").value)
      ),
      scte35_pid: Number(document.getElementById("p-scte35_pid").value) || 500,
      local_feed_port: Number(document.getElementById("p-feed_port").value),
      preview_path: document.getElementById("p-preview_path").value || null,
      preview_enabled: Number(document.getElementById("p-preview_enabled").value),
      caption_policy: document.getElementById("p-caption-policy").value,
      enabled: Number(document.getElementById("p-enabled").value),
    };
    if (inputType !== "srt") {
      body.srt_mode = null;
      body.srt_remote_host = null;
      body.srt_remote_port = null;
      body.srt_listen_port = null;
    }
    if (inputType !== "decklink") {
      body.decklink_device_index = null;
    }
    if (inputType === "srt") {
      if (body.srt_mode === "listener") {
        if (!body.srt_listen_port) {
          api.toast("SRT listener needs a listen port", "error");
          return;
        }
      } else if (!body.srt_remote_host || !body.srt_remote_port) {
        api.toast(
          "SRT caller needs remote host AND port (or paste srt://host:port)",
          "error"
        );
        return;
      }
    }
    var res = await api.post("/v1/processing/" + id + "/config", body);
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Save failed", "error");
      return;
    }
    var offsetHot = res.data.offset_hot;
    var msg =
      "Processing saved — restart nexbreak-proc@" + id + " for ingest changes";
    if (offsetHot && offsetHot.pipeline_restart) {
      msg =
        "Processing saved — splice video-hold applied (pipeline restarting)";
    } else if (
      body.splice_insertion_delay_ms != null &&
      body.splice_insertion_delay_ms >= 0 &&
      offsetHot &&
      offsetHot.ok
    ) {
      msg = "Processing saved — splice timing offset applied live";
    }
    api.toast(msg, "success");
    closeModal(procModal);
    load();
  });

  var delayInput = document.getElementById("p-delay");
  if (delayInput) {
    delayInput.addEventListener("input", updateDelayHint);
    delayInput.addEventListener("change", updateDelayHint);
  }

  document.getElementById("btn-egr-save").addEventListener("click", async function () {
    var id = document.getElementById("e-id").value;
    var sourceId = Number(document.getElementById("e-source").value);
    var body = {
      name: document.getElementById("e-name").value,
      output_type: document.getElementById("e-output_type").value,
      srt_mode: document.getElementById("e-srt_mode").value,
      srt_remote_host: document.getElementById("e-srt_remote_host").value || null,
      srt_remote_port: document.getElementById("e-srt_remote_port").value
        ? Number(document.getElementById("e-srt_remote_port").value)
        : null,
      srt_listen_port: document.getElementById("e-srt_listen_port").value
        ? Number(document.getElementById("e-srt_listen_port").value)
        : null,
      hls_mode: document.getElementById("e-hls_mode").value,
      hls_push_url: document.getElementById("e-hls_push_url").value || null,
      enabled: Number(document.getElementById("e-enabled").value),
    };
    var res = await api.post("/v1/egress/" + id + "/config", body);
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Save failed", "error");
      return;
    }
    if (sourceId) {
      var routed = await applyRouting(id, sourceId, body.name || "Egress", true);
      if (!routed) return;
    }
    api.toast("Egress saved — restart nexbreak-egress@" + id, "success");
    closeModal(egrModal);
    load();
  });

  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
  // Keep status live without fighting an open editor form.
  setInterval(async function () {
    await fetchUnitStatus();
    if (lastProc.length) {
      renderList(document.getElementById("proc-list"), lastProc, "proc");
      renderList(document.getElementById("egr-list"), lastEgr, "egr");
      updateProcSummary();
    }
  }, 5000);
})();
