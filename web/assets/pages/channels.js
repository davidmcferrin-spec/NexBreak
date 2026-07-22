"use strict";
(function () {
  var api = window.NexBreakAPI;
  var editor = document.getElementById("editor");

  function renderList(el, channels, kind) {
    if (!channels.length) {
      el.innerHTML = '<div class="empty">None</div>';
      return;
    }
    el.innerHTML =
      '<table class="data"><thead><tr><th>Name</th><th>Type</th><th>Svc</th><th></th></tr></thead><tbody>' +
      channels
        .map(function (c) {
          var editBtn =
            kind === "proc"
              ? '<button type="button" data-edit="' + c.id + '">Edit</button>'
              : "";
          var extra =
            kind === "proc" && c.rtsp_url
              ? '<div class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                api.esc(c.rtsp_url) +
                "</div>"
              : "";
          return (
            "<tr><td>" +
            api.esc(c.name) +
            (Number(c.enabled) ? "" : ' <span class="badge dim">off</span>') +
            extra +
            "</td><td>" +
            api.esc(c.input_type || c.output_type) +
            "</td><td class=\"muted\">@" +
            api.esc(c.service_name) +
            "</td><td>" +
            editBtn +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    el.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openEdit(Number(btn.getAttribute("data-edit")), channels);
      });
    });
  }

  function openEdit(id, channels) {
    var ch = channels.find(function (c) {
      return Number(c.id) === id;
    });
    if (!ch) return;
    document.getElementById("f-id").value = ch.id;
    document.getElementById("f-name").value = ch.name || "";
    document.getElementById("f-input_type").value = ch.input_type || "rtsp";
    document.getElementById("f-rtsp_url").value = ch.rtsp_url || "";
    document.getElementById("f-rtsp_transport").value = ch.rtsp_transport || "tcp";
    document.getElementById("f-ingest_mode").value = ch.ingest_mode || "copy";
    document.getElementById("f-delay").value = ch.splice_insertion_delay_ms || 0;
    document.getElementById("f-feed_port").value = ch.local_feed_port || "";
    document.getElementById("f-bitrate").value = ch.target_bitrate_kbps || "";
    document.getElementById("f-preview_path").value = ch.preview_path || "";
    document.getElementById("f-preview_enabled").value = String(
      ch.preview_enabled == null ? 1 : Number(ch.preview_enabled)
    );
    document.getElementById("f-captioning").value = String(Number(ch.captioning_enabled) || 0);
    document.getElementById("f-enabled").value = String(Number(ch.enabled) || 0);
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function load() {
    var [proc, egr] = await Promise.all([api.get("/v1/processing"), api.get("/v1/egress")]);
    if (!proc.ok) {
      document.getElementById("proc-list").innerHTML =
        '<div class="empty">Controller unreachable</div>';
      return;
    }
    renderList(document.getElementById("proc-list"), proc.data.channels || [], "proc");
    renderList(document.getElementById("egr-list"), (egr.data && egr.data.channels) || [], "egr");
  }

  document.getElementById("btn-cancel").addEventListener("click", function () {
    editor.hidden = true;
  });

  document.getElementById("btn-save").addEventListener("click", async function () {
    var id = document.getElementById("f-id").value;
    var body = {
      name: document.getElementById("f-name").value,
      input_type: document.getElementById("f-input_type").value,
      rtsp_url: document.getElementById("f-rtsp_url").value,
      rtsp_transport: document.getElementById("f-rtsp_transport").value,
      ingest_mode: document.getElementById("f-ingest_mode").value,
      splice_insertion_delay_ms: Number(document.getElementById("f-delay").value),
      local_feed_port: Number(document.getElementById("f-feed_port").value),
      target_bitrate_kbps: Number(document.getElementById("f-bitrate").value) || null,
      preview_path: document.getElementById("f-preview_path").value || null,
      preview_enabled: Number(document.getElementById("f-preview_enabled").value),
      captioning_enabled: Number(document.getElementById("f-captioning").value),
      enabled: Number(document.getElementById("f-enabled").value),
    };
    var res = await api.post("/v1/processing/" + id + "/config", body);
    if (!res.ok || !res.data || !res.data.ok) {
      api.toast((res.data && res.data.error) || "Save failed", "error");
      return;
    }
    api.toast("Channel saved — restart nexbreak-proc@" + id + " to apply", "success");
    editor.hidden = true;
    load();
  });

  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
})();
