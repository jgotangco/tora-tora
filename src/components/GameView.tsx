import { useEffect, useRef, useState, type RefObject } from "react";
import { Play, RotateCcw, Share2, Volume2, VolumeX } from "lucide-react";
import { ToraGame, VIEW_H, VIEW_W, type HudState } from "@/game/game";
import { loadName, loadScores, submitScore, type ScoreRow } from "@/game/scores";

function pad(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(6, "0");
}

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ToraGame | null>(null);
  const nameRef = useRef("ACE");
  const hudRef = useRef<HudState>({
    mode: "title",
    score: 0,
    best: 0,
    lives: 3,
    qualifies: false,
    muted: false,
  });
  const savedRef = useRef(false);
  const restartRef = useRef<() => void>(() => {});
  const [hud, setHud] = useState<HudState>(hudRef.current);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [name, setName] = useState("ACE");
  const [rank, setRank] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareText, setShareText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  nameRef.current = name;
  hudRef.current = hud;

  const commit = () => {
    const h = hudRef.current;
    if (savedRef.current || !h.qualifies || h.score <= 0) return;
    const res = submitScore(nameRef.current, h.score);
    savedRef.current = true;
    setSaved(true);
    setScores(res.scores);
    setRank(res.rank);
  };

  restartRef.current = () => {
    commit();
    gameRef.current?.begin();
  };

  useEffect(() => {
    setScores(loadScores());
    setName(loadName());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const slot = slotRef.current;
    if (!canvas || !slot) return;

    const fit = () => {
      const rect = slot.getBoundingClientRect();
      // Slot padding, bezel border, and bezel padding sit outside the bitmap.
      const chrome = 40;
      const scale = Math.max(
        1,
        Math.floor(Math.min((rect.width - chrome) / VIEW_W, (rect.height - chrome) / VIEW_H)),
      );
      canvas.style.width = `${VIEW_W * scale}px`;
      canvas.style.height = `${VIEW_H * scale}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(slot);

    const game = new ToraGame(canvas, {
      onHud: (next) => {
        if (next.mode === "over" && hudRef.current.mode !== "over") {
          savedRef.current = false;
          setSaved(false);
          setRank(null);
          setCopied(false);
          setShareText("");
        }
        hudRef.current = next;
        setHud(next);
      },
      onRestart: () => restartRef.current(),
    });
    gameRef.current = game;
    return () => {
      observer.disconnect();
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (hud.mode === "over" && hud.qualifies && !saved) inputRef.current?.focus();
  }, [hud.mode, hud.qualifies, saved]);

  const start = () => {
    gameRef.current?.begin();
  };

  const share = async () => {
    commit();
    const text = `I scored ${hudRef.current.score} in Tora Tora! Play at ${location.href}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Tora Tora", text });
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setShareText("");
    } catch {
      setShareText(text);
      setCopied(false);
    }
  };

  const showTouch = hud.mode === "play" || hud.mode === "pause";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <div ref={slotRef} className="grid min-h-60 min-w-0 place-items-center overflow-hidden p-3 max-md:shrink-0 md:min-h-0 md:flex-1">
          <div className="bezel border-4 border-border bg-surface p-1">
            <div className="crt">
              <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} className="pixel block bg-bg select-none" />
            </div>
          </div>
        </div>
        <aside
          className={`${hud.mode === "play" ? "hidden md:flex" : "flex"} min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-border bg-surface p-4 md:w-80 md:flex-none md:border-t-0 md:border-l`}
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-muted">PACIFIC CHANNEL</p>
              <h1 className="mt-1 text-3xl leading-none tracking-widest text-primary">TORA TORA</h1>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center border-2 border-border text-fg"
              aria-label={hud.muted ? "Unmute" : "Mute"}
              onClick={() => gameRef.current?.toggleMute()}
            >
              {hud.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </button>
          </header>

          {hud.mode === "title" && (
            <>
              <p className="text-sm leading-relaxed text-muted">
                Endless river raid. Fly the channel, break the bridges, and don't run dry.
              </p>
              <p className="font-mono text-sm text-fg">
                BEST <span className="text-primary">{scores[0] ? pad(scores[0].score) : "------"}</span>
              </p>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2 text-sm font-bold tracking-widest text-bg"
                onClick={(e) => {
                  e.currentTarget.blur();
                  start();
                }}
              >
                <Play aria-hidden size={18} />
                Start
              </button>
              <p className="text-xs tracking-widest text-muted">PRESS SPACE OR ENTER TO START</p>
            </>
          )}

          {hud.mode === "pause" && (
            <>
              <h2 className="text-2xl tracking-widest text-primary">PAUSED</h2>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2 text-sm font-bold tracking-widest text-bg"
                onClick={() => gameRef.current?.resume()}
              >
                <Play aria-hidden size={18} />
                Resume
              </button>
            </>
          )}

          {hud.mode === "over" && (
            <>
              <h2 className="text-2xl tracking-widest text-accent">GAME OVER</h2>
              <p className="font-mono text-3xl tracking-widest text-primary">{pad(hud.score)}</p>
              {hud.score > hud.best && hud.score > 0 && (
                <p className="text-sm tracking-widest text-primary">NEW HIGH SCORE</p>
              )}
              {hud.qualifies && (
                <label className="flex flex-col gap-2 text-xs tracking-widest text-muted">
                  INITIALS
                  <input
                    ref={inputRef}
                    value={name}
                    maxLength={3}
                    spellCheck={false}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    aria-label="Initials"
                    disabled={saved}
                    onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        restartRef.current();
                      }
                    }}
                    className="w-24 border-2 border-primary bg-bg px-2 py-2 text-center font-mono text-xl tracking-widest text-primary"
                  />
                </label>
              )}
              {rank !== null && <p className="text-sm text-fg">RANK {String(rank).padStart(2, "0")} OF 10</p>}
              {!hud.qualifies && hud.score > 0 && (
                <p className="text-sm leading-relaxed text-muted">Outside the top ten. The channel only keeps the best.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-primary bg-primary px-4 py-2 text-sm font-bold tracking-widest text-bg"
                  onClick={() => restartRef.current()}
                >
                  <RotateCcw aria-hidden size={16} />
                  Fly again
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-border bg-bg px-4 py-2 text-sm tracking-widest text-fg"
                  onClick={() => void share()}
                >
                  <Share2 aria-hidden size={16} />
                  Share score
                </button>
              </div>
              {copied && <p className="text-sm text-primary">Copied to clipboard.</p>}
              {shareText && (
                <input readOnly value={shareText} aria-label="Share message" className="w-full border-2 border-border bg-bg px-2 py-2 text-xs text-fg" />
              )}
            </>
          )}

          <section className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
            <h2 className="text-xs tracking-widest text-fg">BRIEFING</h2>
            <p>A and Left move left. D and Right move right. W speeds up. S slows down.</p>
            <p>Hold Space to fire. P or Esc pauses. M mutes.</p>
            <p>Banks, islands, ships, and bridges cost a life. Fly over yellow fuel barges — shooting them scores 50 but wastes the fuel. Slow down to fill the tank.</p>
            <p>Three lives. An extra life every 10,000. Bridges are worth 500.</p>
          </section>

          <section>
            <h2 className="text-xs tracking-widest text-fg">HIGH SCORES</h2>
            {scores.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No scores yet.</p>
            ) : (
              <ol className="mt-2">
                {scores.map((row, i) => (
                  <li
                    key={`${row.name}-${row.score}-${i}`}
                    className={`flex justify-between gap-3 border-b border-border py-1 font-mono text-sm ${i + 1 === rank ? "text-primary" : "text-fg"}`}
                  >
                    <span>
                      {String(i + 1).padStart(2, "0")} {row.name}
                    </span>
                    <span>{pad(row.score)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
      {showTouch && <TouchDock gameRef={gameRef} />}
      <p className="sr-only" aria-live="polite">
        {hud.mode === "over" ? `Game over. Score ${hud.score}.` : hud.mode === "pause" ? "Paused." : ""}
      </p>
    </main>
  );
}

function TouchDock({ gameRef }: { gameRef: RefObject<ToraGame | null> }) {
  return (
    <div className="touch-dock">
      <div className="grid w-44 grid-cols-3 gap-2">
        <span />
        <Hold gameRef={gameRef} action="up" label="Up" />
        <span />
        <Hold gameRef={gameRef} action="left" label="Left" />
        <Hold gameRef={gameRef} action="down" label="Down" />
        <Hold gameRef={gameRef} action="right" label="Right" />
      </div>
      <Hold gameRef={gameRef} action="fire" label="Fire" className="min-h-24 min-w-24 self-stretch" />
    </div>
  );
}

function Hold({
  gameRef,
  action,
  label,
  className = "",
}: {
  gameRef: RefObject<ToraGame | null>;
  action: "left" | "right" | "up" | "down" | "fire";
  label: string;
  className?: string;
}) {
  const set = (down: boolean) => gameRef.current?.setHold(action, down);
  return (
    <button
      type="button"
      aria-label={label}
      className={`min-h-12 min-w-12 border-2 border-border bg-bg text-xs tracking-widest text-fg ${className}`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={(e) => {
        set(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => set(false)}
    >
      {label}
    </button>
  );
}
