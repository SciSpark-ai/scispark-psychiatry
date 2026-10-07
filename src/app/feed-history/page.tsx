import { FeedHistory } from "@/components/clinical/FeedHistory"

// Clinical edition: every search that was run, to reopen or delete. (Upstream's own /history page,
// the log of changes to the vault, is a different thing and stays where it is.)
export default function FeedHistoryPage() {
  return <FeedHistory />
}
