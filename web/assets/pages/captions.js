"use strict";
(function () {
  var api = window.NexBreakAPI;

  async function loadChannels() {
    var el = document.getElementById("cap-channels");
    var res = await api.get("/v1/processing");
    if (!res.ok || !res.data) {
      el.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var channels = res.data.channels || [];
    if (!channels.length) {
      el.innerHTML = '<div class="empty">No processing channels</div>';
      return;
    }

    var statuses = await Promise.all(
      channels.map(function (c) {
        return api.get("/v1/processing/" + c.id + "/captioning").then(function (r) {
          return { id: c.id, ch: c, data: r.data };
        });
      })
    );

    el.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>Channel</th><th>Desired</th><th>Vosk</th><th>Bypass</th><th></th>" +
      "</tr></thead><tbody>" +
      statuses
        .map(function (s) {
          var rt = (s.data && s.data.runtime) || {};
          var enabled = Number((s.data && s.data.enabled) || 0) === 1;
          var running = !!rt.running;
          var bypassed = rt.bypassed != null ? !!rt.bypassed : !enabled;
          return (
            "<tr><td><strong>" +
            api.esc(s.ch.name) +
            '</strong> <span class="muted">@' +
            api.esc(s.ch.service_name) +
            "</span></td><td>" +
            (enabled
              ? '<span class="badge ok">on</span>'
              : '<span class="badge dim">off</span>') +
            "</td><td>" +
            (running
              ? '<span class="badge ok">running</span>'
              : '<span class="badge dim">stopped</span>') +
            "</td><td>" +
            (bypassed
              ? '<span class="badge warn">bypassed</span>'
              : '<span class="badge ok">active</span>') +
            '</td><td><button type="button" data-cap="' +
            s.id +
            '" data-next="' +
            (enabled ? "0" : "1") +
            '">' +
            (enabled ? "Turn off / bypass" : "Turn on") +
            "</button></td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    el.querySelectorAll("[data-cap]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-cap");
        var next = Number(btn.getAttribute("data-next"));
        btn.disabled = true;
        var r = await api.post("/v1/processing/" + id + "/captioning", { enabled: next });
        btn.disabled = false;
        if (!r.ok || !r.data || !r.data.ok) {
          api.toast((r.data && r.data.error) || "Toggle failed", "error");
          return;
        }
        api.toast(
          next ? "Captions on — Vosk starting for this stream" : "Captions bypassed — Vosk stopped",
          "success"
        );
        loadChannels();
      });
    });
  }

  async function loadLex() {
    var res = await api.get("/v1/captions/lexicon");
    var el = document.getElementById("lex-list");
    if (!res.ok) {
      el.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var entries = res.data.entries || [];
    if (!entries.length) {
      el.innerHTML = '<div class="empty">No lexicon entries</div>';
      return;
    }
    el.innerHTML = entries
      .map(function (e) {
        return (
          '<div class="row"><span><strong>' +
          api.esc(e.word) +
          "</strong> · " +
          api.esc(e.phonetic) +
          '</span><button type="button" class="danger" data-del-lex="' +
          e.id +
          '">Remove</button></div>'
        );
      })
      .join("");
    el.querySelectorAll("[data-del-lex]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        await api.del("/v1/captions/lexicon/" + btn.getAttribute("data-del-lex"));
        api.toast("Removed", "success");
        loadLex();
      });
    });
  }

  async function loadBl() {
    var res = await api.get("/v1/captions/blacklist");
    var el = document.getElementById("bl-list");
    if (!res.ok) {
      el.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    var entries = res.data.entries || [];
    if (!entries.length) {
      el.innerHTML = '<div class="empty">No blacklist entries</div>';
      return;
    }
    el.innerHTML = entries
      .map(function (e) {
        return (
          '<div class="row"><span>' +
          api.esc(e.word) +
          '</span><button type="button" class="danger" data-del-bl="' +
          e.id +
          '">Remove</button></div>'
        );
      })
      .join("");
    el.querySelectorAll("[data-del-bl]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        await api.del("/v1/captions/blacklist/" + btn.getAttribute("data-del-bl"));
        api.toast("Removed", "success");
        loadBl();
      });
    });
  }

  document.getElementById("lex-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    var res = await api.post("/v1/captions/lexicon", {
      word: fd.get("word"),
      phonetic: fd.get("phonetic"),
    });
    if (!res.ok) {
      api.toast((res.data && res.data.error) || "Add failed", "error");
      return;
    }
    ev.target.reset();
    api.toast("Lexicon entry added", "success");
    loadLex();
  });

  document.getElementById("bl-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    var res = await api.post("/v1/captions/blacklist", { word: fd.get("word") });
    if (!res.ok) {
      api.toast((res.data && res.data.error) || "Add failed", "error");
      return;
    }
    ev.target.reset();
    api.toast("Blacklist entry added", "success");
    loadBl();
  });

  document.getElementById("btn-refresh-channels").addEventListener("click", loadChannels);
  loadChannels();
  loadLex();
  loadBl();
  setInterval(loadChannels, 8000);
})();
