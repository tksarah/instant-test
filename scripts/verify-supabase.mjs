import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const envFileOrder = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
];

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

function loadWorkspaceEnv() {
  const loadedFiles = [];
  const fileValues = {};

  for (const fileName of envFileOrder) {
    const filePath = path.join(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    Object.assign(fileValues, parseEnvFile(fs.readFileSync(filePath, "utf8")));
    loadedFiles.push(fileName);
  }

  return {
    loadedFiles,
    env: {
      ...fileValues,
      ...process.env,
    },
  };
}

function getSupabaseConfig(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";

  return {
    url,
    serviceRoleKey,
  };
}

async function queryCount(client, table) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function main() {
  const { loadedFiles, env } = loadWorkspaceEnv();
  const { url, serviceRoleKey } = getSupabaseConfig(env);

  if (!url || !serviceRoleKey) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "missing-env",
          loadedEnvFiles: loadedFiles,
          hasSupabaseUrl: Boolean(url),
          hasServiceRoleKey: Boolean(serviceRoleKey),
          message:
            "SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local などに設定してください。",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  let urlHost = "invalid-url";

  try {
    urlHost = new URL(url).host;
  } catch {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "invalid-url",
          loadedEnvFiles: loadedFiles,
          message: "SUPABASE_URL の形式が不正です。",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const [classes, tests, questions, attempts] = await Promise.all([
      queryCount(client, "classes"),
      queryCount(client, "tests"),
      queryCount(client, "questions"),
      queryCount(client, "student_attempts"),
    ]);

    const { data: featuredClass, error: featuredClassError } = await client
      .from("classes")
      .select("id, name, code")
      .limit(1)
      .maybeSingle();

    if (featuredClassError) {
      throw new Error(`classes sample: ${featuredClassError.message}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          reason: "connected",
          loadedEnvFiles: loadedFiles,
          urlHost,
          tableCounts: {
            classes,
            tests,
            questions,
            student_attempts: attempts,
          },
          featuredClass,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "connection-failed",
          loadedEnvFiles: loadedFiles,
          urlHost,
          message: error instanceof Error ? error.message : "unknown error",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

await main();