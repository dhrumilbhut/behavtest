// A nondeterministic stand-in for an LLM app, to see how BehavTest separates noise from a regression.
// Each call answers correctly with probability BOT_ACCURACY (default 0.9), like a model sampled at a
// temperature above 0. A seeded generator (SEED, default 1) makes a given command reproducible.
//
//   behavtest run examples/nondeterministic/suite.mjs --repeat 10 --label before
//   BOT_ACCURACY=0.6 SEED=2 behavtest run examples/nondeterministic/suite.mjs --repeat 10 --label after
//   behavtest compare
//
// No API key, no server: the "model" is the function below.

// mulberry32: a tiny deterministic PRNG, so the example output can be reproduced exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const accuracy = Number(process.env.BOT_ACCURACY ?? 0.9);
const random = rng(Number(process.env.SEED ?? 1));

const facts = {
  "refund-window": ["How long do I have to return an item?", "30 days"],
  "shipping-time": ["How long does standard shipping take?", "3 to 5 business days"],
  "opening-hours": ["When are you open?", "9am to 5pm"],
  "support-email": ["How do I contact support?", "help@example.com"],
  "gift-cards": ["Do gift cards expire?", "never expire"],
  "price-match": ["Do you match competitors' prices?", "within 14 days"],
  "warranty": ["How long is the warranty?", "2 years"],
  "international": ["Do you ship abroad?", "40 countries"],
};

export default {
  name: "support-bot",
  defaults: { repeat: 10, concurrency: 1 },
  pipeline: {
    name: "sampled-bot",
    config: { accuracy },
    // Correct with probability `accuracy`; otherwise a plausible answer without the key fact.
    run: (question) => {
      const [, fact] = Object.values(facts).find(([q]) => q === question);
      return random() < accuracy ? `Sure: ${fact}.` : "Please check our website for details.";
    },
  },
  scorers: {
    statesFact: ({ output, config }) => output.includes(config.fact),
  },
  cases: Object.entries(facts).map(([id, [question, fact]]) => ({
    id,
    input: question,
    scorers: ["statesFact"],
    scorerConfig: { statesFact: { fact } },
  })),
};
