<?php
declare(strict_types=1);
// Router UI merged into Channels (egress Source dropdown). Keep this redirect
// for old bookmarks / bookmarks / panel links.
header('Location: /channels.php', true, 301);
exit;
