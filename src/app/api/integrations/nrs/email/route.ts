import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  buildNrsImportLinePrefix,
  extractNrsReportDate,
  parseNrsInventoryStatusCsv,
  parseNrsCashTenderAmount,
  parseNrsSalesHistoryCsv,
  type NrsInventoryRow,
  type NrsSalesRow,
} from "@/lib/integrations/nrs-email-import";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/env";

export const runtime = "nodejs";

function getImportSecret() {
  return process.env.NRS_EMAIL_IMPORT_SECRET?.trim() ?? "";
}

function isAuthorized(request: NextRequest) {
  const configuredSecret = getImportSecret();
  const providedSecret = request.headers.get("x-nrs-import-secret") ?? "";

  if (!configuredSecret || !providedSecret) {
    return false;
  }

  const expected = Buffer.from(configuredSecret);
  const actual = Buffer.from(providedSecret);

  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

function createAdminClient() {
  return createSupabaseClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function hashFile(contents: string) {
  return createHash("sha256").update(contents).digest("hex");
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function getFiles(formData: FormData) {
  return Array.from(formData.values()).filter(
    (value): value is File => value instanceof File && value.size > 0,
  );
}

function getReportFile(files: File[], fragment: string) {
  return files.find((file) => file.name.toLowerCase().includes(fragment));
}

function buildSalesLineRows(
  sales: NrsSalesRow[],
  importId: string,
  storeKey: string,
  businessDate: string,
  summaryId: string,
) {
  const prefix = buildNrsImportLinePrefix(importId);

  return sales.map((row) => ({
    sales_summary_id: summaryId,
    store_key: storeKey,
    business_date: businessDate,
    amount: row.totalAmount,
    product_type: row.upc ? "nrs_item" : "nrs_department",
    description: `${prefix} ${row.upc ? `UPC ${row.upc} | ` : ""}${row.name} | Qty ${row.totalQty}`,
    reconciled: false,
  }));
}

async function updateInventory(
  supabase: ReturnType<typeof createAdminClient>,
  storeKey: string,
  inventory: NrsInventoryRow[],
) {
  const upcs = inventory.map((row) => row.upc);
  const { data: products, error } = await supabase
    .from("products")
    .select("id,barcode")
    .eq("store_key", storeKey)
    .in("barcode", upcs);

  if (error) {
    throw error;
  }

  const stockByUpc = new Map(
    inventory.map((row) => [row.upc, row.inStock]),
  );
  let updatedCount = 0;

  for (const product of products ?? []) {
    const upc = product.barcode?.trim() ?? "";
    const stock = stockByUpc.get(upc);

    if (stock === undefined) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({ quantity: stock })
      .eq("id", product.id)
      .eq("store_key", storeKey);

    if (updateError) {
      throw updateError;
    }

    updatedCount += 1;
  }

  return updatedCount;
}

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Supabase service-role configuration is required" },
        { status: 503 },
      );
    }

    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const files = getFiles(formData);
    const salesFile = getReportFile(files, "sales_history");
    const inventoryFile = getReportFile(files, "inventory_status");
    const configuredStoreKey =
      process.env.NRS_EMAIL_IMPORT_STORE_KEY?.trim() ?? "";
    const submittedStoreKey = formData.get("storeKey")?.toString().trim() ?? "";

    if (!configuredStoreKey || !salesFile || !inventoryFile) {
      return NextResponse.json(
        {
          error:
            "NRS_EMAIL_IMPORT_STORE_KEY, Sales_History CSV, and Inventory_Status CSV are required",
        },
        { status: configuredStoreKey ? 400 : 503 },
      );
    }

    if (submittedStoreKey && submittedStoreKey !== configuredStoreKey) {
      return NextResponse.json(
        { error: "The submitted store does not match this import mailbox" },
        { status: 400 },
      );
    }

    const storeKey = configuredStoreKey;
    const [salesText, inventoryText] = await Promise.all([
      salesFile.text(),
      inventoryFile.text(),
    ]);
    const businessDate = extractNrsReportDate(salesFile.name);
    const inventoryDate = extractNrsReportDate(inventoryFile.name);

    if (businessDate !== inventoryDate) {
      return NextResponse.json(
        { error: "NRS sales and inventory reports must have the same date" },
        { status: 400 },
      );
    }

    const sales = parseNrsSalesHistoryCsv(salesText);
    const cashTenderTotal = parseNrsCashTenderAmount(salesText);
    const inventory = parseNrsInventoryStatusCsv(inventoryText);
    const salesFileHash = hashFile(salesText);
    const inventoryFileHash = hashFile(inventoryText);
    const supabase = createAdminClient();

    const { data: existingImport, error: existingImportError } = await supabase
      .from("nrs_email_imports")
      .select(
        "id,sales_file_hash,inventory_file_hash,sales_total,cash_tender_total,item_count,inventory_row_count,status",
      )
      .eq("store_key", storeKey)
      .eq("business_date", businessDate)
      .maybeSingle();

    if (existingImportError) {
      throw existingImportError;
    }

    if (
      existingImport &&
      existingImport.sales_file_hash === salesFileHash &&
      existingImport.inventory_file_hash === inventoryFileHash &&
      existingImport.status === "imported"
    ) {
      return NextResponse.json({
        status: "already_imported",
        businessDate,
        salesTotal: toNumber(existingImport.sales_total),
        cashTenderTotal: existingImport.cash_tender_total ?? null,
        itemCount: existingImport.item_count,
        inventoryRowCount: existingImport.inventory_row_count,
      });
    }

    const { data: importRow, error: importError } = await supabase
      .from("nrs_email_imports")
      .upsert(
        {
          id: existingImport?.id,
          store_key: storeKey,
          business_date: businessDate,
          sales_file_name: salesFile.name,
          inventory_file_name: inventoryFile.name,
          sales_file_hash: salesFileHash,
          inventory_file_hash: inventoryFileHash,
          status: "processing",
        },
        { onConflict: "store_key,business_date" },
      )
      .select("id")
      .single();

    if (importError || !importRow) {
      throw importError ?? new Error("Failed to create NRS import record");
    }

    const { data: summary, error: summaryError } = await supabase
      .from("daily_sales_summaries")
      .upsert(
        {
          store_key: storeKey,
          business_date: businessDate,
        },
        { onConflict: "store_key,business_date" },
      )
      .select("id")
      .single();

    if (summaryError || !summary) {
      throw summaryError ?? new Error("Failed to create daily sales summary");
    }

    const linePrefix = buildNrsImportLinePrefix(importRow.id);
    const { error: deleteLinesError } = await supabase
      .from("daily_sales_product_lines")
      .delete()
      .eq("store_key", storeKey)
      .eq("business_date", businessDate)
      .like("description", `${linePrefix}%`);

    if (deleteLinesError) {
      throw deleteLinesError;
    }

    const salesLines = buildSalesLineRows(
      sales,
      importRow.id,
      storeKey,
      businessDate,
      summary.id,
    );

    if (salesLines.length > 0) {
      const { error: salesInsertError } = await supabase
        .from("daily_sales_product_lines")
        .insert(salesLines);

      if (salesInsertError) {
        throw salesInsertError;
      }
    }

    const salesTotal = sales.reduce((sum, row) => sum + row.totalAmount, 0);
    const [{ data: allProductLines, error: productLinesError }, { data: allPaymentLines, error: paymentLinesError }] =
      await Promise.all([
        supabase
          .from("daily_sales_product_lines")
          .select("amount,product_type")
          .eq("store_key", storeKey)
          .eq("business_date", businessDate),
        supabase
          .from("daily_sales_payment_lines")
          .select("amount,payment_method")
          .eq("store_key", storeKey)
          .eq("business_date", businessDate),
      ]);

    if (productLinesError) {
      throw productLinesError;
    }

    if (paymentLinesError) {
      throw paymentLinesError;
    }

    const productBreakdown = (allProductLines ?? []).reduce<
      Record<string, number>
    >((breakdown, row) => {
      breakdown[row.product_type] =
        (breakdown[row.product_type] ?? 0) + toNumber(row.amount);
      return breakdown;
    }, {});
    const paymentBreakdown = (allPaymentLines ?? []).reduce<
      Record<string, number>
    >((breakdown, row) => {
      breakdown[row.payment_method] =
        (breakdown[row.payment_method] ?? 0) + toNumber(row.amount);
      return breakdown;
    }, {});
    const productTotal = Object.values(productBreakdown).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const paymentTotal = Object.values(paymentBreakdown).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const cashSales = paymentBreakdown.cash ?? 0;

    const { error: summaryUpdateError } = await supabase
      .from("daily_sales_summaries")
      .update({
        gross_sales: Math.abs(paymentTotal) > 0.009 ? paymentTotal : productTotal,
        payment_total: paymentTotal,
        product_total: productTotal,
        cash_sales: cashSales,
        cashless_sales: paymentTotal - cashSales,
        line_count: (allProductLines ?? []).length + (allPaymentLines ?? []).length,
        payment_breakdown: paymentBreakdown,
        product_breakdown: productBreakdown,
        reconciled: false,
      })
      .eq("id", summary.id)
      .eq("store_key", storeKey);

    if (summaryUpdateError) {
      throw summaryUpdateError;
    }

    const inventoryUpdatedCount = await updateInventory(
      supabase,
      storeKey,
      inventory,
    );

    const { error: completeError } = await supabase
      .from("nrs_email_imports")
      .update({
        status: "imported",
        sales_total: salesTotal,
        cash_tender_total: cashTenderTotal,
        item_count: sales.reduce((sum, row) => sum + row.totalQty, 0),
        sales_line_count: sales.length,
        inventory_row_count: inventory.length,
        inventory_updated_count: inventoryUpdatedCount,
        imported_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", importRow.id)
      .eq("store_key", storeKey);

    if (completeError) {
      throw completeError;
    }

    const { data: pendingReview, error: reviewReadError } = await supabase
      .from("pos_cash_eod_reviews")
      .select("id,pos_cash_counted")
      .eq("store_key", storeKey)
      .eq("business_date", businessDate)
      .maybeSingle<{ id: string; pos_cash_counted: number | string }>();

    if (reviewReadError) {
      throw reviewReadError;
    }

    if (pendingReview) {
      const expectedCash = cashTenderTotal;
      const countedCash = toNumber(pendingReview.pos_cash_counted);
      const { error: reviewUpdateError } = await supabase
        .from("pos_cash_eod_reviews")
        .update({
          nrs_import_id: importRow.id,
          nrs_cash_total: expectedCash,
          variance:
            expectedCash === null
              ? null
              : Math.round((countedCash - expectedCash) * 100) / 100,
          status: "counted",
        })
        .eq("id", pendingReview.id)
        .eq("store_key", storeKey);

      if (reviewUpdateError) {
        throw reviewUpdateError;
      }
    }

    return NextResponse.json({
      status: "imported",
      businessDate,
      salesTotal,
      salesLineCount: sales.length,
      itemCount: sales.reduce((sum, row) => sum + row.totalQty, 0),
      inventoryRowCount: inventory.length,
      inventoryUpdatedCount,
    });
  } catch (error) {
    console.error("NRS email import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import NRS reports",
      },
      { status: 500 },
    );
  }
}
