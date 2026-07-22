"use strict";
(function () {
  var api = window.NexBreakAPI;
  var matrix = document.getElementById("matrix");
  var proc = [];
  var egr = [];
  var assignments = {};

  async function load() {
    var [p, e, r] = await Promise.all([
      api.get("/v1/processing"),
      api.get("/v1/egress"),
      api.get("/v1/routing"),
    ]);
    if (!p.ok || !e.ok || !r.ok) {
      matrix.innerHTML = '<div class="empty">Controller unreachable</div>';
      return;
    }
    proc = p.data.channels || [];
    egr = e.data.channels || [];
    assignments = {};
    (r.data.assignments || []).forEach(function (a) {
      assignments[a.egress_channel_id] = a.processing_channel_id;
    });
    render();
  }

  function render() {
    if (!egr.length) {
      matrix.innerHTML = '<div class="empty">No egress channels</div>';
      return;
    }
    matrix.innerHTML = "";
    egr.forEach(function (out) {
      var row = document.createElement("div");
      row.className = "router-row";

      var left = document.createElement("div");
      left.innerHTML =
        "<strong>" +
        api.esc(out.name) +
        '</strong><div class="muted">egress @' +
        api.esc(out.service_name) +
        " · " +
        api.esc(out.output_type) +
        "</div>";

      var arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.textContent = "←";

      var sel = document.createElement("select");
      sel.innerHTML = '<option value="">— unassigned —</option>';
      proc.forEach(function (inn) {
        var opt = document.createElement("option");
        opt.value = String(inn.id);
        opt.textContent = inn.name + " (@" + inn.service_name + ")";
        if (Number(assignments[out.id]) === Number(inn.id)) opt.selected = true;
        sel.appendChild(opt);
      });
      var mid = document.createElement("div");
      mid.appendChild(sel);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary";
      btn.textContent = "Apply";
      btn.addEventListener("click", async function () {
        var pid = Number(sel.value);
        if (!pid) {
          api.toast("Pick a processing source", "error");
          return;
        }
        var res = await api.post("/v1/routing", {
          processing_channel_id: pid,
          egress_channel_id: out.id,
        });
        if (!res.ok || !res.data || !res.data.ok) {
          api.toast((res.data && res.data.error) || "Routing failed", "error");
          return;
        }
        api.toast(out.name + " ← reassigned", "success");
        load();
      });

      row.appendChild(left);
      row.appendChild(arrow);
      row.appendChild(mid);
      row.appendChild(btn);
      matrix.appendChild(row);
    });
  }

  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
})();
