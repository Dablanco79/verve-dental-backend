/**
 * MasterProductSearchModal — Product Matching Engine v1.
 *
 * A modal dialog that lets the user search for and select an existing
 * Master Product to link to a supplier product row.
 *
 * Calls GET /api/v1/master-products with the search term.
 * Returns the selected product via onSelect.
 */
import { useState, useEffect, useRef } from "react";

import type { MasterProduct } from "../../types/masterProduct.js";
import { createApiClient } from "../../api/client.js";
import { loadConfig } from "../../config/index.js";

const apiClient = createApiClient(loadConfig());

type MasterProductSearchModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: MasterProduct) => void;
  title?: string;
};

export function MasterProductSearchModal({
  isOpen,
  onClose,
  onSelect,
  title = "Search Master Products",
}: MasterProductSearchModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<MasterProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm("");
      setResults([]);
      setSearchError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = searchTerm.trim();

    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      apiClient
        .listMasterProducts({ search: trimmed, status: "active", limit: 20 })
        .then((page) => {
          setResults(page.items);
        })
        .catch((err: unknown) => {
          setSearchError(
            err instanceof Error ? err.message : "Search failed. Please try again.",
          );
          setResults([]);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchTerm]);

  if (!isOpen) return null;

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="modal-content master-product-search-modal">
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <label className="scan-form__field">
            Search by name, SKU, or category
            <input
              ref={inputRef}
              type="text"
              className="master-product-search-modal__input"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
              }}
              placeholder="e.g. Nitrile Gloves, VRV-GLV-001"
              data-testid="master-product-search-input"
            />
          </label>

          {isSearching ? (
            <p className="master-product-search-modal__status" role="status">
              Searching…
            </p>
          ) : null}

          {searchError ? (
            <p className="status-card__error" role="alert">
              {searchError}
            </p>
          ) : null}

          {!isSearching && searchTerm.trim().length >= 2 && results.length === 0 && !searchError ? (
            <p className="master-product-search-modal__status" role="status">
              No active master products found for "{searchTerm}".
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul
              className="master-product-search-modal__results"
              role="listbox"
              aria-label="Search results"
            >
              {results.map((product) => (
                <li key={product.id} role="option" aria-selected="false">
                  <button
                    type="button"
                    className="master-product-search-modal__result"
                    onClick={() => {
                      onSelect(product);
                    }}
                    data-testid={`search-result-${product.id}`}
                  >
                    <span className="master-product-search-modal__result-name">
                      {product.displayName}
                    </span>
                    <span className="master-product-search-modal__result-meta">
                      {product.sku}
                      {product.brand ? ` · ${product.brand}` : ""}
                      {" · "}{product.category}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="link-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
