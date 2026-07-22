"use strict";
(function () {
  var listEl = document.getElementById("unit-list");
  var logEl = document.getElementById("log");
  var statusEl = document.getElementById("status");
  var followBtn = document.getElementById("follow");
  var restartBtn = document.getElementById("restart-unit");
  var powerBtn = document.getElementById("power-unit");
  var toggleBtn = document.getElementById("toggle-unit");

  var selected = null;
  var follow = true;
  var lastLine = "";
  var sinceCursor = "";
  var lastServices = [];

  async function api(action, body) {
    var opts = body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ action: action }, body)),
        }
      : {};
    var url = body ? "/ops.php" : "/ops.php?action=" + encodeURIComponent(action);
    var res = await fetch(url, opts);
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "HTTP " + res.status);
    }
    return data;
  }

  function isParked(state, enabled) {
    return enabled === "disabled" && (state === "inactive" || state === "failed");
  }

  function stateClass(state, enabled) {
    if (isParked(state, enabled)) return "off";
    if (state === "active") return "ok";
    if (state === "failed" || state === "inactive") return "bad";
    return "";
  }

  function stateText(s) {
    if (isParked(s.state, s.enabled)) return "disabled";
    var en = s.enabled && s.enabled !== "unknown" ? " · " + s.enabled : "";
    return s.state + en;
  }

  function updateUnitButtons() {
    var svc = lastServices.find(function (x) {
      return x.unit === selected;
    });
    if (!svc || !svc.can_toggle) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = "Enable/Disable…";
      delete toggleBtn.dataset.enable;
      powerBtn.disabled = true;
      powerBtn.textContent = "Start/Stop…";
      delete powerBtn.dataset.run;
      return;
    }
    var isEnabled = svc.enabled === "enabled";
    toggleBtn.disabled = false;
    toggleBtn.textContent = isEnabled ? "Disable unit…" : "Enable unit…";
    toggleBtn.dataset.enable = isEnabled ? "false" : "true";
    var isRunning = svc.state === "active" || svc.state === "activating";
    powerBtn.disabled = false;
    powerBtn.textContent = isRunning ? "Stop unit…" : "Start unit…";
    powerBtn.dataset.run = isRunning ? "false" : "true";
  }

  async function refreshServices() {
    try {
      var data = await api("services");
      lastServices = data.services || [];
      var keep = selected;
      listEl.innerHTML = "";
      lastServices.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "unit" + (keep === s.unit ? " selected" : "");
        b.innerHTML =
          '<div class="name">' +
          s.unit +
          '</div><div class="state ' +
          stateClass(s.state, s.enabled) +
          '">' +
          stateText(s) +
          "</div>";
        b.addEventListener("click", function () {
          selectUnit(s.unit);
        });
        listEl.appendChild(b);
      });
      if (keep) {
        var still = lastServices.find(function (x) {
          return x.unit === keep;
        });
        restartBtn.disabled = !still;
      }
      updateUnitButtons();
    } catch (err) {
      statusEl.textContent = "status error: " + err.message;
      listEl.innerHTML =
        '<div class="empty">Ops helpers missing? Run install (sudoers + /usr/local/bin/nexbreak-ops-*.sh)</div>';
    }
  }

  function selectUnit(unit) {
    selected = unit;
    lastLine = "";
    sinceCursor = "";
    logEl.textContent = "";
    Array.prototype.forEach.call(listEl.querySelectorAll(".unit"), function (el) {
      el.classList.toggle("selected", el.querySelector(".name").textContent === unit);
    });
    restartBtn.disabled = false;
    updateUnitButtons();
    statusEl.textContent = unit;
    pollJournal(true);
  }

  function extractIso(line) {
    var m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{4}|Z)?)/);
    return m ? m[1] : "";
  }

  function nearBottom() {
    return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  }

  function scrollToBottom() {
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function pollJournal(full) {
    if (!selected) return;
    try {
      var stick = full || nearBottom();
      var body = { unit: selected, lines: full || !sinceCursor ? 150 : 80 };
      if (!full && sinceCursor) body.since = sinceCursor;
      var data = await api("journal", body);
      var text = data.log || "";
      var lines = text.split("\n").filter(Boolean);
      if (!lines.length) {
        statusEl.textContent = selected + " · no new lines";
        return;
      }
      if (full || !logEl.textContent) {
        logEl.textContent = text;
        if (stick) scrollToBottom();
      } else {
        var start = 0;
        if (lastLine) {
          var idx = lines.lastIndexOf(lastLine);
          start = idx >= 0 ? idx + 1 : 0;
        }
        var add = lines.slice(start).join("\n");
        if (add) {
          logEl.textContent += (logEl.textContent.endsWith("\n") ? "" : "\n") + add + "\n";
          if (stick) scrollToBottom();
        }
      }
      lastLine = lines[lines.length - 1];
      var iso = extractIso(lastLine);
      if (iso) sinceCursor = iso;
      statusEl.textContent = selected + " · updated " + new Date().toLocaleTimeString();
    } catch (err) {
      statusEl.textContent = "journal error: " + err.message;
    }
  }

  followBtn.addEventListener("click", function () {
    follow = !follow;
    followBtn.classList.toggle("active", follow);
  });
  document.getElementById("clear-log").addEventListener("click", function () {
    logEl.textContent = "";
    lastLine = "";
  });
  restartBtn.addEventListener("click", async function () {
    if (!selected) return;
    if (!confirm("Restart " + selected + " now?")) return;
    try {
      await api("restart", { units: [selected] });
      statusEl.textContent = "restarted " + selected;
      refreshServices();
      pollJournal(true);
    } catch (err) {
      statusEl.textContent = "restart error: " + err.message;
    }
  });
  document.getElementById("restart-channels").addEventListener("click", async function () {
    if (!confirm("Restart every enabled nexbreak-proc@ / nexbreak-egress@ unit?")) return;
    try {
      var data = await api("restart_channels", {});
      statusEl.textContent = "restarted " + (data.restarted || []).length + " channel unit(s)";
      refreshServices();
    } catch (err) {
      statusEl.textContent = "restart error: " + err.message;
    }
  });
  powerBtn.addEventListener("click", async function () {
    if (!selected || powerBtn.dataset.run == null) return;
    var run = powerBtn.dataset.run === "true";
    if (!confirm((run ? "Start" : "Stop") + " " + selected + "?")) return;
    try {
      await api("set_running", { unit: selected, run: run });
      statusEl.textContent = (run ? "started " : "stopped ") + selected;
      refreshServices();
    } catch (err) {
      statusEl.textContent = "power error: " + err.message;
    }
  });
  toggleBtn.addEventListener("click", async function () {
    if (!selected || toggleBtn.dataset.enable == null) return;
    var enable = toggleBtn.dataset.enable === "true";
    if (!confirm((enable ? "Enable" : "Disable") + " " + selected + "?")) return;
    try {
      await api("set_enabled", { unit: selected, enable: enable });
      statusEl.textContent = (enable ? "enabled " : "disabled ") + selected;
      refreshServices();
    } catch (err) {
      statusEl.textContent = "enable error: " + err.message;
    }
  });

  setInterval(function () {
    refreshServices();
    if (follow && selected) pollJournal(false);
  }, 3000);
  refreshServices();
})();
