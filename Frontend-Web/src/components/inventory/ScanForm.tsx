import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BarcodeFormat, InventoryItem, ScanMode } from "../../types/inventory.js";

type SmartScanProductInput = {
  barcodeValue: string;
  barcodeFormat?: BarcodeFormat;
  name: string;
  supplierPreference: string;
  category: string;
  unitOfMeasure: string;
  minimumStock: number;
  reorderQuantity: number;
};

type ScanFormProps = {
  isSubmitting: boolean;
  initialMode?: ScanMode;
  initialReason?: string;
  allowReceive?: boolean;
  inventoryItems?: InventoryItem[];
  onCreateProduct?: (values: SmartScanProductInput) => Promise<InventoryItem>;
  onSubmit: (values: {
    barcodeValue: string;
    barcodeFormat?: BarcodeFormat;
    quantity: number;
    mode: ScanMode;
    reason?: string;
  }) => Promise<void>;
};

type CameraStatus = "idle" | "starting" | "scanning";

type NativeBarcodeDetector = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => NativeBarcodeDetector;

type ZxingScannerControls = {
  stop: () => void;
};

type CreateProductFormValues = {
  name: string;
  supplierPreference: string;
  category: string;
  unitOfMeasure: string;
  minimumStock: string;
  reorderQuantity: string;
};

type CreateProductFieldErrors = Partial<Record<keyof CreateProductFormValues | "barcode", string>>;

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
  inventoryItems = [],
  onCreateProduct,
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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [createdProduct, setCreatedProduct] = useState<InventoryItem | null>(null);
  const [createProductValues, setCreateProductValues] = useState<CreateProductFormValues>({
    name: "",
    supplierPreference: "",
    category: "",
    unitOfMeasure: "unit",
    minimumStock: "0",
    reorderQuantity: "0",
  });
  const [createProductErrors, setCreateProductErrors] = useState<CreateProductFieldErrors>({});
  const [createProductError, setCreateProductError] = useState<string | null>(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [productCreatedMessage, setProductCreatedMessage] = useState<string | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const productNameInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<ZxingScannerControls | null>(null);
  const isCameraActiveRef = useRef(false);

  const trimmedBarcode = barcodeValue.trim();
  const searchableInventoryItems = useMemo(
    () => (createdProduct ? [createdProduct, ...inventoryItems] : inventoryItems),
    [createdProduct, inventoryItems],
  );
  const matchedProduct = useMemo(() => {
    const lookup = trimmedBarcode.toLowerCase();
    if (!lookup) return null;

    return (
      searchableInventoryItems.find(
        (item) =>
          item.masterSku.toLowerCase() === lookup ||
          item.name.toLowerCase() === lookup,
      ) ?? null
    );
  }, [searchableInventoryItems, trimmedBarcode]);
  const hasUnknownBarcode = trimmedBarcode.length > 0 && !matchedProduct;
  const parsedQuantity = Number(quantity);
  const quantityForPreview =
    Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
  const categoryOptions = useMemo(
    () => [...new Set(inventoryItems.map((item) => item.category).filter(Boolean))].sort(),
    [inventoryItems],
  );
  const supplierOptions = useMemo(
    () => [
      ...new Set(
        inventoryItems
          .map((item) => item.supplierPreference)
          .filter((supplier): supplier is string => Boolean(supplier)),
      ),
    ].sort(),
    [inventoryItems],
  );
  const unitOptions = useMemo(
    () => [...new Set(inventoryItems.map((item) => item.unitOfMeasure).filter(Boolean))].sort(),
    [inventoryItems],
  );

  useEffect(() => {
    setScanMode(initialMode === "receive" && allowReceive ? "receive" : "deduct");
  }, [allowReceive, initialMode]);

  useEffect(() => {
    setReason(initialReason);
  }, [initialReason]);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (hasUnknownBarcode) {
      window.setTimeout(() => productNameInputRef.current?.focus(), 0);
    }
  }, [hasUnknownBarcode]);

  useEffect(() => {
    if (!hasUnknownBarcode) {
      return;
    }

    setCreateProductValues((current) => ({
      ...current,
      category: current.category || categoryOptions[0] || "General",
      unitOfMeasure: current.unitOfMeasure || unitOptions[0] || "unit",
    }));
  }, [categoryOptions, hasUnknownBarcode, unitOptions]);

  const stopCamera = useCallback((): void => {
    isCameraActiveRef.current = false;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  function applyDetectedBarcode(value: string): void {
    const nextValue = value.trim();
    if (!nextValue) return;

    setBarcodeValue(nextValue);
    setProductCreatedMessage(null);
    setError(null);
    setCameraError(null);
    stopCamera();
    window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function closeCreateProductModal(): void {
    setBarcodeValue("");
    setCreateProductValues({
      name: "",
      supplierPreference: "",
      category: "",
      unitOfMeasure: unitOptions[0] || "unit",
      minimumStock: "0",
      reorderQuantity: "0",
    });
    setCreateProductErrors({});
    setCreateProductError(null);
    setProductCreatedMessage(null);
    window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function updateCreateProductField<K extends keyof CreateProductFormValues>(
    field: K,
    value: CreateProductFormValues[K],
  ): void {
    setCreateProductValues((current) => ({ ...current, [field]: value }));
    setCreateProductErrors((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== field),
      );
    });
    setCreateProductError(null);
  }

  function validateCreateProduct(): CreateProductFieldErrors {
    const errors: CreateProductFieldErrors = {};
    const minimumStock = Number(createProductValues.minimumStock);
    const reorderQuantity = Number(createProductValues.reorderQuantity);

    if (!trimmedBarcode) {
      errors.barcode = "Barcode is required.";
    }
    if (
      inventoryItems.some((item) => item.masterSku.toLowerCase() === trimmedBarcode.toLowerCase())
    ) {
      errors.barcode = "This barcode already matches an existing product code.";
    }
    if (!createProductValues.name.trim()) {
      errors.name = "Product name is required.";
    }
    if (!createProductValues.supplierPreference.trim()) {
      errors.supplierPreference = "Supplier is required.";
    }
    if (!createProductValues.category.trim()) {
      errors.category = "Category is required.";
    }
    if (!createProductValues.unitOfMeasure.trim()) {
      errors.unitOfMeasure = "Unit of measure is required.";
    }
    if (!Number.isInteger(minimumStock) || minimumStock < 0) {
      errors.minimumStock = "Minimum stock must be zero or a positive whole number.";
    }
    if (!Number.isInteger(reorderQuantity) || reorderQuantity < 0) {
      errors.reorderQuantity = "Reorder quantity must be zero or a positive whole number.";
    }

    return errors;
  }

  async function handleCreateProduct(): Promise<void> {
    if (!onCreateProduct) {
      setCreateProductError("Product creation is not available in this scanner.");
      return;
    }

    const errors = validateCreateProduct();
    if (Object.keys(errors).length > 0) {
      setCreateProductErrors(errors);
      return;
    }

    setCreateProductErrors({});
    setCreateProductError(null);
    setIsCreatingProduct(true);

    try {
      const minimumStock = Number(createProductValues.minimumStock);
      const reorderQuantity = Number(createProductValues.reorderQuantity);
      const product = await onCreateProduct({
        barcodeValue: trimmedBarcode,
        barcodeFormat: barcodeFormat || undefined,
        name: createProductValues.name.trim(),
        supplierPreference: createProductValues.supplierPreference.trim(),
        category: createProductValues.category.trim(),
        unitOfMeasure: createProductValues.unitOfMeasure.trim(),
        minimumStock,
        reorderQuantity,
      });
      setCreatedProduct(product);
      setBarcodeValue(product.masterSku);
      setCreateProductValues({
        name: "",
        supplierPreference: "",
        category: "",
        unitOfMeasure: unitOptions[0] || "unit",
        minimumStock: "0",
        reorderQuantity: "0",
      });
      setProductCreatedMessage("Product Created Successfully");
      window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to create product.";
      if (message.toLowerCase().includes("barcode")) {
        setCreateProductErrors({ barcode: "This barcode is already assigned to a product." });
      }
      setCreateProductError(message);
    } finally {
      setIsCreatingProduct(false);
    }
  }

  async function startNativeBarcodeDetector(video: HTMLVideoElement): Promise<boolean> {
    const barcodeWindow = window as Window & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    };

    if (!barcodeWindow.BarcodeDetector) {
      return false;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    streamRef.current = stream;
    video.srcObject = stream;
    await video.play();

    const detector = new barcodeWindow.BarcodeDetector({
      formats: ["ean_13", "code_128", "qr_code", "data_matrix"],
    });

    const detect = () => {
      void detector
        .detect(video)
        .then((barcodes) => {
          const value = barcodes[0]?.rawValue;
          if (value) {
            applyDetectedBarcode(value);
            return;
          }

          if (isCameraActiveRef.current) {
            animationFrameRef.current = window.requestAnimationFrame(detect);
          }
        })
        .catch(() => {
          if (isCameraActiveRef.current) {
            animationFrameRef.current = window.requestAnimationFrame(detect);
          }
        });
    };

    animationFrameRef.current = window.requestAnimationFrame(detect);
    return true;
  }

  async function startZxingScanner(video: HTMLVideoElement): Promise<void> {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const controls = await reader.decodeFromVideoDevice(
      undefined,
      video,
      (result) => {
        const value = result?.getText();
        if (value) {
          applyDetectedBarcode(value);
        }
      },
    );
    zxingControlsRef.current = controls;
  }

  async function handleCameraScan(): Promise<void> {
    const mediaDevices = "mediaDevices" in navigator ? navigator.mediaDevices : undefined;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      setCameraError("Camera scanning is not available in this browser. Use the barcode field or a USB/Bluetooth scanner.");
      barcodeInputRef.current?.focus();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    setCameraError(null);
    setError(null);
    setCameraStatus("starting");
    isCameraActiveRef.current = true;

    try {
      const nativeStarted = await startNativeBarcodeDetector(video);
      if (!nativeStarted) {
        await startZxingScanner(video);
      }
      setCameraStatus("scanning");
    } catch (err: unknown) {
      stopCamera();
      const message = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access or use the barcode field."
        : "Unable to start camera scanning. Check camera permissions or use the barcode field.";
      setCameraError(message);
      barcodeInputRef.current?.focus();
    }
  }

  async function submitScan(nextMode: ScanMode): Promise<void> {
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
        mode: nextMode,
        reason: nextMode === "receive" && reason.trim() ? reason.trim() : undefined,
      });
      setBarcodeValue("");
      setQuantity("1");
      if (nextMode === "receive") {
        setReason("");
      }
      window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      setError(message);
    }
  }

  return (
    <div className="scan-form">
      <div className="scan-form__intro">
        <div>
          <h3 className="scan-form__title">Barcode scanning workflow</h3>
          <p className="scan-form__hint">
            Scan or type a barcode first, then confirm the quantity and action.
            USB and Bluetooth scanners can use the barcode field directly.
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
          Barcode
          <input
            ref={barcodeInputRef}
            value={barcodeValue}
            onChange={(event) => {
              setBarcodeValue(event.target.value);
              setProductCreatedMessage(null);
              setError(null);
              setCameraError(null);
            }}
            placeholder="e.g. 9301234567890 or VRV-CMP-001"
            autoComplete="off"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitScan(scanMode);
              }
            }}
            required
          />
        </label>

        <button
          type="button"
          className="scan-form__camera-button"
          onClick={() => {
            void handleCameraScan();
          }}
          disabled={cameraStatus !== "idle" || isSubmitting}
          aria-label="Scan product with camera"
        >
          <span aria-hidden="true">📷</span>
          Scan Product
        </button>

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
          type="button"
          className={
            scanMode === "receive"
              ? "scan-form__submit scan-form__submit--receive"
              : "scan-form__submit"
          }
          disabled={isSubmitting}
          onClick={() => {
            void submitScan(scanMode);
          }}
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

      <div
        className={`scan-camera${cameraStatus !== "idle" ? " scan-camera--active" : ""}`}
        aria-live="polite"
      >
        <video
          ref={videoRef}
          className="scan-camera__video"
          muted
          playsInline
          aria-label="Camera barcode preview"
        />
        {cameraStatus !== "idle" ? (
          <div className="scan-camera__controls">
            <p className="scan-form__hint">
              {cameraStatus === "starting"
                ? "Starting camera..."
                : "Point the camera at a barcode. The camera will close after a scan."}
            </p>
            <button type="button" className="link-button" onClick={stopCamera}>
              Cancel camera
            </button>
          </div>
        ) : null}
      </div>

      {cameraError ? (
        <p className="status-card__error" role="alert">
          {cameraError}
        </p>
      ) : null}

      {matchedProduct ? (
        <section className="scan-product-card" aria-live="polite" aria-label="Scanned product summary">
          <div>
            <p className="scan-product-card__eyebrow">Product found</p>
            <h3>{matchedProduct.name}</h3>
            <p className="inventory-page__subtitle">
              Supplier: {matchedProduct.supplierPreference ?? "No supplier preference set"}
            </p>
          </div>
          <dl className="scan-product-card__details">
            <div>
              <dt>SKU</dt>
              <dd>{matchedProduct.masterSku}</dd>
            </div>
            <div>
              <dt>Current stock</dt>
              <dd>{matchedProduct.quantityOnHand} {matchedProduct.unitOfMeasure}</dd>
            </div>
            <div>
              <dt>Reorder level</dt>
              <dd>{matchedProduct.reorderPoint} {matchedProduct.unitOfMeasure}</dd>
            </div>
          </dl>
          <div className="scan-product-card__quantity" aria-label="Quantity controls">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setQuantity(String(Math.max(1, quantityForPreview - 1)));
              }}
              aria-label="Decrease quantity"
            >
              -
            </button>
            <span>Qty {quantityForPreview}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setQuantity(String(quantityForPreview + 1));
              }}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <div className="scan-product-card__actions">
            {allowReceive ? (
              <button
                type="button"
                className="scan-form__submit scan-form__submit--receive"
                onClick={() => {
                  void submitScan("receive");
                }}
                disabled={isSubmitting}
                aria-label="Receive scanned product"
              >
                Receive
              </button>
            ) : null}
            <button
              type="button"
              className="scan-form__submit"
              onClick={() => {
                void submitScan("deduct");
              }}
              disabled={isSubmitting}
              aria-label="Deduct scanned product"
            >
              Deduct
            </button>
          </div>
        </section>
      ) : null}

      {hasUnknownBarcode ? (
        <div
          className="scan-create-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-create-product-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeCreateProductModal();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreateProduct();
            }
          }}
        >
          <div
            className="scan-create-modal__panel"
          >
            <div className="status-card__header">
              <div>
                <p className="scan-product-card__eyebrow">Unknown product</p>
                <h3 id="scan-create-product-title">Create product from scan</h3>
                <p className="inventory-page__subtitle">
                  This barcode was not found. Create the product without leaving scan mode.
                </p>
              </div>
            </div>

            <label className="scan-form__field">
              Barcode
              <input value={trimmedBarcode} readOnly aria-describedby="scan-create-barcode-help" />
            </label>
            <p id="scan-create-barcode-help" className="scan-form__hint">
              Barcode is read-only because it came from the current scan.
            </p>
            {createProductErrors.barcode ? (
              <p className="product-form__field-error" role="alert">
                {createProductErrors.barcode}
              </p>
            ) : null}

            <label className="scan-form__field">
              Product Name *
              <input
                ref={productNameInputRef}
                value={createProductValues.name}
                onChange={(event) => {
                  updateCreateProductField("name", event.target.value);
                }}
                aria-invalid={createProductErrors.name ? true : undefined}
                required
              />
              {createProductErrors.name ? (
                <span className="product-form__field-error" role="alert">
                  {createProductErrors.name}
                </span>
              ) : null}
            </label>

            <label className="scan-form__field">
              Supplier *
              <input
                value={createProductValues.supplierPreference}
                onChange={(event) => {
                  updateCreateProductField("supplierPreference", event.target.value);
                }}
                list="scan-supplier-options"
                aria-invalid={createProductErrors.supplierPreference ? true : undefined}
                required
              />
              <datalist id="scan-supplier-options">
                {supplierOptions.map((supplier) => (
                  <option key={supplier} value={supplier} />
                ))}
              </datalist>
              {createProductErrors.supplierPreference ? (
                <span className="product-form__field-error" role="alert">
                  {createProductErrors.supplierPreference}
                </span>
              ) : null}
            </label>

            <div className="scan-create-modal__grid">
              <label className="scan-form__field">
                Category
                <input
                  value={createProductValues.category}
                  onChange={(event) => {
                    updateCreateProductField("category", event.target.value);
                  }}
                  list="scan-category-options"
                  aria-invalid={createProductErrors.category ? true : undefined}
                />
                <datalist id="scan-category-options">
                  {categoryOptions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
                {createProductErrors.category ? (
                  <span className="product-form__field-error" role="alert">
                    {createProductErrors.category}
                  </span>
                ) : null}
              </label>

              <label className="scan-form__field">
                Unit of Measure
                <input
                  value={createProductValues.unitOfMeasure}
                  onChange={(event) => {
                    updateCreateProductField("unitOfMeasure", event.target.value);
                  }}
                  list="scan-unit-options"
                  aria-invalid={createProductErrors.unitOfMeasure ? true : undefined}
                />
                <datalist id="scan-unit-options">
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
                {createProductErrors.unitOfMeasure ? (
                  <span className="product-form__field-error" role="alert">
                    {createProductErrors.unitOfMeasure}
                  </span>
                ) : null}
              </label>

              <label className="scan-form__field">
                Minimum Stock
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={createProductValues.minimumStock}
                  onChange={(event) => {
                    updateCreateProductField("minimumStock", event.target.value);
                  }}
                  aria-invalid={createProductErrors.minimumStock ? true : undefined}
                />
                {createProductErrors.minimumStock ? (
                  <span className="product-form__field-error" role="alert">
                    {createProductErrors.minimumStock}
                  </span>
                ) : null}
              </label>

              <label className="scan-form__field">
                Reorder Quantity
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={createProductValues.reorderQuantity}
                  onChange={(event) => {
                    updateCreateProductField("reorderQuantity", event.target.value);
                  }}
                  aria-invalid={createProductErrors.reorderQuantity ? true : undefined}
                />
                {createProductErrors.reorderQuantity ? (
                  <span className="product-form__field-error" role="alert">
                    {createProductErrors.reorderQuantity}
                  </span>
                ) : null}
              </label>
            </div>

            <p className="scan-form__hint">
              Minimum Stock is saved as the product reorder level. Reorder Quantity is captured
              in this workflow, but the current product API does not persist a separate reorder
              quantity field.
            </p>

            {createProductError ? (
              <p className="status-card__error" role="alert">
                {createProductError}
              </p>
            ) : null}

            <div className="scan-product-card__actions">
              <button
                type="button"
                className="link-button"
                onClick={closeCreateProductModal}
                disabled={isCreatingProduct}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-link"
                disabled={isCreatingProduct}
                onClick={() => {
                  void handleCreateProduct();
                }}
              >
                {isCreatingProduct ? "Saving..." : "Save Product"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {productCreatedMessage ? (
        <p className="inventory-notice" role="status">
          ✅ {productCreatedMessage}
        </p>
      ) : null}

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
    </div>
  );
}
