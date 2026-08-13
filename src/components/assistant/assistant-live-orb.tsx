"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type AssistantLiveOrbState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking";

interface AssistantLiveOrbProps {
  state: AssistantLiveOrbState;
  /** 0–1 mic / user voice level */
  inputLevel?: number;
  /** 0–1 assistant TTS level */
  outputLevel?: number;
  label?: string;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

function useSmoothedLevel(target: number) {
  const [level, setLevel] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setLevel((current) => current + (targetRef.current - current) * 0.16);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return level;
}

export function AssistantLiveOrb({
  state,
  inputLevel = 0,
  outputLevel = 0,
  label,
  className,
  size = "lg",
}: AssistantLiveOrbProps) {
  const smoothInput = useSmoothedLevel(inputLevel);
  const smoothOutput = useSmoothedLevel(outputLevel);

  const activeLevel =
    state === "speaking"
      ? smoothOutput
      : state === "listening"
        ? smoothInput
        : state === "thinking"
          ? 0.32
          : state === "connecting"
            ? 0.18
            : 0.06;

  const isActive = state !== "idle";
  const pulseScale = 1 + activeLevel * 0.14;
  const glowStrength = 0.55 + activeLevel * 0.55;

  const orbStyle = {
    "--orb-scale": pulseScale,
    "--orb-glow": glowStrength,
    "--orb-voice": activeLevel,
  } as CSSProperties;

  return (
    <div
      className={cn(
        "assistant-gemini-orb-wrap",
        size === "xs" && "assistant-gemini-orb-wrap-xs",
        size === "sm" && "assistant-gemini-orb-wrap-sm",
        size === "md" && "assistant-gemini-orb-wrap-md",
        size === "lg" && "assistant-gemini-orb-wrap-lg",
        isActive && "assistant-gemini-orb-wrap-active",
        className
      )}
      data-state={state}
      style={orbStyle}
      aria-hidden={state === "idle"}
      role="img"
      aria-label={label ?? "Voice AI visualizer"}
    >
      <div className="assistant-gemini-orb-scene">
        <span className="assistant-gemini-orb-aura assistant-gemini-orb-aura-1" aria-hidden />
        <span className="assistant-gemini-orb-aura assistant-gemini-orb-aura-2" aria-hidden />
        <span className="assistant-gemini-orb-ripple assistant-gemini-orb-ripple-1" aria-hidden />
        <span className="assistant-gemini-orb-ripple assistant-gemini-orb-ripple-2" aria-hidden />

        <div className="assistant-gemini-orb-sphere">
          <span className="assistant-gemini-orb-spectrum" aria-hidden />
          <span className="assistant-gemini-orb-mist assistant-gemini-orb-mist-1" aria-hidden />
          <span className="assistant-gemini-orb-mist assistant-gemini-orb-mist-2" aria-hidden />
          <span className="assistant-gemini-orb-mist assistant-gemini-orb-mist-3" aria-hidden />
          <span className="assistant-gemini-orb-mist assistant-gemini-orb-mist-4" aria-hidden />
          <span className="assistant-gemini-orb-highlight" aria-hidden />
          <span className="assistant-gemini-orb-shimmer" aria-hidden />
        </div>
      </div>

      {label ? <p className="assistant-gemini-orb-caption">{label}</p> : null}
    </div>
  );
}
