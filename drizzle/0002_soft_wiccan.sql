ALTER TABLE `experiment_settings` ADD `model_scope` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `experiment_settings` ADD `single_model_id` text DEFAULT 'model-gpt' NOT NULL;