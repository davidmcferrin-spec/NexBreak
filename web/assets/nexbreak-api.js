/**
 * nexbreak-api.js — thin fetch wrapper to the controller (NexAlert api helper pattern).
 */
(function (global) {
  "use strict";

  function base() {
    return (global.NEXBREAK_API || "http://127.0.0.1:8787").replace(/\/$/, "");
  }

  async function request(method, path, body) {
    var opts = {
      method: method,
      headers: { Accept: "application/json" },
      cache: "no-store",
    };
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
    fmtTime: fmtTime,
  };
})(typeof window !== "undefined" ? window : globalThis);
