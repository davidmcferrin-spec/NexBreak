<?php
declare(strict_types=1);
$pageTitle = 'Roll';
$activeNav = 'roll';
$pageScript = '/assets/pages/roll.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Roll</h1>
    <p class="sub">Per-stream SCTE-35 splice control — one channel never touches another</p>
  </div>
  <div class="bar roll-audio-bar">
    <button type="button" id="btn-vu" class="tgl" title="Show stereo VU meters on previews">VU</button>
    <button type="button" id="btn-mute" class="tgl" title="Mute program audio (this browser only)">Mute</button>
    <span class="vol-wrap" title="Volume (this browser only — Web Audio)">
      <span class="qlabel">vol</span>
      <input type="range" id="volume" min="0" max="100" step="1" value="100" aria-label="Volume">
      <span id="vol-pct">100%</span>
    </span>
  </div>
</div>

<p class="warn-banner">Live WebRTC preview is post-splice. Click a card to hear it (stereo VU via Web Audio). Buttons come from <a href="/triggers.php">Triggers</a> presets; each channel’s timing offset applies before inject.</p>

<section class="channel-grid" id="roll-grid">
  <div class="empty">Loading channels…</div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
