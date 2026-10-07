import { describe, expect, it, vi } from "vitest"
import { editFieldRemote, extractRecordRemote, loadRecordRemote } from "../records/client"
import { paperSlug } from "../../wiki/authoring"
import { RECORD } from "./records-fixture"
import { paper } from "./helpers"

const PAPER = paper({ title: "Esketamine versus quetiapine", ids: { doi: "10.1000/J.X(26)1+2" } })
const VIEW = { record: RECORD, names: { esketamine: "Esketamine" }, filing: { conditions: [], treatments: [{ code: "esketamine", name: "Esketamine" }] } }
const answering = (result: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(status === 200 ? { result } : { error: result }), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>

describe("the browser's callers of the trial-record routes", () => {
  it("asks for a paper's record by its slug and its key, so another paper with the same title does not get it", async () => {
    const fetchFn = answering(VIEW)
    expect(await loadRecordRemote(PAPER, fetchFn)).toEqual(VIEW)
    const url = new URL(fetchFn.mock.calls[0][0] as string, "http://x")
    expect(url.pathname).toBe("/api/clinical/records")
    expect(url.searchParams.get("slug")).toBe(paperSlug(PAPER))
    expect(url.searchParams.get("key")).toBe("doi:10.1000/j.x(26)1+2")
  })
  it("gives the record with the names it is filed under after an extraction and after a change", async () => {
    expect(await extractRecordRemote(PAPER, "randomized-trial", answering(VIEW))).toEqual(VIEW)
    const fetchFn = answering(VIEW)
    expect(await editFieldRemote(RECORD.slug, "arms.a1.treatmentCode", { action: "edit", value: null }, { value: "esketamine" }, fetchFn)).toEqual(VIEW)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string)).toEqual({ slug: RECORD.slug, path: "arms.a1.treatmentCode", change: { action: "edit", value: null }, expected: { value: "esketamine" } })
  })
  it("fails with the server's own words", async () => {
    await expect(loadRecordRemote(PAPER, answering("Trial data for this paper is already stored but could not be read; it was left untouched.", 409))).rejects.toThrow(/could not be read/)
  })
})
