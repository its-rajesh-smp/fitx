import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_IGNORES = new Set(["node_modules", "dist", ".git", ".DS_Store"]);

/**
 * Deterministic SHA-256 over every file path and its contents under `dir`.
 * Used as a trigger so the UI is only rebuilt and re-uploaded when its sources change.
 */
export const hashDirectory = (dir: string, ignores: Set<string> = DEFAULT_IGNORES): string => {
  const hash = crypto.createHash("sha256");

  const walk = (current: string) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .filter((entry) => !ignores.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        hash.update(path.relative(dir, fullPath));
        hash.update(fs.readFileSync(fullPath));
      }
    }
  };

  walk(dir);
  return hash.digest("hex");
};
