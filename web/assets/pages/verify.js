"use strict";
(function () {
  var api = window.NexBreakAPI;
  var items = [];
  var selectedId = null;
  var listening = false;
  var pollTimer = null;

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
        : '<span class="badge dim">watch stopped</span>'
    );
    if (live.tap_kind) bits.push('<span class="badge dim">' + api.esc(live.tap_kind) + "</span>");
    if (live.bytes_seen != null) {
      bits.push(
        '<span class="muted">' + api.esc(String(live.bytes_seen)) + " bytes read</span>"
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
    } else {
      bits.push('<span class="muted">No SCTE seen yet on this tap</span>');
    }
    if (live.error) {
      bits.push('<span class="badge warn">' + api.esc(String(live.error)) + "</span>");
    }
    el.className = "";
    el.innerHTML = bits.join(" ");
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
    if (!live.listening && listening) {
      setListeningUi(false);
      stopPoll();
    }
    renderStatus(live);
    renderEvents(live, r.data.sightings);
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
    var r = await api.post("/v1/verify/" + selectedId + "/listen", {});
    if (!r.ok || !r.data || !r.data.ok) {
      btn.disabled = false;
      api.toast((r.data && r.data.error) || "Listen failed", "error");
      return;
    }
    setListeningUi(true);
    api.toast("Listening on " + (r.data.tap && r.data.tap.tap_kind), "success");
    renderStatus(r.data.live);
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

  loadEgresses();
})();
