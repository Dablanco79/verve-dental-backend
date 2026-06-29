import { useEffect, useState, type SubmitEvent } from "react";

import type { BarcodeFormat, ScanMode } from "../../types/inventory.js";

type ScanFormProps = {
  isSubmitting: boolean;
  initialMode?: ScanMode;
  initialReason?: string;
  allowReceive?: boolean;
  onSubmit: (values: {
    barcodeValue: string;
    barcodeFormat?: BarcodeFormat;
    quantity: number;
    mode: ScanMode;
    reason?: string;
  }) => Promise<void>;
};

const FORMAT_OPTIONS: Array<{ value: "" | BarcodeFormat; label: string }> = [
  { value: "", label: "Auto-detect" },
  { value: "ean13", label: "EAN-13" },
  { value: "gs1", label: "GS1" },
  { value: "code128", label: "Code 128" },
  { value: "qr", label: "QR" },
  { value: "data_matrix", label: "Data Matrix" },
];

export function ScanForm({
  isSubmitting,
  initialMode = "deduct",
  initialReason = "",
  allowReceive = true,
  onSubmit,
}: ScanFormProps) {
  const [scanMode, setScanMode] = useState<ScanMode>(
    initialMode === "receive" && allowReceive ? "receive" : "deduct",
  );
  const [barcodeValue, setBarcodeValue] = useState("");
  const [barcodeFormat, setBarcodeFormat] = useState<"" | BarcodeFormat>("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState(initialReason);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScanMode(initialMode === "receive" && allowReceive ? "receive" : "deduct");
  }, [allowReceive, initialMode]);

  useEffect(() => {
    setReason(initialReason);
  }, [initialReason]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const trimmed = barcodeValue.trim();

    if (!trimmed) {
      setError("Enter a barcode value to scan.");
      return;
    }

    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }

    try {
      await onSubmit({
        barcodeValue: trimmed,
        barcodeFormat: barcodeFormat || undefined,
        quantity: parsedQuantity,
        mode: scanMode,
        reason: scanMode === "receive" && reason.trim() ? reason.trim() : undefined,
      });
      setBarcodeValue("");
      setQuantity("1");
      if (scanMode === "receive") {
        setReason("");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
    }
  }

  return (
    <form className="scan-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="scan-form__intro">
        <div>
          <h3 className="scan-form__title">Barcode scanning workflow</h3>
          <p className="scan-form__hint">
            Scan or type a barcode first, then confirm the quantity and action.
          </p>
        </div>
        <div className="scan-mode-toggle" role="group" aria-label="Scanner mode">
          <button
            type="button"
            className={scanMode === "deduct" ? "scan-mode-toggle__btn scan-mode-toggle__btn--active" : "scan-mode-toggle__btn"}
            onClick={() => {
              setScanMode("deduct");
            }}
          >
            Use stock
          </button>
          {allowReceive ? (
            <button
              type="button"
              className={scanMode === "receive" ? "scan-mode-toggle__btn scan-mode-toggle__btn--active scan-mode-toggle__btn--receive" : "scan-mode-toggle__btn"}
              onClick={() => {
                setScanMode("receive");
              }}
            >
              Receive stock
            </button>
          ) : null}
        </div>
      </div>

      <p className="scan-form__mode-hint">
        {scanMode === "deduct"
          ? "Deducts inventory when items are used in clinic."
          : "Adds inventory when deliveries or purchase orders arrive."}
      </p>

      <div className="scan-form__row scan-form__row--scanner">
        <label className="scan-form__field scan-form__field--grow">
          Barcode / scanner input
          <input
            value={barcodeValue}
            onChange={(event) => {
              setBarcodeValue(event.target.value);
            }}
            placeholder="e.g. 9301234567890 or VRV-CMP-001"
            autoComplete="off"
            autoFocus
            required
          />
        </label>

        <label className="scan-form__field">
          Format
          <select
            value={barcodeFormat}
            onChange={(event) => {
              setBarcodeFormat(event.target.value as "" | BarcodeFormat);
            }}
          >
            {FORMAT_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="scan-form__field scan-form__field--narrow">
          Qty
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        </label>

        <button
          type="submit"
          className={
            scanMode === "receive"
              ? "scan-form__submit scan-form__submit--receive"
              : "scan-form__submit"
          }
          disabled={isSubmitting}
        >
          {isSubmitting
            ? scanMode === "receive"
              ? "Receiving…"
              : "Scanning…"
            : scanMode === "receive"
              ? "Receive"
              : "Deduct"}
        </button>
      </div>

      {scanMode === "receive" ? (
        <label className="scan-form__field scan-form__field--grow scan-form__reference">
          Delivery reference (optional)
          <input
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder="e.g. PO-4521 or supplier invoice"
          />
        </label>
      ) : null}

      {error ? <p className="status-card__error">{error}</p> : null}
    </form>
  );
}
