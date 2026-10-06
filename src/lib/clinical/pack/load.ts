import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  JournalsSchema, OnboardingOptionsSchema, PackManifestSchema, TaxonomySchema, TextWordsSchema,
  type SpecialtyPack,
} from "./schema"

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"))
}

/** Reads and validates a specialty pack folder. Throws with the failing file named. */
export async function loadPackFromDir(dir: string): Promise<SpecialtyPack> {
  const manifest = PackManifestSchema.parse(await readJson(path.join(dir, "manifest.json")))
  const parse = async <T,>(name: string, parser: { parse(value: unknown): T }): Promise<T> => {
    try {
      return parser.parse(await readJson(path.join(dir, name)))
    } catch (error) {
      throw new Error(`pack ${manifest.id}: ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const taxonomy = await parse(manifest.files.taxonomy, TaxonomySchema)
  const journals = await parse(manifest.files.journals, JournalsSchema)
  const onboarding = await parse(manifest.files.onboarding, OnboardingOptionsSchema)
  const textWords = await parse(manifest.files.textWords, TextWordsSchema)
  return { manifest, taxonomy, journals: journals.journals, onboarding, textWords: textWords.words }
}

/** The shipped psychiatry pack. Server-side only (reads the app's `packs/` folder). */
export function loadPsychiatryPack(root: string = process.cwd()): Promise<SpecialtyPack> {
  return loadPackFromDir(path.join(root, "packs", "psychiatry"))
}
