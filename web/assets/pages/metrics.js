"use strict";
(function () {
  var api = window.NexBreakAPI;
  var colors = window.NexBreakRouteColors;
  var range = "24h";

  function n(v) {
    return v == null || v === "" ? 0 : Number(v);
  }

  function fmtUptime(sec) {
    var s = Math.floor(Number(sec) || 0);
    if (s < 0) return "—";
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function drawLineChart(canvas, series, key, stroke) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 800;
    var cssH = canvas.clientHeight || 120;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var edge = cssVar("--edge", "#2c3542");
    var dim = cssVar("--dim", "#98a6b5");
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, 8);
    ctx.lineTo(36, cssH - 18);
    ctx.lineTo(cssW - 8, cssH - 18);
    ctx.stroke();

    var pts = (series || [])
      .map(function (row) {
        var y = row[key];
        if (y == null || y === "") return null;
        return { t: Number(row.sampled_at), y: Number(y) };
      })
      .filter(function (p) {
        return p && isFinite(p.t) && isFinite(p.y);
      });

    if (!pts.length) {
      ctx.fillStyle = dim;
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText("No samples yet — waiting for controller sampler", 44, cssH / 2);
      return;
    }

    var t0 = pts[0].t;
    var t1 = pts[pts.length - 1].t;
    if (t1 <= t0) t1 = t0 + 1;
    var yMin = 0;
    var yMax = 100;
    var padL = 36;
    var padR = 8;
    var padT = 8;
    var padB = 18;
    var w = cssW - padL - padR;
    var h = cssH - padT - padB;

    ctx.fillStyle = dim;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("100", 4, padT + 8);
    ctx.fillText("0", 10, padT + h);

    ctx.strokeStyle = stroke || cssVar("--acc", "#56c4f5");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = padL + ((p.t - t0) / (t1 - t0)) * w;
      var y = padT + h - ((p.y - yMin) / (yMax - yMin)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    var last = pts[pts.length - 1];
    ctx.fillStyle = stroke || cssVar("--acc", "#56c4f5");
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(last.y.toFixed(1) + "%", cssW - 64, 16);
  }

  function renderHostCharts(series, host) {
    drawLineChart(document.getElementById("chart-cpu"), series, "cpu_percent", cssVar("--acc", "#56c4f5"));
    drawLineChart(document.getElementById("chart-mem"), series, "mem_percent", cssVar("--ok", "#4cc38a"));
    drawLineChart(document.getElementById("chart-swap"), series, "swap_percent", cssVar("--warn", "#f5a623"));
    drawLineChart(document.getElementById("chart-gpu"), series, "gpu_percent", "#e87a7a");

    var foot = document.getElementById("host-uptime-foot");
    var meta = document.getElementById("host-meta");
    var nSamples = (series || []).length;
    if (meta) {
      var bits = [];
      if (host && host.hostname) bits.push(host.hostname);
      bits.push(nSamples + " samples");
      bits.push("15s interval");
      meta.textContent = bits.join(" · ");
    }
    if (foot) {
      var up =
        host && host.uptime_seconds != null
          ? fmtUptime(host.uptime_seconds)
          : "—";
      foot.textContent = "Uptime " + up + " · disk not charted";
    }

    var gpuEl = document.getElementById("host-gpu");
    if (!gpuEl) return;
    var gpus = (host && host.gpu) || [];
    if (!gpus.length) {
      gpuEl.hidden = true;
      gpuEl.innerHTML = "";
      return;
    }
    gpuEl.hidden = false;
    gpuEl.innerHTML =
      '<p class="muted" style="margin:10px 0 0;font-size:12px">' +
      gpus
        .map(function (g, i) {
          return api.esc(
            (g.name || "GPU " + (i + 1)) +
              (g.vendor ? " · " + g.vendor : "") +
              (g.utilization_percent != null
                ? " · now " + Number(g.utilization_percent).toFixed(0) + "%"
                : "")
          );
        })
        .join(" · ") +
      "</p>";
  }

  function renderSpark(series) {
    var el = document.getElementById("chart-splices");
    var byBucket = {};
    (series || []).forEach(function (row) {
      if (row.event_type !== "splice_command") return;
      var ts = Number(row.bucket_ts);
      if (!byBucket[ts]) byBucket[ts] = { ok: 0, fail: 0 };
      if (row.result === "success") byBucket[ts].ok += n(row.n);
      else if (row.result === "failure") byBucket[ts].fail += n(row.n);
      else byBucket[ts].ok += n(row.n);
    });
    var keys = Object.keys(byBucket)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    if (!keys.length) {
      el.innerHTML = '<div class="empty">No splice events in this range</div>';
      return;
    }
    var max = 1;
    keys.forEach(function (k) {
      max = Math.max(max, byBucket[k].ok + byBucket[k].fail);
    });
    el.innerHTML = keys
      .map(function (k) {
        var ok = byBucket[k].ok;
        var fail = byBucket[k].fail;
        var hOk = Math.round((ok / max) * 100);
        var hFail = Math.round((fail / max) * 100);
        var label = new Date(k * 1000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return (
          '<div class="spark-col" title="' +
          api.esc(label) +
          ": ok=" +
          ok +
          " fail=" +
          fail +
          '">' +
          '<div class="spark-stack">' +
          '<div class="spark-bar fail" style="height:' +
          hFail +
          '%"></div>' +
          '<div class="spark-bar ok" style="height:' +
          hOk +
          '%"></div>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderByChannel(rows) {
    var el = document.getElementById("by-channel");
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="empty">No per-channel activity</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr><th>Channel</th><th>Splices</th><th>OK</th><th>Fail</th><th>Config</th><th></th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          var sw =
            colors && r.id
              ? colors.swatchHtml(r.id, r.name || "#" + r.id)
              : "";
          return (
            '<tr class="route-tinted" data-pid="' +
            api.esc(r.id) +
            '"><td><span class="route-chip">' +
            sw +
            api.esc(r.name || "#" + r.id) +
            "</span></td><td>" +
            n(r.splices) +
            "</td><td>" +
            n(r.splice_ok) +
            '</td><td class="' +
            (n(r.splice_fail) ? "bad" : "") +
            '">' +
            n(r.splice_fail) +
            "</td><td>" +
            n(r.config_changes) +
            '</td><td><button type="button" class="btn-clear-channel" data-id="' +
            api.esc(r.id) +
            '" data-name="' +
            api.esc(r.name || "#" + r.id) +
            '">Clear…</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";
    el.querySelectorAll("tr.route-tinted").forEach(function (tr) {
      if (colors) colors.paintRow(tr, tr.getAttribute("data-pid"));
    });
    el.querySelectorAll(".btn-clear-channel").forEach(function (btn) {
      btn.addEventListener("click", function () {
        clearChannel(btn.getAttribute("data-id"), btn.getAttribute("data-name"));
      });
    });
  }

  async function clearChannel(id, name) {
    if (!id) return;
    if (
      !confirm(
        "Clear audit and metrics for " +
          (name || "#" + id) +
          "?\n\n" +
          "Deletes this processing channel's audit_events and SCTE sightings.\n" +
          "Other channels are unchanged."
      )
    ) {
      return;
    }
    var state = document.getElementById("state");
    state.textContent = "clearing…";
    state.className = "muted";
    var res = await api.post("/v1/audit/clear", {
      processing_channel_id: Number(id),
    });
    if (!res.ok || !res.data || !res.data.ok) {
      state.textContent = (res.data && res.data.error) || "clear failed";
      state.className = "bad";
      api.toast(state.textContent, "error");
      return;
    }
    var d = res.data;
    state.textContent =
      "cleared " +
      (d.audit_deleted || 0) +
      " events · " +
      (d.name || name || "#" + id);
    state.className = "ok";
    api.toast(state.textContent, "ok");
    await load();
  }

  function renderRoutes(routes) {
    var el = document.getElementById("routes");
    if (!routes || !routes.length) {
      el.innerHTML = '<div class="empty">No routes assigned</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr><th>Processing</th><th></th><th>Egress</th></tr></thead><tbody>' +
      routes
        .map(function (r) {
          var sw = colors
            ? colors.swatchHtml(r.processing_channel_id, r.processing_name)
            : "";
          return (
            '<tr class="route-tinted" data-pid="' +
            api.esc(r.processing_channel_id) +
            '"><td><span class="route-chip">' +
            sw +
            api.esc(r.processing_name) +
            '</span></td><td class="arrow">→</td><td>' +
            api.esc(r.egress_name) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
    el.querySelectorAll("tr.route-tinted").forEach(function (tr) {
      if (colors) colors.paintRow(tr, tr.getAttribute("data-pid"));
    });
  }

  function renderInventory(ch) {
    var el = document.getElementById("inventory");
    var proc = (ch && ch.processing) || [];
    var egr = (ch && ch.egress) || [];
    var routes = (ch && ch.routes) || [];
    var egrToProc = {};
    routes.forEach(function (r) {
      egrToProc[r.egress_channel_id] = r.processing_channel_id;
    });
    el.innerHTML =
      '<div class="two-col">' +
      '<div><h3 class="muted" style="margin:0 0 8px;font-size:11px;text-transform:uppercase">Processing</h3>' +
      (proc.length
        ? '<table class="data"><thead><tr><th>Name</th><th>Type</th><th>CC</th><th>On</th></tr></thead><tbody>' +
          proc
            .map(function (c) {
              var sw = colors ? colors.swatchHtml(c.id, c.name) : "";
              return (
                '<tr class="route-tinted" data-pid="' +
                api.esc(c.id) +
                '"><td><span class="route-chip">' +
                sw +
                api.esc(c.name) +
                "</span></td><td>" +
                api.esc(c.input_type) +
                "</td><td>" +
                (c.caption_policy || (Number(c.captioning_enabled) ? "auto" : "off")) +
                "</td><td>" +
                (Number(c.enabled) ? "yes" : "no") +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table>"
        : '<div class="empty">None</div>') +
      "</div>" +
      '<div><h3 class="muted" style="margin:0 0 8px;font-size:11px;text-transform:uppercase">Egress</h3>' +
      (egr.length
        ? '<table class="data"><thead><tr><th>Name</th><th>Type</th><th>Mode</th><th>On</th></tr></thead><tbody>' +
          egr
            .map(function (c) {
              var pid = egrToProc[c.id];
              return (
                '<tr class="route-tinted" data-pid="' +
                api.esc(pid || "") +
                '"><td>' +
                (pid && colors ? colors.swatchHtml(pid) : "") +
                api.esc(c.name) +
                "</td><td>" +
                api.esc(c.output_type) +
                "</td><td>" +
                api.esc(c.srt_mode || "—") +
                "</td><td>" +
                (Number(c.enabled) ? "yes" : "no") +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table>"
        : '<div class="empty">None</div>') +
      "</div></div>";
    el.querySelectorAll("tr.route-tinted").forEach(function (tr) {
      var pid = tr.getAttribute("data-pid");
      if (colors && pid) colors.paintRow(tr, pid);
    });
  }

  async function load() {
    var state = document.getElementById("state");
    state.textContent = "loading…";
    state.className = "muted";
    var res = await api.get("/v1/metrics?range=" + encodeURIComponent(range));
    if (!res.ok || !res.data || !res.data.ok) {
      state.textContent = (res.data && res.data.error) || "controller unreachable";
      state.className = "bad";
      return;
    }
    var d = res.data;
    var t = d.totals || {};
    document.getElementById("m-splices").textContent = n(t.splices);
    document.getElementById("m-ok").textContent = n(t.splice_ok);
    var failEl = document.getElementById("m-fail");
    failEl.textContent = n(t.splice_fail);
    failEl.className = "v" + (n(t.splice_fail) ? " bad" : "");
    document.getElementById("m-routes").textContent = n(t.routing_changes);
    document.getElementById("m-config").textContent = n(t.config_changes);
    document.getElementById("m-life").textContent = n(t.lifecycle_events);
    renderHostCharts(d.host_series || [], d.host);
    renderSpark(d.series);
    renderByChannel(d.by_channel);
    renderRoutes(d.channels && d.channels.routes);
    renderInventory(d.channels);
    state.textContent = "updated " + new Date().toLocaleTimeString();
    state.className = "ok";
  }

  document.querySelectorAll(".range").forEach(function (btn) {
    btn.addEventListener("click", function () {
      range = btn.getAttribute("data-range");
      document.querySelectorAll(".range").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      load();
    });
  });
  document.getElementById("btn-refresh").addEventListener("click", load);
  window.addEventListener("resize", function () {
    load();
  });
  load();
  setInterval(load, 30000);
})();
