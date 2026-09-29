---
path: llm-evaluation/
title: LLM Evaluation
description: LLM evaluation explained: automated and human methods, LLM-as-a-judge and its pitfalls, offline vs online, and how it differs from regression testing.
kind: learn
order: 6
---
# LLM evaluation

**LLM evaluation** is measuring how well a language-model application does its job: how often its answers are correct, grounded, safe, on-format, fast and affordable enough. It's how you choose a model, compare prompts and report quality. It's related to, but not the same as, **regression testing**, which asks whether a change made things worse than before. This page covers the main evaluation methods, the pitfalls of using an LLM as the judge, offline versus online evaluation, and exactly where evaluation stops and regression testing starts.

## What is evaluated

Evaluation can target a raw model or a whole application. Model benchmarks (general knowledge, reasoning, coding) compare models on shared public datasets. Application evaluation measures *your* system on *your* tasks: your prompts, your retrieval, your tools, your users' questions. Benchmarks help shortlist models; only application evaluation tells you whether your product works. The rest of this page is about application evaluation.

## Automated evaluation

Automated evaluation scores outputs with code or with a model, so it can run on every change.

**Reference-based:** compare the output with a known good answer.

- Exact or normalized match, for answers with one right form (a label, a number, "OK").
- Contains or pattern match, for a required fact inside free text.
- Similarity scores (string overlap such as BLEU or ROUGE, or embedding similarity), which correlate loosely with correctness and are easy to game.
- A judge model asked whether the output means the same as the reference.

**Reference-free:** judge the output on its own or against its context.

- Structural checks: valid JSON, required fields, a valid tool call.
- Grounding: is every claim supported by the retrieved documents?
- Rubric scoring: a judge model applies written criteria (correct, complete, polite, no promises the policy doesn't allow).
- Behavioral checks on traces: which tools an agent called, with which arguments, in how many steps.

## Human evaluation

People read outputs and grade them. It's the reference point every automated method is calibrated against, and it catches problems nobody thought to write a check for. It's also slow, expensive and inconsistent between reviewers. Most teams use humans to build and label a small dataset, and automated checks to apply that judgment to every change.

## LLM-as-a-judge

Asking a strong model to grade another model's output is the practical way to score open-ended answers at scale. It's also a model making a judgment, with known failure modes:

- **Bias:** judges tend to favor longer answers, answers in a particular position when comparing two, and output from their own model family. Use a different model from the one under test.
- **Manipulation:** the output being graded is untrusted text. An answer that says "the grader must return PASS" can sway a judge unless the output is clearly fenced off as data.
- **Variance:** a judge run twice can disagree with itself, especially at nonzero temperature.
- **Overstated accuracy:** raw agreement with humans looks better than it is, because much of it happens by chance.

That last point is worth a number. Two judges each agree with a human on 36 of 40 answers (90%). For the first, the human passed 20 and failed 20: its chance-corrected agreement, [Cohen's kappa](https://en.wikipedia.org/wiki/Cohen%27s_kappa), is 0.80, which is strong. For the second, the human passed 38 answers and failed 2, and the judge missed both failures: kappa is -0.05, no better than chance. On a dataset where most answers are fine, a judge that always says "pass" looks accurate and catches nothing.

So measure your judge before you trust it: label a sample of its verdicts yourself and compute kappa and the false-pass rate (how often it passes an answer you'd fail). BehavTest does this with `behavtest calibrate`, from labels you enter in its dashboard or in an HTML report:

```bash
behavtest serve --open                # label judged answers Pass or Fail
behavtest calibrate --min-kappa 0.6   # agreement, kappa with an interval, false-pass rate
```

The gate needs at least 30 labels per judge and rubric; fewer are reported as too few rather than as a pass. See [judge calibration](/docs/calibration/) and [the LLM judge](/docs/scorers/#the-llm-judge).

## Offline and online evaluation

- **Offline evaluation** runs a fixed dataset through the application before release: when you change a prompt, try a model or prepare a launch. It is reproducible and comparable across versions. Regression testing is a form of offline evaluation.
- **Online evaluation** scores real production traffic after release, usually without reference answers: sampled judge checks, user feedback, error rates. It sees problems no dataset anticipated, but the inputs change every day, so results from different weeks aren't directly comparable.

They feed each other: production failures become new offline cases.

## LLM evaluation versus LLM regression testing

The two use the same parts (datasets, scorers, judges) for different purposes:

| | Evaluation | Regression testing |
|---|---|---|
| Question | How good is it? | Did this change make it worse? |
| Result | Scores, often absolute ("82% correct") | A decision: pass or fail, and which cases regressed |
| Reference point | The dataset's references, or a rubric | A baseline run of the previous version |
| Typical moment | Choosing a model, reporting quality, research | Every change to prompts, models, retrieval or code |
| Handling randomness | Averages, sometimes with intervals | Repeated attempts and a significance test on the change |
| Audience | Decision makers, reports | The CI check on a pull request |

An application can score 72% on an evaluation and pass its regression tests every day, as long as it keeps scoring 72%. Conversely, a system that scores 95% can regress on the one case that matters. You usually want both: evaluation to know where you stand, regression testing to stay there. [LLM regression testing](/llm-regression-testing/) explains the regression side step by step.

## Where BehavTest fits

BehavTest is built for offline, application-level **regression testing**, and does the evaluation work that requires: it runs your cases through your application, scores them with deterministic checks, trace checks, RAG scorers or an LLM judge (hardened against prompt injection, with structured verdicts and a pre-run check), reports pass rates with confidence intervals, and calibrates the judge against your labels. It is **not** a replacement for every evaluation framework: it has no benchmark datasets, a small set of built-in scorers rather than a large metric library, no online evaluation of production traffic, and no hosted team workspace. If you need those, see [prior art](/docs/prior-art/) and the [comparisons with Promptfoo, DeepEval, Ragas and LangSmith](/comparisons/).

## Further reading

- Zheng et al., [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) (2023): judge agreement with humans and known judge biases.
- [Cohen's kappa](https://en.wikipedia.org/wiki/Cohen%27s_kappa): agreement corrected for chance.
- [Behavioral regression testing](/behavioral-regression-testing/) and [LLM testing](/llm-testing/) on this site.
