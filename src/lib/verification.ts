import type { Citation, Contract, Occurrence } from "./types";

export function normalizeWithMap(text: string) {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (/\s/u.test(character)) {
      if (characters.length && characters[characters.length - 1] !== " ") {
        characters.push(" ");
        starts.push(index);
        ends.push(index + 1);
      } else if (characters[characters.length - 1] === " ") ends[ends.length - 1] = index + 1;
    } else {
      characters.push(character);
      starts.push(index);
      ends.push(index + 1);
    }
  }
  if (characters[characters.length - 1] === " ") { characters.pop(); starts.pop(); ends.pop(); }
  return { text: characters.join(""), starts, ends };
}

export function locateQuote(contract: Pick<Contract, "text" | "segments">, quote: string): Occurrence[] {
  const source = normalizeWithMap(contract.text);
  const needle = normalizeWithMap(quote).text;
  if (needle.length < 8 || needle.length > 4000) return [];
  const occurrences: Occurrence[] = [];
  let position = source.text.indexOf(needle);
  while (position !== -1) {
    const start = source.starts[position];
    const end = source.ends[position + needle.length - 1];
    const segments = contract.segments.filter(segment => segment.end > start && segment.start < end).map(segment => ({ id: segment.id, number: segment.number, start: Math.max(start, segment.start) - segment.start, end: Math.min(end, segment.end) - segment.start }));
    occurrences.push({ start, end, segments });
    position = source.text.indexOf(needle, position + 1);
  }
  return occurrences;
}

export function verifyCitations(proposals: { id: string; documentId: string; quote: string }[], documents: Contract[]): Citation[] {
  const citations: Citation[] = [];
  const used = new Set<string>();
  for (const proposal of proposals.slice(0, 24)) {
    if (!/^C\d+$/.test(proposal.id) || used.has(proposal.id)) continue;
    const document = documents.find(document => document.id === proposal.documentId);
    if (!document) continue;
    const occurrences = locateQuote(document, proposal.quote);
    if (!occurrences.length) continue;
    used.add(proposal.id);
    citations.push({ ...proposal, documentName: document.name, quote: document.text.slice(occurrences[0].start, occurrences[0].end), occurrences });
  }
  return citations;
}

export function groundedAnswer(draft: string, citations: Citation[]) {
  const valid = new Set(citations.map(citation => citation.id));
  const paragraphs = draft.split(/\n\s*\n/).filter(paragraph => {
    const refs = [...paragraph.matchAll(/\[\[(C\d+)\]\]/g)].map(match => match[1]);
    return refs.length > 0 && refs.every(ref => valid.has(ref));
  });
  return paragraphs.join("\n\n") || "Insufficient verified evidence to answer this question. This does not establish that a clause is absent from the selected documents.";
}