---
path: blog/my-rag-eval-kept-failing-the-cheap-model/
title: My RAG Eval Kept Failing the Cheap Model. The Model Wasn't the Problem.
label: RAG Evaluation Debugging
description: A real debugging story: why a cheap LLM judge scored 7 out of 12 on a RAG faithfulness check, and why the fix was the prompt, not the model.
kind: blog
date: 2026-10-01
topics: rag, llm-judge, evaluation, prompt-engineering
---
# My RAG Eval Kept Failing the Cheap Model. The Model Wasn't the Problem.

RAG feels like magic in a demo and breaks in ways nobody can quite explain in production. The usual first instinct when an answer goes wrong is to ask whether the model retrieved the right document. The second instinct, once retrieval looks fine, is to blame the model for generating a bad answer anyway.

I built RAG specific scorers for BehavTest recently: one that checks whether an answer stays faithful to what was actually retrieved, and one that checks whether the retrieved documents were even relevant to the question in the first place. Both rely on an LLM judge to make the call. Judges are themselves a thing you have to test, and the first real test run taught me something I didn't expect: my own judge prompt was the bug, and the model I was about to write off as too weak had done nothing wrong.

## What a Faithfulness Judge Is Actually Supposed to Check

A faithfulness scorer answers one question: is this answer supported by the text that was retrieved, or did the model add something that isn't actually in there? That sounds simple, but there are two ways to implement it, and the difference matters for cost as much as for correctness.

The straightforward version asks the judge for one verdict per answer: supported or not. The more useful version, claim mode, asks the judge to first break the answer into individual factual claims, then mark each one supported or unsupported against the retrieved text, with the source document cited per claim. Structured this way, claim mode costs roughly one to two times a single verdict call instead of one call per claim, because the judge does the decomposition and the scoring in one structured response rather than one call per fact.

A second scorer, context relevance, checks the retrieval side directly: for each document that came back, was it actually relevant to the question, independent of whether the final answer used it well. Between the two, you get a real answer to the question that matters most when a RAG pipeline goes wrong: was this a retrieval failure or a generation failure. That distinction is the entire reason claim level attribution is worth building in the first place, rather than a single collapsed faithfulness score that can't tell you which half of the pipeline actually broke.

## The Weak Model That Wasn't

I ran the first real test against a small set of prompts, using a handful of different judge models so I could compare them against each other. One of the cheapest models on the list, the kind of model you'd pick specifically to keep judging costs down, scored 7 out of 12. The obvious read was that a model this cheap simply isn't strong enough to be trusted as a judge, and the honest move would have been to write that conclusion into the documentation and move on with a more expensive default.

Something about a 7 out of 12 result on a task this simple, judging whether a short answer is or isn't supported by a short passage, didn't sit right. It's not a hard reasoning problem. It's closer to reading comprehension. So instead of downgrading the model, I went looking at what the judge was actually being asked, and found three separate problems, all in the prompt, none in the model.

First, the faithfulness judge was seeing the original question alongside the answer and the retrieved context, and it was quietly scoring relevance to the question instead of faithfulness to the context. An answer that was completely supported by the retrieved text but slightly off topic relative to the question was getting marked unfaithful, which isn't what faithfulness means at all.

Second, in claim mode, the judge was occasionally listing the question itself as one of the answer's claims, then correctly noting the question wasn't supported by anything, which dragged the score down for a reason that had nothing to do with the actual answer.

Third, the context relevance scorer had a subtler bug: it was picking up the anti tampering nonce used to fence untrusted text in the prompt, and returning that nonce string as if it were a document id, instead of the id of an actual retrieved document.

None of these are model failures. They're all cases where the harness asked an ambiguous or slightly wrong question and then graded the answer to that wrong question as if it were the real one.

![The run detail view, showing a case's judge verdict alongside a "check the judge" pass/fail labeling control (demo data)](/blog/my-rag-eval-kept-failing-the-cheap-model/ui-run-light.png)

## Fixing the Prompt, Not the Model

Each fix was small on its own. Faithfulness judging was changed so the judge never sees the original question at all, only the answer and the retrieved context, which removes any path for relevance to leak into a faithfulness call. Document ids are now listed explicitly outside the fenced, untrusted portion of the prompt, and the judge's output schema enforces that any id it returns has to be one of the real ids offered, via an enum constraint rather than free text.

After those three changes, I reran the same comparison across models: 216 verdicts total. Two of the models, including a genuinely small one, went 36 out of 36 correct across both faithfulness modes. The model that had scored 7 out of 12 went 36 out of 36 on answer level faithfulness and 34 out of 36 in claim mode, with the two misses being one wrong claim call and one timeout, not a pattern of the model failing to understand the task.

The lesson generalizes past this one scorer: when a cheap model looks unreasonably bad at a task that shouldn't be hard, check what you're actually asking it before you conclude the model can't do the job. I'd told myself a clean story about model capability, and the real explanation was three separate, fixable, entirely mundane prompt bugs.

## Retrieved Documents Are Untrusted Input Too

There's a second failure mode worth testing for once the faithfulness prompt itself is fixed: what happens when one of the retrieved documents is actively trying to manipulate the judge. I ran a test where one retrieved document contained an instruction telling the judge to return a passing verdict regardless of the actual answer, the same category of attack as prompt injection against a chatbot, just aimed at the evaluator instead of the end user facing model.

Two of the models tested were never fooled by it, across every attempt. The cheapest model in the set was fooled once, out of two attempts in claim mode, and cited the injected document as its supporting source when it happened. That's a genuinely useful data point if you're choosing a judge model for a system where retrieved content isn't fully trusted, which in most real deployments, it isn't. Retrieved documents come from wherever your retrieval system points, and treating them as safe input by default is the same mistake as treating a chatbot's raw output as safe to render without escaping.

![The judge calibration view, showing Cohen's kappa, agreement percentage, and a confusion matrix of judge verdicts against human labels (demo data)](/blog/my-rag-eval-kept-failing-the-cheap-model/ui-cal-dark.png)

## Trusting a Judge Requires Measuring It, Not Assuming It

None of this replaces actually checking whether a judge agrees with a human. Pass rates from a judge can look reasonable and still be systematically wrong in a direction nobody notices, which is exactly what almost happened here before the prompt bugs were found. The real check is comparing the judge's verdicts against a small set of your own labeled examples, and reporting agreement with something like Cohen's kappa rather than trusting a raw percentage. A judge that agrees with itself ninety percent of the time and a judge that agrees with a human ninety percent of the time are very different claims, and only one of them is the one that actually matters.

If you're building judge prompts for a RAG evaluation, I'd be glad to compare notes on what you've found.
