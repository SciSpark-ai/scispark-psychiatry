import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import * as route from "../../../app/api/clinical/records/route"
import * as tableRoute from "../../../app/api/clinical/records/table/route"
import { llmResult, paper } from "../../clinical/__tests__/helpers"

const ABSTRACT = "Adults with treatment-resistant depression were randomised to esketamine nasal spray (n = 336) or quetiapine (n = 340). Remission occurred in 91 of 336 patients with esketamine and 60 of 340 with quetiapine."
const PAPER = paper({ title: "Esketamine versus quetiapine in treatment-resistant depression", ids: { pmid: "111" }, abstract: ABSTRACT })
const SLUG = "esketamine-versus-quetiapine-in-treatment-resistant-depression"
const S1 = "Adults with treatment-resistant depression were randomised to esketamine nasal spray (n = 336) or quetiapine (n = 340)."
const S2 = "Remission occurred in 91 of 336 patients with esketamine and 60 of 340 with quetiapine."
const q = (value: string | number | null, quote: string | null) => ({ value, quote })
const none = q(null, null)
const ANSWER = {
  isTrial: true, condition: q("treatment-resistant depression", S1), conditionCode: "treatment-resistant-depression",
  arms: [{ id: "a1", role: "treatment", treatment: q("esketamine nasal spray", S1), treatmentCode: "esketamine", n: q(336, S1) }, { id: "a2", role: "control", treatment: q("quetiapine", S1), treatmentCode: "quetiapine", n: q(340, S1) }],
  outcomes: [{ id: "o1", name: q("Remission", S2), instrument: none, timepoint: none, kind: "binary", lowerIsBetter: false, primary: true,
    results: [{ armId: "a1", n: q(336, S2), mean: none, sd: none, events: q(91, S2) }, { armId: "a2", n: q(340, S2), mean: none, sd: none, events: q(60, S2) }] }],
}
const post = (body: unknown) => route.POST(new Request("http://x/api/clinical/records", { method: "POST", body: JSON.stringify(body) }))
const patch = (body: unknown) => route.PATCH(new Request("http://x/api/clinical/records", { method: "PATCH", body: JSON.stringify(body) }))
const KEY = "pmid:111"
const FILE = `records/${SLUG}.json`
const get = (slug: string, key: string | null = KEY) => route.GET(new Request(`http://x/api/clinical/records?slug=${encodeURIComponent(slug)}${key === null ? "" : `&key=${encodeURIComponent(key)}`}`))
const offline = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch

let storage: MemoryVaultStorage
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  await storage.write(".scispark/settings.json", JSON.stringify({ ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }))
  setServerVaultForTests(storage)
})
afterEach(() => { setServerVaultForTests(null); setSkillTestOverrides() })

describe("/api/clinical/records", () => {
  it("extracts on request, stores the record, and returns it afterwards without a model", async () => {
    const strong = new MockProvider([llmResult(ANSWER, "claude-sonnet-5")])
    setSkillTestOverrides({ providerOverride: { strong }, fetchFn: offline })
    const made = await post({ paper: PAPER, design: "randomized-trial" })
    expect(made.status).toBe(200)
    const { result } = await made.json()
    expect(result.record.arms).toHaveLength(2)
    // No full text could be had, and the record says so.
    expect(result.record.source.access).toBe("abstract")
    const read = await (await get(SLUG)).json()
    expect(read.result.record.slug).toBe(SLUG)
    expect(strong.calls).toHaveLength(1)
  })

  it("returns an existing record without reading the paper or calling a model, so a second extraction cannot overwrite confirmed values", async () => {
    const first = new MockProvider([llmResult(ANSWER, "claude-sonnet-5")])
    setSkillTestOverrides({ providerOverride: { strong: first }, fetchFn: offline })
    const made = (await (await post({ paper: PAPER, design: "randomized-trial" })).json()).result.record
    const confirmed = await (await patch({ slug: SLUG, path: "arms.a1.n", change: { action: "confirm" }, expected: made.arms[0].n })).json()
    const second = new MockProvider([])
    setSkillTestOverrides({ providerOverride: { strong: second }, fetchFn: offline })
    const again = await post({ paper: PAPER, design: "randomized-trial" })
    expect(again.status).toBe(200)
    expect((await again.json()).result.record).toEqual(confirmed.result.record)
    expect(second.calls).toHaveLength(0)
  })

  it("answers 422 for a paper that is not a trial and stores nothing", async () => {
    const strong = new MockProvider([])
    setSkillTestOverrides({ providerOverride: { strong }, fetchFn: offline })
    const refused = await post({ paper: PAPER, design: "meta-analysis" })
    expect(refused.status).toBe(422)
    expect(strong.calls).toHaveLength(0)
    expect((await (await get(SLUG)).json()).result.record).toBeNull()
  })

  it("rejects a slug that is a path", async () => {
    expect((await get("../.scispark/settings")).status).toBe(400)
    expect((await patch({ slug: "../.scispark/settings", path: "condition", change: { action: "confirm" }, expected: { value: "x", quote: null, state: "unverified" } })).status).toBe(400)
  })

  it("confirms a field, answers 409 to a stale change and 404 for a paper with no record", async () => {
    setSkillTestOverrides({ providerOverride: { strong: new MockProvider([llmResult(ANSWER, "claude-sonnet-5")]) }, fetchFn: offline })
    const { result } = await (await post({ paper: PAPER, design: "randomized-trial" })).json()
    const seen = result.record.arms[0].n
    const confirmed = await patch({ slug: SLUG, path: "arms.a1.n", change: { action: "confirm" }, expected: seen })
    expect((await confirmed.json()).result.record.arms[0].n.state).toBe("human-confirmed")
    expect((await patch({ slug: SLUG, path: "arms.a1.n", change: { action: "edit", value: 1 }, expected: seen })).status).toBe(409)
    expect((await patch({ slug: "no-such-paper", path: "arms.a1.n", change: { action: "confirm" }, expected: seen })).status).toBe(404)
  })
})

describe("/api/clinical/records: whose record it is, and what is never overwritten", () => {
  const extracted = async () => {
    setSkillTestOverrides({ providerOverride: { strong: new MockProvider([llmResult(ANSWER, "claude-sonnet-5")]) }, fetchFn: offline })
    return (await (await post({ paper: PAPER, design: "randomized-trial" })).json()).result
  }
  const TWIN = paper({ title: PAPER.title, ids: { pmid: "999" }, abstract: ABSTRACT })

  it("gives a paper its record only when the record was read from that paper", async () => {
    await extracted()
    expect((await (await get(SLUG)).json()).result.record.paperKey).toBe(KEY)
    // Another paper with the same title has the same slug. It has no trial data.
    expect((await (await get(SLUG, "pmid:999")).json()).result.record).toBeNull()
    expect((await get(SLUG, null)).status).toBe(400)
  })

  it("answers 409 to an extraction for another paper with the same title, without a model call, and keeps the stored record", async () => {
    await extracted()
    const before = await storage.read(FILE)
    const second = new MockProvider([llmResult(ANSWER, "claude-sonnet-5")])
    setSkillTestOverrides({ providerOverride: { strong: second }, fetchFn: offline })
    const refused = await post({ paper: TWIN, design: "randomized-trial" })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe("Another paper with the same title already has trial data stored. This paper's data cannot be stored beside it.")
    expect(second.calls).toHaveLength(0)
    expect(await storage.read(FILE)).toBe(before)
  })

  it("answers 409 for a stored file it cannot read: it is not offered for extraction and not overwritten", async () => {
    await storage.write(FILE, "{ not json")
    const read = await get(SLUG)
    expect(read.status).toBe(409)
    expect((await read.json()).error).toBe("Trial data for this paper is already stored but could not be read; it was left untouched.")
    const strong = new MockProvider([llmResult(ANSWER, "claude-sonnet-5")])
    setSkillTestOverrides({ providerOverride: { strong }, fetchFn: offline })
    const refused = await post({ paper: PAPER, design: "randomized-trial" })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain("could not be read; it was left untouched")
    expect(strong.calls).toHaveLength(0)
    expect(await storage.read(FILE)).toBe("{ not json")
  })

  it("stores one record when the same paper is sent twice at once, and gives both callers that record", async () => {
    setSkillTestOverrides({ providerOverride: { strong: new MockProvider([llmResult(ANSWER, "claude-sonnet-5"), llmResult(ANSWER, "claude-sonnet-5")]) }, fetchFn: offline })
    const [first, second] = await Promise.all([post({ paper: PAPER, design: "randomized-trial" }), post({ paper: PAPER, design: "randomized-trial" })])
    expect([first.status, second.status]).toEqual([200, 200])
    expect((await first.json()).result.record).toEqual((await second.json()).result.record)
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })

  it("says under which terms of the pack the record is filed, and gives the terms to choose from", async () => {
    const result = await extracted()
    expect(result.names).toEqual({ "treatment-resistant-depression": "Treatment-resistant depression", esketamine: "Esketamine", quetiapine: "Quetiapine" })
    expect(result.filing.conditions).toContainEqual({ code: "schizophrenia", name: "Schizophrenia" })
    expect(result.filing.treatments).toContainEqual({ code: "ketamine", name: "Ketamine" })
    expect(result.filing.treatments.some((entry: { code: string }) => entry.code === "schizophrenia")).toBe(false)
    const read = (await (await get(SLUG)).json()).result
    expect(read.names).toEqual(result.names)
    expect(read.filing).toEqual(result.filing)
    expect((await (await get("no-such-paper")).json()).result).toEqual({ record: null, names: {}, filing: { conditions: [], treatments: [] } })
  })

  it("files an arm under ketamine once its name is corrected to ketamine, and under nothing for a name the pack does not know", async () => {
    const { record } = await extracted()
    const corrected = (await (await patch({ slug: SLUG, path: "arms.a1.treatment", change: { action: "edit", value: "ketamine" }, expected: record.arms[0].treatment })).json()).result
    expect(corrected.record.arms[0].treatmentCode).toBe("ketamine")
    expect(corrected.names.ketamine).toBe("Ketamine")
    expect(corrected.names.esketamine).toBeUndefined()
    const unknown = (await (await patch({ slug: SLUG, path: "arms.a1.treatment", change: { action: "edit", value: "an unnamed compound" }, expected: corrected.record.arms[0].treatment })).json()).result
    expect(unknown.record.arms[0].treatmentCode).toBeNull()
  })

  it("changes what an arm is filed under on request, checking the term against the pack", async () => {
    await extracted()
    const refiled = await patch({ slug: SLUG, path: "arms.a1.treatmentCode", change: { action: "edit", value: "ketamine" }, expected: { value: "esketamine" } })
    expect((await refiled.json()).result.record.arms[0].treatmentCode).toBe("ketamine")
    expect((await patch({ slug: SLUG, path: "arms.a1.treatmentCode", change: { action: "edit", value: "schizophrenia" }, expected: { value: "ketamine" } })).status).toBe(400)
    expect((await patch({ slug: SLUG, path: "conditionCode", change: { action: "edit", value: null }, expected: { value: "treatment-resistant-depression" } })).status).toBe(200)
    expect((await patch({ slug: SLUG, path: "conditionCode", change: { action: "edit", value: "depression" }, expected: { value: "treatment-resistant-depression" } })).status).toBe(409)
  })

  it("counts a trial under a direction only after the reader has confirmed the direction of benefit and both roles", async () => {
    const { record } = await extracted()
    const table = async () => (await (await tableRoute.GET(new Request("http://x/api/clinical/records/table?condition=depression"))).json()).result.rows[0]
    expect(await table()).toMatchObject({ trials: 1, favours: 0, unconfirmed: 1 })
    await patch({ slug: SLUG, path: "outcomes.o1.lowerIsBetter", change: { action: "confirm" }, expected: { value: false, state: "unverified" } })
    await patch({ slug: SLUG, path: "arms.a1.role", change: { action: "confirm" }, expected: { value: record.arms[0].role, state: "unverified" } })
    expect(await table()).toMatchObject({ favours: 0, unconfirmed: 1 })
    await patch({ slug: SLUG, path: "arms.a2.role", change: { action: "confirm" }, expected: { value: "control", state: "unverified" } })
    expect(await table()).toMatchObject({ favours: 1, unconfirmed: 0 })
  })

  it("keeps the paper in the stored record", async () => {
    await extracted()
    expect(JSON.parse((await storage.read(FILE)) as string).paper.ids).toEqual({ pmid: "111" })
  })
})

describe("/api/clinical/records/table", () => {
  const table = (condition: string) => tableRoute.GET(new Request(`http://x/api/clinical/records/table?condition=${encodeURIComponent(condition)}`))
  it("builds the table of a condition from the stored records, taking in its subtypes", async () => {
    setSkillTestOverrides({ providerOverride: { strong: new MockProvider([llmResult(ANSWER, "claude-sonnet-5")]) }, fetchFn: offline })
    await post({ paper: PAPER, design: "randomized-trial" })
    const { result } = await (await table("depression")).json()
    expect(result.condition.code).toBe("depression")
    expect(result.rows.map((row: { key: string; trials: number }) => [row.key, row.trials])).toEqual([["esketamine", 1]])
  })
  it("answers 404 for a condition the pack does not have and 400 for a malformed one", async () => {
    expect((await table("no-such-condition")).status).toBe(404)
    expect((await table("../etc")).status).toBe(400)
    // A treatment is not a condition.
    expect((await table("esketamine")).status).toBe(404)
  })
})
