export type Segment = { id: string; number: number; text: string; start: number; end: number };
export type Contract = { id: string; name: string; kind: "pdf" | "docx"; status: "processing" | "ready" | "error"; error: string | null; created: string; pages: number; characters: number; segments: Segment[]; text: string };
export type Occurrence = { start: number; end: number; segments: { id: string; number: number; start: number; end: number }[] };
export type Citation = { id: string; documentId: string; documentName: string; quote: string; occurrences: Occurrence[] };
export type Evidence = { documentId: string; documentName: string; segment: number; text: string; chunkId: number; start: number; end: number };
export type Coverage = { documentId: string; name: string; totalChunks: number; retrievedChunks: number; indexed: boolean; fullyExamined: boolean };
export type Message = { id: string; role: "user" | "assistant"; content: string; status: "streaming" | "complete" | "cancelled" | "error"; citations: Citation[]; activity: string[]; coverage: Coverage[]; created: string };