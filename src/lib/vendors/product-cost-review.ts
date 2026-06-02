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

export type ProductCostReviewRow = {
  productKey: string;
  productId?: string;
  productName: string;
  productSku: string;
  supplierName?: string;
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
  increaseCount: number;
  comparedProductCount: number;
  receiptProductCount: number;
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

    if (options?.supplierId && product?.supplierId !== options.supplierId) {
      return;
    }

    groupedMovements.set(key, [...(groupedMovements.get(key) ?? []), movement]);
  });

  const minIncreasePercent =
    options?.minIncreasePercent ?? INVOICE_COST_INCREASE_WARNING_PERCENT;
  const comparedProductCount = Array.from(groupedMovements.values()).filter(
    (movements) => movements.length >= 2,
  ).length;
  const allRows = Array.from(groupedMovements.entries())
    .map<ProductCostReviewRow | null>(([productKey, movements]) => {
      const latest = movements[0];
      const previous = movements[1];

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

      const product = productByKey.get(productKey);
      const supplierName = product?.supplierId
        ? supplierById.get(product.supplierId)?.name
        : undefined;
      const row: ProductCostReviewRow = {
        productKey,
        productName: product?.name ?? latest.productName,
        productSku: product?.sku ?? latest.productSku,
        previousCost: previous.unitCost,
        latestCost: latest.unitCost,
        increaseAmount,
        increasePercent,
        latestReceiptDate: latest.createdAt,
      };

      const productId = product?.id ?? latest.productId;
      const latestReceiptReference = getReceiptReference(latest);
      const previousReceiptReference = getReceiptReference(previous);

      if (productId) {
        row.productId = productId;
      }

      if (supplierName) {
        row.supplierName = supplierName;
      }

      if (latestReceiptReference) {
        row.latestReceiptReference = latestReceiptReference;
      }

      if (previousReceiptReference) {
        row.previousReceiptReference = previousReceiptReference;
      }

      return row;
    })
    .filter((row): row is ProductCostReviewRow => Boolean(row))
    .sort(
      (left, right) =>
        right.latestReceiptDate.getTime() - left.latestReceiptDate.getTime(),
    );
  const rows = allRows.slice(0, options?.limit ?? 8);

  return {
    rows,
    increaseCount: allRows.length,
    comparedProductCount,
    receiptProductCount: groupedMovements.size,
  };
}
