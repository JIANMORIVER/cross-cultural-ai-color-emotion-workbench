CREATE TABLE `experiment_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`repetitions` integer NOT NULL,
	`run_word_to_color` integer NOT NULL,
	`run_color_to_emotion` integer NOT NULL,
	`concurrency` integer NOT NULL,
	`max_retry` integer NOT NULL,
	`timeout_seconds` integer NOT NULL,
	`save_raw` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`alias` text NOT NULL,
	`model_id` text NOT NULL,
	`base_url` text NOT NULL,
	`api_format` text NOT NULL,
	`max_tokens` integer NOT NULL,
	`temperature` real NOT NULL,
	`top_p` real NOT NULL,
	`supports_seed` integer NOT NULL,
	`supports_json` integer NOT NULL,
	`rate_limit` integer NOT NULL,
	`enabled` integer NOT NULL,
	`last_test_status` text NOT NULL,
	`latency_ms` integer
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`researcher` text NOT NULL,
	`description` text NOT NULL,
	`experiment_version` text NOT NULL,
	`emotion_list_version` text NOT NULL,
	`color_list_version` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trial_results` (
	`trial_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_alias` text NOT NULL,
	`task_type` text NOT NULL,
	`run_index` integer NOT NULL,
	`stimulus_id` text NOT NULL,
	`clean_json` text NOT NULL,
	`raw_response` text NOT NULL,
	`validation_status` text NOT NULL,
	`retry_count` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
