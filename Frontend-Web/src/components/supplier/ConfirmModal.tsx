import { useState } from "react";

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Controls confirm button colour: "warning" (amber) or "danger" (red). */
  confirmVariant?: "warning" | "danger";
  onClose: () => void;
  /** Must resolve on success; throw on failure. The modal handles its own error display. */
  onConfirm: () => Promise<void>;
};

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmVariant = "warning",
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      await onConfirm();
      // Parent is expected to unmount this modal on success via state change.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed. Please try again.");
      setLoading(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget && !loading) onClose();
  }

  return (
    <div
      className="supplier-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="supplier-modal supplier-modal--confirm">
        <div className="supplier-modal__header">
          <h2 className="supplier-modal__title" id="confirm-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="supplier-modal__close"
            onClick={onClose}
            aria-label="Close"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <p className="supplier-confirm__message">{message}</p>

        {error ? (
          <p className="supplier-form__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="supplier-form__actions">
          <button
            type="button"
            className="supplier-form__cancel"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`supplier-confirm__btn supplier-confirm__btn--${confirmVariant}`}
            onClick={() => {
              void handleConfirm();
            }}
            disabled={loading}
          >
            {loading ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
