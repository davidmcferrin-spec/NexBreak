<?php
declare(strict_types=1);
$pageTitle = 'Audit';
$activeNav = 'audit';
$pageScript = '/assets/pages/audit.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Audit</h1>
    <p class="sub">Splice commands, service lifecycle, config and routing changes</p>
  </div>
  <div class="bar">
    <label class="muted" for="filter-channel">Channel</label>
    <select id="filter-channel">
      <option value="">All channels</option>
    </select>
    <button type="button" id="btn-clear-audit" title="Delete audit events and SCTE sightings for the selected scope">Clear audit…</button>
    <button type="button" id="btn-refresh">Refresh</button>
    <span id="state" class="muted"></span>
  </div>
</div>

<section class="panel">
  <h2>Event log</h2>
  <div id="audit-wrap"><div class="empty">Loading…</div></div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
