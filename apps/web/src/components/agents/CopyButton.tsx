import { useEffect, useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

/** Copies `text` to the clipboard and confirms briefly; falls back to selecting nothing silently. */
export function CopyButton({ text, label = "Copy", className = "k-btn k-btn--ghost k-btn--sm" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      title={text}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
