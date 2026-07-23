"use strict";
(function () {
  var api = window.NexBreakAPI;
  var procEditor = document.getElementById("proc-editor");
  var egrEditor = document.getElementById("egr-editor");
  var lastProc = [];
  var lastEgr = [];
  var unitStatus = {}; // unit name → { state, enabled }

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

  function renderList(el, channels, kind) {
    if (!channels.length) {
      el.innerHTML = '<div class="empty">None</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr><th>Status</th><th>Name</th><th>Type</th><th>Bitrate</th><th>Svc</th><th></th></tr></thead><tbody>' +
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
            '</td><td class="muted" title="sensed in / output target">' +
            api.esc(fmtBitrate(c)) +
            "</td><td class=\"muted\">@" +
            api.esc(c.service_name) +
            '</td><td><button type="button" data-edit="' +
            c.id +
            '" data-kind="' +
            kind +
            '">Edit</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";

    el.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-edit"));
        var kindBtn = btn.getAttribute("data-kind");
        if (kindBtn === "proc") openProcEdit(id);
        else openEgrEdit(id);
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
    document.getElementById("proc-rtsp-push-warn").hidden =
      type !== "rtsp" || rtspRole !== "server_push";
  }

  function openProcEdit(id) {
    var ch = lastProc.find(function (c) {
      return Number(c.id) === id;
    });
    if (!ch) return;
    egrEditor.hidden = true;
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
    document.getElementById("p-decklink").value =
      ch.decklink_device_index != null ? ch.decklink_device_index : "";
    document.getElementById("p-ingest_mode").value = ch.ingest_mode || "copy";
    document.getElementById("p-delay").value = ch.splice_insertion_delay_ms || 0;
    document.getElementById("p-feed_port").value = ch.local_feed_port || "";
    setBitrateReadout("p", ch);
    document.getElementById("p-preview_path").value = ch.preview_path || "";
    document.getElementById("p-preview_enabled").value = String(
      ch.preview_enabled == null ? 1 : Number(ch.preview_enabled)
    );
    document.getElementById("p-caption-policy").value =
      ch.caption_policy || (Number(ch.captioning_enabled) ? "auto" : "off");
    document.getElementById("p-enabled").value = String(Number(ch.enabled) || 0);
    syncProcFields();
    procEditor.hidden = false;
    procEditor.scrollIntoView({ behavior: "smooth", block: "start" });
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
    document.getElementById("egr-hls-warn").hidden = type !== "hls";
  }

  function openEgrEdit(id) {
    var ch = lastEgr.find(function (c) {
      return Number(c.id) === id;
    });
    if (!ch) return;
    procEditor.hidden = true;
    document.getElementById("e-id").value = ch.id;
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
    syncEgrFields();
    egrEditor.hidden = false;
    egrEditor.scrollIntoView({ behavior: "smooth", block: "start" });
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
    var [proc, egr] = await Promise.all([
      api.get("/v1/processing"),
      api.get("/v1/egress"),
    ]);
    if (!proc.ok) {
      document.getElementById("proc-list").innerHTML =
        '<div class="empty">Controller unreachable</div>';
      return;
    }
    lastProc = proc.data.channels || [];
    lastEgr = (egr.data && egr.data.channels) || [];
    renderList(document.getElementById("proc-list"), lastProc, "proc");
    renderList(document.getElementById("egr-list"), lastEgr, "egr");
    updateProcSummary();
    fetchUnitStatus().then(function () {
      renderList(document.getElementById("proc-list"), lastProc, "proc");
      renderList(document.getElementById("egr-list"), lastEgr, "egr");
    });
  }

  document.getElementById("btn-proc-cancel").addEventListener("click", function () {
    procEditor.hidden = true;
  });
  document.getElementById("btn-egr-cancel").addEventListener("click", function () {
    egrEditor.hidden = true;
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
      splice_insertion_delay_ms: Number(document.getElementById("p-delay").value),
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
    api.toast(
      "Processing saved — restart nexbreak-proc@" + id + " for ingest changes",
      "success"
    );
    procEditor.hidden = true;
    load();
  });

  document.getElementById("btn-egr-save").addEventListener("click", async function () {
    var id = document.getElementById("e-id").value;
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
    api.toast("Egress saved — restart nexbreak-egress@" + id, "success");
    egrEditor.hidden = true;
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
