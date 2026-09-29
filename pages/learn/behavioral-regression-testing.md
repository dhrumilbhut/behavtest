---
path: behavioral-regression-testing/
title: Behavioral Regression Testing
description: What behavioral regression testing is, from first principles: behavior versus output, nondeterminism, repeated runs, and when a drop is real.
kind: learn
order: 1
---
# Behavioral regression testing

A **behavioral regression test** checks that a system still *does* what it is supposed to do after a change, judged by properties of what it does rather than by the exact output it produces. When the system is nondeterministic, as every LLM application is, "still does it" becomes a rate: the test asks whether the behavior now happens less often than before, by more than chance would explain.

This page builds the idea up from the ground: what counts as behavior, why exact outputs are the wrong thing to compare, why one run of each version can't settle the question, and what a statistically sound answer looks like.

## Output versus behavior

Take a support assistant and one question: *"Can I return an item after 40 days?"* The shop accepts returns for 30 days. Here are three answers the assistant might give:

| Answer | Same wording as before? | Correct behavior? |
|---|---|---|
| "No: returns are accepted within 30 days." | yes (the old answer) | yes |
| "Our policy allows returns within 30 days, so 40 days is too late." | no | yes |
| "Sure, just bring it back with the receipt!" | no | **no** |

A test that compares exact output (a snapshot) treats the second and third answers the same way: both differ from the stored text. The first is a harmless rephrasing and the second is a real regression, but the snapshot can't tell them apart. The behavior you care about is a *property* of the answer: it states the 30-day limit and doesn't promise an exception. A behavioral test checks that property, so the rephrasing passes and the wrong promise fails.

Behavior isn't only about the words. For an AI application it usually includes:

- **Content:** the answer states a required fact, follows a rubric, or matches a reference answer in meaning.
- **Actions:** an agent called the right tool with the right arguments, and didn't loop.
- **Grounding:** a RAG pipeline retrieved the right documents and answered only from them.
- **Constraints:** the response came back within a latency or cost budget, or in a required format.

## Four terms, defined

- **Behavior:** an observable property of one response, decided by a check (a *scorer*): passes or fails.
- **Expected behavior:** the property that must hold for a test case, written down as the scorer's configuration: a key fact, a rubric, a tool name, a list of document ids.
- **Regression:** expected behavior that used to hold and now holds less often, after a change to the system (a prompt edit, a model swap, new retrieval settings, a dependency upgrade).
- **Nondeterminism:** the same input produces different outputs on different calls. For LLMs this comes from sampling, and providers do not guarantee identical outputs even at low temperatures. It means "the expected behavior holds" is not yes or no: it is a probability.

## Why a single run of each version can't tell you

Suppose a case passes on the old version and fails on the new one. Is that a regression? With a nondeterministic system you can't know from one attempt each. If a case passes 80% of the time, two versions that behave *identically* will disagree on a single attempt about a third of the time.

The noise is large even with several attempts. In BehavTest's [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic), a bot that answers correctly 90% of the time was run twice, **with nothing changed**, 10 attempts per case:

```text
  ✗ regressed opening-hours 10/10 → 7/10 100% → 70%  p=0.211
      not statistically significant at this sample size
  ✓ improved  refund-window 7/10 → 10/10 70% → 100%  p=0.211
      not statistically significant at this sample size
```

One case "dropped" 30 points and another "rose" 30 points, and both movements are pure chance. Anyone comparing single runs would spend the afternoon chasing them.

## Repeated testing: behavior as a pass rate

The fix is to measure each case several times and treat its behavior as a pass rate with an uncertainty range. A 95% [Wilson score interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval) shows how much a pass rate can be trusted:

| Attempts passed | Pass rate | 95% interval |
|---|---|---|
| 1 of 1 | 100% | 21% to 100% |
| 3 of 3 | 100% | 44% to 100% |
| 7 of 10 | 70% | 40% to 89% |
| 9 of 10 | 90% | 60% to 98% |
| 45 of 50 | 90% | 79% to 96% |

One passing attempt is consistent with a true pass rate as low as 21%. The intervals narrow as attempts grow, which is exactly the trade-off you manage in practice: more attempts give sharper answers and cost more model calls.

Repeats also produce a category that single runs can't: a **flaky** case, one that passes on some attempts and fails on others. Flakiness is information. It tells you the behavior is not reliable even before anything changes.

## Statistical confidence: is the drop bigger than the noise?

With pass rates on both sides of a change, the question becomes a standard statistical one. Two levels matter:

- **Per case:** did this case's pass rate drop? With two small samples of pass/fail results, [Fisher's exact test](https://en.wikipedia.org/wiki/Fisher%27s_exact_test) gives a p-value: how surprising the difference would be if nothing had changed. 5/5 → 0/5 gives p = 0.008 (surprising: a real change). 3/3 → 0/3 gives p = 0.1, so three attempts per side can never show a significant change for one case.
- **Overall:** did the suite as a whole get worse? Pooling the evidence across cases is far more sensitive than any single case. A [permutation test](https://en.wikipedia.org/wiki/Permutation_test) that shuffles attempts *within* each case asks whether the average change is bigger than the within-case randomness.

On the same example, when the bot's accuracy really dropped from 90% to 60%, most individual cases were still "not significant" at 10 attempts each, but the overall test was not in doubt:

```text
  ✗ regressed shipping-time 10/10 → 5/10 100% → 50%  p=0.033 significant
  ✗ regressed support-email 9/10 → 5/10 90% → 50%  p=0.141
      not statistically significant at this sample size
  ...
  attempt pass rate  85% [76%–91%] → 56% [45%–67%]  (8 comparable cases; descriptive)
  overall change     mean per case -28.7 pts, 95% CI [-41.3 pts, -16.3 pts], p=<0.0001 → significant regression
```

Compare the unchanged run from the previous section: its overall change was -3.7 points with an interval from -15 to +7.5 points and p ≈ 0.67, which is noise. That contrast is the whole point of behavioral regression testing: **the same kind of per-case wobble, two very different verdicts**, decided by evidence rather than by eye.

## The workflow

```text
  test cases + expected behaviors
              |
   run each case N times (baseline)        run each case N times (after the change)
              |                                          |
      pass rate per case                         pass rate per case
              \__________________  __________________/
                                 \/
         compare: per-case exact test, overall permutation test
                                 |
       regressed / improved / flaky / not significant  ->  pass or fail the check
```

A baseline can be the last good run, a run of the main branch, or a small file committed to the repository so that every pull request is compared with the same reference.

## Doing it with BehavTest

BehavTest implements exactly this loop. You describe cases and their expected behaviors in a suite, it runs each case `--repeat` times through your application, and `behavtest compare` applies the per-case and overall tests:

```bash
behavtest run suite.json --repeat 10 --label before
# change the prompt, the model or the retrieval settings
behavtest run suite.json --repeat 10 --label after
behavtest compare --fail-on-regression --significant-only
```

Reproduce the numbers on this page with the keyless example: `behavtest run examples/nondeterministic/suite.mjs --label before`, then `SEED=2 behavtest run examples/nondeterministic/suite.mjs` (same bot) or `BOT_ACCURACY=0.6 SEED=3 behavtest run examples/nondeterministic/suite.mjs` (worse bot), then `behavtest compare`. The overall p-values are Monte Carlo estimates, so their last digits vary between runs. See [how BehavTest works](/docs/how-it-works/), [how compare decides](/docs/compare/) and the full [statistical reference](/docs/statistics/).

## What behavioral regression testing does not tell you

- **Whether the behavior was right to begin with.** It measures change against a baseline. A suite whose cases or checks are poorly chosen will pass happily while users suffer.
- **Anything about behavior you didn't write down.** Coverage is the set of cases and scorers you maintain; it grows as you turn real failures into cases.
- **Certainty.** A 5% significance level allows up to 1 in 20 per-case comparisons of an unchanged case to look significant by chance (Fisher's exact test is conservative, so usually fewer), and the per-case tests are not corrected for the number of cases: a large suite will show some false alarms at the case level. The overall test and repeated evidence across runs are more reliable than any single flagged case.
- **Judge-free truth when an LLM judges.** When a scorer is itself an LLM, its verdicts add their own noise and bias. Measure how often it agrees with you before trusting it: see [judge calibration](/docs/calibration/).

## Related

- [LLM regression testing](/llm-regression-testing/): the practical workflow, including CI.
- [AI regression testing](/ai-regression-testing/): how it differs from regression testing in traditional software.
- [LLM evaluation](/llm-evaluation/): measuring quality, and how it differs from regression testing.
- [Non-determinism: repeat your cases](/docs/repeats/) and [compare runs](/docs/compare/) in the BehavTest reference.
