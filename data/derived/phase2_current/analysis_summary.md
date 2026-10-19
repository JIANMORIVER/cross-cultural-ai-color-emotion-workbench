# Task 2 analysis summary

## Analytic sample

- Total raw rows: 484
- Eligible Munsell-11 rows: 348
- BW: 99
- CN: 120
- UK: 129
- Formal Munsell-11 rows excluded for age outliers/missing age: 4
- Named-colour legacy rows (not mixed into Munsell analysis): 48
- Straightline responses flagged but retained: 6

The primary outcome is emotion selection prevalence. Intensity is analysed on a 0-5 grid, with an unselected emotion coded as 0. `None` and `Other` are retained in QC flags but excluded from the 20-emotion inferential grid.

## Omnibus results

- Selection cells significant after BH-FDR (q < 0.05): 75 / 220
- Zero-inclusive intensity cells significant after BH-FDR (q < 0.05): 72 / 220

Largest cross-group prevalence ranges:

| Colour | Emotion | Range | Cramer's V | q |
|---|---:|---:|---:|---:|
| J0 | Disgust | 0.418 | 0.439 | 6.02e-13 |
| D38 | Amusement | 0.396 | 0.400 | 8.55e-11 |
| C9 | Contentment | 0.392 | 0.348 | 3.14e-08 |
| F0 | Disgust | 0.363 | 0.333 | 1.51e-07 |
| F4 | Amusement | 0.360 | 0.349 | 3.14e-08 |
| F4 | Joy | 0.355 | 0.352 | 3.14e-08 |
| F0 | Disappointment | 0.339 | 0.270 | 3.1e-05 |
| H35 | Guilt | 0.324 | 0.315 | 6.71e-07 |
| H35 | Fear | 0.321 | 0.330 | 1.8e-07 |
| J0 | Fear | 0.309 | 0.273 | 2.55e-05 |

Largest significant pairwise prevalence differences:

| Colour | Emotion | Contrast | Difference | q |
|---|---|---|---:|---:|
| J0 | Disgust | CN - UK | 0.418 | 1.25e-09 |
| J0 | Disgust | CN - BW | 0.409 | 4.01e-08 |
| D38 | Amusement | CN - UK | 0.396 | 1.53e-08 |
| C9 | Contentment | CN - BW | 0.392 | 1.36e-07 |
| D38 | Amusement | CN - BW | 0.377 | 8.01e-07 |
| F0 | Disgust | CN - BW | 0.363 | 9.02e-08 |
| F4 | Amusement | CN - BW | 0.360 | 8.11e-07 |
| F4 | Joy | CN - BW | 0.355 | 2.93e-06 |
| F0 | Disappointment | CN - BW | 0.339 | 2.69e-05 |
| H35 | Guilt | CN - BW | 0.324 | 3.7e-06 |

## Interpretation cautions

- Each participant supplies repeated responses across colours and emotions. These cell-wise tests are descriptive/exploratory and use BH correction, but they do not replace a preregistered multilevel model.
- Conditional mean intensity among selectors is descriptive only. The inferential intensity test uses 0 for unselected emotions so that selection and strength are not separated in a biased subset.
- Residence mismatch and straightlining are flags, not automatic exclusions, unless the corresponding command-line option is used.
- Replace colour codes with verified Munsell labels/hex values through `--colour-map`; the code never guesses the mapping.

## Exclusion-version counts

- no_phase2_data: 84
- named_13: 48
- munsell_11: 4
