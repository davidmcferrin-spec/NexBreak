"use strict";
(function () {
  var api = window.NexBreakAPI;
  var range = "24h";

  function n(v) {
    return v == null || v === "" ? 0 : Number(v);
  }

  function renderSpark(series, bucketSeconds) {
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
          return (
            "<tr><td>" +
            api.esc(r.name || "#" + r.id) +
            "</td><td>" +
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
      '<table class="data"><thead><tr><th>Egress</th><th></th><th>Processing</th></tr></thead><tbody>' +
      routes
        .map(function (r) {
          return (
            "<tr><td>" +
            api.esc(r.egress_name) +
            '</td><td class="arrow">←</td><td>' +
            api.esc(r.processing_name) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderInventory(ch) {
    var el = document.getElementById("inventory");
    var proc = (ch && ch.processing) || [];
    var egr = (ch && ch.egress) || [];
    el.innerHTML =
      '<div class="two-col">' +
      '<div><h3 class="muted" style="margin:0 0 8px;font-size:11px;text-transform:uppercase">Processing</h3>' +
      (proc.length
        ? '<table class="data"><thead><tr><th>Name</th><th>Type</th><th>CC</th><th>On</th></tr></thead><tbody>' +
          proc
            .map(function (c) {
              return (
                "<tr><td>" +
                api.esc(c.name) +
                "</td><td>" +
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
              return (
                "<tr><td>" +
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
    renderSpark(d.series, d.bucket_seconds);
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
  load();
  setInterval(load, 30000);
})();
