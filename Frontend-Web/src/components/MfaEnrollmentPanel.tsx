import { useEffect, useState, type SubmitEvent } from "react";

import type { MfaSetupData } from "../types/index.js";

type Props = {
  setupData: MfaSetupData;
  /**
   * Called with the verified 6-digit code when the user submits the form.
   * Should throw on error so the panel can surface the message to the user.
   */
  onConfirm: (code: string) => Promise<void>;
  /** Optional cancel handler — shows a Cancel button when provided. */
  onCancel?: () => void;
  /** When true the submit button shows a loading state and inputs are disabled. */
  isBusy: boolean;
};

/**
 * MFA Enrollment Panel
 *
 * Renders the QR code (generated client-side via the qrcode package — the
 * secret never leaves the browser), the manual entry key, and a TOTP code
 * input form.
 *
 * Security notes:
 *   - QR code is generated client-side; the secret is never sent to a
 *     third-party service.
 *   - The secret is hidden by default; the user must explicitly click "Show"
 *     to reveal it, reducing shoulder-surfing risk.
 *   - This component does not persist the secret in any storage medium.
 */
export function MfaEnrollmentPanel({ setupData, onConfirm, onCancel, isBusy }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    setQrError(false);

    async function generate(): Promise<void> {
      try {
        const QRCode = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(setupData.uri, {
          width: 200,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrError(true);
      }
    }

    void generate();
    return () => { cancelled = true; };
  }, [setupData.uri]);

  async function handleSubmit(e: SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setCodeError("Enter the 6-digit numeric code from your authenticator app.");
      return;
    }
    setCodeError(null);
    try {
      await onConfirm(trimmed);
    } catch (err: unknown) {
      setCodeError(
        err instanceof Error ? err.message : "Verification failed. Please try again.",
      );
    }
  }

  return (
    <div className="mfa-panel">
      <div className="mfa-panel__qr-wrap">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR code — scan with your authenticator app"
            width={200}
            height={200}
            className="mfa-panel__qr-image"
          />
        ) : qrError ? (
          <p className="mfa-panel__qr-fallback">
            QR code unavailable — use the key below to add the account manually.
          </p>
        ) : (
          <p className="loading-message">Generating QR code…</p>
        )}
      </div>

      <div className="mfa-panel__secret-wrap">
        <p className="mfa-panel__secret-label">Manual entry key</p>
        <div className="mfa-panel__secret-row">
          <code className="mfa-panel__secret-code" aria-label="MFA secret key">
            {showSecret ? setupData.secret : "•".repeat(setupData.secret.length)}
          </code>
          <button
            type="button"
            className="button-link"
            onClick={() => { setShowSecret((v) => !v); }}
            aria-pressed={showSecret}
          >
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mfa-panel__secret-hint">
          If you cannot scan the QR code, enter this key manually in Google
          Authenticator, Authy, or another TOTP app. Keep it private.
        </p>
      </div>

      <form
        className="product-form"
        onSubmit={(e) => { void handleSubmit(e); }}
        aria-label="Confirm MFA code"
        noValidate
      >
        <label>
          Verification code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => { setCode(e.target.value); }}
            disabled={isBusy}
          autoFocus
          />
        </label>

        {codeError ? (
          <p className="status-card__error" role="alert">
            {codeError}
          </p>
        ) : null}

        <div className="product-form__actions">
          <button type="submit" disabled={isBusy}>
            {isBusy ? "Verifying…" : "Confirm & enable MFA"}
          </button>
          {onCancel ? (
            <button
              type="button"
              className="pr-inline-form__cancel"
              onClick={onCancel}
              disabled={isBusy}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
