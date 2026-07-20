"use client";

import { X } from "lucide-react";
import type { BrainHandoff } from "@/lib/brain/guidance";

export function BrainHandoffBanner({
  handoff,
  onDismiss,
}: {
  handoff: BrainHandoff;
  onDismiss: () => void;
}) {
  return (
    <div className="fd-brain-handoff" role="status" aria-label="Brain handoff context">
      <p>
        <strong>From {handoff.label}</strong>
        <span> — asking: {handoff.prompt}</span>
      </p>
      <button type="button" aria-label="Dismiss handoff" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
