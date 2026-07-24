-- Custom SQL migration file, put your code below! --
UPDATE `model_configs`
SET `model_id` = 'gpt-5.6',
    `api_format` = 'OpenAI Chat Completions',
    `supports_seed` = 0,
    `last_test_status` = 'Not tested',
    `latency_ms` = NULL
WHERE `id` = 'model-gpt'
  AND `model_id` = 'gpt-4.1-mini';
