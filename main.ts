// Hour-by-hour Twitch viewer forecast for a game's release day (hours 2..24).
// Offline and deterministic: each comparable launch's release-day curve is turned
// into ratios against its own hour-0 print. Those ratios are weighted by a tier
// factor times a log-Gaussian penalty for how far the comparable's opening print
// sits from ours, then combined into five weighted quantiles per hour. The five
// quantile series are smoothed in log space across neighbouring hours and scaled
// by our own hour-1 print. Standard library only; no network calls.

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const HOURS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

// Map a comparable's unlock tier text to a trust weight (case-insensitive).
function tierWeight(unlock: string): number {
  const s = String(unlock == null ? "" : unlock).toLowerCase();
  if (s.includes("tier: early-access-contaminated")) return 0.3;
  if (s.includes("tier: weak")) return 0.1;
  if (s.includes("tier: comparable")) return 1.0;
  return 1.0;
}

// Extract a comparable's release-day hourly curve: only points in the release
// date part of day_start, chronological, first 24. Null means "not usable".
function releaseDayCurve(
  comparable: any
): { values: number[]; weight: number } | null {
  if (!comparable || typeof comparable !== "object") return null;
  const unlock = String(comparable.unlock == null ? "" : comparable.unlock);
  if (unlock.toLowerCase().includes("tier: target-history")) return null;
  const day = String(comparable.day_start == null ? "" : comparable.day_start).slice(0, 10);
  if (!day || !Array.isArray(comparable.hourly)) return null;
  const points = comparable.hourly
    .filter(
      (p: any) =>
        p && typeof p.from === "string" && p.from.slice(0, 10) === day
    )
    .sort((a: any, b: any) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .slice(0, 24);
  if (points.length !== 24) return null;
  return {
    values: points.map((p: any) => Number(p.viewers)),
    weight: tierWeight(unlock),
  };
}

// Weighted quantile: sort (ratio, weight) ascending by ratio, accumulate weight,
// and return the first ratio whose cumulative share reaches each level.
function weightedQuantile(pairs: Array<{ ratio: number; weight: number }>, levels: number[]): number[] {
  const sorted = pairs.slice().sort((a, b) => a.ratio - b.ratio);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  if (!(total > 0) || sorted.length === 0) return levels.map(() => 1);
  return levels.map((level) => {
    let acc = 0;
    for (const p of sorted) {
      acc += p.weight;
      if (acc >= level * total - 1e-12) return p.ratio;
    }
    return sorted[sorted.length - 1].ratio;
  });
}

// Build the 23 forecast rows for one case.
function forecastCase(cs: any): Array<{ hour: number; q: number[] }> {
  const rawKnown = Number(cs && cs.known && cs.known[0] && cs.known[0].viewers);
  const base = Math.max(1, Number.isFinite(rawKnown) ? rawKnown : 1);
  const levels = Array.isArray(cs.levels) && cs.levels.length === 5 ? cs.levels.map(Number) : DEFAULT_LEVELS;
  const curves = (Array.isArray(cs.comparables) ? cs.comparables : [])
    .map(releaseDayCurve)
    .filter((c: any) => c !== null);
  const scale = base * 0.94;

  // Raw quantile ratios for each hour, scaled by our opening print.
  const raw: number[][] = [];
  for (const h of HOURS) {
    const idx = h - 1; // hour 2 uses comparable hour 1 / hour 0
    const pairs: Array<{ ratio: number; weight: number }> = [];
    for (const comp of curves) {
      const c0 = comp.values[0];
      const ratio = comp.values[idx] / c0;
      const weight = comp.weight * Math.exp(-0.5 * Math.pow(Math.log(c0 / base) / 1.2, 2));
      if (!Number.isFinite(ratio) || !Number.isFinite(weight) || weight <= 0) continue;
      pairs.push({ ratio, weight });
    }
    if (pairs.length === 0) {
      // No usable weighting: fall back to a flat ratio of 1 for every comparable.
      // If even the comparable list is empty, keep one neutral pair so a
      // quantile is still defined and the forecast stays deterministic.
      for (const _ of curves) pairs.push({ ratio: 1, weight: 1 });
      if (pairs.length === 0) pairs.push({ ratio: 1, weight: 1 });
    }
    raw.push(weightedQuantile(pairs, levels).map((q) => q * scale));
  }

  // Smooth the five quantile series across hours in log space. The light
  // 0.35 / 0.30 / 0.35 kernel blends an hour with its neighbours, while the
  // max/min indices reuse the end hours so both ends stay well defined. The
  // tiny floor keeps the log finite even if a raw quantile ever reached zero.
  const smoothed = raw.map((row) => row.slice());
  for (let i = 0; i < raw.length; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const cur = raw[i];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    for (let k = 0; k < levels.length; k++) {
      smoothed[i][k] = Math.exp(
        0.35 * Math.log(Math.max(prev[k], 1e-12)) +
          0.30 * Math.log(Math.max(cur[k], 1e-12)) +
          0.35 * Math.log(Math.max(next[k], 1e-12))
      );
    }
  }

  return HOURS.map((h, i) => {
    let q = smoothed[i].slice(0, 5);
    while (q.length < 5) q.push(q.length ? q[q.length - 1] : 0.01);
    q = q.map((v) => {
      const f = Number.isFinite(v) ? v : 0.01;
      return Math.min(1e9, Math.max(0.01, f));
    });
    for (let k = 1; k < q.length; k++) q[k] = Math.max(q[k], q[k - 1]);
    const rounded = q.map((v) => Math.round(v * 100) / 100);
    for (let k = 1; k < rounded.length; k++) rounded[k] = Math.max(rounded[k], rounded[k - 1]);
    return { hour: h, q: rounded };
  });
}

// Read every .in case, write one .out file per case, sorted by name.
function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outputDir, { recursive: true });
  const names = readdirSync(inputDir)
    .filter((n) => n.endsWith(".in"))
    .sort();
  for (const name of names) {
    const text = readFileSync(join(inputDir, name), "utf8");
    const cs = JSON.parse(text);
    const id = String(cs && cs.id != null ? cs.id : name.replace(/\.in$/, ""));
    const out = { hours: forecastCase(cs) };
    writeFileSync(join(outputDir, id + ".out"), JSON.stringify(out), "utf8");
  }
}

main();
