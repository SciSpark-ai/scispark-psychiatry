import { CLINICAL_COPY } from "@/lib/clinical/copy"

const CLASS_LABELS = new Map<string, string>(Object.entries(CLINICAL_COPY.evidence.classLabels))

/** The name of a class of treatment: the pack's own label, else the copy's name for its key, else the key. */
export const classNameOf = (key: string, label: string | null): string => label ?? CLASS_LABELS.get(key) ?? key
