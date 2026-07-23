<?php
declare(strict_types=1);
$pageTitle = 'Verify';
$activeNav = 'verify';
$pageScript = '/assets/pages/verify.js';
require __DIR__ . '/include/header.php';
?>
<div class="verify-page">
  <div class="page-header verify-header">
    <div>
      <h1>Verify</h1>
      <p class="sub">Correlate SCTE sent (controller) vs received (bitstream) — latest at the top of each table</p>
    </div>
  </div>

  <section class="panel verify-listen">
    <div class="panel-head">
      <h2>Listen</h2>
      <div class="bar" style="margin:0; flex-wrap:wrap; gap:8px">
        <label style="display:flex; align-items:center; gap:8px">
          Output
          <select id="verify-egress" style="min-width:200px"></select>
        </label>
        <button type="button" class="primary" id="btn-listen">Listen</button>
        <button type="button" id="btn-stop" disabled>Stop</button>
        <button type="button" id="btn-probe">Probe feed</button>
        <button type="button" id="btn-refresh">Refresh</button>
      </div>
    </div>
    <div id="verify-tap" class="muted verify-meta">Select an output to see the tap source.</div>
    <div id="verify-status" class="empty">Not listening</div>
    <div id="verify-probe" class="muted"></div>
  </section>

  <section class="verify-compare" aria-label="Sent vs received SCTE">
    <div class="panel verify-col">
      <div class="panel-head">
        <h2>Sent</h2>
        <span class="panel-meta" id="verify-injects-meta">controller → spliceinject</span>
      </div>
      <p class="muted verify-col-hint">Commands accepted for the routed input. Match by Event ID to Received.</p>
      <div id="verify-injects" class="verify-scroll">
        <div class="empty">No recent splice commands</div>
      </div>
    </div>
    <div class="panel verify-col">
      <div class="panel-head">
        <h2>Received</h2>
        <span class="panel-meta" id="verify-events-meta">TSDuck on tap</span>
      </div>
      <p class="muted verify-col-hint">TID 0xFC on the post-splice feed. Empty while Sent succeeds means markers are not on the wire.</p>
      <div id="verify-events" class="verify-scroll">
        <div class="empty">Start listening, then fire a splice from Roll.</div>
      </div>
    </div>
  </section>
</div>
<?php require __DIR__ . '/include/footer.php'; ?>
