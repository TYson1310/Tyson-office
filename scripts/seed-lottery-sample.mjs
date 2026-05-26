import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import process from "node:process";

const STORE_KEY = "sample";
const STORE_NAME = "Sample Store";
const STORE_TIME_ZONE = "America/New_York";
const SEED_SOURCE = "sample-lottery-seed";

function loadEnvFile(path = ".env.local") {
  try {
    const contents = readFileSync(path, "utf8");

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").replace(/^['"]|['"]$/g, "");

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Environment variables may already be provided by the shell.
  }
}

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function getDateKeyInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function isoDateDaysAgo(daysAgo) {
  const today = getDateKeyInTimeZone(new Date(), STORE_TIME_ZONE);
  return addDaysToDateKey(today, -daysAgo);
}

function isoTimestampDaysAgo(daysAgo, hour = 12) {
  const date = new Date(`${isoDateDaysAgo(daysAgo)}T00:00:00.000Z`);
  date.setUTCHours(hour, 0, 0, 0);

  return date.toISOString();
}

function money(value) {
  return Math.round(value * 100) / 100;
}

function ticket(value) {
  return String(value).padStart(3, "0");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Validation failed: ${message}`);
  }
}

async function requireOk(label, promise) {
  const result = await promise;

  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }

  return result.data;
}

async function assertLotteryDatabaseIsCurrent(supabase) {
  const preflightDate = "2099-12-31";

  await requireOk(
    "check lottery database migration",
    supabase.rpc("reconciliation_engine", {
      target_store_key: STORE_KEY,
      target_report_date: preflightDate,
      input_pos_register_total: 0,
      input_manager_notes: "Sample seed migration preflight",
      reconciled_by: null,
    }),
  );

  await requireOk(
    "remove sample seed migration preflight",
    supabase
      .from("eod_reconciliation")
      .delete()
      .eq("store_key", STORE_KEY)
      .eq("report_date", preflightDate),
  );
}

function ticketSales(startTicket, endTicket, ticketPrice) {
  const ticketsSold = Number(endTicket) - Number(startTicket);

  if (ticketsSold < 0) {
    throw new Error(`Invalid ticket range ${startTicket} to ${endTicket}`);
  }

  return {
    ticketsSold,
    calculatedRevenue: money(ticketsSold * ticketPrice),
  };
}

function buildGameImageUrl(gameId, name, color) {
  const label = encodeURIComponent(`${gameId} ${name}`);
  return `https://dummyimage.com/420x240/${color}/ffffff.png&text=${label}`;
}

function activePack({
  binNumber,
  gameId,
  packNumber,
  receivedTicketNumber,
  controlCode,
}) {
  return {
    pack_id: `${gameId}-${packNumber}-${receivedTicketNumber}`,
    store_key: STORE_KEY,
    pack_number: packNumber,
    game_id: gameId,
    status: "active",
    bin_number: binNumber,
    received_ticket_number: receivedTicketNumber,
    pack_control_code: controlCode,
    date_received: isoTimestampDaysAgo(8, 9),
    date_activated: isoTimestampDaysAgo(4, 8),
  };
}

function backstockPack({
  gameId,
  packNumber,
  receivedTicketNumber,
  controlCode,
  daysAgo,
}) {
  return {
    pack_id: `${gameId}-${packNumber}-${receivedTicketNumber}`,
    store_key: STORE_KEY,
    pack_number: packNumber,
    game_id: gameId,
    status: "backstock",
    bin_number: null,
    received_ticket_number: receivedTicketNumber,
    pack_control_code: controlCode,
    date_received: isoTimestampDaysAgo(daysAgo, 10),
    date_activated: null,
  };
}

function buildAudit({
  date,
  employeeId,
  endTicket,
  inventoryId,
  pack,
  startTicket,
  ticketPrice,
}) {
  const { ticketsSold, calculatedRevenue } = ticketSales(
    startTicket,
    endTicket,
    ticketPrice,
  );

  return {
    store_key: STORE_KEY,
    audit_date: date,
    employee_id: employeeId,
    inventory_id: inventoryId,
    bin_number: pack.bin_number,
    start_ticket_no: startTicket,
    end_ticket_no: endTicket,
    tickets_sold: ticketsSold,
    calculated_revenue: calculatedRevenue,
    audit_type: "eod",
    created_at: `${date}T22:00:00.000Z`,
  };
}

async function seed() {
  loadEnvFile();

  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const today = isoDateDaysAgo(0);
  const dayOne = isoDateDaysAgo(1);
  const dayTwo = isoDateDaysAgo(2);
  const dayThree = isoDateDaysAgo(3);

  await requireOk(
    "upsert sample store",
    supabase.from("stores").upsert(
      {
        store_key: STORE_KEY,
        name: STORE_NAME,
        status: "active",
      },
      { onConflict: "store_key" },
    ),
  );

  await requireOk(
    "upsert sample store settings",
    supabase.from("store_settings").upsert(
      {
        store_key: STORE_KEY,
        business_name: STORE_NAME,
        currency_code: "USD",
        timezone_name: STORE_TIME_ZONE,
        country: "United States",
        scratch_bin_count: 8,
        till_opening_float: 500,
        till_closing_float: 500,
        lottery_retailer_commission_rate: 5,
        lottery_cashing_bonus_rate: 1,
      },
      { onConflict: "store_key" },
    ),
  );

  await assertLotteryDatabaseIsCurrent(supabase);

  await requireOk(
    "clear sample terminal reports",
    supabase.from("terminal_reports").delete().eq("store_key", STORE_KEY),
  );
  await requireOk(
    "clear sample daily audits",
    supabase.from("daily_audits").delete().eq("store_key", STORE_KEY),
  );
  await requireOk(
    "clear sample EOD reconciliation",
    supabase.from("eod_reconciliation").delete().eq("store_key", STORE_KEY),
  );
  await requireOk(
    "clear sample inventory",
    supabase.from("inventory").delete().eq("store_key", STORE_KEY),
  );

  const games = [
    {
      game_id: "01953",
      game_name: "Gold Rush 50X",
      ticket_price: 10,
      ticket_count: 100,
      is_active: true,
      image_path: `${SEED_SOURCE}/01953.png`,
      image_url: buildGameImageUrl("01953", "Gold Rush 50X", "0f766e"),
      source_file_name: SEED_SOURCE,
      source_page: 1,
      crop_index: 1,
    },
    {
      game_id: "01974",
      game_name: "$1 Million Premier Cash",
      ticket_price: 20,
      ticket_count: 50,
      is_active: true,
      image_path: `${SEED_SOURCE}/01974.png`,
      image_url: buildGameImageUrl("01974", "Premier Cash", "1d4ed8"),
      source_file_name: SEED_SOURCE,
      source_page: 1,
      crop_index: 2,
    },
    {
      game_id: "01425",
      game_name: "Jumbo Bucks",
      ticket_price: 5,
      ticket_count: 100,
      is_active: true,
      image_path: `${SEED_SOURCE}/01425.png`,
      image_url: buildGameImageUrl("01425", "Jumbo Bucks", "be123c"),
      source_file_name: SEED_SOURCE,
      source_page: 2,
      crop_index: 1,
    },
    {
      game_id: "02001",
      game_name: "Lucky Green",
      ticket_price: 2,
      ticket_count: 100,
      is_active: true,
      image_path: `${SEED_SOURCE}/02001.png`,
      image_url: buildGameImageUrl("02001", "Lucky Green", "047857"),
      source_file_name: SEED_SOURCE,
      source_page: 2,
      crop_index: 2,
    },
    {
      game_id: "02222",
      game_name: "Bonus Cashword",
      ticket_price: 3,
      ticket_count: 100,
      is_active: true,
      image_path: `${SEED_SOURCE}/02222.png`,
      image_url: buildGameImageUrl("02222", "Bonus Cashword", "7c3aed"),
      source_file_name: SEED_SOURCE,
      source_page: 3,
      crop_index: 1,
    },
  ];

  await requireOk(
    "upsert sample game catalog",
    supabase.from("game_catalog").upsert(games, { onConflict: "game_id" }),
  );

  const inventorySeed = [
    activePack({
      binNumber: 1,
      gameId: "01953",
      packNumber: "101425",
      receivedTicketNumber: "046",
      controlCode: "054",
    }),
    activePack({
      binNumber: 2,
      gameId: "01974",
      packNumber: "202311",
      receivedTicketNumber: "000",
      controlCode: "050",
    }),
    activePack({
      binNumber: 3,
      gameId: "01425",
      packNumber: "461107",
      receivedTicketNumber: "025",
      controlCode: "075",
    }),
    activePack({
      binNumber: 4,
      gameId: "02001",
      packNumber: "555777",
      receivedTicketNumber: "010",
      controlCode: "090",
    }),
    backstockPack({
      gameId: "01953",
      packNumber: "101426",
      receivedTicketNumber: "000",
      controlCode: "100",
      daysAgo: 2,
    }),
    backstockPack({
      gameId: "01974",
      packNumber: "202312",
      receivedTicketNumber: "000",
      controlCode: "050",
      daysAgo: 1,
    }),
    backstockPack({
      gameId: "02222",
      packNumber: "333444",
      receivedTicketNumber: "000",
      controlCode: "100",
      daysAgo: 1,
    }),
  ];

  const inventoryRows = await requireOk(
    "insert sample inventory",
    supabase
      .from("inventory")
      .insert(inventorySeed)
      .select("id,pack_id,pack_number,game_id,status,bin_number"),
  );
  const inventoryByPackId = new Map(
    inventoryRows.map((row) => [row.pack_id, row]),
  );
  const gameById = new Map(games.map((game) => [game.game_id, game]));

  const employeeRow = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin", "manager", "cashier", "employee"])
    .limit(1)
    .maybeSingle();
  const employeeId = employeeRow.data?.id ?? null;

  const auditPlan = [
    [dayThree, "01953-101425-046", "046", "052"],
    [dayTwo, "01953-101425-046", "052", "060"],
    [dayOne, "01953-101425-046", "060", "067"],
    [dayThree, "01974-202311-000", "000", "003"],
    [dayTwo, "01974-202311-000", "003", "006"],
    [dayOne, "01974-202311-000", "006", "011"],
    [dayThree, "01425-461107-025", "025", "035"],
    [dayTwo, "01425-461107-025", "035", "044"],
    [dayOne, "01425-461107-025", "044", "050"],
    [dayThree, "02001-555777-010", "010", "022"],
    [dayTwo, "02001-555777-010", "022", "035"],
    [dayOne, "02001-555777-010", "035", "047"],
  ];

  const auditRows = auditPlan.map(([date, packId, startTicket, endTicket]) => {
    const pack = inventoryByPackId.get(packId);

    if (!pack) {
      throw new Error(`Missing seeded pack ${packId}`);
    }

    return buildAudit({
      date,
      employeeId,
      endTicket,
      inventoryId: pack.id,
      pack,
      startTicket,
      ticketPrice: Number(gameById.get(pack.game_id).ticket_price),
    });
  });

  await requireOk(
    "insert sample daily audits",
    supabase.from("daily_audits").insert(auditRows),
  );

  const scratchByDate = new Map();
  for (const audit of auditRows) {
    scratchByDate.set(
      audit.audit_date,
      money(
        (scratchByDate.get(audit.audit_date) ?? 0) + audit.calculated_revenue,
      ),
    );
  }

  const terminalRows = [
    {
      report_date: dayThree,
      draw_sales: 510,
      draw_payouts: 125,
      scratch_payouts: 90,
      total_cashing_bonus: 4,
      total_cancels: 12,
      variance: 0,
      note: "Seed balanced day",
    },
    {
      report_date: dayTwo,
      draw_sales: 575,
      draw_payouts: 140,
      scratch_payouts: 115,
      total_cashing_bonus: 6,
      total_cancels: 8,
      variance: -7.25,
      note: "Seed over day",
    },
    {
      report_date: dayOne,
      draw_sales: 620,
      draw_payouts: 155,
      scratch_payouts: 120,
      total_cashing_bonus: 5,
      total_cancels: 10,
      variance: 5.5,
      note: "Seed short day",
    },
  ];

  await requireOk(
    "insert sample terminal reports",
    supabase.from("terminal_reports").insert(
      terminalRows.map((row) => ({
        store_key: STORE_KEY,
        report_date: row.report_date,
        draw_sales: row.draw_sales,
        draw_payouts: row.draw_payouts,
        scratch_payouts: row.scratch_payouts,
        total_cashing_bonus: row.total_cashing_bonus,
        total_cancels: row.total_cancels,
        created_by: employeeId,
      })),
    ),
  );

  await requireOk(
    "insert sample EOD reconciliations",
    supabase.from("eod_reconciliation").upsert(
      terminalRows.map((row) => {
        const expectedCash = money(
          (scratchByDate.get(row.report_date) ?? 0) +
            row.draw_sales -
            row.draw_payouts -
            row.scratch_payouts -
            row.total_cashing_bonus -
            row.total_cancels,
        );

        return {
          store_key: STORE_KEY,
          report_date: row.report_date,
          total_expected_cash: expectedCash,
          pos_register_total: money(expectedCash - row.variance),
          manager_notes: row.note,
          created_by: employeeId,
        };
      }),
      { onConflict: "store_key,report_date" },
    ),
  );

  const activeRows = await requireOk(
    "read active sample inventory",
    supabase
      .from("inventory")
      .select("id,pack_id,pack_number,game_id,status,bin_number")
      .eq("store_key", STORE_KEY)
      .eq("status", "active")
      .order("bin_number"),
  );
  const backstockRows = await requireOk(
    "read sample backstock",
    supabase
      .from("inventory")
      .select("id")
      .eq("store_key", STORE_KEY)
      .eq("status", "backstock"),
  );
  const latestAudits = await requireOk(
    "read latest sample audits",
    supabase
      .from("daily_audits")
      .select("inventory_id,bin_number,end_ticket_no,audit_date,created_at")
      .eq("store_key", STORE_KEY)
      .order("audit_date", { ascending: false })
      .order("created_at", { ascending: false }),
  );
  const settings = await requireOk(
    "read sample settings",
    supabase
      .from("store_settings")
      .select(
        "scratch_bin_count,lottery_retailer_commission_rate,lottery_cashing_bonus_rate",
      )
      .eq("store_key", STORE_KEY)
      .single(),
  );

  assert(Number(settings.scratch_bin_count) === 8, "sample store has 8 bins");
  assert(activeRows.length === 4, "sample store has 4 active bins");
  assert(backstockRows.length === 3, "sample store has 3 backstock packs");

  const latestByInventory = new Map();
  for (const audit of latestAudits) {
    if (!latestByInventory.has(audit.inventory_id)) {
      latestByInventory.set(audit.inventory_id, audit);
    }
  }

  const plannedEnds = new Map([
    [1, "073"],
    [2, "014"],
    [3, "056"],
    [4, "052"],
  ]);
  const todayScratchSales = activeRows.reduce((total, pack) => {
    const start = latestByInventory.get(pack.id)?.end_ticket_no ?? "000";
    const end = plannedEnds.get(pack.bin_number);
    const game = gameById.get(pack.game_id);
    const result = ticketSales(start, end, Number(game.ticket_price));

    return money(total + result.calculatedRevenue);
  }, 0);
  const terminalSales = 450;
  const onlinePayout = 110;
  const scratchPayout = 75;
  const ticketCancels = 12;
  const cashingBonus = 5;
  const expectedCash = money(
    todayScratchSales +
      terminalSales -
      onlinePayout -
      scratchPayout -
      ticketCancels -
      cashingBonus,
  );
  const netTicketSales = money(terminalSales - ticketCancels);
  const totalPayouts = money(onlinePayout + scratchPayout);
  const commissionCredit = money(
    netTicketSales * (Number(settings.lottery_retailer_commission_rate) / 100),
  );
  const payoutCommissionCredit = money(
    totalPayouts * (Number(settings.lottery_cashing_bonus_rate) / 100),
  );
  const predictedEftNetDue = money(
    netTicketSales - commissionCredit - payoutCommissionCredit - totalPayouts,
  );

  assert(todayScratchSales === 160, "planned EOD scratch sales are $160");
  assert(expectedCash === 408, "planned EOD expected cash is $408");
  assert(predictedEftNetDue === 229.25, "planned EFT net due is $229.25");

  const binOne = activeRows.find((row) => row.bin_number === 1);
  const binOneStart = latestByInventory.get(binOne.id)?.end_ticket_no;
  assert(binOneStart === "067", "bin 1 starts from prior end ticket 067");
  assert(
    Number("002") < Number(binOneStart),
    "lower end ticket test is invalid",
  );

  const reportRows = await requireOk(
    "read sample report rows",
    supabase
      .from("eod_reconciliation")
      .select(
        "report_date,total_expected_cash,pos_register_total,short_over_amount",
      )
      .eq("store_key", STORE_KEY)
      .order("report_date", { ascending: false }),
  );
  assert(reportRows.length === 3, "sample report has 3 historical closeouts");

  console.log("Seeded lottery sample store.");
  console.log(`Store: ${STORE_NAME} (${STORE_KEY})`);
  console.log(`Historical closeouts: ${dayThree}, ${dayTwo}, ${dayOne}`);
  console.log(
    `Active bins: ${activeRows
      .map((row) => `${row.bin_number}:${row.game_id}/${row.pack_number}`)
      .join(", ")}`,
  );
  console.log(`Backstock packs: ${backstockRows.length}`);
  console.log(
    `Planned EOD check for ${today}: scratch=$${todayScratchSales.toFixed(
      2,
    )}, expected_cash=$${expectedCash.toFixed(2)}, eft_net_due=$${predictedEftNetDue.toFixed(
      2,
    )}`,
  );
  console.log("Validation: PASS");
}

seed().catch((error) => {
  console.error(error.message);

  if (error.message.includes('column reference "report_date" is ambiguous')) {
    console.error(
      "Apply Supabase migration 202605110016_fix_lottery_reconciliation_conflicts.sql, then rerun npm run seed:lottery-sample.",
    );
  }

  process.exitCode = 1;
});
