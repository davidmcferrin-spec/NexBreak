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
      <p class="sub">Listen runs until Stop — watches the return feed for SCTE. Test cues are optional: they inject real markers downstream receivers will act on.</p>
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
        <label style="display:flex; align-items:center; gap:6px" title="Fire an alternating start/end test splice into the routed input every 12s while listening. These are REAL SCTE-35 markers — downstream ad inserters will act on them.">
          <input type="checkbox" id="verify-autoinject">
          Send test cues (12s)
        </label>
        <button type="button" class="primary" id="btn-listen">Listen</button>
        <button type="button" id="btn-stop" disabled>Stop</button>
        <button type="button" id="btn-refresh">Refresh</button>
      </div>
    </div>
    <div id="verify-tap" class="muted verify-meta">Select an output to see the tap source.</div>
    <div id="verify-status" class="empty">Not listening</div>
  </section>

  <section class="panel verify-chain">
    <div class="panel-head">
      <h2>Insertion engine</h2>
      <span class="panel-meta" id="verify-chain-meta">in-chain tsp splicemonitor on the routed input</span>
    </div>
    <p class="muted verify-col-hint">Lossless proof from inside the splice pipeline: UDP command received → enqueued → injected → seen by splicemonitor. If a Roll shows received but never injected, spliceinject has no PTS lock or no null packets to replace.</p>
    <div id="verify-chain" class="empty">Select an output with a routed input.</div>
  </section>

  <section class="verify-compare" aria-label="Sent vs received SCTE">
    <div class="panel verify-col">
      <div class="panel-head">
        <h2>Sent</h2>
        <span class="panel-meta" id="verify-injects-meta">controller / verify auto-inject</span>
      </div>
      <p class="muted verify-col-hint">Splice commands for the routed input (Roll + optional test cues). Match by Event ID.</p>
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
        <div class="empty">Click Listen — rows appear when SCTE is seen on the tap (Roll, or test cues if enabled).</div>
      </div>
    </div>
  </section>
</div>
<?php require __DIR__ . '/include/footer.php'; ?>
