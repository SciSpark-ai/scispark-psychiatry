// src/lib/clinical/evidence/file.ts
import type { VaultStorage } from "../../vault/storage"
import { FindingsFileSchema, type Finding } from "./schema"

// Where findings are kept and how the file is read. No writes and nothing that needs the server:
// the paper resolver, which also runs in the browser, reads findings through this.

export const FINDINGS_PATH = ".scispark/clinical/findings.json"

/** The findings by paper key, or null when the file is missing, damaged or of another version. */
export function parseFindings(raw: string | null): Record<string, Finding> | null {
  if (raw === null) return null
  try {
    const parsed = FindingsFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.findings : null
  } catch {
    return null
  }
}

export async function readFindings(storage: VaultStorage): Promise<Finding[]> {
  return Object.values(parseFindings(await storage.read(FINDINGS_PATH)) ?? {})
}
