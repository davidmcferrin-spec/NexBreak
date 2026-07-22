<?php
declare(strict_types=1);
?>
</main>
<div id="toast-host" class="toast-host" aria-live="polite"></div>
<?php if (!empty($pageScript)): ?>
<script src="<?= htmlspecialchars(nexbreak_asset($pageScript), ENT_QUOTES, 'UTF-8') ?>"></script>
<?php endif; ?>
</body>
</html>
