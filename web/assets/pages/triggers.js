"use strict";
(function () {
  var api = window.NexBreakAPI;
  var presets = [];
  var channels = [];
  var editingId = null;

  function listEl() {
    return document.getElementById("preset-list");
  }

  function editor() {
    return document.getElementById("preset-editor");
  }

  function renderList() {
    var el = listEl();
    if (!presets.length) {
      el.innerHTML = '<div class="empty">No presets</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr>' +
      "<th>Order</th><th>Label</th><th>Slug</th><th>Type</th><th>Flags</th><th></th>" +
      "</tr></thead><tbody>" +
      presets
        .map(function (p) {
          var flags = [];
          if (!Number(p.enabled)) flags.push("off");
          if (Number(p.auto_return)) flags.push("auto-return " + (p.break_duration_sec || "?") + "s");
          if (p.hex_payload) flags.push("hex");
          if (!Number(p.use_channel_delay)) flags.push("no delay");
          return (
            "<tr><td>" +
            api.esc(String(p.sort_order)) +
            "</td><td>" +
            api.esc(p.label) +
            '</td><td class="muted">' +
            api.esc(p.slug) +
            "</td><td>" +
            api.esc(p.splice_type) +
            '</td><td class="muted">' +
            api.esc(flags.join(" · ") || "—") +
            '</td><td><button type="button" data-edit="' +
            p.id +
            '">Edit</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";
    el.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openEdit(Number(btn.getAttribute("data-edit")));
      });
    });
  }

  function renderPanelUrls() {
    var box = document.getElementById("panel-urls");
    var chSel = document.getElementById("panel-channel");
    var cid = Number(chSel.value) || 0;
    var enabled = presets.filter(function (p) {
      return Number(p.enabled);
    });
    if (!cid || !enabled.length) {
      box.innerHTML = '<div class="empty">Select a channel with enabled presets</div>';
      return;
    }
    var origin = window.location.origin;
    box.innerHTML =
      '<table class="data"><thead><tr><th>Button</th><th>GET URL</th><th></th></tr></thead><tbody>' +
      enabled
        .map(function (p) {
          var url =
            origin +
            "/api/v1/splice?processing_channel_id=" +
            cid +
            "&preset=" +
            encodeURIComponent(p.slug);
          return (
            "<tr><td>" +
            api.esc(p.label) +
            '</td><td class="muted" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            api.esc(url) +
            '</td><td><button type="button" data-copy="' +
            api.esc(url) +
            '">Copy</button></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";
    box.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        api.copyText(btn.getAttribute("data-copy"));
      });
    });
  }

  function openEdit(id) {
    var p = null;
    for (var i = 0; i < presets.length; i++) {
      if (Number(presets[i].id) === id) {
        p = presets[i];
        break;
      }
    }
    editingId = id;
    document.getElementById("editor-title").textContent = p ? "Edit preset" : "New preset";
    document.getElementById("f-id").value = p ? p.id : "";
    document.getElementById("f-label").value = p ? p.label : "";
    document.getElementById("f-slug").value = p ? p.slug : "";
    document.getElementById("f-sort").value = p ? p.sort_order : 100;
    document.getElementById("f-enabled").value = p ? String(Number(p.enabled)) : "1";
    document.getElementById("f-type").value = p ? p.splice_type : "splice_start_immediate";
    document.getElementById("f-hex").value = p && p.hex_payload ? p.hex_payload : "";
    document.getElementById("f-auto").value = p ? String(Number(p.auto_return)) : "0";
    document.getElementById("f-break").value =
      p && p.break_duration_sec != null ? p.break_duration_sec : "";
    document.getElementById("f-delay").value = p
      ? String(Number(p.use_channel_delay == null ? 1 : p.use_channel_delay))
      : "1";
    document.getElementById("btn-delete").hidden = !p;
    editor().hidden = false;
  }

  function openNew() {
    editingId = null;
    document.getElementById("editor-title").textContent = "New preset";
    document.getElementById("f-id").value = "";
    document.getElementById("f-label").value = "";
    document.getElementById("f-slug").value = "";
    document.getElementById("f-sort").value = 100;
    document.getElementById("f-enabled").value = "1";
    document.getElementById("f-type").value = "splice_start_immediate";
    document.getElementById("f-hex").value = "";
    document.getElementById("f-auto").value = "0";
    document.getElementById("f-break").value = "";
    document.getElementById("f-delay").value = "1";
    document.getElementById("btn-delete").hidden = true;
    editor().hidden = false;
  }

  async function load() {
    var [pr, ch] = await Promise.all([
      api.get("/v1/splice/presets"),
      api.get("/v1/processing"),
    ]);
    if (!pr.ok || !pr.data || !pr.data.ok) {
      listEl().innerHTML =
        '<div class="empty">' +
        api.esc((pr.data && pr.data.error) || "Failed to load presets") +
        "</div>";
      return;
    }
    presets = pr.data.presets || [];
    channels = (ch.data && ch.data.channels) || [];
    renderList();
    var sel = document.getElementById("panel-channel");
    var prev = sel.value;
    sel.innerHTML = channels
      .map(function (c) {
        return (
          '<option value="' +
          c.id +
          '">' +
          api.esc(c.name) +
          " (@" +
          api.esc(c.service_name) +
          ")</option>"
        );
      })
      .join("");
    if (prev) sel.value = prev;
    renderPanelUrls();
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  document.getElementById("btn-new").addEventListener("click", openNew);
  document.getElementById("btn-cancel").addEventListener("click", function () {
    editor().hidden = true;
  });
  document.getElementById("panel-channel").addEventListener("change", renderPanelUrls);

  document.getElementById("btn-save").addEventListener("click", async function () {
    var body = {
      label: document.getElementById("f-label").value,
      slug: document.getElementById("f-slug").value,
      sort_order: Number(document.getElementById("f-sort").value) || 0,
      enabled: Number(document.getElementById("f-enabled").value),
      splice_type: document.getElementById("f-type").value,
      hex_payload: document.getElementById("f-hex").value || null,
      auto_return: Number(document.getElementById("f-auto").value),
      break_duration_sec: document.getElementById("f-break").value
        ? Number(document.getElementById("f-break").value)
        : null,
      use_channel_delay: Number(document.getElementById("f-delay").value),
    };
    var id = document.getElementById("f-id").value;
    var res = id
      ? await api.post("/v1/splice/presets/" + id, body)
      : await api.post("/v1/splice/presets", body);
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Save failed", "error");
      return;
    }
    api.toast("Preset saved", "success");
    editor().hidden = true;
    load();
  });

  document.getElementById("btn-delete").addEventListener("click", async function () {
    var id = document.getElementById("f-id").value;
    if (!id || !window.confirm("Delete this preset?")) return;
    var res = await api.post("/v1/splice/presets/" + id, { delete: true });
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Delete failed", "error");
      return;
    }
    api.toast("Deleted", "success");
    editor().hidden = true;
    load();
  });

  load();
})();
