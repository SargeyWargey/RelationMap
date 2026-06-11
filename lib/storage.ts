import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Monotonic counter so concurrent writes to the same file never share a temp
// name (a fixed `.tmp` suffix lets parallel writers clobber each other).
let tmpCounter = 0;

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  tmpCounter += 1;
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Best-effort cleanup so failed writes don't leave temp files behind.
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}
