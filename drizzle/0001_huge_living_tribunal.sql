ALTER TABLE `experiment_settings` ADD `prompt_seed_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `experiment_settings` ADD `prompt_seed_base` integer DEFAULT 20260715 NOT NULL;--> statement-breakpoint
ALTER TABLE `experiment_settings` ADD `native_seed_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `experiment_settings` ADD `prompt_variants_enabled` integer DEFAULT false NOT NULL;