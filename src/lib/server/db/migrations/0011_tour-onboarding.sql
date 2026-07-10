-- Guided-walk onboarding: the tour autostarts while tour_version is behind the
-- app's TOUR_VERSION constant; tour_completed_at is the audit stamp (skip counts).
ALTER TABLE `users` ADD `tour_completed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `tour_version` integer DEFAULT 0 NOT NULL;