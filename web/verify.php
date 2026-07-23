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
    Verify taps the routed post-splice local feed (same MPEG-TS egress remuxes)
    so it does not steal the live SRT client. Status should show
    <strong>listening</strong> then <strong>stream locked</strong> with rising
    byte counts — then fire a splice from Roll to confirm SCTE.
  </p>
  <div class="bar" style="margin-bottom:12px; flex-wrap:wrap; gap:8px">
    <label style="display:flex; align-items:center; gap:8px">
      Output
      <select id="verify-egress" style="min-width:220px"></select>
    </label>
    <button type="button" class="primary" id="btn-listen">Listen</button>
    <button type="button" id="btn-stop" disabled>Stop</button>
    <button type="button" id="btn-refresh">Refresh</button>
  </div>
  <div id="verify-tap" class="muted" style="margin-bottom:10px">Select an output to see the tap source.</div>
  <div id="verify-status" class="empty">Not listening</div>
</section>

<section class="panel">
  <h2>Recent injects</h2>
  <p class="muted" style="margin-bottom:8px">
    Controller audit for splice commands — confirmation even if the bitstream watch is quiet.
  </p>
  <div id="verify-injects"><div class="empty">No recent splice commands</div></div>
</section>

<section class="panel">
  <h2>SCTE sightings</h2>
  <div id="verify-events"><div class="empty">Start listening, then fire a splice from Roll.</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
