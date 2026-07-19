export type BrainQuotaState = { date: string; turns: number; builds: number };
export type CapabilityQuotaState = { minute: number[]; day: string; aiCalls: number };

export function consumeBrainTurn(state: BrainQuotaState) {
  if (state.turns >= 25) return false;
  state.turns += 1;
  return true;
}

export function consumeWorkspaceBuild(state: BrainQuotaState) {
  if (state.builds >= 10) return false;
  state.builds += 1;
  return true;
}

export function consumeCapabilityCall(state: CapabilityQuotaState, now: number, expensive: boolean) {
  const date = new Date(now).toISOString().slice(0, 10);
  if (state.day !== date) {
    state.day = date;
    state.aiCalls = 0;
  }
  state.minute = state.minute.filter((value) => value > now - 60_000);
  if (state.minute.length >= 30) return "Capability rate limit reached. Try again in a minute.";
  if (expensive && state.aiCalls >= 20) return "Daily AI and research capability limit reached.";
  state.minute.push(now);
  if (expensive) state.aiCalls += 1;
  return null;
}
