"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getGuidance, GUIDANCE_DISMISS_KEY, type DemoView } from "@/lib/brain/guidance";

const GUIDANCE_DISMISS_EVENT = "findex-guidance-dismiss";

function subscribeGuidanceDismiss(onStoreChange: () => void) {
  window.addEventListener(GUIDANCE_DISMISS_EVENT, onStoreChange);
  return () => window.removeEventListener(GUIDANCE_DISMISS_EVENT, onStoreChange);
}

function getGuidanceTipSnapshot() {
  try {
    return sessionStorage.getItem(GUIDANCE_DISMISS_KEY) !== "1";
  } catch {
    return true;
  }
}

function getGuidanceTipServerSnapshot() {
  return true;
}

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
  const [localDismissed, setLocalDismissed] = useState(false);
  const tipFromStorage = useSyncExternalStore(
    subscribeGuidanceDismiss,
    getGuidanceTipSnapshot,
    getGuidanceTipServerSnapshot,
  );
  const showTip = tipFromStorage && !localDismissed;

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
    setLocalDismissed(true);
    try {
      sessionStorage.setItem(GUIDANCE_DISMISS_KEY, "1");
    } catch {
      // sessionStorage may be unavailable
    }
    window.dispatchEvent(new Event(GUIDANCE_DISMISS_EVENT));
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
            onClick={() => setHelpOpen((open) => !open)}
          >
            ?
          </button>

          {helpOpen ? (
            <div className="fd-guidance-popover" role="region" aria-label={guidance.helpTitle}>
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
