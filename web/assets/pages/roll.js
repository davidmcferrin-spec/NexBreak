"use strict";
(function () {
  var api = window.NexBreakAPI;
  var grid = document.getElementById("roll-grid");

  var SPLICE_TYPES = [
    { value: "splice_start_immediate", label: "ROLL" },
    { value: "splice_end_immediate", label: "END" },
    { value: "splice_cancel", label: "CANCEL" },
  ];

  async function fire(channelId, spliceType, btn) {
    btn.disabled = true;
    try {
      var res = await api.post("/v1/splice", {
        processing_channel_id: channelId,
        splice_type: spliceType,
      });
      if (!res.ok || !res.data || !res.data.ok) {
        api.toast((res.data && res.data.error) || "Splice failed", "error");
        return;
      }
      api.toast(
        "Queued · delay " + (res.data.delay_ms || 0) + " ms · audit #" + res.data.audit_id,
        "success"
      );
    } catch (err) {
      api.toast(String(err.message || err), "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function load() {
    var res = await api.get("/v1/processing");
    if (!res.ok || !res.data) {
      grid.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var channels = (res.data.channels || []).filter(function (c) {
      return Number(c.enabled) === 1;
    });
    if (!channels.length) {
      grid.innerHTML = '<div class="empty">No enabled processing channels</div>';
      return;
    }
    grid.innerHTML = "";
    channels.forEach(function (ch) {
      var card = document.createElement("div");
      card.className = "channel-card";
      card.innerHTML =
        '<div class="title"><strong>' +
        api.esc(ch.name) +
        '</strong><span class="badge dim">' +
        api.esc(ch.input_type) +
        "</span></div>" +
        '<div class="preview-slot">WebRTC preview — next</div>' +
        '<div class="muted">Delay ' +
        api.esc(String(ch.splice_insertion_delay_ms)) +
        " ms · feed :" +
        api.esc(String(ch.local_feed_port)) +
        '</div><div class="bar"></div>';
      var bar = card.querySelector(".bar");
      SPLICE_TYPES.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = t.label;
        if (t.value === "splice_start_immediate") b.className = "roll";
        if (t.value === "splice_cancel") b.className = "danger";
        b.addEventListener("click", function () {
          fire(ch.id, t.value, b);
        });
        bar.appendChild(b);
      });
      grid.appendChild(card);
    });
  }

  load();
})();
