-- 64-bit perceptual hash (dHash, hex) of the item's visual content: the
-- mid-point frame for videos, the image itself for photos. Content-based
-- fallback for the arrivals "replace media?" prompt — a re-rendered scan
-- matches by what it looks like even when filenames and titles have changed.
-- Perceptual (not byte) hashing because every re-encode shifts pixel values.
ALTER TABLE `items` ADD `frame_phash` text;
