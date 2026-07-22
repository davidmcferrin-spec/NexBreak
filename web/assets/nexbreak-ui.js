/**
 * nexbreak-ui.js — theme helpers (pattern from NexVUE nexvue-ui.js).
 * Apply before paint; localStorage key: nexbreak-theme ("dark" | "light"); default dark.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "nexbreak-theme";

  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function readStoredTheme() {
    try {
      return normalizeTheme(global.localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return "dark";
    }
  }

  function applyTheme(theme) {
    theme = normalizeTheme(theme);
    var root = global.document.documentElement;
    if (root) root.setAttribute("data-theme", theme);
    return theme;
  }

  function setTheme(theme) {
    theme = applyTheme(theme);
    try {
      global.localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {}
    syncToggle();
    return theme;
  }

  function getTheme() {
    var root = global.document.documentElement;
    if (root && root.getAttribute("data-theme")) {
      return normalizeTheme(root.getAttribute("data-theme"));
    }
    return readStoredTheme();
  }

  function toggleTheme() {
    return setTheme(getTheme() === "light" ? "dark" : "light");
  }

  function syncToggle() {
    var btn = global.document.getElementById("theme-toggle");
    if (!btn) return;
    var isLight = getTheme() === "light";
    btn.setAttribute("aria-pressed", isLight ? "true" : "false");
    btn.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
    btn.textContent = isLight ? "Dark" : "Light";
  }

  applyTheme(readStoredTheme());

  function onReady(fn) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    syncToggle();
    var btn = global.document.getElementById("theme-toggle");
    if (btn) btn.addEventListener("click", function () { toggleTheme(); });
  });

  global.NexBreakUI = {
    getTheme: getTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    STORAGE_KEY: STORAGE_KEY,
  };
})(typeof window !== "undefined" ? window : globalThis);
