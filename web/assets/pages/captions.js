"use strict";
(function () {
  var api = window.NexBreakAPI;

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

  loadLex();
  loadBl();
})();
