import { useEffect, useMemo, type CSSProperties } from "react";
import logo from "../assets/logo.png";

/** What went wrong: an HTTP error status, or a request that never got an answer. */
export interface Burn {
  status: number | null;
  statusText: string;
  message?: string;
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

const HEADLINES: [(s: number | null) => boolean, string[]][] = [
  [(s) => s === null, ["Serveur en mode ghost 👻", "Personne au bout du fil", "Le serveur t'a vu, il a pas répondu"]],
  [(s) => s === 401, ["T'es qui toi ? 🤨", "Montre tes papiers"]],
  [(s) => s === 403, ["Interdit de burnes 🚫", "Même pas en rêve"]],
  [(s) => s === 404, ["404 burnes not found", "Ça existe pas frérot"]],
  [(s) => s === 418, ["Je suis une théière ☕", "Tea time, pas burn time"]],
  [(s) => s === 429, ["Calme tes burnes 🧊", "Trop de requêtes, chill"]],
  [(s) => s !== null && s < 500, ["Bad request, bad vibes", "C'est toi le problème", "Le serveur te juge"]],
  [(s) => s !== null && s >= 500, ["Le backend a craqué 💥", "Le serveur a les burnes en vrac", "Ça a pété en prod"]],
];

const CAPTIONS = [
  "skill issue",
  "L + ratio",
  "emotional damage",
  "no cap fr fr",
  "it's giving error",
  "touch grass",
  "certified bruh moment",
  "le flop 📉",
  "mission failed",
  "c'est chaud",
  "main character du bug",
  "rip bozo",
  "nah ça va pas",
  "cringe",
  "sus 📮",
  "ok boomer",
];

const EMOJIS = ["💀", "🔥", "😭", "🥜", "💥", "🤡", "😵‍💫", "🫠", "📉", "🚨", "☠️", "🗿"];

const STICKER_SPOTS = [
  { top: "14%", left: "7%" },
  { top: "20%", right: "8%" },
  { top: "66%", left: "6%" },
  { top: "72%", right: "7%" },
  { top: "42%", left: "3%" },
  { top: "46%", right: "3%" },
];

/** A synthesized "vine boom": a short, low, falling sine with a bit of grit. */
function boom() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    const shaper = ctx.createWaveShaper();
    shaper.curve = Float32Array.from({ length: 256 }, (_, i) => Math.tanh(((i / 128) - 1) * 4));
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.6);
    osc.connect(shaper).connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1);
    osc.onended = () => ctx.close();
  } catch {
    // no audio, no boom
  }
}

interface Props {
  burn: Burn;
  onClose: () => void;
}

export function BurnedOverlay({ burn, onClose }: Props) {
  const { status } = burn;

  // Rolled once per burn so the chaos doesn't reshuffle on re-render
  const scene = useMemo(() => {
    const headline = pick(HEADLINES.find(([match]) => match(status))![1]);
    const captions = [...CAPTIONS].sort(() => Math.random() - 0.5);
    return {
      headline,
      stickers: STICKER_SPOTS.map((spot, i) => ({
        spot,
        text: captions[i],
        rotate: rand(-18, 18),
        delay: 0.25 + i * 0.09,
      })),
      rain: Array.from({ length: 28 }, () => ({
        emoji: pick(EMOJIS),
        left: rand(0, 100),
        size: rand(22, 54),
        duration: rand(2.6, 5.5),
        delay: rand(-5, 0),
      })),
      tape: Array.from({ length: 12 }, () => pick(["BURNED", "SKILL ISSUE", "L", "RATIO", "💀", "ERROR", "NO CAP"])).join("  ⚠  "),
    };
  }, [burn]);

  useEffect(() => {
    boom();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [burn, onClose]);

  const code = status === null ? "∅" : String(status);
  const detail = status === null ? burn.message || "No response" : burn.statusText;

  return (
    <div className="burned" role="alertdialog" aria-label="Request failed" onClick={onClose}>
      <div className="burned-flash" />
      <div className="burned-rain" aria-hidden>
        {scene.rain.map((r, i) => (
          <span
            key={i}
            style={{ left: `${r.left}%`, fontSize: r.size, animationDuration: `${r.duration}s`, animationDelay: `${r.delay}s` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      <div className="burned-tape top" aria-hidden><div>{scene.tape}  ⚠  {scene.tape}</div></div>
      <div className="burned-tape bottom" aria-hidden><div>{scene.tape}  ⚠  {scene.tape}</div></div>

      <div className="burned-code" aria-hidden>{code}</div>

      {scene.stickers.map((s, i) => (
        <div key={i} className="burned-sticker" style={{ ...s.spot, "--r": `${s.rotate}deg`, animationDelay: `${s.delay}s` } as unknown as CSSProperties}>
          {s.text}
        </div>
      ))}

      <div className="burned-center" onClick={(e) => e.stopPropagation()}>
        <div className="burned-logo">
          <img src={logo} alt="" />
          <span className="burned-skull">💀</span>
        </div>
        <h1 className="burned-title" data-text="T'AS ÉTÉ BURNED">T'AS ÉTÉ BURNED</h1>
        <div className="burned-headline">{scene.headline}</div>
        <div className="burned-status">
          <b>{code}</b>
          <span>{detail}</span>
        </div>
        <button className="burned-btn" onClick={onClose} autoFocus>
          ok j'avoue c'est ma faute 😔
        </button>
        <div className="burned-hint">Esc pour pleurer en silence</div>
      </div>
    </div>
  );
}
