"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Database, LoaderCircle, Sparkles, X } from "lucide-react";
import type { BrainEvent, BrainStatus } from "@/lib/brain/contracts";
import type { WidgetArtifact } from "@/lib/widgets/contracts";

type Message = { id: string; role: "user" | "assistant"; content: string; provenance?: string };
const suggestions = [
  "Dining last month?",
  "What is safe to spend?",
  "Show recurring costs",
  "Build me a FIRE calculator",
];
const statusLabels: Record<BrainStatus, string> = {
  thinking: "Understanding your question",
  querying: "Querying the deterministic ledger",
  sandboxing: "Starting a disposable E2B workspace",
  coding: "Codex is building your widget",
  validating: "Typechecking, testing, and policy scanning",
  rendering: "Rendering in an isolated preview",
};

function sessionId() {
  const key = "findex-anonymous-session-v1";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
}

export function BrainPanel({
  onWidget,
  initialPrompt,
  onPromptConsumed,
  onClose,
}: {
  onWidget: (artifact: WidgetArtifact) => void;
  initialPrompt: string | null;
  onPromptConsumed: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([{ id: "intro", role: "assistant", content: "I’m grounded in Jordan’s demo ledger. Ask about spending, cashflow, commitments—or ask me to build a financial tool for this dashboard." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<BrainStatus | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const initialHandled = useRef<string | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, stage]);
  useEffect(() => {
    if (initialPrompt && initialHandled.current !== initialPrompt && !busy) {
      initialHandled.current = initialPrompt;
      onPromptConsumed();
      void send(initialPrompt);
    }
  // send intentionally reads current message state for the requested turn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, busy, onPromptConsumed]);

  const send = async (message: string) => {
    const cleaned = message.trim().slice(0, 500);
    if (!cleaned || busy) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleaned };
    const assistantId = crypto.randomUUID();
    const prior = messages.filter((item) => item.id !== "intro").slice(-12);
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setStage("thinking");

    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId(),
          message: cleaned,
          history: prior.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!response.ok || !response.body) throw new Error("The Financial Brain is temporarily unavailable.");

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
          if (event.type === "status") setStage(event.status);
          if (event.type === "text_delta") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + event.delta } : item));
          }
          if (event.type === "tool_result") {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, provenance: event.provenance } : item));
          }
          if (event.type === "widget") onWidget(event.artifact);
          if (event.type === "error") throw new Error(event.message);
        }
      }
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === assistantId ? {
        ...item,
        content: item.content || (error instanceof Error ? error.message : "I couldn’t complete that request."),
      } : item));
    } finally {
      setStage(null);
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };

  return (
    <section className="brain-panel" aria-label="Financial Brain">
      <header className="brain-header">
        <div className="brain-title-row"><span className="brain-orb"><Sparkles size={15} /></span><div><div className="brain-title">Financial Brain</div><div className="brain-status">Grounded in your demo ledger</div></div></div>
        <button className="icon-button-dark brain-mobile-close" onClick={onClose} aria-label="Close Financial Brain"><X size={14} /></button>
      </header>
      <div className="brain-messages" aria-live="polite">
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.content || (message.role === "assistant" && busy ? "…" : "")}
            {message.provenance && <div className="provenance-chip"><Database size={9} />{message.provenance}</div>}
          </div>
        ))}
        {stage && <div className="brain-stage"><LoaderCircle className="spin" size={12} />{statusLabels[stage]}</div>}
        <div ref={endRef} />
      </div>
      <div className="suggestions" aria-label="Suggested prompts">
        {suggestions.map((suggestion) => <button className="suggestion" onClick={() => void send(suggestion)} disabled={busy} key={suggestion}>{suggestion}</button>)}
      </div>
      <form className="brain-composer" onSubmit={submit}>
        <textarea className="brain-input" value={input} onChange={(event) => setInput(event.target.value.slice(0, 500))} placeholder="Ask about your money or build a tool…" aria-label="Message the Financial Brain" />
        <div className="composer-footer"><span className="composer-hint">{input.length}/500 · calculations use trusted tools</span><button className="send-button" disabled={busy || !input.trim()} aria-label="Send message"><ArrowUp size={14} /></button></div>
      </form>
    </section>
  );
}
