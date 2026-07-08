-- Location (user-editable place name + GPS plumbing for a future map),
-- personal favorites, public emoji reactions, and voice memories.
ALTER TABLE `items` ADD `location` text;--> statement-breakpoint
ALTER TABLE `items` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `items` ADD `lng` real;--> statement-breakpoint

CREATE TABLE `favorites` (
	`user_id` text NOT NULL REFERENCES `users`(`id`),
	`item_id` text NOT NULL REFERENCES `items`(`id`),
	`created_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `item_id`)
);--> statement-breakpoint
CREATE INDEX `favorites_user` ON `favorites` (`user_id`, `created_at`);--> statement-breakpoint

CREATE TABLE `reactions` (
	`item_id` text NOT NULL REFERENCES `items`(`id`),
	`user_id` text NOT NULL REFERENCES `users`(`id`),
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`item_id`, `user_id`, `emoji`)
);--> statement-breakpoint
CREATE INDEX `reactions_item` ON `reactions` (`item_id`);--> statement-breakpoint

CREATE TABLE `voice_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL REFERENCES `items`(`id`),
	`user_id` text NOT NULL REFERENCES `users`(`id`),
	`storage_key` text NOT NULL,
	`mime` text NOT NULL,
	`duration` real,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `voice_notes_item` ON `voice_notes` (`item_id`);
