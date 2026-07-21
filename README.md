# Chromalab — AI Emotion–Color Experiment Platform

Chromalab is a research workspace for standardized, English-only, text-based comparison of emotion–color associations across language models.

The study materials are aligned with the reference human survey:

- 20 Geneva Emotion Wheel emotion terms
- 11 anonymous color IDs and sRGB HEX values
- Word → Color and Color → Emotion task definitions
- no cultural framing, visual swatches, color names, or conversation history

## Current prototype

Implemented:

- six-step research workflow
- durable project, model, experiment, and result schemas using D1
- four starter OpenAI-compatible model profiles
- session-only API keys and live minimal connection tests
- experiment request-volume calculations and locked study conditions
- per-model Temperature, Top P, and maximum-output controls
- prominent provider-specific model variant picker plus custom Model ID input
- single-model scope that requires only the selected model credential
- one-request real pilots for both tasks, saving validated Interest → Color or J0 → Emotion results
- Color → Emotion uses a partial-or-complete 20-emotion selection with integer intensity levels 1–5
- seeded, reproducible shuffling for the 20 Word → Color stimuli, 11 Color → Emotion stimuli, and in-prompt emotion options
- independently switchable prompt seed tag, native API seed, and equivalent prompt-variant rotation policies
- runner readiness, pause/resume controls, data-review table, and filtering
- JSON/CSV configuration and study-material exports
- source-format result CSVs: Word → Color grouped by model and repetition, Color → Emotion kept per source request
- 91-column SurveyResponse XLSX matching the supplied data-format sample, with row manifest and experiment conditions
- original multi-model XLSX matching the supplied Doubao layout, with separate result and experiment-condition sheets
- responsive desktop and mobile interface

The production collection worker is intentionally not simulated. Queue dispatch, structured-output validation, and retries are the next implementation layer.

## Local development

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Verification

```bash
npm run lint
npm test
```

API keys are stored only in browser session storage. They are never written to D1 or included in exported configuration files.
