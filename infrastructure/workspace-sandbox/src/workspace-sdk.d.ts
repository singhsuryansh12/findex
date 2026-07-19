declare module "@findex/workspace-sdk" {
  export type CapabilityResult<T> = { data: T; source: string; freshAt: string };
  export const workspace: { invoke<T = unknown>(capability: string, input: unknown): Promise<CapabilityResult<T>> };
  export function useCapability<TInput = unknown, TResult = unknown>(capability: string): (input: TInput) => Promise<CapabilityResult<TResult>>;
  export function useWorkspaceState<T>(key: string, initialValue: T): [T, (next: T | ((current: T) => T)) => void, boolean];
  export function exportWorkspaceData(filename: string, data: unknown, format?: "json" | "csv"): Promise<unknown>;
}
