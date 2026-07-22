"use strict";
(function () {
  var api = window.NexBreakAPI;
  var statusEl = document.getElementById("api-status");

  async function load() {
    var res = await api.get("/v1/dashboard");
    if (!res.ok || !res.data || !res.data.ok) {
      statusEl.textContent = "Controller unreachable at " + (window.NEXBREAK_API || "") + " — start nexbreak-controller.";
      statusEl.style.color = "var(--bad)";
      return;
    }
    statusEl.textContent = "Controller online";
    statusEl.style.color = "var(--ok)";
    var s = res.data.stats;
    document.getElementById("stat-proc").textContent = s.processing_enabled;
    document.getElementById("stat-egr").textContent = s.egress_enabled;
    document.getElementById("stat-routes").textContent = s.routes;
    document.getElementById("stat-splices").textContent = s.splice_events;

    var wrap = document.getElementById("recent-wrap");
    var events = res.data.recent || [];
    if (!events.length) {
      wrap.innerHTML = '<div class="empty">No audit events yet</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>When</th><th>Type</th><th>Channel</th><th>Result</th><th>Detail</th>" +
      "</tr></thead><tbody>" +
      events
        .map(function (e) {
          var badge = e.result === "success" ? "ok" : "bad";
          return (
            "<tr><td>" +
            api.esc(api.fmtTime(e.occurred_at)) +
            "</td><td>" +
            api.esc(e.event_type) +
            "</td><td>" +
            api.esc(e.processing_name || "—") +
            '</td><td><span class="badge ' +
            badge +
            '">' +
            api.esc(e.result) +
            "</span></td><td class=\"muted\">" +
            api.esc(e.detail || e.splice_type || "") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
  setInterval(load, 8000);
})();
