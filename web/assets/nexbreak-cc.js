/**
 * nexbreak-cc.js — CC preference + SSE client for Preview / Roll overlays.
 * Captions arrive via same-origin /cc.php (not MediaMTX / WHEP).
 */
(function (global) {
  "use strict";

  var PREF_KEY = "nexbreak-captions-on";

  function getPref() {
    try {
      return localStorage.getItem(PREF_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setPref(on) {
    try {
      localStorage.setItem(PREF_KEY, on ? "1" : "0");
    } catch (e) {}
  }

  function connect(onCue) {
    var es = null;
    var path = null;

    function close() {
      if (es) {
        try {
          es.close();
        } catch (e) {}
        es = null;
      }
    }

    function setPath(next) {
      next = next ? String(next) : null;
      if (next === path && es) return;
      close();
      path = next;
      if (!path) {
        onCue({ text: "", clear: true, seq: 0, service: "CC1" });
        return;
      }
      es = new EventSource("/cc.php?path=" + encodeURIComponent(path));
      es.onmessage = function (ev) {
        var data;
        try {
          data = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        onCue({
          text: typeof data.text === "string" ? data.text : "",
          clear: !!data.clear || !data.text,
          seq: data.seq | 0,
          service: data.service || "CC1",
        });
      };
    }

    return {
      close: close,
      setPath: setPath,
      getPath: function () {
        return path;
      },
    };
  }

  function renderOverlay(el, cue, enabled) {
    if (!el) return;
    if (!enabled || !cue || cue.clear || !cue.text) {
      el.textContent = "";
      el.hidden = true;
      return;
    }
    el.textContent = cue.text;
    el.hidden = false;
  }

  global.NexBreakCC = {
    PREF_KEY: PREF_KEY,
    getPref: getPref,
    setPref: setPref,
    connect: connect,
    renderOverlay: renderOverlay,
  };
})(typeof window !== "undefined" ? window : globalThis);
