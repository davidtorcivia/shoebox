-- "Not them" on an item's suggested person. The faces worker recomputes
-- suggestions wholesale on every scan, so without this record a dismissed
-- suggestion would resurface after the next upload; the worker skips stamping
-- suggested_person_id for (item, person) pairs listed here. Confirming the
-- person deletes the row.
CREATE TABLE `face_suggestion_dismissals` (
	`item_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `person_id`)
);
