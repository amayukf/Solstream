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
