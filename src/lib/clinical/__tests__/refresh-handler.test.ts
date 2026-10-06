import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadPsychiatryPack } from "../pack/load"
import { handleRefresh } from "../feed/refresh-handler"
import { refreshClinicalFeed } from "../feed/client"
import { saveWatchEntries } from "../watch/store"
import { fastOk, paper, SETTINGS, strongOk, watch } from "./helpers"

const RCT = paper({
  title: "Esketamine nasal spray in treatment-resistant depression", ids: { pmid: "1" },
  abstract: "Adults with treatment-resistant depression received esketamine nasal spray.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Depression"], date: "2026-09-28",
})

describe("handleRefresh and the browser client", () => {
  it("streams stages, returns the feed, and the client reads both back", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "depression", treatment: "esketamine" })])
    const events: object[] = []
    const feed = await handleRefresh(storage, (event) => events.push(event), {
      loadPack: loadPsychiatryPack,
      enumerate: async () => ({ records: [RCT], total: 1, truncated: false }),
      settings: SETTINGS,
      providerOverride: { strong: strongOk(), fast: fastOk([{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "received esketamine nasal spray" }]) },
      now: () => new Date("2026-10-06T10:00:00Z"),
    })
    expect(events).toEqual(["context", "plan", "retrieve", "filter", "grade", "select"].map((stage) => ({ type: "progress", stage })))
    expect(feed.items).toHaveLength(1)

    const body = [...events, { type: "result", payload: feed }].map((event) => JSON.stringify(event)).join("\n") + "\n"
    const stages: string[] = []
    const fetched = await refreshClinicalFeed((stage) => stages.push(stage), async () => new Response(body))
    expect(stages).toEqual(["context", "plan", "retrieve", "filter", "grade", "select"])
    expect(fetched.items[0].paper.title).toBe(RCT.title)
  })

  it("surfaces a server error to the caller", async () => {
    const body = JSON.stringify({ type: "error", message: "Add at least one watch entry before refreshing the feed." }) + "\n"
    await expect(refreshClinicalFeed(undefined, async () => new Response(body))).rejects.toThrow(/watch entry/)
  })
})
