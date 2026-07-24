"use strict";
(function () {
  var api = window.NexBreakAPI;
  var channelFilter = "";
  var channels = [];

  function stateEl() {
    return document.getElementById("state");
  }

  async function loadChannels() {
    var sel = document.getElementById("filter-channel");
    var res = await api.get("/v1/processing");
    channels = (res.ok && res.data && res.data.channels) || [];
    var keep = channelFilter;
    sel.innerHTML = '<option value="">All channels</option>';
    channels.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.name || "#" + c.id;
      sel.appendChild(opt);
    });
    sel.value = keep;
    channelFilter = sel.value;
  }

  async function load() {
    var wrap = document.getElementById("audit-wrap");
    var q = "/v1/audit?limit=100";
    if (channelFilter) {
      q += "&processing_channel_id=" + encodeURIComponent(channelFilter);
    }
    var res = await api.get(q);
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
            // Full splice payload hex lives on the Verify page inspector —
            // keep the audit list readable.
            api.esc(
              String(e.detail || "").replace(
                /\s*payload:[0-9a-fA-F]{8,}/,
                " [payload on Verify]"
              )
            ) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  async function clearAudit() {
    var body;
    var label;
    if (channelFilter) {
      var ch = channels.find(function (c) {
        return String(c.id) === String(channelFilter);
      });
      label = (ch && ch.name) || "channel #" + channelFilter;
      if (
        !confirm(
          "Clear audit and metrics for " +
            label +
            "?\n\n" +
            "Deletes this processing channel's audit_events and SCTE sightings.\n" +
            "Other channels are unchanged."
        )
      ) {
        return;
      }
      body = { processing_channel_id: Number(channelFilter) };
    } else {
      if (
        !confirm(
          "Clear audit and metrics for ALL channels?\n\n" +
            "This deletes every audit_events and scte_sightings row.\n" +
            "A single config_change receipt will remain."
        )
      ) {
        return;
      }
      body = { all: true };
    }
    var st = stateEl();
    st.textContent = "clearing…";
    st.className = "muted";
    var res = await api.post("/v1/audit/clear", body);
    if (!res.ok || !res.data || !res.data.ok) {
      st.textContent = (res.data && res.data.error) || "clear failed";
      st.className = "bad";
      api.toast(st.textContent, "error");
      return;
    }
    var d = res.data;
    st.textContent =
      "cleared " +
      (d.audit_deleted || 0) +
      " events, " +
      (d.sightings_deleted || 0) +
      " sightings";
    st.className = "ok";
    api.toast(st.textContent, "ok");
    await load();
  }

  document.getElementById("filter-channel").addEventListener("change", function (ev) {
    channelFilter = ev.target.value;
    load();
  });
  document.getElementById("btn-clear-audit").addEventListener("click", clearAudit);
  document.getElementById("btn-refresh").addEventListener("click", load);

  loadChannels().then(load);
  setInterval(load, 10000);
})();
