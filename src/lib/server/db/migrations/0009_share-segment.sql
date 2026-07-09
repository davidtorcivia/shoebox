-- Optional video-segment bounds for a share: the share still targets the whole
-- item, but the viewer (and any clip download) is limited to [start,end] seconds.
ALTER TABLE `shares` ADD `segment_start` real;--> statement-breakpoint
ALTER TABLE `shares` ADD `segment_end` real;