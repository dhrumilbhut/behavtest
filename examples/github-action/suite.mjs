// A keyless suite for trying (and testing) the Regrade GitHub Action.
// The "pipeline" is a tiny FAQ bot; set BOT_QUALITY=broken to simulate a pull request that breaks it.
const answers = {
  "opening-hours": "We are open 9am to 5pm, Monday to Friday.",
  "refund-window": "You can return items within 30 days.",
  "shipping-time": "Standard shipping takes 3 to 5 business days.",
  "support-email": "Write to help@example.com.",
  "gift-cards": "Gift cards never expire.",
};

export default {
  name: "faq-bot",
  pipeline: {
    name: "faq-bot",
    config: { quality: process.env.BOT_QUALITY ?? "good" },
    run: (question) => {
      const id = String(question);
      if (process.env.BOT_QUALITY === "broken" && id !== "opening-hours") return "Sorry, I don't know.";
      return answers[id];
    },
  },
  cases: Object.entries(answers).map(([id, answer]) => ({
    id,
    input: id,
    scorers: ["mentionsKeyFact"],
    scorerConfig: { mentionsKeyFact: { fact: answer.match(/\d+|help@example\.com|never expire/)[0] } },
  })),
  scorers: {
    mentionsKeyFact: ({ output, config }) => output.includes(config.fact),
  },
};
