<?php
declare(strict_types=1);
$pageTitle = 'Captions';
$activeNav = 'captions';
$pageScript = '/assets/pages/captions.js';
require __DIR__ . '/include/header.php';
?>
<div class="page-header">
  <div>
    <h1>Captions</h1>
    <p class="sub">Program CC policy (egress) · shared lexicon/blacklist · Preview overlay is separate</p>
  </div>
  <button type="button" id="btn-refresh-channels">Refresh channels</button>
</div>

<section class="panel">
  <h2>Per-stream caption policy</h2>
  <p class="warn-banner" style="margin-bottom:10px">
    <strong>Auto</strong> — preserve source closed captions when present; otherwise insert ASR (CEA-608 CC1)
    into the program feed for SRT egress.
    <strong>Force ASR</strong> — always insert ASR (re-encodes that channel to H.264+A53; replaces source CC).
    <strong>Off</strong> — no ASR; source CC still preserved on remux.
    Policy changes that flip preserve ↔ insert restart that channel’s pipeline only.
    Preview page <em>CC</em> toggle is a display-only overlay from ccextractor — not this ASR worker text.
  </p>
  <div id="cap-channels"><div class="empty">Loading…</div></div>
</section>

<section class="panel">
  <h2>Vosk / ASR live</h2>
  <p class="sub" style="margin-top:0">What the caption worker is doing right now (model load, audio tap, partial/final text).</p>
  <div id="cap-asr-live"><div class="empty">Loading…</div></div>
</section>

<section class="two-col">
  <div class="panel">
    <h2>Phonetic lexicon</h2>
    <form id="lex-form" class="bar" style="margin-bottom:12px">
      <input name="word" placeholder="Word" required>
      <input name="phonetic" placeholder="Phonetic" required>
      <button type="submit" class="primary">Add</button>
    </form>
    <div class="list-edit" id="lex-list"><div class="empty">Loading…</div></div>
  </div>
  <div class="panel">
    <h2>Blacklist</h2>
    <p class="warn-banner" style="margin-bottom:10px">Blacklisted words are omitted from caption text entirely — no placeholder.</p>
    <form id="bl-form" class="bar" style="margin-bottom:12px">
      <input name="word" placeholder="Word" required>
      <button type="submit" class="primary">Add</button>
    </form>
    <div class="list-edit" id="bl-list"><div class="empty">Loading…</div></div>
  </div>
</section>
<?php require __DIR__ . '/include/footer.php'; ?>
