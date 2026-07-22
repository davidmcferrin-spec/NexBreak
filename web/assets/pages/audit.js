"use strict";
(function () {
  var api = window.NexBreakAPI;

  async function load() {
    var res = await api.get("/v1/audit?limit=100");
    var wrap = document.getElementById("audit-wrap");
    if (!res.ok || !res.data) {
      wrap.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var events = res.data.events || [];
    if (!events.length) {
      wrap.innerHTML = '<div class="empty">No events</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>When</th><th>Type</th><th>Processing</th><th>Egress</th><th>Who</th><th>IP</th><th>Result</th><th>Detail</th>" +
      "</tr></thead><tbody>" +
      events
        .map(function (e) {
          var badge = e.result === "success" ? "ok" : "bad";
          return (
            "<tr><td>" +
            api.esc(api.fmtTime(e.occurred_at)) +
            "</td><td>" +
            api.esc(e.event_type) +
            (e.splice_type ? '<div class="muted">' + api.esc(e.splice_type) + "</div>" : "") +
            "</td><td>" +
            api.esc(e.processing_name || "—") +
            "</td><td>" +
            api.esc(e.egress_name || "—") +
            "</td><td>" +
            api.esc(e.credential_label || "—") +
            "</td><td class=\"muted\">" +
            api.esc(e.source_ip || "—") +
            '</td><td><span class="badge ' +
            badge +
            '">' +
            api.esc(e.result) +
            "</span></td><td class=\"muted\">" +
            api.esc(e.detail || "") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
  setInterval(load, 10000);
})();
