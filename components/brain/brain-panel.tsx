"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUp, CarFront, Database, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import type { BrainEvent, BrainInsightCard } from "@/lib/brain/contracts";
import type { WorkspaceArtifactV2, WorkspaceProgressPhase } from "@/lib/workspaces/contracts";

type Message = { id: string; role: "user" | "assistant"; content: string; provenance?: string; insight?: BrainInsightCard };
type PendingClarification = { token: string; questions: string[]; title: string };
type RetryRequest = { message: string; token: string | null; clarificationAnswers: string[] };

const suggestions = [
  "Can I afford a car next month?",
  "Where did my money go last month?",
  "How is my portfolio allocation balanced?",
  "What bills and subscriptions are coming up?",
];
const phaseLabels: Record<WorkspaceProgressPhase, string> = {
  assessing: "Assessing request complexity",
  planning: "Designing your workspace",
  clarifying: "Waiting for your requirements",
  scaffolding: "Preparing a blank workspace",
  coding: "Sol is building the application",
  checking: "Typechecking, testing, and policy scanning",
  browser_testing: "Verifying interactions and responsive behavior",
  reviewing: "Running an independent Sol review",
  repairing: "Repairing validation findings",
  publishing: "Saving a verified version",
};

export function BrainPanel({
  onWorkspace,
  activeWorkspace,
  initialPrompt,
  onPromptConsumed,
}: {
  onWorkspace: (artifact: WorkspaceArtifactV2) => void | Promise<void>;
  activeWorkspace: WorkspaceArtifactV2 | null;
  initialPrompt: string | null;
  onPromptConsumed: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([{
    id: "intro",
    role: "assistant",
    content: "I’m grounded in Jordan’s spending, income, cash flow, and synthetic portfolio. Ask a question, test a purchase, or describe a financial tool you want me to build.",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<WorkspaceProgressPhase | null>(null);
  const [phaseDetail, setPhaseDetail] = useState("");
  const [pending, setPending] = useState<PendingClarification | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchase, setPurchase] = useState({ date: "2026-08-15", upfront: "15000", monthly: "650" });
  const messagesRef = useRef<HTMLDivElement>(null);
  const initialHandled = useRef<string | null>(null);

  const send = useCallback(async (
    message: string,
    options?: { token?: string | null; clarificationAnswers?: string[] },
  ) => {
    const cleaned = message.trim().slice(0, 1_000);
    if (!cleaned || busy) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleaned };
    const assistantId = crypto.randomUUID();
    const prior = messages.filter((item) => item.id !== "intro").slice(-12);
    const token = options?.token ?? pending?.token ?? null;
    const clarificationAnswers = options?.clarificationAnswers ?? (pending ? [cleaned] : []);
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setPhase("assessing");
    setPhaseDetail("Understanding the request");
    setRetryRequest(null);
    if (token) setPending(null);

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
      });
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
          const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as BrainEvent;
          if (event.type === "build_progress") {
            setPhase(event.phase);
            setPhaseDetail(event.detail);
          }
          if (event.type === "assistant_delta") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.delta } : item));
          }
          if (event.type === "tool_result") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, provenance: event.provenance } : item));
          }
          if (event.type === "insight_card") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, insight: event.card } : item));
          }
          if (event.type === "clarification_required") {
            const content = `Before I build ${event.planTitle}, I need one focused round of clarification:\n\n${event.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content } : item));
            setPending({ token: event.token, questions: event.questions, title: event.planTitle });
            setAnswers(event.questions.map(() => ""));
          }
          if (event.type === "workspace_published") {
            setRetryRequest(null);
            await onWorkspace(event.artifact);
          }
          if (event.type === "workspace_failed" || event.type === "error") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content || event.message } : item));
            if (event.recoverable) setRetryRequest({ message: cleaned, token, clarificationAnswers });
          }
        }
      }
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === assistantId ? {
        ...item,
        content: item.content || (error instanceof Error ? error.message : "I couldn’t complete that request."),
      } : item));
      setRetryRequest({ message: cleaned, token, clarificationAnswers });
    } finally {
      setPhase(null);
      setPhaseDetail("");
      setBusy(false);
    }
  }, [activeWorkspace, busy, messages, onWorkspace, pending]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, phase, pending]);
  useEffect(() => {
    if (initialPrompt && initialHandled.current !== initialPrompt && !busy) {
      initialHandled.current = initialPrompt;
      onPromptConsumed();
      if (initialPrompt.startsWith("Can I afford")) {
        setPurchaseOpen(true);
        return;
      }
      void send(initialPrompt);
    }
  }, [initialPrompt, busy, onPromptConsumed, send]);
  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };
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

  return (
    <section className={`brain-panel${isPristine ? " is-pristine" : ""}`} aria-label="Financial Brain">
      <header className="brain-header">
        <div className="brain-title-row"><span className="brain-orb"><Sparkles size={15} /></span><div><div className="brain-title">Financial Brain</div><div className="brain-status">{activeWorkspace ? `Editing ${activeWorkspace.title} · v${activeWorkspace.version}` : "Grounded in your complete demo picture"}</div></div></div>
      </header>
      <div className="brain-messages" aria-live="polite" ref={messagesRef}>
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.content || (message.role === "assistant" && busy ? "…" : "")}
            {message.provenance && <div className="provenance-chip"><Database size={9} />{message.provenance}</div>}
            {message.insight && (
              <article className={`brain-insight-card ${message.insight.status ?? ""}`} aria-label={message.insight.title}>
                <div className="brain-insight-kicker">{message.insight.kind === "decision" ? "Decision check" : "Grounded insight"}</div>
                <h3>{message.insight.title}</h3>
                <p>{message.insight.conclusion}</p>
                <div className="brain-insight-metrics">
                  {message.insight.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong className={metric.tone}>{metric.value}</strong></div>)}
                </div>
                <details><summary>Calculation notes</summary><ul>{message.insight.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></details>
                <Link href={message.insight.relatedHref}>{message.insight.relatedLabel}<ArrowRight size={13} /></Link>
              </article>
            )}
          </div>
        ))}
        {phase && <div className="brain-stage"><LoaderCircle className="spin" size={12} /><span>{phaseLabels[phase]}<small>{phaseDetail}</small></span></div>}
        {pending && !busy && (
          <form className="clarification-card" onSubmit={submitClarification}>
            {pending.questions.map((question, index) => (
              <label key={question}><span>{question}</span><textarea aria-label={`Answer ${index + 1}`} value={answers[index] ?? ""} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value.slice(0, 1_000) : answer))} /></label>
            ))}
            <button type="submit" disabled={answers.some((answer) => !answer.trim())}>Build workspace</button>
          </form>
        )}
      </div>
      {!pending && <div className="suggestions" aria-label="Suggested prompts">
        {retryRequest && <button className="suggestion retry" onClick={() => void send(retryRequest.message, { token: retryRequest.token, clarificationAnswers: retryRequest.clarificationAnswers })} disabled={busy}><RotateCw size={11} />Retry last build</button>}
        {suggestions.map((suggestion) => <button className="suggestion" onClick={() => suggestion.startsWith("Can I afford") ? setPurchaseOpen(true) : void send(suggestion)} disabled={busy} key={suggestion}>{suggestion}</button>)}
      </div>}
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
        <textarea className="brain-input" value={input} onChange={(event) => setInput(event.target.value.slice(0, 1_000))} placeholder={pending ? "Answer the questions above…" : activeWorkspace ? "Ask a question or describe a revision…" : "Ask about your money, or describe a tool…"} aria-label="Message the Financial Brain" />
        <div className="composer-footer"><span className="composer-hint">{input.length}/1000 · Demo data · Educational, not advice</span><button className="send-button" disabled={busy || !input.trim()} aria-label="Send message"><ArrowUp size={14} /></button></div>
      </form>
    </section>
  );
}
