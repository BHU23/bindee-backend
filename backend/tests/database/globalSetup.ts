import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL } from "./testDb.js";

/** Creates the test database if needed and applies all migrations to it. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({
    connectionString: TEST_DATABASE_URL.replace(`/${dbName}`, "/postgres"),
  });
  try {
    await admin.connect();
    const found = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } catch (error) {
    throw new Error(
      "Test Postgres is not reachable (start it with docker compose up -d postgres)",
      { cause: error },
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
