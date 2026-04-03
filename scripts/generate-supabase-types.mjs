import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function generateTypes() {
  try {
    return execSync("npx supabase gen types typescript --local --schema public", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error
      ? String(error.stderr ?? "")
      : "";

    if (stderr.includes("not running") || stderr.includes("Cannot find project ref")) {
      throw new Error(
        "local Supabase stack が起動していません。先に `npm run supabase:start` を実行してください。",
      );
    }

    throw error;
  }
}

function main() {
  const output = generateTypes();
  const filePath = path.join(
    process.cwd(),
    "src",
    "lib",
    "supabase",
    "database.types.ts",
  );

  fs.writeFileSync(filePath, output, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        filePath,
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
            : "Supabase 型生成に失敗しました。",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}