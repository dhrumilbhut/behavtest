---
path: docs/statistics/
title: Statistical testing in BehavTest
description: The statistics behind behavtest compare: Wilson intervals, Fisher's exact test, a case-stratified permutation test, bootstrap intervals, and their limits.
kind: doc
order: 1
---
# Statistical testing in BehavTest

`behavtest compare` decides whether a change made an AI application behave worse. Because each test case passes only some of the time, that is a statistical question, and this page documents exactly how BehavTest answers it: what is computed, why each method was chosen, and what the numbers can and cannot tell you. For the intuition first, read [behavioral regression testing](/behavioral-regression-testing/).

## The data

Each run stores every **attempt**: one execution of one case, with a status of `passed` (every scorer passed), `failed` (the pipeline answered and a scorer said no) or `errored` (no verdict was possible: the pipeline was down, timed out, or a judge could not answer). With `--repeat N`, a case has N attempts. A case's **pass rate** is its passed attempts divided by its attempts.

Cases in the two runs are matched by id. Before any statistics, three kinds of case are set aside:

- **modified:** the case's definition changed (its hash covers the input, the expected answer and documents, the scorers and their configuration, inline scorer code and the judge model). Different tests can't be compared. The pipeline is deliberately not part of the hash: a new prompt or model is exactly what a comparison measures.
- **errored:** at least one attempt errored in either run. An error is not evidence about behavior. (An errored case in the new run still fails the regression gate.)
- **new / removed:** the case exists in only one run.

Everything below applies to the remaining **comparable** cases.

## Per case: pass rates and Wilson intervals

Each side's pass rate is reported with a 95% [Wilson score interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval). Wilson is used rather than the textbook normal approximation because it stays sensible at the extremes that are common here: 10 of 10 passing gives 72% to 100%, not a zero-width interval at 100%.

The case is then classified by the direction of its pass rate: lower is **regressed**, higher is **improved**, equal is **unchanged**, or **flaky** when equal and the new run's attempts were mixed.

## Per case: Fisher's exact test

Whether a case's change is **significant** comes from [Fisher's exact test](https://en.wikipedia.org/wiki/Fisher%27s_exact_test) on the 2×2 table of passed and not-passed attempts before and after, two-sided, at α = 0.05. It is exact (no large-sample approximation), which matters with 3 to 20 attempts per side. The consequence is a floor on what one case can show:

| Attempts per side | Most extreme change | p | Can be significant? |
|---|---|---|---|
| 1 | 1/1 → 0/1 | 1.000 | no |
| 3 | 3/3 → 0/3 | 0.100 | no |
| 5 | 5/5 → 0/5 | 0.008 | yes |
| 10 | 10/10 → 5/10 | 0.033 | yes |

A change that is not significant is still listed, with the note "not statistically significant at this sample size" (or, with one attempt per side, "could be noise, re-run with --repeat to confirm"). Per-case tests are **not corrected for multiple comparisons**: in a suite of 100 unchanged cases, a few may come out significant by chance. Treat a single significant case as a lead to investigate, and the overall test as the verdict on the suite.

## Overall: a case-stratified permutation test

The overall question is "on this suite, did the pass rate move by more than the pipeline's sampling noise?" The statistic is the **mean change in pass rate per case** (each comparable case weighted equally, so a case with more attempts doesn't dominate).

The test is a paired [permutation test](https://en.wikipedia.org/wiki/Permutation_test) **stratified by case**: within each case, the before/after labels of that case's own attempts are shuffled, the mean change is recomputed, and the p-value is the share of shuffles at least as extreme as the observed change (two-sided, with the usual +1 correction so it is never exactly zero). Cases are held fixed because the randomness that matters is *within* each case (the same input gives different outputs), not which cases happen to be in the suite. With one attempt per side, this reduces to an exact sign test on the cases whose outcome flipped: six one-way flips are significant (p = 0.031), five are not (p = 0.063).

A drop with p < 0.05 is a **significant regression**, a rise a **significant improvement**, and anything else **not significant**.

The interval printed next to the mean change is a 95% percentile **bootstrap** interval that resamples attempts within each case (before and after separately), again holding the cases fixed, so its width reflects the same within-case noise.

## Monte Carlo, and why the last digits vary

The permutation test and the bootstrap use random resampling: between 2,000 and 10,000 resamples, depending on the number of attempts. The random seed is derived from the two run ids, so **comparing the same two runs always gives the same numbers**, and a report can be regenerated exactly. Two *different* runs of an unchanged pipeline will give slightly different p-values, as in this repeat of the no-change experiment from the [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic): p = 0.678, 0.668 and 0.671 on three fresh pairs of runs. The smallest reportable p-value is about 0.0001, printed as `<0.0001`.

## The descriptive pass rate

The line `attempt pass rate 85% [76%–91%] → 56% [45%–67%]` pools all attempts of all comparable cases on each side, with Wilson intervals. It is labelled **descriptive** because it is not the test: pooling attempts ignores which case they came from, and cases with more attempts weigh more. The decision comes from the permutation test on the per-case mean.

## Validation

The statistics are checked against textbook reference values in the test suite, and the overall test is checked by simulation: with nothing changed it rejects less than 9% of the time, and it rejects more than 95% of the time for a real drop. The [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic) has an end-to-end test that keeps the numbers quoted in this documentation true.

## Assumptions and limits

- **Attempts are independent.** Each attempt is a separate request. Caching, shared conversation state or a provider that returns the same sample for identical requests would violate this and make changes look more (or less) significant than they are.
- **A significant result is about this suite.** The test answers whether *these cases* got worse, not whether the application got worse on inputs you didn't include.
- **Pass/fail only.** The comparison uses whether each attempt passed. Scores with a value (a retrieval recall of 0.6, a faithfulness fraction) enter through the scorer's threshold (`min`), not as numbers.
- **Power grows with attempts and cases.** Small changes in a single case's pass rate need many attempts; broad regressions show up in the overall test much sooner.
- **The gate adds rules of its own.** `--fail-on-regression` also fails on any regressed case, significant or not, and on a case that errored in the new run; `--significant-only` drops the non-significant regressed cases from that list. See [compare runs](/docs/compare/).

## Related

- [Compare runs: what regressed, and is it real?](/docs/compare/) for the command and its output.
- [Non-determinism: repeat your cases](/docs/repeats/) and [baselines and CI](/docs/ci-baselines/).
- [LLM regression testing](/llm-regression-testing/): choosing attempts and gates in practice.
