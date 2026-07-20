import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// Keep React/UI packages out of serverExternalPackages — Next/workflow already
// transpile some of them, and that combination fails the production build.
const workspaceHostPackages = [
  "./node_modules/react/**/*",
  "./node_modules/react-dom/**/*",
  "./node_modules/scheduler/**/*",
  "./node_modules/recharts/**/*",
  "./node_modules/lucide-react/**/*",
  "./node_modules/date-fns/**/*",
  "./node_modules/typescript/**/*",
  "./node_modules/@types/react/**/*",
  "./node_modules/@types/react-dom/**/*",
  "./node_modules/esbuild/**/*",
  "./node_modules/@esbuild/**/*",
];

const nextConfig: NextConfig = {
  // Keep typescript bundled/traced normally. Marking it external makes
  // require.resolve("typescript/lib/tsc.js") return a non-runnable [externals] path.
  serverExternalPackages: ["esbuild"],
  outputFileTracingIncludes: {
    "/*": workspaceHostPackages,
  },
};

export default withWorkflow(nextConfig);
