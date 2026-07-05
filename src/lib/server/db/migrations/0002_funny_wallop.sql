ALTER TABLE `people` ADD `slug` text DEFAULT '' NOT NULL;--> statement-breakpoint
WITH `base_rows` AS (
	SELECT
		`id`,
		coalesce(
			nullif(
				lower(
					replace(
						replace(
							replace(
								replace(
									replace(
										replace(trim(`name`), ' ', '-'),
										'.',
										''
									),
									'''',
									''
								),
								'"',
								''
							),
							'&',
							'and'
						),
						'/',
						'-'
					)
				),
				''
			),
			'person'
		) AS `base`
	FROM `people`
),
`ranked` AS (
	SELECT
		`id`,
		`base`,
		row_number() OVER (PARTITION BY `base` ORDER BY `id`) AS `n`,
		count(*) OVER (PARTITION BY `base`) AS `c`
	FROM `base_rows`
)
UPDATE `people`
SET `slug` = (
	SELECT CASE WHEN `c` = 1 THEN `base` ELSE `base` || '-' || `n` END
	FROM `ranked`
	WHERE `ranked`.`id` = `people`.`id`
)
WHERE `slug` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_unique` ON `people` (`slug`);
