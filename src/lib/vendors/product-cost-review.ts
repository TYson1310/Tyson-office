import type {
  OperationsDataset,
  OperationsInventoryMovement,
} from "@/lib/erp/operations";
import { INVOICE_COST_INCREASE_WARNING_PERCENT } from "@/lib/vendors/invoice-processing";

export type ProductLatestReceiptCost = {
  unitCost: number;
  receiptDate: Date;
  receiptReference?: string;
};

export type ProductCostComparisonType = "cross-vendor" | "same-vendor";

export type ProductCostReviewRow = {
  comparisonType: ProductCostComparisonType;
  productKey: string;
  productId?: string;
  productName: string;
  productSku: string;
  reviewKey: string;
  supplierName?: string;
  latestSupplierId?: string;
  latestSupplierName?: string;
  previousSupplierId?: string;
  previousSupplierName?: string;
  previousCost: number;
  latestCost: number;
  increaseAmount: number;
  increasePercent: number;
  latestReceiptDate: Date;
  latestReceiptReference?: string;
  previousReceiptReference?: string;
};

export type ProductCostReviewSummary = {
  rows: ProductCostReviewRow[];
  crossVendorDifferenceCount: number;
  crossVendorRows: ProductCostReviewRow[];
  increaseCount: number;
  comparedProductCount: number;
  receiptProductCount: number;
  sameVendorIncreaseCount: number;
  sameVendorRows: ProductCostReviewRow[];
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeSkuKey(value?: string | null) {
  return (value ?? "").trim().toUpperCase();
}

function buildReceiptProductKey(
  movement: Pick<OperationsInventoryMovement, "productId" | "productSku">,
) {
  if (movement.productId) {
    return `product:${movement.productId}`;
  }

  const skuKey = normalizeSkuKey(movement.productSku);
  return skuKey ? `sku:${skuKey}` : "";
}

export function getProductReceiptLookupKeys(product: {
  id: string;
  sku?: string | null;
}) {
  const keys = [`product:${product.id}`];
  const skuKey = normalizeSkuKey(product.sku);

  if (skuKey) {
    keys.push(`sku:${skuKey}`);
  }

  return keys;
}

function getReceiptReference(movement: OperationsInventoryMovement) {
  return movement.adjustmentNumber || undefined;
}

function getMovementVendorKey(movement: OperationsInventoryMovement) {
  if (movement.vendorId) {
    return `vendor:${movement.vendorId}`;
  }

  const normalizedVendorName = movement.vendorName?.trim().toUpperCase();

  if (normalizedVendorName) {
    return `vendor-name:${normalizedVendorName}`;
  }

  return "";
}

function getMovementVendorName(movement: OperationsInventoryMovement) {
  return movement.vendorName ?? "Unknown vendor";
}

function buildProductCostReviewRow(input: {
  comparisonType: ProductCostComparisonType;
  latest: OperationsInventoryMovement;
  product?: OperationsDataset["products"][number];
  productKey: string;
  previous: OperationsInventoryMovement;
  supplierName?: string;
}) {
  const increaseAmount = roundMoney(input.latest.unitCost - input.previous.unitCost);
  const increasePercent = roundMoney(
    (increaseAmount / input.previous.unitCost) * 100,
  );
  const latestReceiptReference = getReceiptReference(input.latest);
  const previousReceiptReference = getReceiptReference(input.previous);
  const latestSupplierName = getMovementVendorName(input.latest);
  const previousSupplierName = getMovementVendorName(input.previous);
  const latestVendorKey = getMovementVendorKey(input.latest) || "unknown";
  const previousVendorKey = getMovementVendorKey(input.previous) || "unknown";
  const row: ProductCostReviewRow = {
    comparisonType: input.comparisonType,
    productKey: input.productKey,
    productName: input.product?.name ?? input.latest.productName,
    productSku: input.product?.sku ?? input.latest.productSku,
    reviewKey: `${input.comparisonType}:${input.productKey}:${latestVendorKey}:${previousVendorKey}`,
    previousCost: input.previous.unitCost,
    latestCost: input.latest.unitCost,
    increaseAmount,
    increasePercent,
    latestReceiptDate: input.latest.createdAt,
    supplierName: latestSupplierName,
    latestSupplierName,
    previousSupplierName,
  };
  const productId = input.product?.id ?? input.latest.productId;

  if (productId) {
    row.productId = productId;
  }

  if (input.latest.vendorId) {
    row.latestSupplierId = input.latest.vendorId;
  }

  if (input.previous.vendorId) {
    row.previousSupplierId = input.previous.vendorId;
  }

  if (input.supplierName && !row.supplierName) {
    row.supplierName = input.supplierName;
  }

  if (latestReceiptReference) {
    row.latestReceiptReference = latestReceiptReference;
  }

  if (previousReceiptReference) {
    row.previousReceiptReference = previousReceiptReference;
  }

  return row;
}

function getReceiptMovements(
  dataset: Pick<OperationsDataset, "inventoryMovements">,
) {
  return dataset.inventoryMovements
    .filter(
      (movement) =>
        movement.movementType === "vendor_invoice_receipt" &&
        movement.unitCost > 0,
    )
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
}

export function buildLatestReceiptCostLookup(
  dataset: Pick<OperationsDataset, "inventoryMovements">,
) {
  const lookup = new Map<string, ProductLatestReceiptCost>();

  getReceiptMovements(dataset).forEach((movement) => {
    const keys = [
      buildReceiptProductKey(movement),
      movement.productSku ? `sku:${normalizeSkuKey(movement.productSku)}` : "",
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, {
          unitCost: movement.unitCost,
          receiptDate: movement.createdAt,
          receiptReference: getReceiptReference(movement),
        });
      }
    });
  });

  return lookup;
}

export function buildProductCostReviewSummary(
  dataset: Pick<
    OperationsDataset,
    "inventoryMovements" | "products" | "suppliers"
  >,
  options?: {
    supplierId?: string | null;
    minIncreasePercent?: number;
    limit?: number;
  },
): ProductCostReviewSummary {
  const productByKey = new Map<string, OperationsDataset["products"][number]>();
  const supplierById = new Map(
    dataset.suppliers.map((supplier) => [supplier.id, supplier]),
  );

  dataset.products.forEach((product) => {
    getProductReceiptLookupKeys(product).forEach((key) => {
      productByKey.set(key, product);
    });
  });

  const groupedMovements = new Map<string, OperationsInventoryMovement[]>();

  getReceiptMovements(dataset).forEach((movement) => {
    const key = buildReceiptProductKey(movement);

    if (!key) {
      return;
    }

    const product = productByKey.get(key);

    if (
      options?.supplierId &&
      product?.supplierId !== options.supplierId &&
      movement.vendorId !== options.supplierId
    ) {
      return;
    }

    groupedMovements.set(key, [...(groupedMovements.get(key) ?? []), movement]);
  });

  const minIncreasePercent =
    options?.minIncreasePercent ?? INVOICE_COST_INCREASE_WARNING_PERCENT;
  const comparedProductCount = Array.from(groupedMovements.values()).filter(
    (movements) => movements.length >= 2,
  ).length;
  const sameVendorRows = Array.from(groupedMovements.entries()).flatMap(
    ([productKey, movements]) => {
      const product = productByKey.get(productKey);
      const sameVendorGroups = new Map<string, OperationsInventoryMovement[]>();

      movements.forEach((movement) => {
        const vendorKey = getMovementVendorKey(movement);

        if (!vendorKey) {
          return;
        }

        sameVendorGroups.set(vendorKey, [
          ...(sameVendorGroups.get(vendorKey) ?? []),
          movement,
        ]);
      });

      return Array.from(sameVendorGroups.values())
        .map<ProductCostReviewRow | null>((vendorMovements) => {
          const latest = vendorMovements[0];
          const previous = vendorMovements[1];

          if (!latest || !previous || previous.unitCost <= 0) {
            return null;
          }

          const increaseAmount = roundMoney(latest.unitCost - previous.unitCost);
          const increasePercent = roundMoney(
            (increaseAmount / previous.unitCost) * 100,
          );

          if (increaseAmount <= 0 || increasePercent < minIncreasePercent) {
            return null;
          }

          return buildProductCostReviewRow({
            comparisonType: "same-vendor",
            latest,
            previous,
            product,
            productKey,
            supplierName: product?.supplierId
              ? supplierById.get(product.supplierId)?.name
              : undefined,
          });
        })
        .filter((row): row is ProductCostReviewRow => Boolean(row));
    },
  );
  const crossVendorRows = Array.from(groupedMovements.entries())
    .map<ProductCostReviewRow | null>(([productKey, movements]) => {
      const product = productByKey.get(productKey);
      const latestByVendor = new Map<string, OperationsInventoryMovement>();

      movements.forEach((movement) => {
        const vendorKey = getMovementVendorKey(movement);

        if (!vendorKey || latestByVendor.has(vendorKey)) {
          return;
        }

        latestByVendor.set(vendorKey, movement);
      });

      const vendorLatestReceipts = Array.from(latestByVendor.values());

      if (vendorLatestReceipts.length < 2) {
        return null;
      }

      const sortedByCost = vendorLatestReceipts.sort(
        (left, right) => right.unitCost - left.unitCost,
      );
      const highest = sortedByCost[0];
      const lowest = sortedByCost[sortedByCost.length - 1];

      if (!highest || !lowest || lowest.unitCost <= 0) {
        return null;
      }

      const increaseAmount = roundMoney(highest.unitCost - lowest.unitCost);
      const increasePercent = roundMoney((increaseAmount / lowest.unitCost) * 100);

      if (increaseAmount <= 0 || increasePercent < minIncreasePercent) {
        return null;
      }

      return buildProductCostReviewRow({
        comparisonType: "cross-vendor",
        latest: highest,
        previous: lowest,
        product,
        productKey,
        supplierName: product?.supplierId
          ? supplierById.get(product.supplierId)?.name
          : undefined,
      });
    })
    .filter((row): row is ProductCostReviewRow => Boolean(row));
  const allRows = [...sameVendorRows, ...crossVendorRows]
    .sort(
      (left, right) =>
        right.increasePercent - left.increasePercent ||
        right.latestReceiptDate.getTime() - left.latestReceiptDate.getTime(),
    );
  const rows = allRows.slice(0, options?.limit ?? 8);

  return {
    rows,
    crossVendorDifferenceCount: crossVendorRows.length,
    crossVendorRows,
    increaseCount: allRows.length,
    comparedProductCount,
    receiptProductCount: groupedMovements.size,
    sameVendorIncreaseCount: sameVendorRows.length,
    sameVendorRows,
  };
}
