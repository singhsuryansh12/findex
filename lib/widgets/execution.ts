export type WidgetExecutionMode = "auto" | "local" | "e2b" | "disabled";
export type WidgetExecutor = Exclude<WidgetExecutionMode, "auto">;

type ExecutionOptions = {
  requested?: string;
  enabled: boolean;
  nodeEnv: string | undefined;
  hasE2bConfig: boolean;
  hasCodexCredential: boolean;
};

export function resolveWidgetExecutor(options: ExecutionOptions): WidgetExecutor {
  if (!options.enabled) return "disabled";

  const requested: WidgetExecutionMode = ["auto", "local", "e2b", "disabled"].includes(options.requested ?? "")
    ? options.requested as WidgetExecutionMode
    : "auto";

  if (requested === "disabled") return "disabled";
  if (requested === "local") return "local";
  if (requested === "e2b") {
    return options.hasE2bConfig && options.hasCodexCredential ? "e2b" : "disabled";
  }
  if (options.hasE2bConfig && options.hasCodexCredential) return "e2b";
  return options.nodeEnv === "production" ? "disabled" : "local";
}
