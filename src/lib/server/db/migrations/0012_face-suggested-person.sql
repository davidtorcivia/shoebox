-- The faces worker's best confirmed-person match for a pending face's cluster.
-- Pre-fills the review UI so each confirmation compounds instead of every
-- cluster starting from a blank dropdown. Plain text (no FK): people can be
-- merged/deleted without this advisory column blocking the write; readers
-- join people and treat a dangling id as "no suggestion".
ALTER TABLE `faces` ADD `suggested_person_id` text;
