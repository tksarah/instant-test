import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function parseEnvFile(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function parseStatusEnv(content) {
  return parseEnvFile(content);
}

function loadExistingEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

function getStatusEnv() {
  try {
    const output = execSync("npx supabase status -o env", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return parseStatusEnv(output);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error
      ? String(error.stderr ?? "")
      : "";

    if (
      stderr.includes("Docker Desktop") ||
      stderr.includes("docker_engine") ||
      stderr.includes("failed to inspect service")
    ) {
      throw new Error(
        "Docker Desktop を起動してから `npm run supabase:start` を実行してください。",
      );
    }

    if (stderr.includes("supabase start") || stderr.includes("not running")) {
      throw new Error(
        "local Supabase stack が起動していません。先に `npm run supabase:start` を実行してください。",
      );
    }

    throw error;
  }
}

function writeEnvFile(filePath, nextValues) {
  const targetKeys = new Set(Object.keys(nextValues));
  const existingValues = loadExistingEnvFile(filePath);
  const preservedEntries = Object.entries(existingValues).filter(
    ([key]) => !targetKeys.has(key),
  );
  const lines = [
    ...Object.entries(nextValues).map(([key, value]) => `${key}=${value}`),
    ...preservedEntries.map(([key, value]) => `${key}=${value}`),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const statusEnv = getStatusEnv();
  const apiUrl = statusEnv.API_URL || "";
  const anonKey = statusEnv.ANON_KEY || "";
  const serviceRoleKey = statusEnv.SERVICE_ROLE_KEY || "";

  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error("supabase status から必要な接続情報を取得できませんでした。");
  }

  const envFilePath = path.join(process.cwd(), ".env.local");

  writeEnvFile(envFilePath, {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        envFilePath,
        apiUrl,
        wroteKeys: [
          "NEXT_PUBLIC_APP_URL",
          "SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ],
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "local Supabase の env 同期に失敗しました。",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}