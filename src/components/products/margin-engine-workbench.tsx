"use client";

import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Calculator,
  DollarSign,
  PackageSearch,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Target,
  X,
} from "lucide-react";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { ModalPortal } from "@/components/ui/modal-portal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";

export type MarginEngineProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplierName: string;
  location: string;
  cost: number;
  ledgerCost: number;
  price: number;
  quantity: number;
  reorderLevel: number;
  dailyVelocity: number;
  targetMarginPercent: number;
  currentMarginPercent: number;
};

type MarginCalc = {
  landingCost: number;
  targetMarginPercent: number;
  sellingPrice: number;
  profitPerUnit: number;
  markup: number;
  breakEvenPrice: number;
  grossMarginPercent: number;
};

type PricingContext = {
  kind: "product" | "invoice" | "manual";
  title: string;
  detail: string;
};

type LedgerEditState = {
  id: string;
  cost: string;
  price: string;
  targetMarginPercent: string;
};

type MarginEngineWorkbenchProps = {
  products: MarginEngineProduct[];
  compact?: boolean;
  canEditLedger?: boolean;
};

const DEFAULT_LANDING_COST = 50;
const DEFAULT_TARGET_MARGIN = 30;
const INPUT_CLASSNAME = "app-input";

function calculateMargin(
  landingCost: number,
  targetMarginPercent: number,
): MarginCalc {
  const normalizedLandingCost = Math.max(landingCost, 0);
  const normalizedTargetMargin = Math.min(Math.max(targetMarginPercent, 0), 95);
  const breakEvenPrice = normalizedLandingCost;
  const sellingPrice =
    normalizedLandingCost <= 0
      ? 0
      : normalizedLandingCost / (1 - normalizedTargetMargin / 100);
  const profitPerUnit = sellingPrice - normalizedLandingCost;
  const markup =
    normalizedLandingCost <= 0
      ? 0
      : ((sellingPrice - normalizedLandingCost) / normalizedLandingCost) * 100;
  const grossMarginPercent =
    sellingPrice <= 0
      ? 0
      : ((sellingPrice - normalizedLandingCost) / sellingPrice) * 100;

  return {
    landingCost: normalizedLandingCost,
    targetMarginPercent: normalizedTargetMargin,
    sellingPrice: Math.round(sellingPrice * 100) / 100,
    profitPerUnit: Math.round(profitPerUnit * 100) / 100,
    markup: Math.round(markup * 100) / 100,
    breakEvenPrice: Math.round(breakEvenPrice * 100) / 100,
    grossMarginPercent: Math.round(grossMarginPercent * 100) / 100,
  };
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function parseNumberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePositiveNumber(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function calculatePerItemCost(cost: number, quantity: number) {
  return quantity > 0 ? cost / quantity : cost;
}

function calculateCurrentMarginPercent(cost: number, price: number) {
  if (price <= 0) {
    return 0;
  }

  return Math.round(((price - cost) / price) * 100 * 100) / 100;
}

function marginTone(currentMargin: number, targetMargin: number) {
  if (currentMargin >= targetMargin) {
    return "green" as const;
  }

  if (currentMargin >= Math.max(targetMargin - 5, 0)) {
    return "amber" as const;
  }

  return "red" as const;
}

function marginLabel(currentMargin: number, targetMargin: number) {
  if (currentMargin >= targetMargin) {
    return "On target";
  }

  if (currentMargin >= Math.max(targetMargin - 5, 0)) {
    return "Near target";
  }

  return "At risk";
}

function stockTone(quantity: number, reorderLevel: number) {
  if (quantity <= 0) {
    return "red" as const;
  }

  if (quantity <= reorderLevel) {
    return "amber" as const;
  }

  return "green" as const;
}

function stockLabel(quantity: number, reorderLevel: number) {
  if (quantity <= 0) {
    return "Out";
  }

  if (quantity <= reorderLevel) {
    return "Reorder";
  }

  return "Healthy";
}

function formatSignedCurrency(amount: number) {
  const prefix = amount >= 0 ? "+" : "-";
  return `${prefix}${formatCurrency(Math.abs(amount))}`;
}

function formatCostBasisSummary(totalCost: number, quantity: number) {
  if (quantity > 0) {
    return `${formatCurrency(totalCost)} / ${quantity} units`;
  }

  return `${formatCurrency(totalCost)} total`;
}

function buildManualContext(): PricingContext {
  return {
    kind: "manual",
    title: "Custom calculation",
    detail: "Adjust landing cost and target margin for any pricing scenario.",
  };
}

function buildProductContext(product: MarginEngineProduct): PricingContext {
  return {
    kind: "product",
    title: product.name,
    detail: `${product.sku} · ${product.supplierName}`,
  };
}

function buildLedgerEditState(product: MarginEngineProduct): LedgerEditState {
  return {
    id: product.id,
    cost: product.ledgerCost.toFixed(2),
    price: product.price.toFixed(2),
    targetMarginPercent: product.targetMarginPercent.toFixed(1),
  };
}

function buildInvoiceContext(
  searchParams: ReturnType<typeof useSearchParams>,
  landingCost: number,
): PricingContext {
  const invoiceSource = searchParams.get("source");
  const invoiceLine = searchParams.get("line");
  const lineAmount = parsePositiveNumber(searchParams.get("lineAmount"));
  const packQuantity = parsePositiveNumber(searchParams.get("packs"));
  const itemsPerPack = parsePositiveNumber(searchParams.get("itemsPerPack"));
  const title = invoiceSource
    ? `Invoice ${invoiceSource}${invoiceLine ? ` • ${invoiceLine}` : ""}`
    : "Invoice handoff";

  if (lineAmount > 0 && packQuantity > 0 && itemsPerPack > 0) {
    return {
      kind: "invoice",
      title,
      detail: `${formatCurrency(lineAmount)} / (${packQuantity} packs x ${itemsPerPack} items) = ${formatCurrency(landingCost)} per item`,
    };
  }

  return {
    kind: "invoice",
    title,
    detail: `Prefilled with ${formatCurrency(landingCost)} per-unit landing cost from invoice processing.`,
  };
}

export function MarginEngineWorkbench({
  products,
  compact = false,
  canEditLedger = false,
}: MarginEngineWorkbenchProps) {
  const { success } = useAppNotifications();
  const searchParams = useSearchParams();
  const invoicePrefillApplied = useRef(false);
  const [productRows, setProductRows] = useState(products);
  const initialProduct = productRows[0] ?? null;
  const categories = Array.from(
    new Set(productRows.map((product) => product.category)),
  ).sort((left, right) => left.localeCompare(right));
  const defaultTargetMargin =
    initialProduct?.targetMarginPercent ?? DEFAULT_TARGET_MARGIN;
  const [selectedProductId, setSelectedProductId] = useState(
    initialProduct?.id ?? "",
  );
  const [landingCost, setLandingCost] = useState(
    initialProduct
      ? initialProduct.cost.toFixed(2)
      : DEFAULT_LANDING_COST.toFixed(2),
  );
  const [targetMargin, setTargetMargin] = useState(
    initialProduct
      ? initialProduct.targetMarginPercent.toFixed(1)
      : DEFAULT_TARGET_MARGIN.toFixed(1),
  );
  const [pricingContext, setPricingContext] = useState<PricingContext>(
    initialProduct ? buildProductContext(initialProduct) : buildManualContext(),
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingProduct, setEditingProduct] =
    useState<MarginEngineProduct | null>(null);
  const [editForm, setEditForm] = useState<LedgerEditState | null>(null);
  const [editError, setEditError] = useState("");
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());

  const selectedProduct =
    productRows.find((product) => product.id === selectedProductId) ?? null;
  const calculation = calculateMargin(
    parseNumberOrZero(landingCost),
    parseNumberOrZero(targetMargin),
  );

  const filteredProducts = [...productRows]
    .filter((product) => {
      const matchesCategory =
        categoryFilter === "all" || product.category === categoryFilter;
      const matchesSearch =
        deferredSearch.length === 0 ||
        product.name.toLowerCase().includes(deferredSearch) ||
        product.sku.toLowerCase().includes(deferredSearch) ||
        product.category.toLowerCase().includes(deferredSearch) ||
        product.supplierName.toLowerCase().includes(deferredSearch);

      return matchesCategory && matchesSearch;
    })
    .sort((left, right) => {
      const leftGap = left.currentMarginPercent - left.targetMarginPercent;
      const rightGap = right.currentMarginPercent - right.targetMarginPercent;

      if (leftGap < 0 && rightGap >= 0) {
        return -1;
      }

      if (rightGap < 0 && leftGap >= 0) {
        return 1;
      }

      if (leftGap !== rightGap) {
        return leftGap - rightGap;
      }

      return left.name.localeCompare(right.name);
    });

  useEffect(() => {
    setProductRows(products);
  }, [products]);

  useEffect(() => {
    if (productRows.some((product) => product.id === selectedProductId)) {
      return;
    }

    if (pricingContext.kind === "product") {
      const fallbackProduct = productRows[0] ?? null;

      if (fallbackProduct) {
        setSelectedProductId(fallbackProduct.id);
        setLandingCost(fallbackProduct.cost.toFixed(2));
        setTargetMargin(fallbackProduct.targetMarginPercent.toFixed(1));
        setPricingContext(buildProductContext(fallbackProduct));
        return;
      }

      setSelectedProductId("");
      setPricingContext(buildManualContext());
    }
  }, [pricingContext.kind, productRows, selectedProductId]);

  const averageMargin =
    filteredProducts.length === 0
      ? 0
      : filteredProducts.reduce(
          (sum, product) => sum + product.currentMarginPercent,
          0,
        ) / filteredProducts.length;
  const averageTargetMargin =
    filteredProducts.length === 0
      ? 0
      : filteredProducts.reduce(
          (sum, product) => sum + product.targetMarginPercent,
          0,
        ) / filteredProducts.length;
  const belowTargetCount = filteredProducts.filter(
    (product) => product.currentMarginPercent < product.targetMarginPercent,
  ).length;
  const recommendedUplift = filteredProducts.reduce((sum, product) => {
    const recommendedPrice = calculateMargin(
      product.cost,
      product.targetMarginPercent,
    ).sellingPrice;

    return sum + Math.max(recommendedPrice - product.price, 0);
  }, 0);

  useEffect(() => {
    if (invoicePrefillApplied.current) {
      return;
    }

    const invoiceLandingCost = parsePositiveNumber(
      searchParams.get("landingCost"),
    );

    if (invoiceLandingCost <= 0) {
      return;
    }

    invoicePrefillApplied.current = true;
    setSelectedProductId("");
    setLandingCost(invoiceLandingCost.toFixed(2));
    setTargetMargin(defaultTargetMargin.toFixed(1));
    setPricingContext(buildInvoiceContext(searchParams, invoiceLandingCost));
  }, [defaultTargetMargin, searchParams]);

  const applyProductSelection = (product: MarginEngineProduct) => {
    setSelectedProductId(product.id);
    setLandingCost(product.cost.toFixed(2));
    setTargetMargin(product.targetMarginPercent.toFixed(1));
    setPricingContext(buildProductContext(product));
  };

  const enterManualMode = () => {
    setSelectedProductId("");
    setPricingContext(buildManualContext());
  };

  const handleReset = () => {
    const invoiceLandingCost = parsePositiveNumber(
      searchParams.get("landingCost"),
    );

    if (selectedProduct) {
      applyProductSelection(selectedProduct);
      return;
    }

    if (invoiceLandingCost > 0) {
      setLandingCost(invoiceLandingCost.toFixed(2));
      setTargetMargin(defaultTargetMargin.toFixed(1));
      setPricingContext(buildInvoiceContext(searchParams, invoiceLandingCost));
      return;
    }

    if (initialProduct) {
      applyProductSelection(initialProduct);
      return;
    }

    setLandingCost(DEFAULT_LANDING_COST.toFixed(2));
    setTargetMargin(DEFAULT_TARGET_MARGIN.toFixed(1));
    setPricingContext(buildManualContext());
  };

  const openEditDialog = (product: MarginEngineProduct) => {
    setEditingProduct(product);
    setEditForm(buildLedgerEditState(product));
    setEditError("");
  };

  const closeEditDialog = () => {
    if (isSavingProduct) {
      return;
    }

    setEditingProduct(null);
    setEditForm(null);
    setEditError("");
  };

  const editPreview = editForm
    ? calculateMargin(
        calculatePerItemCost(
          parseNumberOrZero(editForm.cost),
          editingProduct?.quantity ?? 0,
        ),
        parseNumberOrZero(editForm.targetMarginPercent),
      )
    : null;

  const handleSaveProduct = async () => {
    if (!editingProduct || !editForm) {
      return;
    }

    setEditError("");

    const cost = Number(editForm.cost);
    const price = Number(editForm.price);
    const nextTargetMargin = Number(editForm.targetMarginPercent);

    if (!Number.isFinite(cost) || cost < 0) {
      setEditError("Cost must be a valid non-negative number.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setEditError("Price must be a valid non-negative number.");
      return;
    }

    if (
      !Number.isFinite(nextTargetMargin) ||
      nextTargetMargin < 0 ||
      nextTargetMargin > 95
    ) {
      setEditError("Target margin must be between 0 and 95 percent.");
      return;
    }

    setIsSavingProduct(true);

    try {
      const response = await fetch("/api/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editForm.id,
          cost,
          price,
          targetMarginPercent: nextTargetMargin,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        id?: string;
        name?: string;
        cost?: number;
        price?: number;
        targetMarginPercent?: number;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update product");
      }

      const updatedProduct: MarginEngineProduct = {
        ...editingProduct,
        ledgerCost: payload?.cost ?? cost,
        cost: calculatePerItemCost(
          payload?.cost ?? cost,
          editingProduct.quantity,
        ),
        price: payload?.price ?? price,
        targetMarginPercent: payload?.targetMarginPercent ?? nextTargetMargin,
        currentMarginPercent: calculateCurrentMarginPercent(
          calculatePerItemCost(payload?.cost ?? cost, editingProduct.quantity),
          payload?.price ?? price,
        ),
      };

      setProductRows((current) =>
        current.map((product) =>
          product.id === updatedProduct.id ? updatedProduct : product,
        ),
      );

      if (selectedProductId === updatedProduct.id) {
        applyProductSelection(updatedProduct);
      }

      success(`${payload?.name ?? updatedProduct.name} updated successfully.`);
      setEditingProduct(null);
      setEditForm(null);
      setEditError("");
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Failed to update product.",
      );
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleEditFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSaveProduct();
  };

  const currentVsRecommendedGap = selectedProduct
    ? calculation.sellingPrice - selectedProduct.price
    : 0;
  const selectionTone =
    pricingContext.kind === "invoice"
      ? "blue"
      : pricingContext.kind === "product"
        ? "green"
        : "slate";
  const sectionClassName = compact ? "rounded-[20px]" : "rounded-[28px]";
  const sectionContentClassName = compact ? "p-4" : undefined;

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {compact ? null : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Visible products"
            value={`${filteredProducts.length}`}
            change={`${productRows.length} total`}
            detail="catalog items in this workbench"
            tone="blue"
          />
          <StatCard
            label="Average margin"
            value={`${averageMargin.toFixed(1)}%`}
            change={`Target ${averageTargetMargin.toFixed(1)}%`}
            detail="current gross margin across filtered products"
            tone={averageMargin >= averageTargetMargin ? "green" : "amber"}
          />
          <StatCard
            label="Below target"
            value={`${belowTargetCount}`}
            change="Needs repricing"
            detail="products under their target margin"
            tone={belowTargetCount === 0 ? "green" : "red"}
          />
          <StatCard
            label="Recommended uplift"
            value={formatCurrency(recommendedUplift)}
            change="Across list"
            detail="aggregate positive price gap to hit target"
            tone="violet"
          />
        </div>
      )}

      <div className={compact ? "grid gap-4" : "grid gap-6"}>
        <SectionCard
          title="Calculator"
          description="Price a product or invoice-derived landing cost against a target margin"
          className={sectionClassName}
          contentClassName={sectionContentClassName}
          action={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={enterManualMode}
                className="w-full rounded-full border border-stroke px-3 py-2 text-xs font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2 sm:w-auto"
              >
                Manual mode
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 sm:w-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          }
        >
          <div
            className={`rounded-[22px] border border-stroke bg-gray-2/60 ${compact ? "p-3.5" : "p-4"} dark:border-dark-3 dark:bg-dark-2/60`}
          >
            <div className="flex items-center gap-2">
              <StatusBadge tone={selectionTone}>
                {pricingContext.kind === "invoice"
                  ? "Invoice"
                  : pricingContext.kind === "product"
                    ? "Product"
                    : "Manual"}
              </StatusBadge>
            </div>
            <div className="mt-3 text-lg font-semibold text-dark dark:text-white">
              {pricingContext.title}
            </div>
            <div className="mt-1 text-sm text-dark-5 dark:text-dark-6">
              {pricingContext.detail}
            </div>
          </div>

          <div
            className={
              compact
                ? "mt-4 grid gap-4 md:grid-cols-2"
                : "mt-5 grid gap-4 md:grid-cols-2"
            }
          >
            <div>
              <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                Landing cost
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-3 text-sm text-dark-5 dark:text-dark-6">
                  $
                </span>
                <CurrencyInput
                  value={landingCost}
                  onValueChange={(decimalValue) => setLandingCost(decimalValue)}
                  showSymbol={false}
                  className={`${INPUT_CLASSNAME} pl-8`}
                  placeholder="0.00"
                />
              </div>
              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                Cost basis per unit before retail markup.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                Target margin
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={targetMargin}
                  onChange={(event) => setTargetMargin(event.target.value)}
                  step="0.1"
                  min="0"
                  max="95"
                  className={`${INPUT_CLASSNAME} pr-8`}
                  placeholder="0.0"
                />
                <span className="pointer-events-none absolute right-4 top-3 text-sm text-dark-5 dark:text-dark-6">
                  %
                </span>
              </div>
              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                Capped at 95% to avoid invalid sell-price outputs.
              </p>
            </div>
          </div>
        </SectionCard>

        <div className="grid gap-6">
          <SectionCard
            title="Pricing outcome"
            description="Recommended selling price from the active calculator inputs"
            className={sectionClassName}
            contentClassName={sectionContentClassName}
          >
            <div
              className={`rounded-[24px] bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-700 ${compact ? "p-5" : "p-6"} text-white shadow-lg`}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-white/80">
                <Calculator className="h-4 w-4" />
                Recommended selling price
              </div>
              <div
                className={
                  compact
                    ? "mt-3 text-4xl font-bold"
                    : "mt-3 text-5xl font-bold"
                }
              >
                {formatCurrency(calculation.sellingPrice)}
              </div>
              <div
                className={
                  compact
                    ? "mt-4 grid gap-3 sm:grid-cols-3"
                    : "mt-5 grid gap-3 sm:grid-cols-3"
                }
              >
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/70">
                    Margin
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {calculation.grossMarginPercent.toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/70">
                    Profit / unit
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {formatCurrency(calculation.profitPerUnit)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/70">
                    Markup
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {calculation.markup.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>

            <div
              className={
                compact
                  ? "mt-4 grid gap-4 md:grid-cols-2"
                  : "mt-5 grid gap-4 md:grid-cols-2"
              }
            >
              <div className="rounded-[22px] border border-stroke p-4 dark:border-dark-3">
                <div className="text-sm font-medium text-dark dark:text-white">
                  Break-even price
                </div>
                <div className="mt-2 text-2xl font-semibold text-dark dark:text-white">
                  {formatCurrency(calculation.breakEvenPrice)}
                </div>
                <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  Floor price before margin contribution.
                </div>
              </div>

              <div className="rounded-[22px] border border-stroke p-4 dark:border-dark-3">
                <div className="text-sm font-medium text-dark dark:text-white">
                  Current product comparison
                </div>
                {selectedProduct ? (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-sm text-dark-5 dark:text-dark-6">
                        Current shelf price
                      </div>
                      <div className="font-semibold text-dark dark:text-white">
                        {formatCurrency(selectedProduct.price)}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="text-sm text-dark-5 dark:text-dark-6">
                        Price delta
                      </div>
                      <div
                        className={`font-semibold ${
                          currentVsRecommendedGap >= 0
                            ? "text-emerald-600"
                            : "text-red"
                        }`}
                      >
                        {formatSignedCurrency(currentVsRecommendedGap)}
                      </div>
                    </div>
                    <div className="mt-3">
                      <StatusBadge
                        tone={marginTone(
                          selectedProduct.currentMarginPercent,
                          selectedProduct.targetMarginPercent,
                        )}
                      >
                        {marginLabel(
                          selectedProduct.currentMarginPercent,
                          selectedProduct.targetMarginPercent,
                        )}
                      </StatusBadge>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                    Pick a product from the ledger to compare the recommendation
                    against its current shelf price.
                  </div>
                )}
              </div>
            </div>

            <div
              className={
                compact
                  ? "mt-4 rounded-[22px] border border-stroke p-4 dark:border-dark-3"
                  : "mt-5 rounded-[22px] border border-stroke p-4 dark:border-dark-3"
              }
            >
              <div className="flex items-center gap-2 text-sm font-medium text-dark dark:text-white">
                <Target className="h-4 w-4" />
                Margin ladder
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                {[20, 30, 40, 50].map((scenarioMargin) => {
                  const scenario = calculateMargin(
                    calculation.landingCost,
                    scenarioMargin,
                  );

                  return (
                    <div
                      key={scenarioMargin}
                      className="rounded-2xl bg-gray-2/70 p-4 dark:bg-dark-2/70"
                    >
                      <div className="text-xs uppercase tracking-[0.16em] text-dark-5 dark:text-dark-6">
                        {scenarioMargin}% margin
                      </div>
                      <div className="mt-2 text-lg font-semibold text-dark dark:text-white">
                        {formatCurrency(scenario.sellingPrice)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Product margin ledger"
        description="All catalog products with current margin health and calculator shortcuts"
        className={sectionClassName}
        contentClassName={sectionContentClassName}
      >
        <div
          className={
            compact
              ? "mb-4 grid gap-3 lg:grid-cols-[1.2fr_220px_auto]"
              : "mb-5 grid gap-3 lg:grid-cols-[1.2fr_220px_auto]"
          }
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-dark-5 dark:text-dark-6" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={`${INPUT_CLASSNAME} pl-10`}
              placeholder="Search product, SKU, category, or supplier"
            />
          </label>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className={INPUT_CLASSNAME}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <div className="flex items-center text-sm text-dark-5 dark:text-dark-6">
            Showing {filteredProducts.length} of {productRows.length} products
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-stroke px-5 py-8 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
            No products match the current search or category filter.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Current margin</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Recommended</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => {
                const recommendedPrice = calculateMargin(
                  product.cost,
                  product.targetMarginPercent,
                ).sellingPrice;
                const isSelected =
                  pricingContext.kind === "product" &&
                  selectedProductId === product.id;

                return (
                  <TableRow
                    key={product.id}
                    className={
                      isSelected ? "bg-primary/5 dark:bg-primary/10" : undefined
                    }
                  >
                    <TableCell>
                      <div className="font-semibold text-dark dark:text-white">
                        {product.name}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {product.sku} · {product.category} · {product.location}
                      </div>
                    </TableCell>
                    <TableCell>{product.supplierName}</TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {product.quantity} units
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge
                          tone={stockTone(
                            product.quantity,
                            product.reorderLevel,
                          )}
                        >
                          {stockLabel(product.quantity, product.reorderLevel)}
                        </StatusBadge>
                        <span className="text-xs text-dark-5 dark:text-dark-6">
                          Reorder {product.reorderLevel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      <div>{formatCurrency(product.cost)}</div>
                      <div className="mt-1 text-xs font-normal text-dark-5 dark:text-dark-6">
                        {formatCostBasisSummary(
                          product.ledgerCost,
                          product.quantity,
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                      {formatCurrency(product.price)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold text-dark dark:text-white">
                        {product.currentMarginPercent.toFixed(1)}%
                      </div>
                      <div className="mt-1">
                        <StatusBadge
                          tone={marginTone(
                            product.currentMarginPercent,
                            product.targetMarginPercent,
                          )}
                        >
                          {marginLabel(
                            product.currentMarginPercent,
                            product.targetMarginPercent,
                          )}
                        </StatusBadge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {product.targetMarginPercent.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold text-dark dark:text-white">
                        {formatCurrency(recommendedPrice)}
                      </div>
                      <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                        {formatSignedCurrency(recommendedPrice - product.price)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => applyProductSelection(product)}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
                            isSelected
                              ? "bg-green-500/15 text-green-600 ring-1 ring-green-500/30 dark:bg-green-500/20 dark:text-green-400"
                              : "text-green-600 hover:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/10"
                          }`}
                          title={
                            isSelected
                              ? "Loaded into calculator"
                              : "Load into calculator"
                          }
                          aria-label={
                            isSelected
                              ? `Loaded ${product.name} into calculator`
                              : `Load ${product.name} into calculator`
                          }
                        >
                          <DollarSign className="h-4 w-4" />
                        </button>
                        {canEditLedger ? (
                          <button
                            type="button"
                            onClick={() => openEditDialog(product)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-indigo-500 transition hover:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
                            title={`Edit ${product.name}`}
                            aria-label={`Edit ${product.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {editingProduct && editForm ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Edit ${editingProduct.name}`}
              className="modal-card-scroll max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark"
            >
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-5 py-4 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Edit Product Margin
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {editingProduct.name} · {editingProduct.sku}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditDialog}
                  disabled={isSavingProduct}
                  className="app-icon-button"
                  aria-label="Close product margin editor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form
                onSubmit={handleEditFormSubmit}
                className="flex flex-1 flex-col overflow-hidden"
              >
                <div className="space-y-5 overflow-y-auto p-5">
                  {editError ? (
                    <div className="rounded-[20px] border border-red/15 bg-red/5 px-4 py-3 text-sm text-red">
                      {editError}
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Total cost
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-3 text-sm text-dark-5 dark:text-dark-6">
                          $
                        </span>
                        <CurrencyInput
                          required
                          value={editForm.cost}
                          onValueChange={(decimalValue) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, cost: decimalValue }
                                : current,
                            )
                          }
                          disabled={isSavingProduct}
                          showSymbol={false}
                          className={`${INPUT_CLASSNAME} pl-8`}
                        />
                      </div>
                      <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                        {editingProduct.quantity > 0
                          ? `Margin uses ${formatCurrency(
                              editPreview?.landingCost ?? 0,
                            )} per item across ${editingProduct.quantity} units.`
                          : "No units are on hand, so margin uses the stored cost directly."}
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Price
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-3 text-sm text-dark-5 dark:text-dark-6">
                          $
                        </span>
                        <CurrencyInput
                          required
                          value={editForm.price}
                          onValueChange={(decimalValue) =>
                            setEditForm((current) =>
                              current
                                ? { ...current, price: decimalValue }
                                : current,
                            )
                          }
                          disabled={isSavingProduct}
                          showSymbol={false}
                          className={`${INPUT_CLASSNAME} pl-8`}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Target margin
                      </label>
                      <div className="relative">
                        <input
                          required
                          type="number"
                          value={editForm.targetMarginPercent}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    targetMarginPercent: event.target.value,
                                  }
                                : current,
                            )
                          }
                          min="0"
                          max="95"
                          step="0.1"
                          disabled={isSavingProduct}
                          className={`${INPUT_CLASSNAME} pr-8`}
                        />
                        <span className="pointer-events-none absolute right-4 top-3 text-sm text-dark-5 dark:text-dark-6">
                          %
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-[22px] border border-stroke p-4 dark:border-dark-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-dark-5 dark:text-dark-6">
                        Current margin
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-dark dark:text-white">
                        {calculateCurrentMarginPercent(
                          calculatePerItemCost(
                            parseNumberOrZero(editForm.cost),
                            editingProduct.quantity,
                          ),
                          parseNumberOrZero(editForm.price),
                        ).toFixed(1)}
                        %
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-stroke p-4 dark:border-dark-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-dark-5 dark:text-dark-6">
                        Recommended price
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-dark dark:text-white">
                        {formatCurrency(editPreview?.sellingPrice ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-stroke p-4 dark:border-dark-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-dark-5 dark:text-dark-6">
                        Price delta
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-dark dark:text-white">
                        {formatSignedCurrency(
                          (editPreview?.sellingPrice ?? 0) -
                            parseNumberOrZero(editForm.price),
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-primary/15 bg-primary/5 p-4 text-sm text-dark-5 dark:text-dark-6">
                    Saving here updates the store-scoped product ledger. Margin
                    analysis and calculator comparisons will use the new values
                    immediately.
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-stroke px-5 py-4 dark:border-dark-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeEditDialog}
                    disabled={isSavingProduct}
                    className="inline-flex items-center justify-center rounded-full border border-stroke px-4 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProduct}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
                  >
                    <Save className="h-4 w-4" />
                    {isSavingProduct ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
