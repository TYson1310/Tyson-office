import { NextRequest, NextResponse } from "next/server";
import {
  FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE,
  isMissingFinancialAccountabilityMigration,
  loadFinancialAccountabilityStatus,
} from "@/lib/accountability/financial-controls";
import { appendAuditEvent } from "@/lib/audit/events";
import { requireProductManagerAccess } from "@/lib/products/api";

export const runtime = "nodejs";

type ProductAccess = Exclude<
  Awaited<ReturnType<typeof requireProductManagerAccess>>,
  { error: NextResponse }
>;

type ProductMutationBody = {
  id?: unknown;
  name?: unknown;
  sku?: unknown;
  category?: unknown;
  supplierId?: unknown;
  location?: unknown;
  quantity?: unknown;
  quantityAdjustmentReason?: unknown;
  quantityAdjustmentReference?: unknown;
  itemsPerPack?: unknown;
  reorderLevel?: unknown;
  dailyVelocity?: unknown;
  cost?: unknown;
  price?: unknown;
  targetMarginPercent?: unknown;
};

type ProductRecord = {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplier_id: string | null;
  location: string | null;
  quantity: number;
  reorder_level: number;
  daily_velocity: number | string;
  cost: number | string;
  price: number | string;
  target_margin_percent: number | string;
  items_per_pack: number;
};

function normalizeProductId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalEvidence(value: unknown) {
  return normalizeOptionalString(value);
}

function normalizeOptionalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWholeNumber(value: unknown, minimum?: number) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(normalized)) {
    return null;
  }

  if (minimum !== undefined && normalized < minimum) {
    return null;
  }

  return normalized;
}

function normalizeNonNegativeNumber(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }

  return Math.round(normalized * 100) / 100;
}

function normalizeTargetMargin(value: unknown) {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 95) {
    return null;
  }

  return Math.round(normalized * 100) / 100;
}

async function validateSupplierId(
  supplierId: string | null,
  access: ProductAccess,
) {
  if (!supplierId) {
    return { supplierId };
  }

  const { data, error } = await access.supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<{ id: string }>();

  if (error) {
    return {
      error: NextResponse.json(
        { error: error.message ?? "Failed to validate supplier" },
        { status: 500 },
      ),
    };
  }

  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Selected supplier was not found for this store" },
        { status: 400 },
      ),
    };
  }

  return { supplierId };
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireProductManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as ProductMutationBody;
    const id = normalizeProductId(body.id);

    if (!id) {
      return NextResponse.json(
        { error: "Product id is required" },
        { status: 400 },
      );
    }

    const updates: Record<string, string | number | null> = {};
    const quantityAdjustmentReason = normalizeOptionalEvidence(
      body.quantityAdjustmentReason,
    );
    const quantityAdjustmentReference = normalizeOptionalEvidence(
      body.quantityAdjustmentReference,
    );

    if (body.name !== undefined) {
      const name = normalizeRequiredString(body.name);

      if (!name) {
        return NextResponse.json(
          { error: "Product name is required" },
          { status: 400 },
        );
      }

      updates.name = name;
    }

    if (body.sku !== undefined) {
      const sku = normalizeRequiredString(body.sku);

      if (!sku) {
        return NextResponse.json({ error: "SKU is required" }, { status: 400 });
      }

      updates.sku = sku;
    }

    if (body.category !== undefined) {
      const category = normalizeRequiredString(body.category);

      if (!category) {
        return NextResponse.json(
          { error: "Category is required" },
          { status: 400 },
        );
      }

      updates.category = category;
    }

    if (body.supplierId !== undefined) {
      const supplierId = normalizeOptionalId(body.supplierId);
      const validation = await validateSupplierId(supplierId, access);

      if ("error" in validation) {
        return validation.error;
      }

      updates.supplier_id = validation.supplierId;
    }

    if (body.location !== undefined) {
      updates.location = normalizeOptionalString(body.location);
    }

    if (body.quantity !== undefined) {
      const quantity = normalizeWholeNumber(body.quantity);

      if (quantity === null) {
        return NextResponse.json(
          { error: "Quantity must be a valid whole number" },
          { status: 400 },
        );
      }

      updates.quantity = quantity;
    }

    if (body.itemsPerPack !== undefined) {
      const itemsPerPack = normalizeWholeNumber(body.itemsPerPack, 1);

      if (itemsPerPack === null) {
        return NextResponse.json(
          {
            error:
              "Items in pack must be a valid whole number greater than zero",
          },
          { status: 400 },
        );
      }

      updates.items_per_pack = itemsPerPack;
    }

    if (body.reorderLevel !== undefined) {
      const reorderLevel = normalizeWholeNumber(body.reorderLevel, 0);

      if (reorderLevel === null) {
        return NextResponse.json(
          { error: "Reorder level must be a valid whole number" },
          { status: 400 },
        );
      }

      updates.reorder_level = reorderLevel;
    }

    if (body.dailyVelocity !== undefined) {
      const dailyVelocity = normalizeNonNegativeNumber(body.dailyVelocity);

      if (dailyVelocity === null) {
        return NextResponse.json(
          { error: "Daily velocity must be a valid non-negative number" },
          { status: 400 },
        );
      }

      updates.daily_velocity = dailyVelocity;
    }

    if (body.cost !== undefined) {
      const cost = normalizeNonNegativeNumber(body.cost);

      if (cost === null) {
        return NextResponse.json(
          { error: "Cost must be a valid non-negative number" },
          { status: 400 },
        );
      }

      updates.cost = cost;
    }

    if (body.price !== undefined) {
      const price = normalizeNonNegativeNumber(body.price);

      if (price === null) {
        return NextResponse.json(
          { error: "Price must be a valid non-negative number" },
          { status: 400 },
        );
      }

      updates.price = price;
    }

    if (body.targetMarginPercent !== undefined) {
      const targetMarginPercent = normalizeTargetMargin(
        body.targetMarginPercent,
      );

      if (targetMarginPercent === null) {
        return NextResponse.json(
          { error: "Target margin must be between 0 and 95 percent" },
          { status: 400 },
        );
      }

      updates.target_margin_percent = targetMarginPercent;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid product fields were provided" },
        { status: 400 },
      );
    }

    const { data: currentProduct, error: currentProductError } =
      await access.supabase
        .from("products")
        .select(
          "id,name,sku,category,supplier_id,location,quantity,items_per_pack,reorder_level,daily_velocity,cost,price,target_margin_percent",
        )
        .eq("id", id)
        .eq("store_key", access.activeStoreKey)
        .maybeSingle<ProductRecord>();

    if (currentProductError) {
      return NextResponse.json(
        {
          error:
            currentProductError.message ?? "Failed to load current product",
        },
        { status: 500 },
      );
    }

    if (!currentProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const quantityChanged =
      updates.quantity !== undefined &&
      Number(updates.quantity) !== Number(currentProduct.quantity);

    if (quantityChanged && !quantityAdjustmentReason) {
      return NextResponse.json(
        { error: "Reason is required when changing quantity on hand" },
        { status: 400 },
      );
    }

    if (quantityChanged) {
      const accountabilityStatus = await loadFinancialAccountabilityStatus(
        access.supabase,
        access.activeStoreKey,
      );

      if (!accountabilityStatus.available) {
        return NextResponse.json(
          {
            error:
              accountabilityStatus.warnings[0] ??
              FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE,
          },
          { status: 503 },
        );
      }
    }

    const { data, error } = await access.supabase
      .from("products")
      .update(updates)
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .select(
        "id,name,sku,category,supplier_id,location,quantity,items_per_pack,reorder_level,daily_velocity,cost,price,target_margin_percent",
      )
      .maybeSingle<ProductRecord>();

    if (error) {
      const isUniqueViolation = error.code === "23505";

      return NextResponse.json(
        {
          error: isUniqueViolation
            ? "A product with that SKU already exists"
            : (error.message ?? "Failed to update product"),
        },
        { status: isUniqueViolation ? 409 : 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (quantityChanged) {
      const quantityBefore = Number(currentProduct.quantity);
      const quantityAfter = Number(data.quantity);
      const quantityDelta = quantityAfter - quantityBefore;
      const unitCost = Number(data.cost ?? 0);
      const requiredQuantityAdjustmentReason = quantityAdjustmentReason ?? "";
      const movementNotes = quantityAdjustmentReference
        ? `${requiredQuantityAdjustmentReason} (Ref ${quantityAdjustmentReference})`
        : requiredQuantityAdjustmentReason;
      const { error: movementError } = await access.supabase
        .from("inventory_movements")
        .insert({
          created_by: access.currentUser.id,
          movement_type: "manual_adjustment",
          notes: movementNotes,
          product_id: data.id,
          product_name: data.name,
          product_sku: data.sku,
          quantity_after: quantityAfter,
          quantity_before: quantityBefore,
          quantity_delta: quantityDelta,
          store_key: access.activeStoreKey,
          total_amount: Math.round(quantityDelta * unitCost * 100) / 100,
          unit_cost: unitCost,
        });

      if (movementError) {
        if (isMissingFinancialAccountabilityMigration(movementError)) {
          await access.supabase
            .from("products")
            .update({ quantity: currentProduct.quantity })
            .eq("id", id)
            .eq("store_key", access.activeStoreKey);

          return NextResponse.json(
            { error: FINANCIAL_ACCOUNTABILITY_MIGRATION_MESSAGE },
            { status: 503 },
          );
        }

        await access.supabase
          .from("products")
          .update({ quantity: currentProduct.quantity })
          .eq("id", id)
          .eq("store_key", access.activeStoreKey);

        return NextResponse.json(
          {
            error:
              movementError.message ??
              "Failed to write inventory movement history",
          },
          { status: 500 },
        );
      }
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "product",
      entityId: data.id,
      action: "product.updated",
      summary: `Product updated: ${data.name}`,
      actorId: access.currentUser.id,
      actorName:
        access.currentUser.user_metadata?.full_name ??
        access.currentUser.email ??
        "User",
      actorRole: access.currentUserRole,
      metadata: {
        changedFields: Object.keys(updates),
        nextValues: Object.fromEntries(
          Object.keys(updates).map((field) => [
            field,
            (data as unknown as Record<string, unknown>)[field],
          ]),
        ),
        previousValues: Object.fromEntries(
          Object.keys(updates).map((field) => [
            field,
            (currentProduct as unknown as Record<string, unknown>)[field],
          ]),
        ),
        quantityAdjustmentReason: quantityChanged
          ? quantityAdjustmentReason
          : null,
        quantityAdjustmentReference: quantityChanged
          ? quantityAdjustmentReference
          : null,
        sku: data.sku,
      },
    });

    return NextResponse.json({
      id: data.id,
      name: data.name,
      sku: data.sku,
      category: data.category,
      supplierId: data.supplier_id,
      location: data.location,
      quantity: data.quantity,
      itemsPerPack: data.items_per_pack,
      reorderLevel: data.reorder_level,
      dailyVelocity: Number(data.daily_velocity),
      cost: Number(data.cost),
      price: Number(data.price),
      targetMarginPercent: Number(data.target_margin_percent),
    });
  } catch (error) {
    console.error("Products PATCH error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update product",
      },
      { status: 500 },
    );
  }
}
