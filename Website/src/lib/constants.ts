/** Navigation bar content — brand name, links, and CTA label. */
export const NAV = {
  brand: "Koda",
  links: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "For Developers", href: "#dev-workflows" },
  ],
  cta: "Join Mailing List",
} as const;

/** Hero section content — headline, subheadline, CTAs, and demo command/actions. */
export const HERO = {
  headline: "Your",
  headline_accent: "Second Half",
  subheadline:
    "Speak and it's done. Koda is an on-device voice agent that turns natural speech into instant macOS actions. No cloud. No latency. No compromise.",
  cta_primary: "Join Mailing List",
  cta_secondary: "See How It Works",
  demo_command: "create a React app and open it in VS Code",
  demo_actions: [
    { label: "mkdir ~/Projects/app", icon: "folder" as const },
    { label: "npx create-react-app .", icon: "terminal" as const },
    { label: "code ~/Projects/app", icon: "code" as const },
  ],
} as const;

/** Statistics data — latency, on-device percentage, and zero-cloud claim. */
export const STATS = [
  { value: 250, suffix: "ms", label: "Average Latency" },
  { value: 100, suffix: "%", label: "On-Device" },
  { value: 0, suffix: "", label: "Cloud Required", prefix: "Zero" },
] as const;

/** Features section content — heading, subheading, and four feature items with visual type references. */
export const FEATURES = {
  heading: "Engineered for Sovereignty",
  subheading: "Every technical decision serves one principle: your machine, your data, your control.",
  items: [
    {
      heading: "Speak Naturally. Act Precisely.",
      description:
        "Say what you mean in plain English. Koda interprets intent, chains multi-step actions, and executes — all in a single breath. Controls every app on your Mac through the Accessibility API — no app cooperation required.",
      visual: "waveform" as const,
    },
    {
      heading: "Nothing Leaves Your Machine",
      description:
        "WhisperKit processes speech on Apple Silicon. Your voice data never touches a server. Privacy isn't a feature — it's the architecture.",
      visual: "lock" as const,
    },
    {
      heading: "250ms. Not 2 Seconds.",
      description:
        "Local inference on the Neural Engine. No round-trip to a data center. The gap between thought and action, nearly eliminated.",
      visual: "latency" as const,
    },
    {
      heading: "Your Voice. Your Workflow.",
      description:
        "Scaffold projects, manage git, control terminals, run builds — all by voice. Define custom commands, chain actions into personal workflows, and extend Koda to match exactly how you work.",
      visual: "terminal" as const,
    },
  ],
} as const;

/** How It Works section content — heading, pipeline steps, latency breakdown, and total ms. */
export const HOW_IT_WORKS = {
  heading: "Three Steps. Sub-Second.",
  subheading: "From voice to execution in under 500 milliseconds.",
  steps: [
    { icon: "mic" as const, label: "Speak", detail: "Natural voice input" },
    { icon: "cpu" as const, label: "Interpret", detail: "On-device AI processing" },
    { icon: "check" as const, label: "Execute", detail: "Instant system action" },
  ],
  latency: [
    { label: "Wake word detection", ms: 50, percentage: 11 },
    { label: "Speech-to-text", ms: 350, percentage: 78 },
    { label: "Command routing", ms: 1, percentage: 1 },
    { label: "Execution", ms: 50, percentage: 11 },
  ],
  totalMs: 451,
} as const;

/** Command showcase content — heading, subheading, and demo command examples with actions. */
export const COMMANDS = {
  heading: "See It In Action",
  subheading: "Natural commands become precise system calls. Instantly.",
  examples: [
    {
      input: "open spotify and play my liked songs",
      actions: [
        'launch_app("Spotify")',
        'navigate("Liked Songs")',
        "play()",
      ],
    },
    {
      input: "create a react app in dashboard and open in vs code",
      actions: [
        'shell("mkdir -p ~/Projects/dashboard")',
        'shell("npx create-react-app .")',
        'launch("VS Code", path: "~/Projects/dashboard")',
      ],
    },
    {
      input: "dark mode",
      actions: ['set_appearance("dark")'],
    },
    {
      input: "new branch feature-auth, commit, and push",
      actions: [
        'git("checkout -b feature-auth")',
        'git("add -A")',
        'git("commit -m \'add auth module\'")',
        'git("push -u origin feature-auth")',
      ],
    },
    {
      input: "close all windows except this one",
      actions: ["close_all_windows(except: frontmost)"],
    },
    {
      input: "run tests and open the failures",
      actions: [
        'shell("npm test -- --ci")',
        'parse_results(filter: "FAIL")',
        'open_file("auth.test.ts", line: 42)',
      ],
    },
    {
      input: "write a validation function for email addresses",
      actions: [
        'read_context("package.json", "tsconfig.json")',
        'generate("validateEmail", lang: "TypeScript")',
        'write_file("src/utils/validateEmail.ts")',
      ],
    },
    {
      input: "screenshot and send to Alex",
      actions: [
        "capture_screenshot()",
        'send_message(to: "Alex", attachment: screenshot)',
      ],
    },
  ],
} as const;

/** Developer Workflows content — heading, subheading, workflow examples, and capability badges. */
export const DEV_WORKFLOWS = {
  heading: "Built for Developers",
  subheading: "Voice-powered workflows that no other assistant can touch. Siri opens apps. Koda scaffolds your entire project.",
  workflows: [
    {
      input: "scaffold a React frontend with an Express backend and connect them",
      steps: [
        "mkdir -p ~/Projects/app/frontend",
        "mkdir -p ~/Projects/app/backend",
        "npx create-react-app frontend",
        "cd backend && npm init -y",
        "npm install express cors",
        'configure proxy → localhost:3001',
        "code ~/Projects/app",
      ],
    },
    {
      input: "create branch feature-auth, commit my changes, and push",
      steps: [
        "git checkout -b feature-auth",
        "git add -A",
        'git commit -m "add auth module"',
        "git push -u origin feature-auth",
      ],
    },
    {
      input: "run the test suite and open the failures",
      steps: [
        "npm test -- --watchAll=false",
        "parsing test output...",
        "2 tests failed in auth.test.ts",
        "code --goto auth.test.ts:42",
      ],
    },
  ],
  capabilities: [
    { label: "Terminal Control", icon: "terminal" as const },
    { label: "Git Workflows", icon: "git" as const },
    { label: "IDE Integration", icon: "code" as const },
    { label: "Project Scaffolding", icon: "folder" as const },
    { label: "Build & Test", icon: "test" as const },
    { label: "Code Generation", icon: "zap" as const },
  ],
} as const;

/** Pricing content — heading, subheading, and three pricing tiers with features. */
export const PRICING = {
  heading: "Simple Pricing",
  subheading: "Start free. Scale when you're ready.",
  tiers: [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Core voice automation for everyday use",
      features: [
        "20 built-in voice commands",
        "On-device speech recognition",
        "Hotkey activation",
        "Native macOS integration",
        "Basic developer commands (open IDE, run scripts)",
      ],
      cta: "Download Free",
      highlighted: false,
      badge: "",
    },
    {
      name: "Pro",
      price: "$9",
      period: "/month",
      description: "Unlimited power with AI interpretation",
      features: [
        "Everything in Free",
        "AI-powered command interpretation",
        "Developer Mode (shell, git, IDE)",
        "Custom scripts & workflows",
        "Always-on wake word",
        "Priority support",
      ],
      cta: "Join Waitlist",
      highlighted: false,
      badge: "",
    },
    {
      name: "Koda Elite",
      price: "$84",
      period: "/year",
      description: "Full commitment. Total control. Your second half, year-round.",
      features: [
        "Everything in Pro",
        "AI-powered command interpretation",
        "Developer Mode (shell, git, IDE)",
        "Custom scripts & workflows",
        "Always-on wake word",
        "Priority support",
      ],
      cta: "Join Waitlist",
      highlighted: true,
      badge: "Save 22%",
    },
  ],
} as const;

/** Call-to-action section content — headline, subheadline, button label, and privacy note. */
export const CTA = {
  headline: "Stop Clicking. Start Commanding.",
  subheadline:
    "Get updates on our launch and be first to know when Koda is ready.",
  button: "Join Mailing List",
  note: "No spam. Unsubscribe anytime.",
} as const;

/** Footer content — brand, tagline, social links, system requirements, and copyright. */
export const FOOTER = {
  brand: "Koda",
  tagline: "Voice-native macOS automation for people who got tired of clicking.",
  socials: [],
  systemReqs: "macOS 13+ / Apple Silicon (M1+)",
  copyright: "Koda",
} as const;
