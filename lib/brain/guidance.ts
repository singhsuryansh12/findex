import type { DemoView } from "@/lib/brain/navigation";

export type { DemoView };

export type BrainHandoff = {
  source: Exclude<DemoView, "brain">;
  label: string;
  prompt: string;
};

export type GuidancePage = {
  chips: string[];
  helpTitle: string;
  helpBody: string;
  capabilities: Array<{ title: string; detail: string }>;
};

export const GUIDANCE_DISMISS_KEY = "findex-guidance-dismiss-v1";

const CAPABILITIES: GuidancePage["capabilities"] = [
  {
    title: "Ask",
    detail: "Get plain-language answers about spending, income, portfolio, and cash flow.",
  },
  {
    title: "Decide",
    detail: "Test a purchase or lifestyle change against your forecast.",
  },
  {
    title: "Build a tool",
    detail: "Create a custom calculator or planner in My tools.",
  },
];

const GUIDANCE: Record<DemoView, GuidancePage> = {
  brain: {
    chips: [
      "Where did my money go last month?",
      "Can I afford a car next month?",
      "Build a safe-to-spend planner",
    ],
    helpTitle: "What can the Financial Brain do?",
    helpBody:
      "Ask about your money, decide on a purchase, or build a custom tool. Everything is grounded in Jordan's demo spending, income, cash flow, and portfolio.",
    capabilities: CAPABILITIES,
  },
  spending: {
    chips: [
      "Where did my money go last month?",
      "What bills and subscriptions are coming up?",
    ],
    helpTitle: "Ask the Brain from Spending",
    helpBody:
      "Explore where money went, spot recurring bills, and see what is coming up next from this page.",
    capabilities: CAPABILITIES,
  },
  portfolio: {
    chips: [
      "How is my portfolio allocation balanced?",
      "Explain my biggest holding",
    ],
    helpTitle: "Ask the Brain from Portfolio",
    helpBody:
      "Check allocation balance, understand your largest holdings, and get plain-language portfolio context.",
    capabilities: CAPABILITIES,
  },
  "cash-flow": {
    chips: [
      "What is safe to spend and how does my cash flow look?",
      "Can I afford a car next month?",
    ],
    helpTitle: "Ask the Brain from Cash flow",
    helpBody:
      "See what is safe to spend, how income and bills line up, and stress-test a big purchase against your forecast.",
    capabilities: CAPABILITIES,
  },
};

const TRY_NEXT_PROMPTS: Record<DemoView, string[]> = {
  brain: [
    "What bills and subscriptions are coming up?",
    "How is my portfolio allocation balanced?",
    "What is safe to spend and how does my cash flow look?",
  ],
  spending: [
    "Can I afford a car next month?",
    "What is safe to spend and how does my cash flow look?",
  ],
  portfolio: [
    "Where did my money go last month?",
    "Can I afford a car next month?",
  ],
  "cash-flow": [
    "Where did my money go last month?",
    "How is my portfolio allocation balanced?",
  ],
};

const HANDOFF_LABELS: Record<Exclude<DemoView, "brain">, string> = {
  spending: "Spending",
  portfolio: "Portfolio",
  "cash-flow": "Cash flow",
};

export function getGuidance(view: DemoView): GuidancePage {
  return GUIDANCE[view];
}

export function getTryNextPrompts(view: DemoView): string[] {
  return TRY_NEXT_PROMPTS[view];
}

export function createHandoff(source: Exclude<DemoView, "brain">, prompt: string): BrainHandoff {
  return {
    source,
    label: HANDOFF_LABELS[source],
    prompt,
  };
}
