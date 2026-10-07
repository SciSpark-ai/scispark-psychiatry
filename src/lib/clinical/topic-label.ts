/** How a topic (a watch entry) is written, everywhere it is shown. Structure, not wording: the names are the user's own. */

interface TopicParts {
  condition?: string
  condition2?: string
  conditionJoin?: "and" | "or"
  treatment?: string
}

/** "ADHD", "ADHD + Autism" (both required) or "ADHD or Autism" (either). */
export function conditionLabel(topic: TopicParts): string | undefined {
  if (!topic.condition) return undefined
  if (!topic.condition2) return topic.condition
  return topic.conditionJoin === "or" ? `${topic.condition} or ${topic.condition2}` : `${topic.condition} + ${topic.condition2}`
}

/** The whole topic: its condition part, then "× treatment". */
export function topicLabel(topic: TopicParts): string {
  return [conditionLabel(topic), topic.treatment].filter(Boolean).join(" × ")
}
