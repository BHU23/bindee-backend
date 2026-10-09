import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const INVENTORY_DELEGATES = [
  "flight",
  "flightFare",
  "seat",
  "seatHold",
  "seatHoldItem",
  "searchSnapshot",
  "airport",
  "route",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated") return [];
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

function outsideInventory(file: string): boolean {
  const rel = relative(SRC, file);
  return (
    !rel.startsWith(join("modules", "inventory")) &&
    !rel.startsWith(join("database", "seeds"))
  );
}

async function lint(code: string, file: string) {
  const [result] = await new ESLint().lintText(code, {
    filePath: join(process.cwd(), file),
  });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  );
}

describe("AC-INV-01 callers depend only on InventoryPort", () => {
  it("When a module imports inventory internals, should be flagged by lint", async () => {
    const deep =
      'import { searchFlights } from "../inventory/repositories/search.js";\nvoid searchFlights;\n';
    expect(await lint(deep, "src/modules/booking/x.ts")).toHaveLength(1);
    const types =
      'import type { FareOption } from "../inventory/types/inventory.js";\nexport type T = FareOption;\n';
    expect(await lint(types, "src/modules/booking/y.ts")).toHaveLength(1);
  });

  it("When a module imports inventory internals through the @ alias, should be flagged too", async () => {
    const alias =
      'import { searchFlights } from "@/modules/inventory/repositories/search.js";\nvoid searchFlights;\n';
    expect(await lint(alias, "src/modules/booking/z.ts")).toHaveLength(1);
  });

  it("When a module imports the inventory barrel, should pass lint", async () => {
    const barrel =
      'import type { InventoryPort } from "../inventory/index.js";\nexport type T = InventoryPort;\n';
    expect(await lint(barrel, "src/modules/booking/x.ts")).toHaveLength(0);
    const aliased =
      'import type { InventoryPort } from "@/modules/inventory/index.js";\nexport type T = InventoryPort;\n';
    expect(await lint(aliased, "src/modules/booking/w.ts")).toHaveLength(0);
  });

  it("When scanning src outside inventory, should find no access to inventory tables", () => {
    const pattern = new RegExp(
      `\\.(${INVENTORY_DELEGATES.join("|")})\\.(find|create|update|delete|upsert|count|aggregate|group)`,
    );
    const offenders = sourceFiles(SRC)
      .filter(outsideInventory)
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
