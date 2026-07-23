"use strict";
(function () {
  var api = window.NexBreakAPI;
  var VIEW_LIMIT = 80;
  var items = [];
  var selectedId = null;
  var listening = false;
  var pollTimer = null;
  var missCount = 0;
  var lastInjectIds = "";
  var lastEventIds = "";
  var focusEventId = null;

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

  function routedProcId() {
    var item = currentItem();
    if (!item || !item.processing) return null;
    return Number(item.processing.id) || null;
  }

  function ageLabel(ts) {
    if (!ts) return "—";
    var s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    return Math.floor(s / 3600) + "h ago";
  }

  function eventKey(v) {
    if (v == null || v === "" || v === "—") return "";
    return String(v);
  }

  function bindFocusRows(root) {
    if (!root) return;
    root.querySelectorAll("tr[data-event-id]").forEach(function (tr) {
      tr.addEventListener("mouseenter", function () {
        focusEventId = tr.getAttribute("data-event-id") || null;
        paintFocus();
      });
      tr.addEventListener("mouseleave", function () {
        focusEventId = null;
        paintFocus();
      });
    });
  }

  function paintFocus() {
    document.querySelectorAll(".verify-scroll tr[data-event-id]").forEach(function (tr) {
      var eid = tr.getAttribute("data-event-id") || "";
      if (focusEventId && eid === focusEventId) {
        tr.classList.add("verify-focus");
      } else {
        tr.classList.remove("verify-focus");
      }
    });
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
    if ((listening || live.listening) && live.scte_null_count) {
      bits.push(
        '<span class="badge dim">keepalive ' +
          api.esc(String(live.scte_null_count)) +
          "</span>"
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
      if (live.scte_null_count) {
        bits.push(
          '<span class="muted">SCTE PID alive (splice_null keepalive) — waiting for splice_insert from Roll/auto-inject</span>'
        );
      } else {
        bits.push(
          '<span class="muted">Listening — auto-injects running; rows appear when TID 0xFC splice_insert is seen</span>'
        );
      }
    }
    if (live.last_auto_inject_at) {
      bits.push(
        '<span class="badge dim">auto ' +
          api.esc(String(live.last_auto_inject_type || "inject")) +
          " " +
          api.esc(ageLabel(live.last_auto_inject_at)) +
          " id=" +
          api.esc(String(live.last_auto_inject_event_id != null ? live.last_auto_inject_event_id : "—")) +
          "</span>"
      );
    } else if ((listening || live.listening) && live.auto_inject_sec) {
      bits.push(
        '<span class="badge dim">auto-inject every ' +
          api.esc(String(live.auto_inject_sec)) +
          "s</span>"
      );
    }
    if (live.error) {
      bits.push('<span class="badge warn">' + api.esc(String(live.error)) + "</span>");
    }
    el.className = "";
    el.innerHTML = bits.join(" ");
  }

  function setMeta(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function injectOccurredTs(e) {
    if (!e || !e.occurred_at) return 0;
    var t = Date.parse(String(e.occurred_at).replace(" ", "T") + "Z");
    return Number.isFinite(t) ? t / 1000 : 0;
  }

  function trimNewest(rows, limit) {
    var list = (rows || []).slice();
    if (list.length > limit) list = list.slice(0, limit);
    return list;
  }

  function scrollPreserve(el, fn) {
    if (!el) {
      fn();
      return;
    }
    var prev = el.scrollTop;
    var stickTop = prev < 48;
    fn();
    // Newest rows are at the top — stay pinned there while watching.
    el.scrollTop = stickTop ? 0 : prev;
  }

  function renderInjects(events, matchedIds) {
    var el = document.getElementById("verify-injects");
    if (!el) return;
    events = trimNewest(
      (events || []).slice().sort(function (a, b) {
        return injectOccurredTs(b) - injectOccurredTs(a);
      }),
      VIEW_LIMIT
    );
    matchedIds = matchedIds || {};
    var sig = events
      .map(function (e) {
        return String(e.id || "") + ":" + String(e.occurred_at || "");
      })
      .join("|");
    if (sig === lastInjectIds && el.querySelector("table")) {
      // Still refresh relative ages / match classes cheaply via full redraw when needed.
    }
    lastInjectIds = sig;

    var proc = currentItem() && currentItem().processing;
    setMeta(
      "verify-injects-meta",
      (events.length ? events.length + " · " : "") +
        (proc ? proc.name : "all channels")
    );

    if (!events.length) {
      el.innerHTML =
        '<div class="empty">No splice commands' +
        (proc ? " for " + api.esc(proc.name) : "") +
        "</div>";
      return;
    }

    scrollPreserve(el, function () {
      el.innerHTML =
        '<table class="data"><thead><tr>' +
        "<th>When</th><th>Event</th><th>Type</th><th>Result</th><th>Channel</th>" +
        "</tr></thead><tbody>" +
        events
          .map(function (e) {
            var ts = injectOccurredTs(e) || null;
            var eidMatch = String(e.detail || "").match(/event_id=(\d+)/);
            var eventId = eidMatch ? eidMatch[1] : "";
            var matched = eventId && matchedIds[eventId];
            var rowClass = matched ? " verify-matched" : "";
            return (
              '<tr class="' +
              rowClass.trim() +
              '"' +
              (eventId ? ' data-event-id="' + api.esc(eventId) + '"' : "") +
              "><td>" +
              api.esc(ageLabel(ts)) +
              "</td><td>" +
              api.esc(eventId || "—") +
              "</td><td>" +
              api.esc(e.splice_type || "—") +
              "</td><td>" +
              (e.result === "success"
                ? '<span class="badge ok">ok</span>'
                : '<span class="badge bad">' + api.esc(e.result || "?") + "</span>") +
              '</td><td class="clip muted">' +
              api.esc(e.processing_name || String(e.processing_channel_id || "—")) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>";
      bindFocusRows(el);
      paintFocus();
    });
  }

  function normalizeSightings(live, sightings) {
    var recent = (live && live.recent) || [];
    if (!recent.length && sightings && sightings.length) {
      recent = sightings.map(function (s) {
        return {
          ts: s.seen_at
            ? Date.parse(String(s.seen_at).replace(" ", "T") + "Z") / 1000
            : null,
          event_id: s.event_id,
          splice_type: s.splice_type,
          out_of_network:
            s.out_of_network == null ? null : !!Number(s.out_of_network),
          verified: !!Number(s.verified),
          raw_snip: s.raw_snip,
        };
      });
    }
    // Newest first (live.recent is already newest-first; DB sightings may need sort).
    recent = recent.slice().sort(function (a, b) {
      return Number(b.ts || 0) - Number(a.ts || 0);
    });
    return trimNewest(recent, VIEW_LIMIT);
  }

  function renderEvents(live, sightings, matchedIds) {
    var el = document.getElementById("verify-events");
    var recent = normalizeSightings(live, sightings);
    matchedIds = matchedIds || {};
    var sig = recent
      .map(function (e) {
        return String(e.event_id || "") + ":" + String(e.ts || "");
      })
      .join("|");
    lastEventIds = sig;

    setMeta(
      "verify-events-meta",
      (recent.length ? recent.length + " · " : "") + "bitstream"
    );

    if (!recent.length) {
      el.innerHTML =
        '<div class="empty">No SCTE markers yet — Listen auto-fires test splices; waiting for TID 0xFC…</div>';
      return;
    }

    scrollPreserve(el, function () {
      el.innerHTML =
        '<table class="data"><thead><tr>' +
        "<th>When</th><th>Event</th><th>Type</th><th>OON</th><th>Match</th>" +
        "</tr></thead><tbody>" +
        recent
          .map(function (e) {
            var eid = eventKey(e.event_id);
            var oon =
              e.out_of_network === true
                ? "yes"
                : e.out_of_network === false
                  ? "no"
                  : "—";
            var matched = (eid && matchedIds[eid]) || !!e.verified;
            var rowClass = matched ? " verify-matched" : "";
            return (
              '<tr class="' +
              rowClass.trim() +
              '"' +
              (eid ? ' data-event-id="' + api.esc(eid) + '"' : "") +
              "><td>" +
              api.esc(ageLabel(e.ts)) +
              "</td><td>" +
              api.esc(eid || "—") +
              "</td><td>" +
              api.esc(String(e.splice_type || "—")) +
              "</td><td>" +
              api.esc(oon) +
              "</td><td>" +
              (matched
                ? '<span class="badge ok">sent</span>'
                : '<span class="badge dim">—</span>') +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>";
      bindFocusRows(el);
      paintFocus();
    });
  }

  function matchMapFrom(injects, sightings) {
    var sent = {};
    var recv = {};
    (injects || []).forEach(function (e) {
      var m = String(e.detail || "").match(/event_id=(\d+)/);
      if (m) sent[m[1]] = true;
    });
    (sightings || []).forEach(function (e) {
      var eid = eventKey(e.event_id);
      if (eid) recv[eid] = true;
    });
    var both = {};
    Object.keys(sent).forEach(function (k) {
      if (recv[k]) both[k] = true;
    });
    return both;
  }

  var cachedInjects = [];
  var cachedSightings = [];
  var cachedLive = {};

  function redrawTables() {
    var matched = matchMapFrom(cachedInjects, cachedSightings.length
      ? cachedSightings
      : normalizeSightings(cachedLive, []));
    // Also treat live.recent event ids as received.
    normalizeSightings(cachedLive, cachedSightings).forEach(function (e) {
      var eid = eventKey(e.event_id);
      if (!eid) return;
      var m = String(
        (cachedInjects || [])
          .map(function (x) {
            return x.detail || "";
          })
          .join("\n")
      );
      if (m.indexOf("event_id=" + eid) >= 0) matched[eid] = true;
    });
    renderInjects(cachedInjects, matched);
    renderEvents(cachedLive, cachedSightings, matched);
  }

  function chainBadge(cls, text) {
    return '<span class="badge ' + cls + '">' + api.esc(text) + "</span>";
  }

  function chainCounter(label, n, ts) {
    var s = label + " " + String(n || 0);
    if (ts) s += " · " + ageLabel(ts);
    return '<span class="muted">' + api.esc(s) + "</span>";
  }

  function renderSplicemon(state) {
    var el = document.getElementById("verify-chain");
    if (!el) return;
    if (!state || !state.tsp_started_at) {
      el.className = "empty";
      el.textContent =
        "No splice-monitor state for this input — redeploy and restart nexbreak-proc@N (needs tsp --verbose + splicemonitor in the chain).";
      return;
    }
    var bits = [];
    if (state.engine === "live") {
      bits.push(chainBadge("ok", "engine live"));
    } else {
      bits.push(chainBadge("dim", "no inserts confirmed yet"));
    }
    bits.push(chainCounter("cmd rx", state.udp_received, state.last_udp_received_at));
    bits.push(chainCounter("enqueued", state.enqueued, state.last_enqueued_at));
    bits.push(chainCounter("injected", state.injected, state.last_injected_at));
    if (state.dropped) {
      bits.push(chainBadge("warn", "dropped " + String(state.dropped)));
    }
    var evt = state.last_event;
    if (evt) {
      var desc =
        String(evt.progress || "event") +
        (evt.event_type ? " " + String(evt.event_type).toUpperCase() : "") +
        " event_id=" + String(evt.event_id != null ? evt.event_id : "—");
      if (evt.pre_roll_ms != null) desc += " pre-roll " + String(evt.pre_roll_ms) + "ms";
      bits.push(
        "<span>Last: <strong>" +
          api.esc(desc) +
          "</strong> " +
          api.esc(ageLabel(evt.ts)) +
          "</span>"
      );
    }
    // Diagnosis hint: commands received but nothing ever injected.
    if (
      state.engine !== "live" &&
      Number(state.udp_received || 0) > 0 &&
      Number(state.injected || 0) === 0
    ) {
      bits.push(
        chainBadge(
          "warn",
          "commands reach spliceinject but nothing injected — check PTS lock / input stuffing (journalctl -u nexbreak-proc@N)"
        )
      );
    }
    el.className = "";
    el.innerHTML = bits.join(" ");
  }

  async function loadSplicemon() {
    var el = document.getElementById("verify-chain");
    if (!el) return;
    var pcid = routedProcId();
    if (!pcid) {
      el.className = "empty";
      el.textContent = "No routed input — insertion engine state unavailable.";
      return;
    }
    var r = await api.get("/v1/processing/" + pcid + "/splicemon");
    if (!r.ok || !r.data || r.data.ok === false) {
      el.className = "empty";
      el.textContent = "Splice monitor state unavailable (controller unreachable?).";
      return;
    }
    renderSplicemon(r.data.splicemon || null);
  }

  async function loadInjects() {
    var q = "/v1/audit?event_type=splice_command&limit=80";
    var pcid = routedProcId();
    if (pcid) q += "&processing_channel_id=" + encodeURIComponent(String(pcid));
    var r = await api.get(q);
    if (!r.ok || !r.data) return;
    cachedInjects = r.data.events || [];
    redrawTables();
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
        if (missCount >= 5) {
          setListeningUi(false);
          stopPoll();
          api.toast((live && live.error) || "Verify watch stopped", "error");
        }
      }
    }
    cachedLive = live;
    cachedSightings = r.data.sightings || [];
    renderStatus(live);
    redrawTables();
    loadInjects();
    loadSplicemon();
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
        var detail = "";
        if (eg.output_type === "hls") {
          detail = "hls · " + (eg.hls_mode || "origin_pull");
        } else {
          var mode = eg.srt_mode || "?";
          var port = eg.srt_listen_port || eg.srt_remote_port || "";
          detail = mode + (port ? " :" + port : "");
        }
        var label = eg.name + " (@" + eg.service_name + ") · " + detail;
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
    loadInjects();
    loadSplicemon();
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
    loadInjects();
    loadSplicemon();
  });

  document.getElementById("btn-refresh").addEventListener("click", function () {
    loadEgresses();
    if (listening) pollLive();
    else {
      loadInjects();
      loadSplicemon();
    }
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
    var r = await api.post("/v1/verify/" + selectedId + "/listen", {
      auto_inject_sec: 12,
    });
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
      "Listening until Stop — auto-inject every " +
        (r.data.auto_inject_sec != null ? r.data.auto_inject_sec : 12) +
        "s",
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

  loadEgresses();
  setInterval(loadInjects, 5000);
  setInterval(function () {
    // Live polling already refreshes this every second while listening.
    if (!listening) loadSplicemon();
  }, 5000);
})();
