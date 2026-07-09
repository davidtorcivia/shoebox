-- The pre-cut clip served to a video-segment share viewer, so the full video is
-- never delivered to them.
ALTER TABLE `shares` ADD `clip_key` text;