<?php
declare(strict_types=1);
$pageTitle = 'Verify';
$activeNav = 'verify';
$pageScript = '/assets/pages/verify.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Verify</h1>
    <p class="sub">Return-feed SCTE-35 check — listen to an egress and confirm markers on the bitstream</p>
  </div>
</div>

<section class="panel">
  <h2>Listen</h2>
  <p class="warn-banner" style="margin-bottom:12px">
    Verify taps the routed post-splice local feed with <strong>TSDuck</strong>
    (not ffmpeg remux — that was dropping SCTE-35 PIDs and looking like “no markers”).
    Status should show <strong>listening</strong> / <strong>stream locked</strong>,
    then fire a splice from Roll. Use <strong>Probe feed</strong> for a one-shot
    PMT + TID&nbsp;0xFC check that separates inject-accepted from markers-on-wire.
  </p>
  <div class="bar" style="margin-bottom:12px; flex-wrap:wrap; gap:8px">
    <label style="display:flex; align-items:center; gap:8px">
      Output
      <select id="verify-egress" style="min-width:220px"></select>
    </label>
    <button type="button" class="primary" id="btn-listen">Listen</button>
    <button type="button" id="btn-stop" disabled>Stop</button>
    <button type="button" id="btn-probe">Probe feed</button>
    <button type="button" id="btn-refresh">Refresh</button>
  </div>
  <div id="verify-tap" class="muted" style="margin-bottom:10px">Select an output to see the tap source.</div>
  <div id="verify-status" class="empty">Not listening</div>
  <div id="verify-probe" class="muted" style="margin-top:10px"></div>
</section>

<section class="panel">
  <h2>Recent injects</h2>
  <p class="muted" style="margin-bottom:8px">
    Controller audit only — proves the command was accepted and sent to
    <code>spliceinject</code>, <em>not</em> that markers are on the bitstream.
  </p>
  <div id="verify-injects"><div class="empty">No recent splice commands</div></div>
</section>

<section class="panel">
  <h2>SCTE sightings (bitstream)</h2>
  <p class="muted" style="margin-bottom:8px">
    TSDuck saw TID&nbsp;0xFC on the tap. Empty here while injects succeed usually
    meant the old ffmpeg remux path; after redeploy, empty means markers are
    not on the feed.
  </p>
  <div id="verify-events"><div class="empty">Start listening, then fire a splice from Roll.</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
