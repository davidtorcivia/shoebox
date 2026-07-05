CREATE TABLE `album_items` (
	`album_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`album_id`, `item_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_item_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `faces` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`frame_time` real,
	`box` text NOT NULL,
	`embedding` blob NOT NULL,
	`cluster_id` text,
	`person_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` integer,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `item_files` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_files_item` ON `item_files` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_people` (
	`item_id` text NOT NULL,
	`person_id` text NOT NULL,
	`face_box` text,
	`source` text DEFAULT 'manual' NOT NULL,
	PRIMARY KEY(`item_id`, `person_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`description` text,
	`date_start` text,
	`date_end` text,
	`date_precision` text DEFAULT 'unknown' NOT NULL,
	`sort_date` text,
	`duration` real,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`blurhash` text,
	`source` text NOT NULL,
	`tape_label` text,
	`status` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_sort` ON `items` (`sort_date`);--> statement-breakpoint
CREATE INDEX `items_status` ON `items` (`status`);--> statement-breakpoint
CREATE INDEX `items_sha` ON `items` (`sha256`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_claim` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nickname` text,
	`birthdate` text,
	`death_date` text,
	`birth_place` text,
	`bio` text,
	`avatar_item_id` text,
	`avatar_crop` text,
	`accent_color` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`person_a` text NOT NULL,
	`person_b` text NOT NULL,
	`type` text NOT NULL,
	FOREIGN KEY (`person_a`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_b`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rel_unique` ON `relationships` (`person_a`,`person_b`,`type`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`allow_download` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'topic' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`accent_color` text NOT NULL,
	`person_id` text,
	`comfort_mode` integer DEFAULT false NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `year_counts` (
	`year` integer NOT NULL,
	`type` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`year`, `type`)
);
