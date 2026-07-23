<?php
declare(strict_types=1);
$pageTitle = 'Services';
$activeNav = 'services';
$pageScript = '/assets/pages/services.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Services</h1>
    <p class="sub">Systemd unit status and journal — LAN-trust ops (not a substitute for SSH)</p>
  </div>
</div>

<p class="warn-banner">
  Restart / start / stop go through allowlisted sudo wrappers.
  Core units (controller, verify, MediaMTX) can be restarted but not disabled from this page.
</p>

<div class="ops-layout">
  <section class="panel ops-units">
    <h2>Units</h2>
    <div id="unit-list"><div class="empty">Loading…</div></div>
  </section>
  <section class="panel ops-journal">
    <h2>Journal</h2>
    <div class="log-bar">
      <button type="button" id="follow" class="active" title="When on, keep the newest journal lines in view">Follow</button>
      <button type="button" id="copy-log" title="Copy journal text to clipboard">Copy</button>
      <button type="button" id="clear-log">Clear view</button>
      <button type="button" id="vacuum-journal" title="Clear journal history for the selected unit only">Clear unit journal…</button>
      <button type="button" id="restart-unit" disabled>Restart unit…</button>
      <button type="button" id="restart-channels" title="Restart every enabled proc/egress unit">Restart channels…</button>
      <button type="button" id="power-unit" disabled>Start/Stop…</button>
      <button type="button" id="toggle-unit" disabled>Enable/Disable…</button>
      <span id="status" class="muted">select a unit</span>
    </div>
    <pre id="log" class="journal"></pre>
  </section>
</div>
<?php require __DIR__ . '/include/footer.php'; ?>
