# GTA VI launch-day Twitch viewers, hour by hour

[![make.fun bounty](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ZiramBayam/makefun-gta6-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ZiramBayam/makefun-gta6-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

This is my entry for the [make.fun bounty "Forecast GTA VI's launch-day Twitch viewers hour by hour"](https://make.fun/bounty/gta6-twitch-ccu-forecast-01).
Not on make.fun yet? You can join through [my referral link](https://make.fun/?ref=m91yrre2&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01).

## What it does

Given a case file, the program predicts the concurrent Twitch viewer count for every hour from 02:00 to 24:00 UTC of a game's release day, and returns a five-point predictive distribution (0.05, 0.25, 0.5, 0.75, 0.95) for each hour.

The method is deliberately simple and fully deterministic:

1. Take the hour-1 print from the case file as the anchor, with a floor of 1.
2. For each comparable launch, extract its first 24 release-day hourly points and express every hour as a ratio to that comparable's own opening hour. Comparables tagged as target history are excluded, and the other unlock tiers get trust weights (comparable 1.0, early-access-contaminated 0.3, weak 0.1).
3. Discount each comparable by a log-Gaussian penalty on how far its opening print is from ours, then compute weighted quantiles of the ratio sample at each hour.
4. Scale those quantiles by 94% of our own opening print, smooth each quantile series in log space across neighbouring hours, and clamp/round the result.

The program reads only the case files it is given. It never uses the network, needs no third-party packages, and finishes in a fraction of a second.

## Running

Node.js 22 or newer is required. From this directory:

```
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` both default to `/input` and `/output` when unset. Every `*.in` file in the input directory is read in name order and gets a matching `*.out` file in the output directory containing `{"hours":[{"hour":h,"q":[...]}, ...]}`.

## Files

- `main.ts` — the whole forecaster (plain JavaScript, TypeScript-compatible).
- `LICENSE` — MIT.

Viewer data behind the bounty is attributed to SullyGnome.com; see the case files' notes for details.
