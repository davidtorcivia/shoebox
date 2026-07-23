-- The source filename (basename) a file arrived under via the ingest folder.
-- Lets a re-ingested file with the same name surface a "replace media?" prompt
-- in arrivals instead of a duplicate item needing all its info re-entered
-- (e.g. re-rendered scans fixing a bad audio mix). Null for uploads and for
-- items ingested before this column existed (those fall back to matching the
-- filename-derived title).
ALTER TABLE `items` ADD `ingest_name` text;
