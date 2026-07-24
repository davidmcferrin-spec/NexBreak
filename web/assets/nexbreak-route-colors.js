/**
 * nexbreak-route-colors.js — stable accent colors per processing channel id.
 * Used on Metrics routing snapshot and Channels lists.
 */
(function (global) {
  "use strict";

  // Distinct, readable on dark + light themes (not purple-heavy).
  var PALETTE = [
    "#56c4f5",
    "#4cc38a",
    "#f5a623",
    "#e87a7a",
    "#7eb6ff",
    "#c9a227",
    "#5ecfc0",
    "#d4a5ff",
  ];

  function colorForProcessingId(id) {
    var n = Number(id);
    if (!isFinite(n) || n <= 0) return "var(--dim)";
    return PALETTE[Math.abs(Math.floor(n) - 1) % PALETTE.length];
  }

  function styleForProcessingId(id) {
    var c = colorForProcessingId(id);
    return {
      color: c,
      borderLeft: "3px solid " + c,
      boxShadow: "inset 3px 0 0 " + c,
    };
  }

  /** Apply left accent to a table row element. */
  function paintRow(el, processingId) {
    if (!el) return;
    var c = colorForProcessingId(processingId);
    el.style.borderLeft = "3px solid " + c;
    el.style.boxShadow = "inset 3px 0 0 " + c;
    el.dataset.routeColor = c;
    el.dataset.processingId = String(processingId || "");
  }

  /** Small swatch HTML. */
  function swatchHtml(processingId, title) {
    var c = colorForProcessingId(processingId);
    var t = title ? ' title="' + String(title).replace(/"/g, "&quot;") + '"' : "";
    return (
      '<span class="route-swatch"' +
      t +
      ' style="background:' +
      c +
      '"></span>'
    );
  }

  global.NexBreakRouteColors = {
    palette: PALETTE.slice(),
    colorForProcessingId: colorForProcessingId,
    styleForProcessingId: styleForProcessingId,
    paintRow: paintRow,
    swatchHtml: swatchHtml,
  };
})(typeof window !== "undefined" ? window : globalThis);
