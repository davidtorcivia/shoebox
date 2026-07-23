-- Full capture timestamp ("YYYY-MM-DDTHH:MM:SS") probed from the video's
-- creation_time metadata, or set manually via the edit form's time field.
-- sort_date stays date-only; ordering queries use this as the intra-day
-- tie-break so same-day items play out chronologically (for digitized tapes
-- the transfer timestamps preserve capture order even though the date part is
-- the transfer date). Null means unknown -> sorts first within the day.
ALTER TABLE `items` ADD `capture_time` text;
