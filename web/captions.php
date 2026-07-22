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
    <p class="sub">Shared phonetic lexicon (accuracy) and blacklist (compliance)</p>
  </div>
</div>

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
