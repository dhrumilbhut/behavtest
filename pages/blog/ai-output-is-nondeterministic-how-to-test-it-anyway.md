---
path: blog/ai-output-is-nondeterministic-how-to-test-it-anyway/
title: AI Output Is Nondeterministic. Here's How to Test It Anyway.
label: Testing Nondeterministic AI
description: Why pass or fail testing breaks for AI applications, and the statistics bug that shaped how BehavTest tells a real regression from noise.
kind: blog
date: 2026-10-01
topics: testing, statistics, ai-agents, regression-testing
---
# AI Output Is Nondeterministic. Here's How to Test It Anyway.

Most teams shipping an AI feature test it by eye. Someone types a few questions into the chatbot, reads the answers, decides they look right, and ships. Then a prompt gets tweaked, or the model gets swapped for something cheaper, and nobody notices anything changed until a user complains.

The problem isn't that testing AI is hard because the code is hard. It's that the output refuses to sit still. Ask the same question twice and you can get two different answers, both reasonable, neither wrong. A test suite built for deterministic code, where the same input always produces the same output, has no idea what to do with that.

I found out how badly a testing tool can get this wrong by building one and watching it lie to me.

## One Pass or One Fail Tells You Almost Nothing

If you run a test case against an LLM pipeline once and it passes, you've learned very little. Run it again and it might fail. Neither result tells you whether the pipeline is good, bad, or just noisy that day.

The only way around this is to stop treating a test case as a single question with a single answer, and start treating it as a question you ask several times, then look at the pattern. Five attempts at the same case, scored individually, gives you an actual pass rate instead of one lucky or unlucky roll. This sounds obvious once you say it out loud. It is not how most people test AI features, because it means every test run costs five times as many model calls, and most testing tools weren't built with that cost in mind from day one.

That decision, attempts as first class data instead of an afterthought, ended up mattering more than almost anything else in the design. It's also what made the next bug possible.

![The runs list, showing several saved runs with their pass rates and a flaky run flagged (demo data)](/blog/ai-output-is-nondeterministic-how-to-test-it-anyway/ui-runs-dark.png)

## The Bug in My Own Statistics

Early in building BehavTest, I wired up a comparison feature: run a suite twice, once against a baseline configuration and once against a change, and tell me whether the change made things better or worse. The mechanism was straightforward. Run each case five times in both configurations, compare the pass rates, and use a statistical test to decide whether the difference was real or just noise.

I tested it against a deliberately bad change. Three test cases that used to pass every single time, five out of five attempts, started failing every single time, zero out of five. The suite's overall pass rate dropped from 88 percent to 67 percent. This is about as unambiguous a regression as you can construct on purpose.

My own tool looked at that and said: not significant.

It was wrong, and it was wrong for an interesting reason. My first implementation bootstrapped over cases: it resampled which test cases were in the suite, as if the suite were a random sample of every question anyone might ask. That answers a different question, "will this be worse in general?", and with twelve cases the answer drowns in case-to-case variation. A regression gate asks something narrower: on this exact suite, did the pass rate move by more than the pipeline's own randomness? That randomness lives inside each case, in its five attempts, not in which cases happen to be in the suite.

The fix was a case stratified paired permutation test, with a separate within case bootstrap for the confidence interval. Each case is treated as its own paired observation, base versus head, and the test asks how likely a shuffle of labels would produce a gap this large by chance. I checked it against known reference values (Wilson intervals, Fisher's exact test on small samples) and then ran it against simulated data thousands of times: under a true null hypothesis it flags a false positive under 9 percent of the time at a 0.05 significance level, and it catches a real 90 percent to 40 percent drop more than 95 percent of the time.

That one bug reshaped how I think about the whole product. A testing tool that can be fooled by its own statistics is worse than no testing tool, because it hands you false confidence instead of an honest "I don't know."

![The compare view showing a statistically significant improvement, with the case-stratified permutation test result and per-case breakdown (demo data)](/blog/ai-output-is-nondeterministic-how-to-test-it-anyway/compare-dark.png)

## Never Guess, and Never Go Green on a Broken Pipeline

Once that lesson landed, it turned into a rule I apply everywhere else in the tool, not just in the comparison logic.

If a pipeline is down, or a judge model can't produce a verdict, the run errors. It does not silently pass, and it does not silently skip the case. Early real API testing against OpenAI found a model that rejected the temperature setting the judge asked for, and every judge call on it was failing outright. The correct behavior in that moment isn't to catch the error and move on quietly. It's to surface it loudly, because a testing tool that goes green on a broken pipeline is lying about the one thing it exists to tell you the truth about.

The same principle shows up in smaller places. If a model's pricing isn't confidently known, the reported cost is null, not zero. A model's output, the thing it actually produces, is treated as untrusted text, the same way you'd treat user input in a web app, because it's entirely possible for a chatty or manipulated model to try to talk its way past whatever is grading it. None of these are exotic ideas. They're the same defensive habits any backend engineer already applies to unreliable systems, just pointed at a part of the stack most eval tools treat as trustworthy by default.

## Why This Has to Work Before It Can Gate a Pull Request

None of the statistics matter if the only place you can see them is a terminal output you have to remember to run by hand. The actual goal was always to get this into CI: commit a baseline once, and let a pull request fail automatically the moment a prompt or model change makes behavior measurably worse, the same way a broken unit test blocks a merge today.

That only works if the tool underneath it is honest. A CI gate built on top of statistics that can call an 88 percent to 67 percent collapse "not significant" would either train a team to ignore it, because it cries wolf, or worse, let real regressions through with a green checkmark attached. Getting the statistics right wasn't a nice to have on the way to a CI integration. It was the prerequisite for one being worth building at all.

The teams that end up finding out about a regression from an angry user in production are the ones treating AI output as fundamentally untestable, something you can only eyeball and hope. The teams that catch it in a pull request are the ones who accepted that the output is noisy, and built the statistics to tell a real change from noise anyway. That's a solvable problem. It just isn't solved by pass or fail.

If you're testing something similarly nondeterministic, I'd be curious how you're approaching it.
