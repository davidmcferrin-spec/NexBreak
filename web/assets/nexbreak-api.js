/**
 * nexbreak-api.js — thin fetch wrapper to the controller (NexAlert api helper pattern).
 * Attaches X-Api-Key for splice (and any other gated routes) once the panel key is known.
 */
(function (global) {
  "use strict";

  var keyPromise = null;

  function base() {
    return (global.NEXBREAK_API || "http://127.0.0.1:8787").replace(/\/$/, "");
  }

  function getApiKey() {
    var k = (global.NEXBREAK_API_KEY || "").trim();
    return k || "";
  }

  function setApiKey(key) {
    global.NEXBREAK_API_KEY = String(key || "").trim();
  }

  /** Load panel key from controller if not already set (LAN appliance UX). */
  function ensureApiKey() {
    if (getApiKey()) {
      return Promise.resolve(getApiKey());
    }
    if (keyPromise) return keyPromise;
    keyPromise = fetch(base() + "/v1/credentials/panel", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.ok && r.data.api_key) {
          setApiKey(r.data.api_key);
          return r.data.api_key;
        }
        return "";
      })
      .catch(function () {
        return "";
      })
      .finally(function () {
        keyPromise = null;
      });
    return keyPromise;
  }

  async function request(method, path, body) {
    // Splice needs the key; fetch lazily so Roll works without Triggers first.
    // Rotate also needs it — ensure before POST /v1/credentials/.../rotate.
    if (
      path.indexOf("/v1/splice") === 0 ||
      path.indexOf("/v1/credentials/panel/rotate") === 0
    ) {
      await ensureApiKey();
    }
    var opts = {
      method: method,
      headers: { Accept: "application/json" },
      cache: "no-store",
    };
    var key = getApiKey();
    if (key) {
      opts.headers["X-Api-Key"] = key;
    }
    if (body !== undefined && body !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(base() + path, opts);
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  function toast(message, type) {
    type = type || "info";
    var host = document.getElementById("toast-host");
    if (!host) {
      console.log("[toast]", type, message);
      return;
    }
    var el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 200);
    }, 3200);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function copyText(text) {
    text = String(text == null ? "" : text);
    if (!text) {
      toast("Nothing to copy", "error");
      return Promise.resolve(false);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          toast("Copied", "success");
          return true;
        },
        function () {
          toast("Copy failed", "error");
          return false;
        }
      );
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      toast(ok ? "Copied" : "Copy failed", ok ? "success" : "error");
      return Promise.resolve(ok);
    } catch (e) {
      toast(text, "info");
      return Promise.resolve(false);
    }
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso.replace(" ", "T") + (iso.indexOf("Z") >= 0 ? "" : "Z")).toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  global.NexBreakAPI = {
    get: function (path) { return request("GET", path); },
    post: function (path, body) { return request("POST", path, body); },
    del: function (path) { return request("DELETE", path); },
    toast: toast,
    esc: esc,
    copyText: copyText,
    fmtTime: fmtTime,
    ensureApiKey: ensureApiKey,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
