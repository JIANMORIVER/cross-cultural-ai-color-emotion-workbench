CREATE TABLE `trial_manifest` (
	`logical_trial_id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`project_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_alias` text NOT NULL,
	`task_type` text NOT NULL,
	`run_index` integer NOT NULL,
	`stimulus_id` text NOT NULL,
	`stimulus_hex` text NOT NULL,
	`stimulus_index` integer NOT NULL,
	`model_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`max_retry_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`repair_attempted_at` text,
	`completed_at` text
);
