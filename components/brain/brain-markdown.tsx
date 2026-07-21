"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function BrainMarkdown({ content }: { content: string }) {
  if (!content.trim()) return null;

  return (
    <div className="brain-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
