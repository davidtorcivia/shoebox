-- Remember which frame the user picked as a video's thumbnail/poster so
-- re-running derivatives is deterministic instead of snapping back to the
-- automatic 10%-in frame. Null means "auto".
ALTER TABLE `items` ADD `poster_time` real;
