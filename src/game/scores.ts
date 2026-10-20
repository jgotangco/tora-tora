export type ScoreRow = { name: string; score: number };

const KEY = "tora-tora-scores-v1";
const NAME_KEY = "tora-tora-name";

export function loadScores(): ScoreRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is ScoreRow =>
          !!row &&
          typeof row === "object" &&
          typeof (row as ScoreRow).name === "string" &&
          typeof (row as ScoreRow).score === "number",
      )
      .map((row) => ({
        name: row.name.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "A").slice(0, 3),
        score: Math.max(0, Math.floor(row.score)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function bestScore(): number {
  const rows = loadScores();
  return rows.length ? rows[0].score : 0;
}

export function qualifies(score: number): boolean {
  if (score <= 0) return false;
  const rows = loadScores();
  if (rows.length < 10) return true;
  return score >= rows[rows.length - 1].score;
}

/** Insert a run into the top 10. Ties keep the new run. Returns 1-based rank or null. */
export function submitScore(name: string, score: number): { scores: ScoreRow[]; rank: number | null } {
  const clean = (name.toUpperCase().replace(/[^A-Z]/g, "") + "ACE").slice(0, 3);
  const points = Math.floor(score);
  const existing = loadScores();
  if (points <= 0) return { scores: existing, rank: null };
  const row: ScoreRow = { name: clean, score: points };
  const next = [...existing, row].sort((a, b) => b.score - a.score || (a === row ? -1 : 1)).slice(0, 10);
  const rank = next.indexOf(row);
  if (rank === -1) return { scores: existing, rank: null };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    /* private mode */
  }
  return { scores: next, rank: rank + 1 };
}

export function loadName(): string {
  if (typeof localStorage === "undefined") return "ACE";
  try {
    const n = localStorage.getItem(NAME_KEY) ?? "ACE";
    const clean = n.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    return (clean + "ACE").slice(0, 3);
  } catch {
    return "ACE";
  }
}
