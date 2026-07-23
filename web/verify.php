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
      <p class="sub">Listen runs until Stop — watches the feed and auto-fires test splices so Sent and Received stay in sync</p>
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
        <button type="button" id="btn-refresh">Refresh</button>
      </div>
    </div>
    <div id="verify-tap" class="muted verify-meta">Select an output to see the tap source.</div>
    <div id="verify-status" class="empty">Not listening</div>
  </section>

  <section class="verify-compare" aria-label="Sent vs received SCTE">
    <div class="panel verify-col">
      <div class="panel-head">
        <h2>Sent</h2>
        <span class="panel-meta" id="verify-injects-meta">controller / verify auto-inject</span>
      </div>
      <p class="muted verify-col-hint">Splice commands for the routed input (Roll + Listen auto-inject). Match by Event ID.</p>
      <div id="verify-injects" class="verify-scroll">
        <div class="empty">No recent splice commands</div>
      </div>
    </div>
    <div class="panel verify-col">
      <div class="panel-head">
        <h2>Received</h2>
        <span class="panel-meta" id="verify-events-meta">TSDuck on tap</span>
      </div>
      <p class="muted verify-col-hint">TID 0xFC on the post-splice feed while Listen is running.</p>
      <div id="verify-events" class="verify-scroll">
        <div class="empty">Click Listen — test splices fire automatically until Stop.</div>
      </div>
    </div>
  </section>
</div>
<?php require __DIR__ . '/include/footer.php'; ?>
