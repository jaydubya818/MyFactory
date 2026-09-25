import { createAuthPlugin } from "@agent-native/core/server";

const rawAppTitle = "Factory Console";
const appTitle = rawAppTitle === "{" + "{APP_TITLE}}" ? "Chat" : rawAppTitle;

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: appTitle,
    screenshotPath: "/auth-marketing/chat.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    learnMoreUrl: "https://github.com/jaydubya818/MyFactory",
    tagline: "Inspect local factory work, evidence, and decisions in one place.",
    features: [
      "Review saved WorkOrders and exact verification evidence",
      "Use the same typed actions from the UI and factory agent",
      "Keep publication behind a scoped human approval",
    ],
  },
});
