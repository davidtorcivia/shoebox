-- Hot-path indexes missing from the initial schema. IF NOT EXISTS keeps this
-- idempotent so concurrent app + worker startup (each runs migrate()) is safe:
-- the second caller's CREATE INDEX is a no-op once the first has committed.
CREATE INDEX IF NOT EXISTS `item_people_person` ON `item_people` (`person_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `album_items_album_position` ON `album_items` (`album_id`, `position`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `comments_item` ON `comments` (`item_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `faces_item` ON `faces` (`item_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_tags_tag` ON `item_tags` (`tag_id`);
