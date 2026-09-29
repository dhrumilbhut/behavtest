---
path: llm-regression-testing/
title: LLM Regression Testing
description: How to regression test an LLM application whose outputs change between runs: behavioral checks, repeated attempts, baselines, significance, CI.
kind: learn
order: 2
---
# LLM regression testing

**How do you regression test an LLM application when its outputs change between runs?** Keep a fixed set of test cases, check each answer for the *behavior* you need rather than its exact wording, run every case several times, and compare the pass rates with a baseline using a significance test. Fail the build only when a change is larger than the run-to-run noise.

This page walks through each of those steps, why each one is needed, and how to wire the result into CI. The concepts behind it are on [behavioral regression testing](/behavioral-regression-testing/).

## Why can't I just snapshot LLM outputs?

Snapshot testing (store the output once, fail when it changes) works for deterministic code. For an LLM it fails in both directions:

- **It fails when nothing is wrong.** Model output varies from call to call: sampling picks different words, and providers don't guarantee identical outputs even at low temperatures (several current OpenAI models reject `temperature: 0` altogether). A snapshot turns every harmless rephrasing into a red test, and a test that is always red gets ignored.
- **It can't tell you what is wrong.** A diff says the text changed, not whether the change matters. "Returns are accepted within 30 days" versus "within 40 days" is a one-character diff and a serious bug; a completely rewritten but correct answer is a large diff and no bug at all.
- **It pins one sample.** The stored snapshot is one draw from a distribution. If that case is right 70% of the time, the snapshot says nothing about the other 30%.

Snapshots are still useful for the deterministic parts around the model (prompt templates, parsers), which [LLM testing](/llm-testing/) covers.

## Step 1: write cases that check behavior

Each case is an input plus the behavior its answer must show. Pick the cheapest check that captures the behavior:

| Behavior to protect | How to check it | In BehavTest |
|---|---|---|
| States a required fact or keyword | Deterministic: substring or regular expression | A custom scorer in a code suite (a one-line function) |
| A fixed answer (a label, "OK", a number) | Deterministic: normalized equality | `exactMatch` |
| Correct and complete in meaning | An LLM judge with a rubric | `llmJudge` |
| Calls the right tool, doesn't loop | Check the agent's recorded steps | `toolCalled`, `maxSteps` |
| Retrieves the right documents, answers from them | Retrieval metrics, a judge on grounding | `retrieval`, `faithfulness`, `contextRelevance` |
| Fast and cheap enough | Thresholds on latency and cost | `latencyCost` |

Prefer deterministic checks: they cost nothing and add no noise of their own. Use an LLM judge where meaning matters, and [check that the judge agrees with you](/docs/calibration/).

A minimal suite that tests a prompt on an OpenAI model:

```json
{
  "$schema": "https://unpkg.com/behavtest/schema/suite.schema.json",
  "name": "support-prompt",
  "defaults": { "judge": "openai:gpt-4.1-nano", "repeat": 5 },
  "pipeline": {
    "adapter": "openai",
    "config": { "model": "gpt-6-luna", "system": "You are a concise support agent. Returns are accepted within 30 days." }
  },
  "cases": [
    {
      "id": "refund-window",
      "input": "Can I return an item after 40 days?",
      "expected": "No: returns are accepted within 30 days.",
      "scorers": ["llmJudge"],
      "scorerConfig": { "llmJudge": { "rubric": "Does the answer state the 30-day limit and avoid promising an exception?" } }
    },
    { "id": "one-word", "input": "Reply with only the word OK.", "expected": "OK", "scorers": ["exactMatch"] }
  ]
}
```

Your application doesn't need to be JavaScript: BehavTest can also call any HTTP endpoint, or a function in a TypeScript suite. See [adapters](/docs/adapters/) and the [integrations](/integrations/) for OpenAI, Anthropic, Ollama, FastAPI, LangChain and the Vercel AI SDK.

## Step 2: record a baseline

Run the suite on the version you trust, with several attempts per case, and keep the result:

```bash
export OPENAI_API_KEY=sk-...
npx behavtest run prompt.suite.json --repeat 5 --label baseline --export behavtest.baseline.json --compact
```

`--export ... --compact` writes a small [run file](/docs/ci-baselines/) with pass/fail per attempt and a hash of each case, but no inputs or outputs, so it is safe to commit. The hash matters: if you later edit a case, the comparison reports it as `modified` instead of mistaking your edit for a regression.

## Step 3: change something and compare

Edit the prompt, swap the model or change retrieval, then run again and compare:

```bash
npx behavtest run prompt.suite.json --repeat 5 --label new-prompt
npx behavtest compare behavtest.baseline.json
```

`compare` lists every case that regressed, improved or is flaky, with its pass rate before and after, a p-value from Fisher's exact test, and an overall verdict from a case-stratified permutation test. Read [how compare decides](/docs/compare/) for the details.

## Step 4: choose how many attempts

The number of attempts per case decides what the comparison can detect. For a single case, these are the p-values of the most extreme result possible (the case went from always passing to never passing, or to half):

| Attempts per side | Change | p (Fisher's exact test) | Significant at 0.05? |
|---|---|---|---|
| 1 | 1/1 → 0/1 | 1.000 | never |
| 3 | 3/3 → 0/3 | 0.100 | never |
| 5 | 5/5 → 0/5 | 0.008 | yes |
| 10 | 10/10 → 5/10 | 0.033 | yes |
| 20 | 20/20 → 14/20 | 0.020 | yes |

So a single case needs about five attempts per side before even a total collapse can be significant, and more to detect partial drops. The overall test pools all cases, so across a suite fewer attempts can still reveal a broad regression. A practical starting point is `--repeat 3` for fast feedback and 5 to 10 for the suite that gates merges; the cost is cases × attempts model calls (plus judge calls), and `behavtest run` prints the count before it starts.

## Step 5: decide what fails the build

This is where nondeterminism bites hardest. BehavTest's [nondeterministic example](https://github.com/dhrumilbhut/behavtest/tree/main/examples/nondeterministic) runs a bot that is right 90% of the time; running it twice with **nothing changed** (10 attempts per case) produced five "regressed" cases, none significant, and an overall change of -3.7 points with p ≈ 0.67. The gate you choose decides what that means:

| Gate | Fails on | Result for the unchanged bot |
|---|---|---|
| `compare --fail-on-regression` | any case whose pass rate dropped, significant or not, any errored case, or a significant overall drop | **fails** (exit 1): noise counts |
| `compare --fail-on-regression --significant-only` | only statistically significant case drops, an errored case, or a significant overall drop | passes (exit 0) |
| `run --min-pass-rate 0.8` | this run alone falling below 80% of attempts passed | passes (exit 0) |

When the same bot's accuracy really fell to 60%, the significant-only gate failed as it should (overall p < 0.001). The rule of thumb: use `--fail-on-regression` for suites that are nearly deterministic (mostly deterministic scorers on stable behavior, where any drop is suspicious), and add `--significant-only` for genuinely nondeterministic behavior, with enough attempts for significance to be reachable.

## Step 6: run it in CI

On GitHub, the [BehavTest Action](/docs/github-action/) runs the suite on every pull request, compares it with the committed baseline, writes the comparison to the job summary and fails the check according to `gate` (`regression`, `significant`, `cases` or `none`):

```yaml
name: BehavTest
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write   # only for comment: true

jobs:
  behavtest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dhrumilbhut/behavtest@v0
        with:
          suite: prompt.suite.json
          repeat: 5
          gate: significant
          comment: true
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Any other CI system can run the same two commands (`behavtest run`, then `behavtest compare behavtest.baseline.json --fail-on-regression`); exit code 1 means the gate failed and 2 means a configuration error. Both recipes are in [baselines and CI](/docs/ci-baselines/). Update the baseline in the same pull request when a change is intended, so moving it is a reviewed decision.

## Limitations

- **The suite is the test.** Regressions in behavior no case exercises go unnoticed. Grow the suite from real failures.
- **Statistics need attempts.** Small changes in pass rate on a single case need many attempts to detect; a handful of attempts only catches large drops.
- **Judges are models too.** An LLM judge adds its own variance and bias. Prefer deterministic checks, use a different model from the one under test, and measure agreement with human labels.
- **Stateless cases.** Each attempt is one request. Multi-turn behavior can be tested by passing the conversation history as input, but BehavTest does not simulate a user over several turns.
- **Not production monitoring.** This runs before you ship; watching live traffic needs an observability tool.

## Related

- [Behavioral regression testing](/behavioral-regression-testing/): the concept, from first principles.
- [LLM evaluation](/llm-evaluation/): measuring quality versus detecting regressions.
- [How BehavTest works](/docs/how-it-works/) · [Quickstart](/docs/quickstart/) · [GitHub Action](/docs/github-action/) · [Statistical testing](/docs/statistics/) · [Troubleshooting](/docs/troubleshooting/)
