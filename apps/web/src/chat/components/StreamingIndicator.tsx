export function StreamingIndicator() {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 px-1" aria-label="응답 생성 중" aria-live="polite">
      <i className="typing-dot" />
      <i className="typing-dot" />
      <i className="typing-dot" />
    </span>
  );
}
