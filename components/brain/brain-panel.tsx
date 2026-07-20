"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, CarFront, Database, LoaderCircle, RotateCw, Sparkles, Square } from "lucide-react";
import type { BrainEvent, BrainInsightCard } from "@/lib/brain/contracts";
import { getTryNextPrompts } from "@/lib/brain/guidance";
import type { WorkspaceArtifactV2, WorkspaceProgressPhase } from "@/lib/workspaces/contracts";
import { clearActiveBrainRun, getActiveBrainRun, saveActiveBrainRun, type ActiveBrainRun } from "@/lib/workspaces/persistence";

type Message = { id: string; role: "user" | "assistant"; content: string; provenance?: string; insight?: BrainInsightCard };
type PendingClarification = { token: string; questions: string[]; title: string };
type RetryRequest = { message: string; token: string | null; clarificationAnswers: string[] };
type RunStatus = {
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  returnValue: { status: "completed"; artifact: WorkspaceArtifactV2 } | { status: "failed"; message: string } | null;
};

const suggestions = [
  "Can I afford a car next month?",
  "Where did my money go last month?",
  "How is my portfolio allocation balanced?",
  "What bills and subscriptions are coming up?",
];

const phaseLabels: Record<WorkspaceProgressPhase, string> = {
  assessing: "Findex is assessing your request",
  planning: "Findex is planning your workspace",
  clarifying: "Findex is waiting for your requirements",
  scaffolding: "Findex is preparing the workspace",
  coding: "Findex is building the application",
  checking: "Findex is checking the build",
  browser_testing: "Findex is verifying interactions",
  reviewing: "Findex is independently reviewing the workspace",
  repairing: "Findex is repairing measured findings",
  publishing: "Findex is publishing your workspace",
};

async function readEventStream(response: Response, onEvent: (event: BrainEvent, index: number | null) => void | Promise<void>) {
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error || "The Financial Brain is temporarily unavailable.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const id = frame.split("\n").find((line) => line.startsWith("id: "));
      const index = id ? Number(id.slice(4)) : null;
      await onEvent(JSON.parse(data.slice(6)) as BrainEvent, Number.isSafeInteger(index) ? index : null);
    }
  }
}

export function BrainPanel({
  onWorkspace,
  activeWorkspace,
  initialPrompt,
  onPromptConsumed,
  onUserSend,
}: {
  onWorkspace: (artifact: WorkspaceArtifactV2) => void | Promise<void>;
  activeWorkspace: WorkspaceArtifactV2 | null;
  initialPrompt: string | null;
  onPromptConsumed: () => void;
  onUserSend?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([{
    id: "intro",
    role: "assistant",
    content: "I can help in three ways: Ask about your money, Decide on a purchase, or Build a custom tool. I’m grounded in Jordan’s demo spending, income, cash flow, and portfolio.",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<WorkspaceProgressPhase | null>(null);
  const [phaseDetail, setPhaseDetail] = useState("");
  const [phaseHistory, setPhaseHistory] = useState<WorkspaceProgressPhase[]>([]);
  const [pending, setPending] = useState<PendingClarification | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchase, setPurchase] = useState({ date: "2026-08-15", upfront: "15000", monthly: "650" });
  const [activeRun, setActiveRun] = useState<ActiveBrainRun | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const initialHandled = useRef<string | null>(null);
  const resumeAttempted = useRef(false);
  const runStartedAt = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const connectRunRef = useRef<((run: ActiveBrainRun, assistantId: string) => Promise<void>) | null>(null);
  const publishedArtifacts = useRef(new Set<string>());
  const activeRetry = useRef<RetryRequest | null>(null);
  const terminalRun = useRef<string | null>(null);
  const activeAssistantId = useRef<string | null>(null);
  /** After a draft mounts, chat unlocks while background polish may still stream. */
  const draftUnlocked = useRef(false);

  const setAssistantContent = useCallback((assistantId: string, content: string, append = false) => {
    setMessages((current) => current.map((item) => item.id === assistantId
      ? { ...item, content: append ? item.content + content : content }
      : item));
  }, []);

  const finishRun = useCallback(async (runId: string) => {
    terminalRun.current = runId;
    streamAbort.current?.abort();
    await clearActiveBrainRun(runId).catch(() => undefined);
    setActiveRun(null);
    setReconnecting(false);
    setBusy(false);
    setPhase(null);
    setPhaseDetail("");
    draftUnlocked.current = false;
    activeAssistantId.current = null;
  }, []);

  const handleRunEvent = useCallback(async (event: BrainEvent, assistantId: string, runId: string) => {
    if (event.type === "build_progress") {
      setPhase(event.phase);
      setPhaseDetail(event.detail);
      setPhaseHistory((current) => current.includes(event.phase) ? current : [...current, event.phase]);
      return;
    }
    if (event.type === "assistant_delta") {
      setAssistantContent(assistantId, event.delta, true);
      return;
    }
    if (event.type === "workspace_published") {
      if (!publishedArtifacts.current.has(event.artifact.id)) {
        publishedArtifacts.current.add(event.artifact.id);
        await onWorkspace(event.artifact);
      }
      const isDraft = event.artifact.qualityTier === "draft";
      const assumptionSummary = event.artifact.plan.assumptions.length
        ? ` Assumptions: ${event.artifact.plan.assumptions.slice(0, 3).join("; ")}.`
        : "";
      if (isDraft) {
        setAssistantContent(
          assistantId,
          `${event.artifact.title} is ready as a working draft (v${event.artifact.version}). I’m refining it in the background—ask for any changes.${assumptionSummary}`,
        );
        setRetryRequest(null);
        draftUnlocked.current = true;
        setBusy(false);
        // Keep the run open so background refine / offer events can arrive.
        return;
      }
      setAssistantContent(
        assistantId,
        `${event.artifact.title} is verified and saved as version ${event.artifact.version}.${assumptionSummary || " No unstated assumptions remain."}`,
      );
      setRetryRequest(null);
      await finishRun(runId);
      return;
    }
    if (event.type === "workspace_refined") {
      if (!publishedArtifacts.current.has(event.artifact.id)) {
        publishedArtifacts.current.add(event.artifact.id);
        await onWorkspace(event.artifact);
      } else {
        await onWorkspace(event.artifact);
      }
      setAssistantContent(
        assistantId,
        event.artifact.qualityTier === "verified"
          ? ` Updated ${event.artifact.title} with a verified polish (v${event.artifact.version}). Tell me if you want more changes.`
          : ` Updated ${event.artifact.title} with a safe polish (v${event.artifact.version}). Tell me if you want more changes.`,
        true,
      );
      if (event.artifact.qualityTier === "verified") {
        setRetryRequest(null);
        await finishRun(runId);
      }
      return;
    }
    if (event.type === "workspace_upgrade_offer") {
      setAssistantContent(
        assistantId,
        ` ${event.summary} Tell me which of these you want applied, or describe a different change. Your current draft stays usable.\n${event.changes.map((change) => `• ${change}`).join("\n")}`,
        true,
      );
      draftUnlocked.current = true;
      setBusy(false);
      return;
    }
    if (event.type === "workspace_failed" || event.type === "error") {
      setAssistantContent(assistantId, event.message);
      if (event.recoverable && activeRetry.current) setRetryRequest(activeRetry.current);
      await finishRun(runId);
    }
  }, [finishRun, onWorkspace, setAssistantContent]);

  const recoverRunStatus = useCallback(async (run: ActiveBrainRun, assistantId: string) => {
    const response = await fetch(`/api/brain/runs/${encodeURIComponent(run.runId)}`, {
      headers: { authorization: `Bearer ${run.accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Findex could not recover this build run.");
    const status = await response.json() as RunStatus;
    if (status.status === "completed" && status.returnValue?.status === "completed") {
      const artifact = status.returnValue.artifact;
      if (artifact.qualityTier === "draft") {
        if (!publishedArtifacts.current.has(artifact.id)) {
          publishedArtifacts.current.add(artifact.id);
          await onWorkspace(artifact);
        }
        // Do not clobber richer stream content (upgrade offers / soft notes).
        setMessages((current) => current.map((item) => {
          if (item.id !== assistantId) return item;
          if (item.content.trim().length > 40) return item;
          return {
            ...item,
            content: `${artifact.title} remains a working draft (v${artifact.version}). Tell me what to refine.`,
          };
        }));
      } else {
        await handleRunEvent({ type: "workspace_published", artifact }, assistantId, run.runId);
      }
      setRetryRequest(null);
      await finishRun(run.runId);
      return true;
    }
    if (status.status === "completed" && status.returnValue?.status === "failed") {
      await handleRunEvent({ type: "workspace_failed", message: status.returnValue.message, recoverable: true }, assistantId, run.runId);
      return true;
    }
    if (status.status === "failed") {
      const message = status.returnValue?.status === "failed" && status.returnValue.message.startsWith("Findex")
        ? status.returnValue.message
        : "Findex couldn't finish this workspace; nothing was published.";
      await handleRunEvent({ type: "workspace_failed", message, recoverable: true }, assistantId, run.runId);
      return true;
    }
    if (status.status === "cancelled") {
      setAssistantContent(assistantId, "Findex stopped the build. Your previously published workspace is unchanged.");
      await finishRun(run.runId);
      return true;
    }
    return false;
  }, [finishRun, handleRunEvent, onWorkspace, setAssistantContent]);

  const connectToRun = useCallback(async (run: ActiveBrainRun, assistantId: string) => {
    if (terminalRun.current === run.runId) return;
    streamAbort.current?.abort();
    const abort = new AbortController();
    streamAbort.current = abort;
    setActiveRun(run);
    if (!draftUnlocked.current) setBusy(true);
    setReconnecting(true);
    if (!runStartedAt.current) runStartedAt.current = Date.now();
    let cursor = run.lastEventIndex;
    try {
      const response = await fetch(`/api/brain/runs/${encodeURIComponent(run.runId)}/events?startIndex=${cursor + 1}`, {
        headers: { authorization: `Bearer ${run.accessToken}` },
        cache: "no-store",
        signal: abort.signal,
      });
      setReconnecting(false);
      await readEventStream(response, async (event, index) => {
        if (index !== null && index <= cursor) return;
        await handleRunEvent(event, assistantId, run.runId);
        if (index !== null && terminalRun.current !== run.runId) {
          cursor = index;
          const updated = { ...run, lastEventIndex: cursor };
          setActiveRun(updated);
          await saveActiveBrainRun(updated);
        }
      });
      if (terminalRun.current === run.runId) return;
      const terminal = await recoverRunStatus({ ...run, lastEventIndex: cursor }, assistantId);
      if (!terminal) {
        setReconnecting(true);
        window.setTimeout(() => void connectRunRef.current?.({ ...run, lastEventIndex: cursor }, assistantId), 1_500);
      }
    } catch {
      if (abort.signal.aborted || terminalRun.current === run.runId) return;
      setReconnecting(true);
      try {
        if (await recoverRunStatus({ ...run, lastEventIndex: cursor }, assistantId)) return;
      } catch {
        // The indexed stream remains the source of truth; retry without starting a new run.
      }
      window.setTimeout(() => void connectRunRef.current?.({ ...run, lastEventIndex: cursor }, assistantId), 1_500);
    }
  }, [handleRunEvent, recoverRunStatus]);

  useEffect(() => { connectRunRef.current = connectToRun; }, [connectToRun]);

  const handleImmediateEvent = useCallback(async (event: BrainEvent, assistantId: string, retry: RetryRequest) => {
    if (event.type === "build_progress") {
      setPhase(event.phase);
      setPhaseDetail(event.detail);
      setPhaseHistory((current) => current.includes(event.phase) ? current : [...current, event.phase]);
    }
    if (event.type === "assistant_delta") setAssistantContent(assistantId, event.delta, true);
    if (event.type === "tool_result") setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, provenance: event.provenance } : item));
    if (event.type === "insight_card") setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, insight: event.card } : item));
    if (event.type === "clarification_required") {
      setAssistantContent(assistantId, `Before I build ${event.planTitle}, I need one focused round of clarification:\n\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`);
      setPending({ token: event.token, questions: event.questions, title: event.planTitle });
      setAnswers(event.questions.map(() => ""));
    }
    if (event.type === "workspace_failed" || event.type === "error") {
      setAssistantContent(assistantId, event.message);
      if (event.recoverable) setRetryRequest(retry);
    }
  }, [setAssistantContent]);

  const send = useCallback(async (message: string, options?: { token?: string | null; clarificationAnswers?: string[] }) => {
    const cleaned = message.trim().slice(0, 1_000);
    if (!cleaned || busy) return;
    onUserSend?.();
    // A new user turn supersedes background polish on the previous run.
    if (activeRun) {
      streamAbort.current?.abort();
      await fetch(`/api/brain/runs/${encodeURIComponent(activeRun.runId)}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${activeRun.accessToken}` },
      }).catch(() => undefined);
      await clearActiveBrainRun(activeRun.runId).catch(() => undefined);
      setActiveRun(null);
    }
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleaned };
    const assistantId = crypto.randomUUID();
    const prior = messages.filter((item) => item.id !== "intro").slice(-12);
    const token = options?.token ?? pending?.token ?? null;
    const clarificationAnswers = options?.clarificationAnswers ?? (pending ? [cleaned] : []);
    const retry = { message: cleaned, token, clarificationAnswers };
    activeRetry.current = retry;
    terminalRun.current = null;
    draftUnlocked.current = false;
    activeAssistantId.current = assistantId;
    runStartedAt.current = Date.now();
    setElapsedSeconds(0);
    setPhaseHistory([]);
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setPhase("assessing");
    setPhaseDetail("Findex is understanding the request");
    setRetryRequest(null);
    if (token) setPending(null);
    let startedRun: ActiveBrainRun | null = null;
    const requestController = new AbortController();
    requestAbort.current = requestController;

    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: cleaned,
          history: prior.map(({ role, content }) => ({ role, content })),
          activeWorkspace: activeWorkspace ? {
            projectId: activeWorkspace.projectId,
            versionId: activeWorkspace.id,
            version: activeWorkspace.version,
            title: activeWorkspace.title,
            plan: activeWorkspace.plan,
            files: activeWorkspace.files,
            manifest: activeWorkspace.manifest,
            validation: activeWorkspace.validation,
          } : null,
          clarificationToken: token,
          clarificationAnswers,
        }),
        signal: requestController.signal,
      });
      await readEventStream(response, async (event) => {
        if (event.type === "workspace_started") {
          startedRun = { runId: event.runId, accessToken: event.accessToken, lastEventIndex: -1 };
          await saveActiveBrainRun(startedRun);
          setActiveRun(startedRun);
          return;
        }
        await handleImmediateEvent(event, assistantId, retry);
      });
      if (startedRun) {
        if (requestAbort.current === requestController) requestAbort.current = null;
        await connectToRun(startedRun, assistantId);
        return;
      }
    } catch (error) {
      if (!requestController.signal.aborted) {
        setAssistantContent(assistantId, error instanceof Error ? error.message : "Findex couldn’t complete that request.");
        setRetryRequest(retry);
      }
    }
    if (requestAbort.current === requestController) requestAbort.current = null;
    setPhase(null);
    setPhaseDetail("");
    setBusy(false);
  }, [activeRun, activeWorkspace, busy, connectToRun, handleImmediateEvent, messages, onUserSend, pending, setAssistantContent]);

  const stopRun = useCallback(async () => {
    if (!busy && !activeRun) return;
    requestAbort.current?.abort();
    streamAbort.current?.abort();
    try {
      if (activeRun) await fetch(`/api/brain/runs/${encodeURIComponent(activeRun.runId)}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${activeRun.accessToken}` },
      });
    } finally {
      const assistantId = activeAssistantId.current ?? (activeRun ? `run:${activeRun.runId}` : null);
      setMessages((current) => current.map((item) => item.id === assistantId
        ? { ...item, content: "Findex stopped the build. Your previously published workspace is unchanged." }
        : item));
      if (activeRun) await finishRun(activeRun.runId);
      else {
        setBusy(false);
        setPhase(null);
        setPhaseDetail("");
        setReconnecting(false);
        activeAssistantId.current = null;
      }
    }
  }, [activeRun, busy, finishRun]);

  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;
    void getActiveBrainRun().then((run) => {
      if (!run) return;
      const assistantId = `run:${run.runId}`;
      activeAssistantId.current = assistantId;
      setMessages((current) => current.some((item) => item.id === assistantId)
        ? current
        : [...current, { id: assistantId, role: "assistant", content: "Findex is reconnecting to your workspace build…" }]);
      runStartedAt.current = Date.now();
      setPhase("coding");
      setPhaseDetail("Findex is reconnecting to the existing build");
      void connectRunRef.current?.(run, assistantId);
    }).catch(() => undefined);
    return () => {
      requestAbort.current?.abort();
      streamAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAt.current) / 1_000))), 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, phase, pending]);

  useEffect(() => {
    if (initialPrompt && initialHandled.current !== initialPrompt && !busy) {
      initialHandled.current = initialPrompt;
      const timer = window.setTimeout(() => {
        onPromptConsumed();
        if (initialPrompt.startsWith("Can I afford")) setPurchaseOpen(true);
        else void send(initialPrompt);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [initialPrompt, busy, onPromptConsumed, send]);

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };
  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  const submitClarification = (event: FormEvent) => {
    event.preventDefault();
    if (!pending || answers.some((answer) => !answer.trim())) return;
    const content = answers.map((answer, index) => `${index + 1}. ${answer.trim()}`).join("\n");
    void send(content, { token: pending.token, clarificationAnswers: answers.map((answer) => answer.trim()) });
  };
  const submitPurchase = (event: FormEvent) => {
    event.preventDefault();
    const upfront = Number(purchase.upfront);
    const monthly = Number(purchase.monthly);
    if (!purchase.date || !Number.isFinite(upfront) || !Number.isFinite(monthly) || upfront < 0 || monthly < 0) return;
    setPurchaseOpen(false);
    void send(`Can I afford a car on ${purchase.date} with a $${upfront.toLocaleString("en-US")} upfront cost and $${monthly.toLocaleString("en-US")} monthly payment?`);
  };

  const isPristine = messages.length === 1 && messages[0]?.id === "intro";
  const lastMessage = messages[messages.length - 1];
  const lastUserPrompt = [...messages].reverse().find((item) => item.role === "user")?.content;
  const showTryNext = !busy && !pending && !isPristine
    && lastMessage?.role === "assistant"
    && lastMessage.content.trim().length > 0;
  const tryNextPrompts = showTryNext ? getTryNextPrompts("brain", lastUserPrompt).slice(0, 2) : [];
  const visiblePhases = phaseHistory.slice(-4);

  const activatePrompt = (prompt: string) => {
    if (prompt.startsWith("Can I afford")) setPurchaseOpen(true);
    else void send(prompt);
  };

  return (
    <section className={`brain-panel${isPristine ? " is-pristine" : ""}`} aria-label="Financial Brain">
      <header className="brain-header">
        <div className="brain-title-row"><span className="brain-orb"><Sparkles size={15} /></span><div><div className="brain-title">Financial Brain</div><div className="brain-status">{activeWorkspace ? `Editing ${activeWorkspace.title} · v${activeWorkspace.version}${activeWorkspace.qualityTier === "draft" ? " · draft" : ""}` : "Grounded in your complete demo picture"}</div></div></div>
      </header>
      <div className="brain-messages" aria-live="polite" ref={messagesRef}>
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.content || (message.role === "assistant" && busy ? "…" : "")}
            {message.provenance && <div className="provenance-chip"><Database size={9} />{message.provenance}</div>}
            {message.insight && (
              <article className={`brain-insight-card ${message.insight.status ?? ""}`} aria-label={message.insight.title}>
                <div className="brain-insight-kicker">{message.insight.kind === "decision" ? "Decision check" : "Grounded insight"}</div>
                <h3>{message.insight.title}</h3><p>{message.insight.conclusion}</p>
                <div className="brain-insight-metrics">{message.insight.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong className={metric.tone}>{metric.value}</strong></div>)}</div>
                <details><summary>Calculation notes</summary><ul>{message.insight.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></details>
                <Link href={message.insight.relatedHref}>{message.insight.relatedLabel}<ArrowRight size={13} /></Link>
              </article>
            )}
          </div>
        ))}
        {phase && (
          <div className="brain-progress" role="status" aria-live="polite">
            <div className="brain-progress-current"><LoaderCircle className="spin" size={14} /><span><strong>{phaseLabels[phase]}</strong><small>{reconnecting ? "Reconnecting to the same build" : phaseDetail}</small></span><time>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</time></div>
            {visiblePhases.length > 1 && <ol className="brain-phase-timeline">{visiblePhases.map((item) => <li className={item === phase ? "active" : "complete"} key={item}>{phaseLabels[item]}</li>)}</ol>}
            {(busy || activeRun) && <button className="brain-stop" type="button" onClick={() => void stopRun()}><Square size={9} />Stop</button>}
          </div>
        )}
        {pending && !busy && (
          <form className="clarification-card" onSubmit={submitClarification}>
            {pending.questions.map((question, index) => <label key={question}><span>{question}</span><textarea aria-label={`Answer ${index + 1}`} value={answers[index] ?? ""} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value.slice(0, 1_000) : answer))} /></label>)}
            <button type="submit" disabled={answers.some((answer) => !answer.trim())}>Build workspace</button>
          </form>
        )}
      </div>
      {!pending && isPristine && (
        <div className="suggestions" aria-label="Suggested prompts">
          {suggestions.map((suggestion) => (
            <button className="suggestion" onClick={() => activatePrompt(suggestion)} disabled={busy} key={suggestion}>{suggestion}</button>
          ))}
        </div>
      )}
      {!pending && (showTryNext || retryRequest) && !isPristine && (
        <div className="suggestions" aria-label={showTryNext ? "Try next" : "Suggested prompts"}>
          {retryRequest && (
            <button
              className="suggestion retry"
              onClick={() => void send(retryRequest.message, { token: retryRequest.token, clarificationAnswers: retryRequest.clarificationAnswers })}
              disabled={busy}
            >
              <RotateCw size={11} />Retry last build
            </button>
          )}
          {tryNextPrompts.map((prompt) => (
            <button className="suggestion" onClick={() => activatePrompt(prompt)} disabled={busy} key={prompt}>{prompt}</button>
          ))}
        </div>
      )}
      {purchaseOpen && !busy && (
        <form className="purchase-scenario-form" onSubmit={submitPurchase}>
          <div className="purchase-form-title"><CarFront size={15} /><span><strong>Test a car purchase</strong><small>I’ll compare it with the next 90 days.</small></span></div>
          <label>Purchase date<input type="date" value={purchase.date} onChange={(event) => setPurchase((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>Upfront cost<input aria-label="Upfront cost" type="number" min="0" step="100" value={purchase.upfront} onChange={(event) => setPurchase((current) => ({ ...current, upfront: event.target.value }))} /></label>
          <label>Monthly payment<input aria-label="Monthly payment" type="number" min="0" step="10" value={purchase.monthly} onChange={(event) => setPurchase((current) => ({ ...current, monthly: event.target.value }))} /></label>
          <div><button type="button" onClick={() => setPurchaseOpen(false)}>Cancel</button><button type="submit">Run decision check</button></div>
        </form>
      )}
      <form className="brain-composer" onSubmit={submit}>
        <textarea className="brain-input" value={input} onChange={(event) => setInput(event.target.value.slice(0, 1_000))} onKeyDown={onComposerKeyDown} placeholder={pending ? "Answer the questions above…" : activeWorkspace ? "Ask for a refinement, or describe what to change…" : "Ask about your money, or describe a tool…"} aria-label="Message the Financial Brain" aria-describedby="brain-composer-hint" />
        <div className="composer-footer"><span className="composer-hint" id="brain-composer-hint">Enter to send · Shift+Enter for a new line · {input.length}/1000 · Educational, not advice</span><button className="send-button" disabled={busy || !input.trim()} aria-label="Send message"><ArrowUp size={14} /></button></div>
      </form>
    </section>
  );
}
