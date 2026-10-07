import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import * as route from "../../../app/api/clinical/records/route"
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
const get = (slug: string) => route.GET(new Request(`http://x/api/clinical/records?slug=${encodeURIComponent(slug)}`))
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
