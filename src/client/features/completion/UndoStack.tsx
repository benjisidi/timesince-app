import { useEffect, useRef, useState } from "react";

export type UndoStatus = "available" | "undoing" | "failed";

export interface UndoItem {
  id: number;
  completionId: number;
  taskId: number;
  taskName: string;
  status: UndoStatus;
  shouldFocus: boolean;
}

const UNDO_LIFETIME_MS = 5_000;

interface UndoToastProps {
  item: UndoItem;
  onExpire: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

function UndoToast({ item, onExpire, onUndo }: UndoToastProps) {
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const remainingMsRef = useRef(UNDO_LIFETIME_MS);
  const hasFocusedRef = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);

  useEffect(() => {
    if (
      !item.shouldFocus ||
      item.status !== "available" ||
      hasFocusedRef.current
    ) {
      return;
    }
    hasFocusedRef.current = true;
    undoButtonRef.current?.focus();
  }, [item.shouldFocus, item.status]);

  useEffect(() => {
    if (item.status !== "available" || isHovered || hasFocusWithin) return;

    const startedAt = Date.now();
    const timer = window.setTimeout(
      () => onExpire(item.id),
      remainingMsRef.current,
    );
    return () => {
      window.clearTimeout(timer);
      remainingMsRef.current = Math.max(
        0,
        remainingMsRef.current - (Date.now() - startedAt),
      );
    };
  }, [hasFocusWithin, isHovered, item.id, item.status, onExpire]);

  return (
    <section
      className={`undo-toast${item.status === "failed" ? " undo-toast-error" : ""}`}
      aria-label={`Completion feedback for ${item.taskName}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setHasFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHasFocusWithin(false);
        }
      }}
    >
      <div>
        <p>{item.status === "failed" ? "Undo failed" : "Completed"}</p>
        <span>{item.taskName}</span>
        {item.status === "failed" ? (
          <small role="alert">Check your connection and try again.</small>
        ) : null}
      </div>
      <button
        ref={undoButtonRef}
        type="button"
        disabled={item.status === "undoing"}
        aria-label={`${item.status === "failed" ? "Retry undo for" : "Undo completion of"} ${item.taskName}`}
        onClick={() => onUndo(item)}
      >
        {item.status === "undoing"
          ? "Undoing…"
          : item.status === "failed"
            ? "Retry"
            : "Undo"}
      </button>
    </section>
  );
}

interface UndoStackProps {
  items: UndoItem[];
  onExpire: (itemId: number) => void;
  onUndo: (item: UndoItem) => void;
}

export function UndoStack({ items, onExpire, onUndo }: UndoStackProps) {
  if (items.length === 0) return null;

  return (
    <aside className="undo-stack" aria-label="Completion actions">
      {items.map((item) => (
        <UndoToast
          key={item.id}
          item={item}
          onExpire={onExpire}
          onUndo={onUndo}
        />
      ))}
    </aside>
  );
}
