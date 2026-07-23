"use strict";
(function () {
  var api = window.NexBreakAPI;

  var POLICIES = [
    { value: "auto", label: "Auto" },
    { value: "force_asr", label: "Force ASR" },
    { value: "off", label: "Off" },
  ];

  function policyOf(ch, data) {
    if (data && data.policy) return data.policy;
    if (ch.caption_policy) return ch.caption_policy;
    return Number(ch.captioning_enabled) ? "auto" : "off";
  }

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
      "<th>Channel</th><th>Policy</th><th>Effective</th><th>Source CC</th><th>ASR</th><th></th>" +
      "</tr></thead><tbody>" +
      statuses
        .map(function (s) {
          var rt = (s.data && s.data.runtime) || {};
          var policy = policyOf(s.ch, s.data);
          var effective = rt.effective_mode || "—";
          var src =
            rt.source_has_cc == null ? "—" : rt.source_has_cc ? "yes" : "no";
          var running = !!rt.running;
          var opts = POLICIES.map(function (p) {
            return (
              '<option value="' +
              p.value +
              '"' +
              (p.value === policy ? " selected" : "") +
              ">" +
              p.label +
              "</option>"
            );
          }).join("");
          return (
            "<tr><td><strong>" +
            api.esc(s.ch.name) +
            '</strong> <span class="muted">@' +
            api.esc(s.ch.service_name) +
            "</span></td><td>" +
            '<select data-policy-for="' +
            s.id +
            '">' +
            opts +
            "</select></td><td>" +
            api.esc(String(effective)) +
            "</td><td>" +
            api.esc(String(src)) +
            "</td><td>" +
            (running
              ? '<span class="badge ok">running</span>'
              : '<span class="badge dim">stopped</span>') +
            '</td><td><button type="button" class="primary" data-apply="' +
            s.id +
            '">Apply</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";

    el.querySelectorAll("[data-apply]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-apply");
        var sel = el.querySelector('[data-policy-for="' + id + '"]');
        var policy = sel ? sel.value : "auto";
        btn.disabled = true;
        var r = await api.post("/v1/processing/" + id + "/captioning", { policy: policy });
        btn.disabled = false;
        if (!r.ok || !r.data || !r.data.ok) {
          api.toast((r.data && r.data.error) || "Policy update failed", "error");
          return;
        }
        var rt = r.data.runtime || {};
        api.toast(
          "Policy " +
            policy +
            (rt.effective_mode ? " · effective " + rt.effective_mode : ""),
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
    var r = await api.post("/v1/captions/lexicon", {
      word: fd.get("word"),
      phonetic: fd.get("phonetic"),
    });
    if (!r.ok || !r.data || !r.data.ok) {
      api.toast((r.data && r.data.error) || "Add failed", "error");
      return;
    }
    ev.target.reset();
    api.toast("Added", "success");
    loadLex();
  });

  document.getElementById("bl-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    var r = await api.post("/v1/captions/blacklist", { word: fd.get("word") });
    if (!r.ok || !r.data || !r.data.ok) {
      api.toast((r.data && r.data.error) || "Add failed", "error");
      return;
    }
    ev.target.reset();
    api.toast("Added", "success");
    loadBl();
  });

  document.getElementById("btn-refresh-channels").addEventListener("click", loadChannels);
  loadChannels();
  loadLex();
  loadBl();
})();
