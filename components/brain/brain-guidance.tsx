"use client";

import { useEffect, useRef, useState } from "react";
import { getGuidance, GUIDANCE_DISMISS_KEY, type DemoView } from "@/lib/brain/guidance";

export function BrainGuidance({
  view,
  onSelectChip,
  disabled = false,
}: {
  view: DemoView;
  onSelectChip: (prompt: string) => void;
  disabled?: boolean;
}) {
  const guidance = getGuidance(view);
  const rootRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showTip, setShowTip] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(GUIDANCE_DISMISS_KEY) === "1") {
        setShowTip(false);
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, []);

  useEffect(() => {
    if (!helpOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setHelpOpen(false);
      }
    }

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setHelpOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [helpOpen]);

  function dismissTip() {
    setShowTip(false);
    try {
      sessionStorage.setItem(GUIDANCE_DISMISS_KEY, "1");
    } catch {
      // sessionStorage may be unavailable
    }
  }

  return (
    <div className="fd-brain-guidance" ref={rootRef}>
      {showTip ? (
        <p className="fd-guidance-tip">
          <span>Try a prompt below, or open help for what the Brain can do.</span>
          <button type="button" onClick={dismissTip}>
            Got it
          </button>
        </p>
      ) : null}

      <div className="fd-guidance-chips">
        {guidance.chips.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onSelectChip(prompt)}
          >
            {prompt}
          </button>
        ))}

        <div className="fd-guidance-help">
          <button
            type="button"
            aria-label="What can the Financial Brain do?"
            aria-expanded={helpOpen}
            aria-haspopup="dialog"
            onClick={() => setHelpOpen((open) => !open)}
          >
            ?
          </button>

          {helpOpen ? (
            <div className="fd-guidance-popover" role="dialog" aria-label={guidance.helpTitle}>
              <strong>{guidance.helpTitle}</strong>
              <p>{guidance.helpBody}</p>
              <ul>
                {guidance.capabilities.map((capability) => (
                  <li key={capability.title}>
                    <strong>{capability.title}</strong>
                    <span>{capability.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
