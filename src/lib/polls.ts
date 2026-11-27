export interface CreatorPollState {
  username: string;
  question: string;
  optionA: string;
  optionB: string;
  minVoteLamports: number;
  isActive: boolean;
  startedAt: number;
  votesA: number;
  votesB: number;
  lamportsA: number;
  lamportsB: number;
}

export function classifyPollVote(message?: string | null): "A" | "B" | null {
  if (!message || typeof message !== "string") return null;
  if (/\[VOTE:A\]/i.test(message) || /(?:^|\s)#A\b/i.test(message)) return "A";
  if (/\[VOTE:B\]/i.test(message) || /(?:^|\s)#B\b/i.test(message)) return "B";
  return null;
}

export function stripVoteTagForSpeech(message: string): string {
  return message
    .replace(/\[VOTE:[AB]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PollSignPayloadInput {
  username: string;
  action: "upsert" | "close";
  question: string;
  optionA: string;
  optionB: string;
  minVoteSol: number;
  timestampMs: number;
  nonce: string;
}

/**
 * Canonical signed message binding every poll mutation field and replay nonce.
 */
export function buildPollSignPayload(input: PollSignPayloadInput): string {
  return JSON.stringify({
    domain: "solstream:poll:v1",
    username: input.username.trim().toLowerCase(),
    action: input.action,
    question: input.question.trim(),
    optionA: input.optionA.trim(),
    optionB: input.optionB.trim(),
    minVoteSol: Number(input.minVoteSol) || 0.005,
    timestampMs: input.timestampMs,
    nonce: input.nonce,
  });
}
