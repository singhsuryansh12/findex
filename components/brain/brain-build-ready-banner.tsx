"use client";

import { X } from "lucide-react";

export type BuildReadyNotice = {
  title: string;
  projectId: string;
};

export function BrainBuildReadyBanner({
  notice,
  onView,
  onDismiss,
}: {
  notice: BuildReadyNotice;
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fd-build-ready" role="status" aria-label="Tool build ready">
      <p>
        <strong>Your tool is ready</strong>
        <span> — {notice.title}</span>
      </p>
      <div className="fd-build-ready-actions">
        <button type="button" className="fd-build-ready-view" onClick={onView}>
          View tool
        </button>
        <button type="button" aria-label="Dismiss build ready notice" onClick={onDismiss}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
