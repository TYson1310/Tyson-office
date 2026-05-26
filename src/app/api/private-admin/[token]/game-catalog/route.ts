import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import {
  appendPrivateAdminAuditEvent,
  requirePrivateAdminSession,
} from "@/lib/private-admin-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

type Params = Promise<{ token: string }>;

export const runtime = "nodejs";

type ExtractedGameCatalogGame = {
  game_id: string;
  game_name: string;
  ticket_price: number;
  image_path: string;
  page_number: number;
  crop_index: number;
};

type GameCatalogExtractionResult = {
  games: ExtractedGameCatalogGame[];
  imageCount: number | null;
  matchedCount: number | null;
  recordCount: number | null;
  warnings: string[];
};

type StoredGameCatalogRow = {
  id: string;
  game_id: string;
  game_name: string;
  ticket_price: number | string;
  ticket_count: number | null;
  is_active: boolean;
  image_path: string;
  image_url: string;
  source_file_name: string | null;
  source_page: number | null;
  crop_index: number | null;
  imported_at: string;
};

type GameCatalogResponseGame = {
  id: string;
  gameId: string;
  gameName: string;
  ticketPrice: number;
  ticketCount: number | null;
  packValue: number | null;
  isActive: boolean;
  imageUrl: string;
  sourcePage: number | null;
  cropIndex: number | null;
  importedAt: string;
};

type GameCatalogPriceRow = {
  is_active: boolean;
  ticket_count: number | null;
  ticket_price: number | string;
};

type GameCatalogPriceSetting = {
  activeGameCount: number;
  configuredGameCount: number;
  gameCount: number;
  hasMixedTicketCounts: boolean;
  packValue: number | null;
  ticketCount: number | null;
  ticketPrice: number;
};

const GAME_CATALOG_BUCKET = "game-catalog";
const MAX_GAME_CATALOG_UPLOAD_BYTES = 25 * 1024 * 1024;
const STORAGE_UPLOAD_ATTEMPTS = 4;
const STORAGE_UPLOAD_BASE_DELAY_MS = 600;
const execFileAsync = promisify(execFile);

function normalizeMoney(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeOptionalNonNegativeInteger(value: unknown) {
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isCompleteGameCatalogExtraction(
  extractionResult: Pick<
    GameCatalogExtractionResult,
    "imageCount" | "matchedCount" | "recordCount"
  >,
) {
  const { imageCount, matchedCount, recordCount } = extractionResult;

  if (imageCount === null || matchedCount === null || recordCount === null) {
    return false;
  }

  return matchedCount >= imageCount && matchedCount >= recordCount;
}

function getErrorField(error: unknown, field: string) {
  return error && typeof error === "object" && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

function getErrorStatusCode(error: unknown) {
  const status = Number(
    getErrorField(error, "statusCode") ?? getErrorField(error, "status"),
  );

  return Number.isInteger(status) ? status : null;
}

function collectErrorText(error: unknown): string {
  if (!error) {
    return "";
  }

  const pieces: string[] = [];

  if (error instanceof Error) {
    pieces.push(error.name, error.message);
    pieces.push(collectErrorText(getErrorField(error, "cause")));
  } else if (typeof error === "object") {
    ["name", "message", "code", "details", "hint"].forEach((field) => {
      const value = getErrorField(error, field);

      if (typeof value === "string") {
        pieces.push(value);
      }
    });
    pieces.push(collectErrorText(getErrorField(error, "originalError")));
    pieces.push(collectErrorText(getErrorField(error, "cause")));
  } else {
    pieces.push(String(error));
  }

  return pieces.filter(Boolean).join(" ");
}

function isRetryableStorageUploadError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  const text = collectErrorText(error).toLowerCase();

  return (
    statusCode === null ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500 ||
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("socket") ||
    text.includes("timeout") ||
    text.includes("temporarily") ||
    text.includes("und_err_socket") ||
    text.includes("econnreset") ||
    text.includes("etimedout")
  );
}

function normalizeTicketPrice(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Ticket price must be greater than zero");
  }

  return Math.round(parsed * 100) / 100;
}

function normalizeTicketCount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("Tickets per pack must be between 1 and 1000");
  }

  return parsed;
}

function normalizeOptionalTicketCount(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  return normalizeTicketCount(value);
}

function normalizeGameId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new Error("Game ID is required");
  }

  return normalized;
}

function normalizeGameName(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    throw new Error("Game name is required");
  }

  return normalized;
}

function normalizeGameStatus(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Game status must be active or inactive");
  }

  return value;
}

function calculatePackValue(ticketPrice: number, ticketCount: number | null) {
  return ticketCount ? Math.round(ticketPrice * ticketCount * 100) / 100 : null;
}

function normalizeExtractedGame(value: unknown) {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const gameId =
    typeof record.game_id === "string" ? record.game_id.trim() : "";
  const gameName =
    typeof record.game_name === "string" ? record.game_name.trim() : "";
  const imagePath =
    typeof record.image_path === "string" ? record.image_path.trim() : "";
  const ticketPrice = normalizeMoney(
    typeof record.ticket_price === "number" ||
      typeof record.ticket_price === "string"
      ? record.ticket_price
      : 0,
  );
  const pageNumber = Number(record.page_number);
  const cropIndex = Number(record.crop_index);

  if (
    !gameId ||
    !gameName ||
    !imagePath ||
    ticketPrice <= 0 ||
    !Number.isInteger(pageNumber) ||
    !Number.isInteger(cropIndex)
  ) {
    return null;
  }

  return {
    game_id: gameId,
    game_name: gameName,
    ticket_price: ticketPrice,
    image_path: imagePath,
    page_number: pageNumber,
    crop_index: cropIndex,
  } satisfies ExtractedGameCatalogGame;
}

function getUploadMimeType(file: File) {
  if (file.type) {
    return file.type;
  }

  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (fileName.endsWith(".png")) {
    return "image/png";
  }

  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (fileName.endsWith(".webp")) {
    return "image/webp";
  }

  return "";
}

function isAllowedGameCatalogMimeType(mimeType: string) {
  return new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]).has(mimeType);
}

function sanitizeFileNameSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "game-catalog"
  );
}

function buildPostgrestInList(values: string[]) {
  return `(${values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")})`;
}

function getPriceKey(ticketPrice: number | string) {
  return normalizeMoney(ticketPrice).toFixed(2);
}

function getMostCommonTicketCount(counts: number[]) {
  const frequency = new Map<number, number>();

  counts.forEach((count) => {
    frequency.set(count, (frequency.get(count) ?? 0) + 1);
  });

  return (
    Array.from(frequency.entries()).sort(
      ([leftCount, leftFrequency], [rightCount, rightFrequency]) =>
        rightFrequency - leftFrequency || rightCount - leftCount,
    )[0]?.[0] ?? null
  );
}

function dedupeExtractedGames(games: ExtractedGameCatalogGame[]) {
  const gamesById = new Map<string, ExtractedGameCatalogGame>();

  games.forEach((game) => {
    const existingGame = gamesById.get(game.game_id);

    if (!existingGame || game.crop_index < existingGame.crop_index) {
      gamesById.set(game.game_id, game);
    }
  });

  return Array.from(gamesById.values()).sort(
    (left, right) => left.crop_index - right.crop_index,
  );
}

function getConfigurationError() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase configuration required" },
      { status: 503 },
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        error: "SUPABASE_SERVICE_ROLE_KEY is required for game catalog import",
      },
      { status: 503 },
    );
  }

  return null;
}

async function runGameCatalogExtractor(
  filePath: string,
  mimeType: string,
  outputDir: string,
): Promise<GameCatalogExtractionResult> {
  const pythonBinary = process.env.PYTHON_BINARY?.trim() || "python3";
  const scriptPath = join(process.cwd(), "scripts", "game_catalog_extract.py");

  try {
    const { stdout } = await execFileAsync(
      pythonBinary,
      [scriptPath, filePath, mimeType, outputDir],
      {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const payload = JSON.parse(stdout) as {
      games?: unknown;
      imageCount?: unknown;
      matchedCount?: unknown;
      recordCount?: unknown;
      warnings?: unknown;
    };
    const games = Array.isArray(payload.games)
      ? payload.games
          .map(normalizeExtractedGame)
          .filter((game): game is ExtractedGameCatalogGame => game !== null)
      : [];
    const warnings = Array.isArray(payload.warnings)
      ? Array.from(
          new Set(
            payload.warnings
              .map((warning) =>
                typeof warning === "string" ? warning.trim() : "",
              )
              .filter(Boolean),
          ),
        )
      : [];

    if (games.length === 0) {
      throw new Error("No valid game catalog rows were extracted");
    }

    return {
      games,
      imageCount: normalizeOptionalNonNegativeInteger(payload.imageCount),
      matchedCount: normalizeOptionalNonNegativeInteger(payload.matchedCount),
      recordCount: normalizeOptionalNonNegativeInteger(payload.recordCount),
      warnings,
    };
  } catch (error) {
    const stderr =
      error &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr
        : "";
    let message = stderr.trim();

    try {
      const parsed = JSON.parse(message) as { error?: unknown };
      message = typeof parsed.error === "string" ? parsed.error : message;
    } catch {
      // Keep raw stderr when the Python helper did not emit JSON.
    }

    throw new Error(message || "Game catalog extraction failed");
  }
}

async function uploadGameImages(
  adminClient: ReturnType<typeof createAdminClient>,
  games: ExtractedGameCatalogGame[],
  sourceFileName: string,
) {
  const importedAt = new Date().toISOString();
  const rows = [];

  for (const game of games) {
    const imageBuffer = await readFile(game.image_path);
    const storagePath = `scratch-offs/${game.game_id}.png`;

    await uploadGameImageWithRetry(
      adminClient,
      storagePath,
      imageBuffer,
      game.game_id,
    );

    const {
      data: { publicUrl },
    } = adminClient.storage.from(GAME_CATALOG_BUCKET).getPublicUrl(storagePath);

    rows.push({
      game_id: game.game_id,
      game_name: game.game_name,
      ticket_price: game.ticket_price,
      is_active: true,
      image_path: storagePath,
      image_url: publicUrl,
      source_file_name: sourceFileName,
      source_page: game.page_number,
      crop_index: game.crop_index,
      imported_at: importedAt,
    });
  }

  return rows;
}

async function uploadGameImageWithRetry(
  adminClient: ReturnType<typeof createAdminClient>,
  storagePath: string,
  imageBuffer: Buffer,
  gameId: string,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= STORAGE_UPLOAD_ATTEMPTS; attempt += 1) {
    const uploadResult = await adminClient.storage
      .from(GAME_CATALOG_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (!uploadResult.error) {
      return;
    }

    lastError = uploadResult.error;

    if (
      attempt >= STORAGE_UPLOAD_ATTEMPTS ||
      !isRetryableStorageUploadError(uploadResult.error)
    ) {
      break;
    }

    await sleep(STORAGE_UPLOAD_BASE_DELAY_MS * 2 ** (attempt - 1));
  }

  const detail = collectErrorText(lastError).trim();

  throw new Error(
    `Failed to upload game #${gameId} image to storage after ${STORAGE_UPLOAD_ATTEMPTS} attempt(s)${
      detail ? `: ${detail}` : ""
    }`,
  );
}

async function loadTicketCountDefaultsByPrice(
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await adminClient
    .from("game_catalog")
    .select("ticket_price,ticket_count")
    .not("ticket_count", "is", null)
    .returns<Pick<GameCatalogPriceRow, "ticket_price" | "ticket_count">[]>();

  if (error) {
    throw error;
  }

  const countsByPrice = new Map<string, number[]>();

  (data ?? []).forEach((row) => {
    if (!row.ticket_count) {
      return;
    }

    const key = getPriceKey(row.ticket_price);
    const counts = countsByPrice.get(key) ?? [];

    counts.push(row.ticket_count);
    countsByPrice.set(key, counts);
  });

  return new Map(
    Array.from(countsByPrice.entries()).flatMap(([priceKey, counts]) => {
      const ticketCount = getMostCommonTicketCount(counts);

      return ticketCount ? [[priceKey, ticketCount] as const] : [];
    }),
  );
}

async function applyTicketCountDefaultsToImportedGames({
  activeGameIds,
  adminClient,
  ticketCountByPrice,
}: {
  activeGameIds: string[];
  adminClient: ReturnType<typeof createAdminClient>;
  ticketCountByPrice: Map<string, number>;
}) {
  if (activeGameIds.length === 0 || ticketCountByPrice.size === 0) {
    return;
  }

  for (const [priceKey, ticketCount] of ticketCountByPrice.entries()) {
    const { error } = await adminClient
      .from("game_catalog")
      .update({ ticket_count: ticketCount })
      .in("game_id", activeGameIds)
      .eq("ticket_price", Number(priceKey))
      .is("ticket_count", null);

    if (error) {
      throw error;
    }
  }
}

async function loadStoredGames(
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await adminClient
    .from("game_catalog")
    .select(
      "id,game_id,game_name,ticket_price,ticket_count,is_active,image_path,image_url,source_file_name,source_page,crop_index,imported_at",
    )
    .order("is_active", { ascending: false })
    .order("ticket_price", { ascending: true })
    .order("game_id", { ascending: true })
    .returns<StoredGameCatalogRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function loadPriceSettings(
  adminClient: ReturnType<typeof createAdminClient>,
) {
  const { data, error } = await adminClient
    .from("game_catalog")
    .select("ticket_price,ticket_count,is_active")
    .order("ticket_price", { ascending: true })
    .returns<GameCatalogPriceRow[]>();

  if (error) {
    throw error;
  }

  const settingsByPrice = new Map<
    string,
    {
      activeGameCount: number;
      gameCount: number;
      ticketCounts: number[];
      ticketPrice: number;
    }
  >();

  (data ?? []).forEach((row) => {
    const ticketPrice = normalizeMoney(row.ticket_price);
    const key = ticketPrice.toFixed(2);
    const current = settingsByPrice.get(key) ?? {
      activeGameCount: 0,
      gameCount: 0,
      ticketCounts: [],
      ticketPrice,
    };

    current.gameCount += 1;

    if (row.is_active) {
      current.activeGameCount += 1;
    }

    if (row.ticket_count) {
      current.ticketCounts.push(row.ticket_count);
    }

    settingsByPrice.set(key, current);
  });

  return Array.from(settingsByPrice.values()).map((setting) => {
    const uniqueTicketCounts = Array.from(new Set(setting.ticketCounts));
    const ticketCount = getMostCommonTicketCount(setting.ticketCounts);

    return {
      activeGameCount: setting.activeGameCount,
      configuredGameCount: setting.ticketCounts.length,
      gameCount: setting.gameCount,
      hasMixedTicketCounts:
        uniqueTicketCounts.length > 1 ||
        (setting.ticketCounts.length > 0 &&
          setting.ticketCounts.length < setting.gameCount),
      packValue: calculatePackValue(setting.ticketPrice, ticketCount),
      ticketCount,
      ticketPrice: setting.ticketPrice,
    } satisfies GameCatalogPriceSetting;
  });
}

function mapStoredGame(row: StoredGameCatalogRow): GameCatalogResponseGame {
  const ticketPrice = normalizeMoney(row.ticket_price);

  return {
    id: row.id,
    gameId: row.game_id,
    gameName: row.game_name,
    ticketPrice,
    ticketCount: row.ticket_count,
    packValue: calculatePackValue(ticketPrice, row.ticket_count),
    isActive: row.is_active,
    imageUrl: row.image_url,
    sourcePage: row.source_page,
    cropIndex: row.crop_index,
    importedAt: row.imported_at,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;
  const configurationError = getConfigurationError();

  if (configurationError) {
    return configurationError;
  }

  const access = await requirePrivateAdminSession(token);

  if (access.error) {
    return access.error;
  }

  try {
    const adminClient = createAdminClient();

    return NextResponse.json({
      games: (await loadStoredGames(adminClient)).map(mapStoredGame),
      priceSettings: await loadPriceSettings(adminClient),
    });
  } catch (error) {
    console.error("Private admin game catalog settings error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load game catalog settings",
      },
      { status: 422 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;
  const configurationError = getConfigurationError();

  if (configurationError) {
    return configurationError;
  }

  const access = await requirePrivateAdminSession(token);

  if (access.error) {
    return access.error;
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Game catalog PDF is required" },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      { error: "Game catalog file is empty" },
      { status: 400 },
    );
  }

  if (file.size > MAX_GAME_CATALOG_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Game catalog file must be 25MB or smaller" },
      { status: 400 },
    );
  }

  const mimeType = getUploadMimeType(file);

  if (!isAllowedGameCatalogMimeType(mimeType)) {
    return NextResponse.json(
      { error: "Upload a PDF, PNG, JPG, or WEBP game catalog" },
      { status: 400 },
    );
  }

  const tempFilePath = join(
    tmpdir(),
    `game-catalog-${randomUUID()}-${sanitizeFileNameSegment(file.name)}`,
  );
  const outputDir = await mkdtemp(join(tmpdir(), "game-catalog-crops-"));

  try {
    await writeFile(tempFilePath, Buffer.from(await file.arrayBuffer()));

    const extractionResult = await runGameCatalogExtractor(
      tempFilePath,
      mimeType,
      outputDir,
    );
    const importWarnings = [...extractionResult.warnings];
    const extractedGames = dedupeExtractedGames(extractionResult.games);
    const adminClient = createAdminClient();
    const ticketCountByPrice =
      await loadTicketCountDefaultsByPrice(adminClient);
    const upsertRows = await uploadGameImages(
      adminClient,
      extractedGames,
      file.name,
    );
    const activeGameIds = Array.from(
      new Set(extractedGames.map((game) => game.game_id)),
    );
    const { data, error } = await adminClient
      .from("game_catalog")
      .upsert(upsertRows, { onConflict: "game_id" })
      .select(
        "id,game_id,game_name,ticket_price,ticket_count,is_active,image_path,image_url,source_file_name,source_page,crop_index,imported_at",
      )
      .returns<StoredGameCatalogRow[]>();

    if (error) {
      throw error;
    }

    await applyTicketCountDefaultsToImportedGames({
      activeGameIds,
      adminClient,
      ticketCountByPrice,
    });

    const shouldDeactivateOldGames =
      isCompleteGameCatalogExtraction(extractionResult);
    let inactiveCount = 0;

    if (shouldDeactivateOldGames) {
      const { error: inactiveError, count } = await adminClient
        .from("game_catalog")
        .update({ is_active: false }, { count: "exact" })
        .not("game_id", "in", buildPostgrestInList(activeGameIds))
        .eq("is_active", true);

      if (inactiveError) {
        throw inactiveError;
      }

      inactiveCount = count ?? 0;
    } else {
      importWarnings.push(
        "Skipped inactive-game cleanup because the uploaded catalog extraction was not complete.",
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.game_catalog_imported",
      metadata: {
        extractedImageCount: extractionResult.imageCount,
        extractedRecordCount: extractionResult.recordCount,
        extractionWarnings: importWarnings,
        fileName: file.name,
        importedCount: data?.length ?? activeGameIds.length,
        inactiveCleanupSkipped: !shouldDeactivateOldGames,
        inactiveCount,
        matchedCount: extractionResult.matchedCount,
      },
      request,
      result: "success",
      targetType: "game_catalog",
      token,
    });

    return NextResponse.json({
      count: data?.length ?? activeGameIds.length,
      extraction: {
        imageCount: extractionResult.imageCount,
        matchedCount: extractionResult.matchedCount,
        recordCount: extractionResult.recordCount,
      },
      inactiveCount,
      games: (await loadStoredGames(adminClient)).map(mapStoredGame),
      priceSettings: await loadPriceSettings(adminClient),
      warnings: importWarnings,
    });
  } catch (error) {
    console.error("Private admin game catalog import error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError
            ? "Game catalog extraction returned invalid JSON"
            : error instanceof Error
              ? error.message
              : "Failed to import game catalog",
      },
      { status: 422 },
    );
  } finally {
    await unlink(tempFilePath).catch(() => undefined);
    await rm(outputDir, { recursive: true, force: true });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;
  const configurationError = getConfigurationError();

  if (configurationError) {
    return configurationError;
  }

  const access = await requirePrivateAdminSession(token);

  if (access.error) {
    return access.error;
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const adminClient = createAdminClient();

    if ("gameId" in body) {
      const gameId = normalizeGameId(body.gameId);
      const gameName = normalizeGameName(body.gameName);
      const ticketPrice = normalizeTicketPrice(body.ticketPrice);
      const ticketCount = normalizeOptionalTicketCount(body.ticketCount);
      const isActive = normalizeGameStatus(body.isActive);
      const { data, error } = await adminClient
        .from("game_catalog")
        .update({
          game_name: gameName,
          is_active: isActive,
          ticket_count: ticketCount,
          ticket_price: ticketPrice,
        })
        .eq("game_id", gameId)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error) {
        throw error;
      }

      if (!data) {
        return NextResponse.json(
          { error: "Game was not found in the catalog" },
          { status: 404 },
        );
      }

      await appendPrivateAdminAuditEvent({
        action: "private_admin.game_catalog_game_updated",
        metadata: {
          gameId,
          isActive,
          ticketCount,
          ticketPrice,
        },
        request,
        result: "success",
        targetId: gameId,
        targetType: "game_catalog_game",
        token,
      });

      return NextResponse.json({
        games: (await loadStoredGames(adminClient)).map(mapStoredGame),
        priceSettings: await loadPriceSettings(adminClient),
      });
    }

    const ticketPrice = normalizeTicketPrice(body.ticketPrice);
    const ticketCount = normalizeTicketCount(body.ticketCount);
    const { count, error } = await adminClient
      .from("game_catalog")
      .update({ ticket_count: ticketCount }, { count: "exact" })
      .eq("ticket_price", ticketPrice);

    if (error) {
      throw error;
    }

    if (!count) {
      return NextResponse.json(
        { error: "No games were found for that ticket price" },
        { status: 404 },
      );
    }

    await appendPrivateAdminAuditEvent({
      action: "private_admin.game_catalog_price_defaults_updated",
      metadata: {
        affectedCount: count ?? 0,
        ticketCount,
        ticketPrice,
      },
      request,
      result: "success",
      targetId: String(ticketPrice),
      targetType: "game_catalog_price",
      token,
    });

    return NextResponse.json({
      games: (await loadStoredGames(adminClient)).map(mapStoredGame),
      priceSettings: await loadPriceSettings(adminClient),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update tickets per pack",
      },
      { status: 400 },
    );
  }
}
