import { z } from "zod"

const ISSN = z.string().regex(/^\d{4}-\d{3}[\dX]$/, "ISSN must look like 1234-567X")

export const TaxonomyNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lowercase ASCII slugs"),
  type: z.enum(["condition", "treatment", "population"]),
  name: z.string().min(1),
  synonyms: z.array(z.string().min(1)).default([]),
  /** Generic and brand names; only meaningful for drugs. */
  brands: z.array(z.string().min(1)).default([]),
  /** MeSH heading label. IDs are not stored: labels are what PubMed queries use. */
  meshHeading: z.string().min(1).optional(),
  /** True only when the label was checked against NLM's lookup. */
  meshVerified: z.boolean().default(false),
  parents: z.array(z.string()).default([]),
  /**
   * Ids of nodes that count as this one when a paper is matched to a watch entry (owner decision
   * 2026-10-06: ketamine counts for esketamine). Used for matching only, not for search queries.
   */
  related: z.array(z.string()).default([]),
  modality: z.enum(["drug", "psychotherapy", "neuromodulation", "other"]).optional(),
})
export type TaxonomyNode = z.infer<typeof TaxonomyNodeSchema>

export const TaxonomySchema = z
  .object({ version: z.string().min(1), nodes: z.array(TaxonomyNodeSchema).min(1) })
  .superRefine((taxonomy, ctx) => {
    const ids = new Set<string>()
    for (const node of taxonomy.nodes) {
      if (ids.has(node.id)) ctx.addIssue({ code: "custom", message: `duplicate taxonomy id: ${node.id}` })
      ids.add(node.id)
    }
    for (const node of taxonomy.nodes) {
      for (const parent of node.parents) {
        if (!ids.has(parent)) ctx.addIssue({ code: "custom", message: `${node.id} has unknown parent ${parent}` })
      }
    }
  })
export type Taxonomy = z.infer<typeof TaxonomySchema>

export const JOURNAL_STATES = ["pinned", "normal", "demoted", "muted"] as const

export const JournalSchema = z
  .object({
    name: z.string().min(1),
    issn: ISSN.optional(),
    eissn: ISSN.optional(),
    openalexSourceId: z.string().regex(/^S\d+$/).optional(),
    tier: z.enum(["A", "B"]),
    state: z.enum(JOURNAL_STATES).default("normal"),
    /**
     * Leading journal (1), established specialty journal (2) or other (3): an editorial choice made by
     * hand in journal-bands.json and written here by scripts/apply-journal-bands.mjs. No journal
     * metric is used. It only orders papers within a match layer; a journal is not a paper.
     */
    band: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .refine((journal) => journal.issn !== undefined || journal.eissn !== undefined, {
    message: "a journal needs an ISSN or an eISSN",
  })
export type Journal = z.infer<typeof JournalSchema>

export const JournalsSchema = z.object({ version: z.string().min(1), journals: z.array(JournalSchema) })

export const OnboardingOptionsSchema = z.object({
  roles: z.array(z.string().min(1)).min(1),
  subspecialties: z.array(z.string().min(1)),
  populations: z.array(z.string().min(1)).min(1),
})

/** Psychiatric text words for the topic pre-filter (records not yet MeSH-indexed). */
export const TextWordsSchema = z.object({ version: z.string().min(1), words: z.array(z.string().min(1)).min(1) })

export const PackManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
  name: z.string().min(1),
  files: z.object({
    taxonomy: z.string().min(1),
    journals: z.string().min(1),
    onboarding: z.string().min(1),
    textWords: z.string().min(1),
  }),
})

export interface SpecialtyPack {
  manifest: z.infer<typeof PackManifestSchema>
  taxonomy: Taxonomy
  journals: Journal[]
  onboarding: z.infer<typeof OnboardingOptionsSchema>
  textWords: string[]
}
