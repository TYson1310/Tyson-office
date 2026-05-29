#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const defaultBackupDir = "backups/supabase";
const pageSize = 1000;

loadEnvFile(resolve(repoRoot, ".env.local"));
loadEnvFile(resolve(repoRoot, ".env"));

const args = new Set(process.argv.slice(2));
const dbOnly = args.has("--db-only");
const storageOnly = args.has("--storage-only");
const skipDatabase =
  storageOnly || isEnabled(process.env.SUPABASE_BACKUP_SKIP_DATABASE);
const skipStorage =
  dbOnly || isEnabled(process.env.SUPABASE_BACKUP_SKIP_STORAGE);

if (dbOnly && storageOnly) {
  fail("Use either --db-only or --storage-only, not both.");
}

const backupRoot = resolve(
  repoRoot,
  process.env.SUPABASE_BACKUP_DIR ?? defaultBackupDir,
);
const backupDir = join(backupRoot, timestamp);
const dbDir = join(backupDir, "database");
const storageDir = join(backupDir, "storage");
const manifest = {
  createdAt: new Date().toISOString(),
  backupDir,
  database: {
    skipped: skipDatabase,
    files: [],
  },
  storage: {
    skipped: skipStorage,
    buckets: [],
    files: [],
  },
  warnings: [],
};

mkdirSync(backupDir, { recursive: true });

try {
  if (!skipDatabase) {
    await backupDatabase();
  }

  if (!skipStorage) {
    await backupStorage();
  }

  pruneOldBackups();
  writeManifest();

  console.log("");
  console.log(`Backup complete: ${backupDir}`);
  console.log("Keep this folder outside git and copy it to another drive.");
} catch (error) {
  writeManifest();
  console.error("");
  console.error("Backup failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function backupDatabase() {
  const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

  if (!dbUrl) {
    fail(
      "Missing SUPABASE_DB_URL or DATABASE_URL. Add the Supabase Postgres connection string to .env.local.",
    );
  }

  mkdirSync(dbDir, { recursive: true });

  const cli = process.env.SUPABASE_CLI_COMMAND ?? "supabase";
  const commonArgs = ["db", "dump", "--db-url", dbUrl];
  const dumps = [
    {
      label: "roles",
      file: join(dbDir, "roles.sql"),
      args: [...commonArgs, "-f", join(dbDir, "roles.sql"), "--role-only"],
    },
    {
      label: "schema",
      file: join(dbDir, "schema.sql"),
      args: [...commonArgs, "-f", join(dbDir, "schema.sql")],
    },
    {
      label: "data",
      file: join(dbDir, "data.sql"),
      args: [
        ...commonArgs,
        "-f",
        join(dbDir, "data.sql"),
        "--use-copy",
        "--data-only",
        "-x",
        "storage.buckets_vectors",
        "-x",
        "storage.vector_indexes",
      ],
    },
  ];

  for (const dump of dumps) {
    console.log(`Creating database ${dump.label} dump...`);
    await run(cli, dump.args);
    manifest.database.files.push(relativeToBackup(dump.file));
  }
}

async function backupStorage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    manifest.warnings.push(
      "Skipped Supabase Storage backup because NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.",
    );
    manifest.storage.skipped = true;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: buckets, error: bucketsError } =
    await supabase.storage.listBuckets();

  if (bucketsError) {
    fail(`Unable to list Supabase Storage buckets: ${bucketsError.message}`);
  }

  const configuredBuckets = getStorageBucketNames();
  const availableBucketNames = new Set((buckets ?? []).map((bucket) => bucket.name));
  const targetBuckets = configuredBuckets.length
    ? configuredBuckets.filter((bucketName) => {
        if (!availableBucketNames.has(bucketName)) {
          manifest.warnings.push(
            `Storage bucket "${bucketName}" does not exist and was skipped.`,
          );
          return false;
        }

        return true;
      })
    : [...availableBucketNames].sort();

  mkdirSync(storageDir, { recursive: true });

  for (const bucketName of targetBuckets) {
    console.log(`Backing up storage bucket "${bucketName}"...`);
    manifest.storage.buckets.push(bucketName);
    await backupBucket(supabase, bucketName);
  }
}

async function backupBucket(supabase, bucketName, prefix = "") {
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucketName).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      fail(
        `Unable to list "${bucketName}/${prefix || ""}": ${error.message}`,
      );
    }

    const entries = data ?? [];

    for (const entry of entries) {
      const remotePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.id === null) {
        await backupBucket(supabase, bucketName, remotePath);
        continue;
      }

      await downloadStorageObject(supabase, bucketName, remotePath, entry);
    }

    if (entries.length < pageSize) {
      break;
    }

    offset += pageSize;
  }
}

async function downloadStorageObject(supabase, bucketName, remotePath, entry) {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(remotePath);

  if (error) {
    fail(`Unable to download "${bucketName}/${remotePath}": ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const localFile = join(storageDir, bucketName, ...remotePath.split("/"));

  mkdirSync(dirname(localFile), { recursive: true });
  writeFileSync(localFile, Buffer.from(arrayBuffer));

  manifest.storage.files.push({
    bucket: bucketName,
    path: remotePath,
    localPath: relativeToBackup(localFile),
    size: entry.metadata?.size ?? data.size ?? null,
    updatedAt: entry.updated_at ?? null,
  });
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const file = readFileSync(filePath, "utf8");

  for (const line of file.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function getStorageBucketNames() {
  const explicit = process.env.SUPABASE_BACKUP_STORAGE_BUCKETS;

  if (explicit) {
    return normalizeList(explicit);
  }

  return normalizeList(
    [
      process.env.NEXT_PUBLIC_SUPABASE_PAYROLL_BUCKET ?? "payroll-documents",
      process.env.NEXT_PUBLIC_SUPABASE_VENDOR_INVOICE_BUCKET ?? "vendor-invoices",
      process.env.NEXT_PUBLIC_SUPABASE_EXPENSE_DOCUMENT_BUCKET ??
        "expense-documents",
    ].join(","),
  );
}

function normalizeList(value) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function pruneOldBackups() {
  const keepRaw = process.env.SUPABASE_BACKUP_KEEP;

  if (!keepRaw) {
    return;
  }

  const keep = Number.parseInt(keepRaw, 10);

  if (!Number.isInteger(keep) || keep < 1) {
    manifest.warnings.push(
      "SUPABASE_BACKUP_KEEP was ignored because it must be a positive integer.",
    );
    return;
  }

  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
  const backupDirs = readdirSync(backupRoot)
    .filter((name) => timestampPattern.test(name))
    .map((name) => {
      const fullPath = join(backupRoot, name);
      return { name, fullPath, stat: statSync(fullPath) };
    })
    .filter((entry) => entry.stat.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const entry of backupDirs.slice(keep)) {
    rmSync(entry.fullPath, { recursive: true, force: true });
    manifest.warnings.push(`Pruned old backup folder: ${entry.name}`);
  }
}

function writeManifest() {
  writeFileSync(
    join(backupDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function run(command, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        rejectRun(
          new Error(
            `Could not find "${command}". Install the Supabase CLI or set SUPABASE_CLI_COMMAND to its path.`,
          ),
        );
        return;
      }

      rejectRun(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}

function relativeToBackup(filePath) {
  return filePath.replace(`${backupDir}${sep}`, "");
}

function isEnabled(value) {
  return value === "1" || value === "true" || value === "yes";
}

function fail(message) {
  throw new Error(message);
}
