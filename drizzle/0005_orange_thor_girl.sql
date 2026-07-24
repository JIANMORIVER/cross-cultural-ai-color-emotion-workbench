CREATE TABLE `trial_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`logical_trial_id` text NOT NULL,
	`project_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_alias` text NOT NULL,
	`task_type` text NOT NULL,
	`run_index` integer NOT NULL,
	`stimulus_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`retryable` integer NOT NULL,
	`error_message` text NOT NULL,
	`raw_response` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
