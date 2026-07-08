-- Distinguish relationship edges the user set by hand from ones we infer
-- (a parent shared to a sibling, siblings implied by a shared parent, etc.).
-- Inferred edges are recomputed from the manual edges on every change, so they
-- can be regenerated safely; the default keeps every existing row as 'manual'.
ALTER TABLE `relationships` ADD `source` text DEFAULT 'manual' NOT NULL;
