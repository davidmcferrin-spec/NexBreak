"use strict";
(function () {
  var JOURNAL_LINES = 300;

  var listEl = document.getElementById("unit-list");
  var logEl = document.getElementById("log");
  var statusEl = document.getElementById("status");
  var followBtn = document.getElementById("follow");
  var restartBtn = document.getElementById("restart-unit");
  var powerBtn = document.getElementById("power-unit");
  var toggleBtn = document.getElementById("toggle-unit");
  var vacuumBtn = document.getElementById("vacuum-journal");

  var selected = null;
  var follow = true;
  var lastServices = [];
  var servicesInFlight = false;
  var journalInFlight = false;

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
    vacuumBtn.disabled = !selected;
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
    if (servicesInFlight) return;
    servicesInFlight = true;
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
    } finally {
      servicesInFlight = false;
    }
  }

  function selectUnit(unit) {
    selected = unit;
    logEl.textContent = "";
    Array.prototype.forEach.call(listEl.querySelectorAll(".unit"), function (el) {
      el.classList.toggle("selected", el.querySelector(".name").textContent === unit);
    });
    restartBtn.disabled = false;
    updateUnitButtons();
    statusEl.textContent = unit;
    pollJournal(true);
  }

  function scrollToBottom() {
    logEl.scrollTop = logEl.scrollHeight;
  }

  function trimToTail(text, maxLines) {
    var lines = String(text || "").split("\n");
    // Drop a single trailing empty line from journalctl output before counting.
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length > maxLines) lines = lines.slice(-maxLines);
    return lines.length ? lines.join("\n") + "\n" : "";
  }

  async function pollJournal(forceStick) {
    if (!selected || journalInFlight) return;
    journalInFlight = true;
    try {
      var stick = !!(forceStick || follow);
      var prevTop = logEl.scrollTop;
      // Always re-fetch the last N lines so the buffer stays a fixed tail.
      var data = await api("journal", { unit: selected, lines: JOURNAL_LINES });
      var text = trimToTail(data.log || "", JOURNAL_LINES);
      logEl.textContent = text;
      if (stick) {
        scrollToBottom();
      } else {
        // Keep the user's place when Follow is off (reading older lines).
        logEl.scrollTop = prevTop;
      }
      var n = text ? text.split("\n").filter(Boolean).length : 0;
      statusEl.textContent =
        selected + " · " + n + " lines · updated " + new Date().toLocaleTimeString();
    } catch (err) {
      statusEl.textContent = "journal error: " + err.message;
    } finally {
      journalInFlight = false;
    }
  }

  followBtn.addEventListener("click", function () {
    follow = !follow;
    followBtn.classList.toggle("active", follow);
    if (follow) scrollToBottom();
  });
  document.getElementById("copy-log").addEventListener("click", async function () {
    var text = logEl.textContent || "";
    if (!text.trim()) {
      statusEl.textContent = "nothing to copy";
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      statusEl.textContent = "journal copied (" + text.length + " chars)";
    } catch (err) {
      statusEl.textContent = "copy failed: " + err.message;
    }
  });
  document.getElementById("clear-log").addEventListener("click", function () {
    logEl.textContent = "";
  });
  vacuumBtn.addEventListener("click", async function () {
    if (!selected) {
      statusEl.textContent = "select a unit first";
      return;
    }
    if (
      !confirm(
        "Clear journal history for " +
          selected +
          "?\n\n" +
          "This unit's older log lines will no longer appear here.\n" +
          "Other units are not affected (no host-wide vacuum)."
      )
    ) {
      return;
    }
    try {
      await api("journal_clear", { unit: selected });
      logEl.textContent = "";
      statusEl.textContent = "journal cleared for " + selected;
      pollJournal(true);
    } catch (err) {
      statusEl.textContent = "clear error: " + err.message;
    }
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
  }, 5000);
  setInterval(function () {
    if (selected) pollJournal(false);
  }, 2500);
  vacuumBtn.disabled = true;
  refreshServices();

  var bundleBtn = document.getElementById("btn-support-bundle");
  var bundleHours = document.getElementById("bundle-hours");
  if (bundleBtn && bundleHours) {
    bundleBtn.addEventListener("click", async function () {
      var hours = parseInt(bundleHours.value, 10) || 24;
      if (
        !confirm(
          "Build a redacted support bundle for the last " +
            hours +
            " hour(s)?\n\n" +
            "Includes journals, channel config, routing, audit, and runtime state.\n" +
            "Secrets (API keys, URL passwords) are stripped."
        )
      ) {
        return;
      }
      bundleBtn.disabled = true;
      statusEl.textContent = "Building support bundle (" + hours + "h)…";
      try {
        var res = await fetch(
          "/ops.php?action=support_bundle&hours=" + encodeURIComponent(String(hours)),
          { method: "GET", cache: "no-store" }
        );
        var ct = (res.headers.get("Content-Type") || "").toLowerCase();
        if (!res.ok || ct.indexOf("application/zip") < 0) {
          var errBody = await res.json().catch(function () {
            return {};
          });
          throw new Error(errBody.error || "HTTP " + res.status);
        }
        var blob = await res.blob();
        var dispo = res.headers.get("Content-Disposition") || "";
        var fname = "nexbreak-support.zip";
        var m = /filename=\"([^\"]+)\"/i.exec(dispo);
        if (m) fname = m[1];
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 2000);
        statusEl.textContent = "Support bundle downloaded (" + fname + ")";
      } catch (err) {
        statusEl.textContent = "support bundle error: " + err.message;
      } finally {
        bundleBtn.disabled = false;
      }
    });
  }
})();
