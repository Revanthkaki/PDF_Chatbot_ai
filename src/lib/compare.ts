import { diffArrays, diffWords } from "diff";
import type { Contract, Occurrence } from "./types";
import { locateQuote } from "./verification";

type Clause = { text: string; number: number; heading: string; topic: string };
export type Change = { id: string; type: "added" | "removed" | "modified"; significance: "High" | "Medium" | "Low"; topic: string; explanation: string; original: string; revised: string; originalOccurrences: Occurrence[]; revisedOccurrences: Occurrence[] };
const topics: [string, RegExp][] = [["Liability", /liabilit|damages|\bcap(?:ped)?\b/i], ["Indemnity", /indemn/i], ["Termination", /terminat|cancell/i], ["Fees", /\bfees?\b|payment|charges?|remuneration/i], ["Confidentiality", /confidential|non.disclosure/i], ["Governing law", /governing|jurisdiction|applicable law/i]];
const topicOf = (text: string) => topics.find(([, regex]) => regex.test(text))?.[0] || "General terms";
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function similarity(before: Clause, after: Clause) {
  const left = words(before.text); const right = words(after.text);
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size);
}
function clauses(document: Contract): Clause[] {
  return document.segments.flatMap(segment => segment.text.split(/\n\s*\n|\n(?=\s*\d+(?:\.\d+)*[.)]?\s+[A-Za-z])/).map(text => text.trim()).filter(Boolean).map(text => ({ text, number: segment.number, heading: text.match(/^\d+(?:\.\d+)*[.)]?\s+/)?.[0].trim() || "", topic: topicOf(text) })));
}
const equivalent = (before: Clause, after: Clause) => before.text === after.text || similarity(before, after) > 0.5 || (before.heading !== "" && before.heading === after.heading && similarity(before, after) > 0.15);
function money(text: string) { return text.match(/(?:AED|USD|EUR|GBP|\$)\s*[\d,]+(?:\.\d+)?/gi) || []; }
function durations(text: string) {
  const numberWord = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)";
  return text.match(new RegExp(`\\b(?:\\d+|${numberWord}(?:[ -]+(?:and[ -]+)?${numberWord})*)\\s+(?:(?:business|calendar)\\s+)?(?:hours?|days?|weeks?|months?|years?)\\b`, "gi")) || [];
}
export function compareContracts(original: Contract, revised: Contract) {
  const originalClauses = clauses(original); const revisedClauses = clauses(revised);
  const limit = 12000;
  const left = originalClauses.slice(0, limit); const right = revisedClauses.slice(0, limit);
  const changes: Change[] = [];
  function add(before?: Clause, after?: Clause) {
    if (before?.text === after?.text) return;
    const originalText = before?.text || ""; const revisedText = after?.text || "";
    const originalTerms = originalText.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "");
    const revisedTerms = revisedText.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "");
    const topic = topicOf(originalText + " " + revisedText);
    const type = !before ? "added" : !after ? "removed" : "modified";
    const amountsBefore = money(originalText); const amountsAfter = money(revisedText);
    const durationsBefore = durations(originalText); const durationsAfter = durations(revisedText);
    const durationChanged = durationsBefore.join().toLowerCase() !== durationsAfter.join().toLowerCase();
    const numeric = JSON.stringify(originalTerms.match(/\d[\d,.]*/g)) !== JSON.stringify(revisedTerms.match(/\d[\d,.]*/g));
    const edits = diffWords(originalTerms, revisedTerms).filter(part => part.added || part.removed);
    const wordEdits = edits.reduce((count, part) => count + (part.count || 0), 0);
    const cosmetic = before && after && originalTerms.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() === revisedTerms.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    const obligationChanged = /\b(?:shall|must|may|not|never|without|unless|except|prohibited|required|permitted|optional|unlimited|sole|exclusive)\b/i.test(edits.map(part => part.value).join(" "));
    const significance = cosmetic ? "Low" : durationChanged || obligationChanged || (topic !== "General terms" && (numeric || type !== "modified")) ? "High" : topic === "General terms" && wordEdits <= 3 && !numeric ? "Low" : "Medium";
    let explanation = `${topic} ${type === "added" ? "provision added in the revised contract" : type === "removed" ? "provision removed from the revised contract" : "wording changed"}.`;
    if (amountsBefore.join() !== amountsAfter.join()) explanation += ` Monetary amounts: ${amountsBefore.join("; ") || "none stated"} -> ${amountsAfter.join("; ") || "none stated"}.`;
    if (durationChanged) explanation += ` Notice periods or durations: ${durationsBefore.join("; ") || "none stated"} -> ${durationsAfter.join("; ") || "none stated"}.`;
    if (numeric && !amountsBefore.length && !amountsAfter.length) explanation += " Numeric terms changed; inspect the source for notice periods, durations, or limits.";
    if (obligationChanged && type === "modified") explanation += " Obligation or permission language changed.";
    if (cosmetic) explanation += originalTerms === revisedTerms ? " Clause numbering or layout changed; the provision text is unchanged." : " The words and numbers are unchanged; only formatting or punctuation differs.";
    changes.push({ id: `change-${changes.length + 1}`, type, significance, topic, explanation, original: originalText, revised: revisedText, originalOccurrences: before ? locateQuote(original, originalText.slice(0, 3500)) : [], revisedOccurrences: after ? locateQuote(revised, revisedText.slice(0, 3500)) : [] });
  }
  let oldIndex = 0; let newIndex = 0;
  const parts = diffArrays(left, right, { comparator: equivalent, timeout: 5000 });
  if (!parts) throw new Error("These versions could not be aligned within the comparison time limit. Try comparing smaller sections.");
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.removed && parts[index + 1]?.added) {
      const added = parts[++index]; const length = Math.max(part.value.length, added.value.length);
      for (let offset = 0; offset < length; offset++) {
        const before = left[oldIndex + offset]; const after = right[newIndex + offset];
        if (before && after && !equivalent(before, after) && before.topic !== after.topic) { add(before); add(undefined, after); }
        else add(before, after);
      }
      oldIndex += part.value.length; newIndex += added.value.length;
    } else if (part.removed) { for (const clause of part.value) add(clause); oldIndex += part.value.length; }
    else if (part.added) { for (const clause of part.value) add(undefined, clause); newIndex += part.value.length; }
    else { for (let offset = 0; offset < part.value.length; offset++) add(left[oldIndex + offset], right[newIndex + offset]); oldIndex += part.value.length; newIndex += part.value.length; }
  }
  return { changes, complete: originalClauses.length <= limit && revisedClauses.length <= limit, originalClauses: originalClauses.length, revisedClauses: revisedClauses.length, examinedOriginal: left.length, examinedRevised: right.length, method: "Sequence-aligned source paragraphs; deterministic significance rules, not a legal opinion." };
}