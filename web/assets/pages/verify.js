"use strict";
(function () {
  var api = window.NexBreakAPI;
  var items = [];
  var selectedId = null;
  var listening = false;
  var pollTimer = null;
  var missCount = 0;

  function sel() {
    return document.getElementById("verify-egress");
  }

  function currentItem() {
    var id = Number(sel().value);
    for (var i = 0; i < items.length; i++) {
      if (Number(items[i].egress.id) === id) return items[i];
    }
    return null;
  }

  function ageLabel(ts) {
    if (!ts) return "—";
    var s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    return Math.floor(s / 3600) + "h ago";
  }

  function renderTap() {
    var el = document.getElementById("verify-tap");
    var item = currentItem();
    if (!item) {
      el.textContent = "Select an output to see the tap source.";
      return;
    }
    var tap = item.tap || {};
    var proc = item.processing;
    var parts = [];
    if (tap.ok === false) {
      parts.push("Tap unavailable: " + (tap.error || "unknown"));
    } else {
      parts.push(tap.label || tap.tap_url || "");
      parts.push("kind=" + (tap.tap_kind || "?"));
    }
    if (proc) {
      parts.push("source " + proc.name + " (@" + proc.service_name + ")");
    } else {
      parts.push("no routed processing source");
    }
    el.textContent = parts.join(" · ");
  }

  function renderStatus(live) {
    var el = document.getElementById("verify-status");
    live = live || {};
    if (!listening && !live.listening) {
      el.className = "empty";
      el.textContent = "Not listening";
      return;
    }
    var locked = !!live.locked;
    var bits = [];
    bits.push(
      locked
        ? '<span class="badge ok">stream locked</span>'
        : '<span class="badge dim">waiting for packets</span>'
    );
    bits.push(
      live.listening
        ? '<span class="badge ok">listening</span>'
        : '<span class="badge warn">watch stopped</span>'
    );
    if (live.tap_kind) bits.push('<span class="badge dim">' + api.esc(live.tap_kind) + "</span>");
    if (live.engine) bits.push('<span class="badge dim">' + api.esc(String(live.engine)) + "</span>");
    if (live.bytes_seen != null) {
      bits.push(
        '<span class="muted">' + api.esc(String(live.bytes_seen)) + " bytes</span>"
      );
    }
    if (live.last_scte_at) {
      bits.push(
        "<span>Last SCTE <strong>" +
          api.esc(ageLabel(live.last_scte_at)) +
          "</strong> event_id=" +
          api.esc(String(live.last_event_id != null ? live.last_event_id : "—")) +
          "</span>"
      );
      if (live.out_of_network === true) {
        bits.push('<span class="badge warn">out of network</span>');
      } else if (live.out_of_network === false) {
        bits.push('<span class="badge ok">return to network</span>');
      }
    } else if (listening || live.listening) {
      bits.push(
        '<span class="muted">Listening — fire a splice from Roll to confirm SCTE</span>'
      );
    }
    if (live.error) {
      bits.push('<span class="badge warn">' + api.esc(String(live.error)) + "</span>");
    }
    el.className = "";
    el.innerHTML = bits.join(" ");
  }

  function renderInjects(events) {
    var el = document.getElementById("verify-injects");
    if (!el) return;
    events = events || [];
    if (!events.length) {
      el.innerHTML = '<div class="empty">No recent splice commands</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>When</th><th>Channel</th><th>Type</th><th>Event</th><th>Result</th><th>Detail</th>" +
      "</tr></thead><tbody>" +
      events
        .map(function (e) {
          var ts = e.occurred_at
            ? Date.parse(String(e.occurred_at).replace(" ", "T") + "Z") / 1000
            : null;
          var eidMatch = String(e.detail || "").match(/event_id=(\d+)/);
          var eventId = eidMatch ? eidMatch[1] : "—";
          return (
            "<tr><td>" +
            api.esc(ageLabel(ts)) +
            "</td><td>" +
            api.esc(e.processing_name || String(e.processing_channel_id || "—")) +
            "</td><td>" +
            api.esc(e.splice_type || "—") +
            "</td><td>" +
            api.esc(eventId) +
            "</td><td>" +
            (e.result === "success"
              ? '<span class="badge ok">ok</span>'
              : '<span class="badge bad">' + api.esc(e.result || "?") + "</span>") +
            '</td><td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            api.esc(String(e.detail || "").slice(0, 100)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  async function loadInjects() {
    var r = await api.get("/v1/audit?event_type=splice_command&limit=20");
    if (!r.ok || !r.data) return;
    renderInjects(r.data.events || []);
  }

  function renderEvents(live, sightings) {
    var el = document.getElementById("verify-events");
    var recent = (live && live.recent) || [];
    if (!recent.length && sightings && sightings.length) {
      recent = sightings.map(function (s) {
        return {
          ts: s.seen_at ? Date.parse(String(s.seen_at).replace(" ", "T") + "Z") / 1000 : null,
          event_id: s.event_id,
          splice_type: s.splice_type,
          out_of_network: s.out_of_network == null ? null : !!Number(s.out_of_network),
          verified: !!Number(s.verified),
          raw_snip: s.raw_snip,
        };
      });
    }
    if (!recent.length) {
      el.innerHTML =
        '<div class="empty">No SCTE markers yet — trigger a splice on the routed input from Roll.</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>When</th><th>Event</th><th>Type</th><th>OON</th><th>Audit match</th><th>Snippet</th>" +
      "</tr></thead><tbody>" +
      recent
        .map(function (e) {
          var oon =
            e.out_of_network === true ? "yes" : e.out_of_network === false ? "no" : "—";
          return (
            "<tr><td>" +
            api.esc(ageLabel(e.ts)) +
            "</td><td>" +
            api.esc(String(e.event_id != null ? e.event_id : "—")) +
            "</td><td>" +
            api.esc(String(e.splice_type || "—")) +
            "</td><td>" +
            api.esc(oon) +
            "</td><td>" +
            (e.verified
              ? '<span class="badge ok">matched</span>'
              : '<span class="badge dim">—</span>') +
            "</td><td class=\"muted\" style=\"max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">" +
            api.esc(String(e.raw_snip || "").slice(0, 80)) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function setListeningUi(on) {
    listening = !!on;
    document.getElementById("btn-listen").disabled = listening;
    document.getElementById("btn-stop").disabled = !listening;
    sel().disabled = listening;
    if (!listening) missCount = 0;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollLive() {
    if (!selectedId) return;
    var r = await api.get("/v1/verify/" + selectedId + "/live");
    if (!r.ok || !r.data) return;
    var live = r.data.live || {};
    if (listening) {
      if (live.listening) {
        missCount = 0;
      } else {
        missCount += 1;
        // Require a few consecutive misses so a brief restart doesn't flip the UI.
        if (missCount >= 5) {
          setListeningUi(false);
          stopPoll();
          api.toast(
            (live && live.error) || "Verify watch stopped",
            "error"
          );
        }
      }
    }
    renderStatus(live);
    renderEvents(live, r.data.sightings);
    loadInjects();
  }

  async function loadEgresses() {
    var r = await api.get("/v1/verify/egresses");
    var box = sel();
    if (!r.ok || !r.data) {
      box.innerHTML = "";
      var detail =
        (r.data && (r.data.error || r.data.message)) ||
        ("HTTP " + (r.status || "?"));
      document.getElementById("verify-status").innerHTML =
        '<div class="empty">Verify API failed: ' +
        api.esc(String(detail)) +
        ". Redeploy with <code>sudo bash scripts/install-ubuntu.sh install</code> " +
        "and <code>sudo systemctl restart nexbreak-verify</code>.</div>";
      return;
    }
    if (r.data.ok === false) {
      box.innerHTML = "";
      document.getElementById("verify-status").innerHTML =
        '<div class="empty">' +
        api.esc(String(r.data.error || "Verify API error")) +
        "</div>";
      return;
    }
    items = r.data.egresses || [];
    var prev = box.value;
    box.innerHTML = items
      .map(function (it) {
        var eg = it.egress;
        var mode = eg.srt_mode || "?";
        var port = eg.srt_listen_port || eg.srt_remote_port || "";
        var label =
          eg.name +
          " (@" +
          eg.service_name +
          ") · " +
          mode +
          (port ? " :" + port : "");
        return (
          '<option value="' +
          eg.id +
          '">' +
          api.esc(label) +
          "</option>"
        );
      })
      .join("");
    if (!items.length) {
      box.innerHTML = '<option value="">No egress channels</option>';
    } else if (prev) {
      box.value = prev;
    }
    selectedId = Number(box.value) || null;
    renderTap();
    var cur = currentItem();
    if (cur && cur.listening) {
      setListeningUi(true);
      stopPoll();
      pollTimer = setInterval(pollLive, 1000);
      pollLive();
    }
  }

  document.getElementById("verify-egress").addEventListener("change", function () {
    selectedId = Number(sel().value) || null;
    renderTap();
  });

  document.getElementById("btn-refresh").addEventListener("click", function () {
    loadEgresses();
    if (listening) pollLive();
  });

  document.getElementById("btn-listen").addEventListener("click", async function () {
    var item = currentItem();
    if (!item) {
      api.toast("Pick an output", "error");
      return;
    }
    if (item.tap && item.tap.ok === false) {
      api.toast(item.tap.error || "Cannot tap this output", "error");
      return;
    }
    selectedId = Number(item.egress.id);
    var btn = document.getElementById("btn-listen");
    btn.disabled = true;
    btn.textContent = "Starting…";
    var r = await api.post("/v1/verify/" + selectedId + "/listen", {});
    btn.textContent = "Listen";
    if (!r.ok || !r.data || !r.data.ok) {
      btn.disabled = false;
      var err =
        (r.data && r.data.error) ||
        ("Listen failed (HTTP " + (r.status || "?") + ")");
      api.toast(err, "error");
      renderStatus((r.data && r.data.live) || { listening: false, error: err });
      return;
    }
    missCount = 0;
    setListeningUi(true);
    api.toast(
      "Listening — " + ((r.data.tap && r.data.tap.label) || (r.data.tap && r.data.tap.tap_kind) || "tap ok"),
      "success"
    );
    if (r.data.tap) {
      var cur = currentItem();
      if (cur) cur.tap = r.data.tap;
      renderTap();
    }
    renderStatus(r.data.live || { listening: true });
    stopPoll();
    pollTimer = setInterval(pollLive, 1000);
    pollLive();
  });

  document.getElementById("btn-stop").addEventListener("click", async function () {
    if (!selectedId) return;
    var r = await api.post("/v1/verify/" + selectedId + "/stop", {});
    stopPoll();
    setListeningUi(false);
    if (!r.ok) {
      api.toast((r.data && r.data.error) || "Stop failed", "error");
      return;
    }
    renderStatus(r.data && r.data.live);
    api.toast("Stopped", "success");
  });

  document.getElementById("btn-probe").addEventListener("click", async function () {
    var item = currentItem();
    if (!item) {
      api.toast("Pick an output", "error");
      return;
    }
    selectedId = Number(item.egress.id);
    var btn = document.getElementById("btn-probe");
    var box = document.getElementById("verify-probe");
    btn.disabled = true;
    btn.textContent = "Probing…";
    box.innerHTML =
      '<span class="muted">Running TSDuck on the post-splice feed (~8s) — fire a splice now if testing injection…</span>';
    var r = await api.post("/v1/verify/" + selectedId + "/probe", { duration_s: 8 });
    btn.disabled = false;
    btn.textContent = "Probe feed";
    if (!r.ok || !r.data || !r.data.ok) {
      var err = (r.data && r.data.error) || ("Probe failed (HTTP " + (r.status || "?") + ")");
      box.innerHTML = '<span class="badge warn">' + api.esc(err) + "</span>";
      api.toast(err, "error");
      return;
    }
    var v = r.data.verdict || "?";
    var okish = v === "scte_on_wire" || v === "sections_without_pmt";
    var badge = okish ? "ok" : v === "pmt_ok_no_sections" ? "warn" : "warn";
    box.innerHTML =
      '<div style="margin-top:4px">' +
      '<span class="badge ' +
      badge +
      '">' +
      api.esc(v) +
      "</span> " +
      api.esc(r.data.summary || "") +
      '</div><div class="muted" style="margin-top:6px">sections=' +
      api.esc(String(r.data.section_count != null ? r.data.section_count : 0)) +
      " · pmt_pids=" +
      api.esc(JSON.stringify(r.data.pmt_scte_pids || [])) +
      " · packets≈" +
      api.esc(String(r.data.packets_seen != null ? r.data.packets_seen : 0)) +
      "</div>";
    api.toast(okish ? "SCTE on the feed" : r.data.summary || v, okish ? "success" : "error");
  });

  loadEgresses();
  loadInjects();
  setInterval(loadInjects, 5000);
})();
