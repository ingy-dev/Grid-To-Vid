import { MAX_CLIP_SECONDS, type Fit, type FrameId, type ShapePref } from './types'

export const FPS = 30

export function gridShape(count: number, pref: ShapePref): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 }
  const target = pref === 'wide' ? 16 / 9 : pref === 'tall' ? 9 / 16 : 1
  let best: { cols: number; rows: number; score: number; aspect: number } | null = null
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const empty = cols * rows - count
    const aspect = cols / rows
    const score = empty * 1.15 + Math.abs(Math.log(aspect / target))
    if (
      !best ||
      score < best.score - 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && aspect > best.aspect)
    ) {
      best = { cols, rows, score, aspect }
    }
  }
  return { cols: best!.cols, rows: best!.rows }
}

export function clipFrameCount(seconds: number): number {
  return Math.max(1, Math.round(seconds * FPS))
}

export function usedSeconds(seconds: number, clipSeconds: number) {
  return Math.max(0.1, Math.min(seconds, clipSeconds))
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

/** Length of the file in frames. Auto loops each clip a whole number of times, capped at 10 seconds. */
export function exportFrameCount(durations: number[], lengthSeconds: number | null = null): number {
  if (lengthSeconds != null && lengthSeconds > 0) return Math.max(1, Math.round(FPS * lengthSeconds))
  const cap = FPS * MAX_CLIP_SECONDS
  let cycle = 1
  for (const seconds of durations) {
    const n = clipFrameCount(seconds)
    cycle = (cycle / gcd(cycle, n)) * n
    if (!Number.isFinite(cycle) || cycle > cap) return cap
  }
  return Math.max(1, Math.round(cycle))
}

export type FrameSpec = {
  id: FrameId
  width: number
  height: number
  ratio: string
}

export const FRAMES: FrameSpec[] = [
  { id: '1920x1080', width: 1920, height: 1080, ratio: '16:9' },
  { id: '1280x720', width: 1280, height: 720, ratio: '16:9' },
  { id: '1080x1080', width: 1080, height: 1080, ratio: '1:1' },
  { id: '1080x1350', width: 1080, height: 1350, ratio: '4:5' },
  { id: '1080x1920', width: 1080, height: 1920, ratio: '9:16' },
  { id: '720x1280', width: 720, height: 1280, ratio: '9:16' },
]

export function frameById(id: FrameId): FrameSpec {
  return FRAMES.find((frame) => frame.id === id) ?? FRAMES[0]
}

export function gifSize(width: number, height: number) {
  const longEdge = 640
  if (width >= height) {
    return { width: longEdge, height: even(height * (longEdge / width)) }
  }
  return { width: even(width * (longEdge / height)), height: longEdge }
}

function even(value: number) {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

export function outputLayout(cols: number, rows: number, frame: FrameSpec) {
  const gif = gifSize(frame.width, frame.height)
  const placed = placeGrid(cols, rows, frame.width, frame.height)
  const gifPlaced = placeGrid(cols, rows, gif.width, gif.height)
  const large = Math.max(frame.width, frame.height) >= 1080
  return {
    ...placed,
    ratio: frame.ratio,
    gifWidth: gifPlaced.width,
    gifHeight: gifPlaced.height,
    gifCell: gifPlaced.cell,
    gifOffsetX: gifPlaced.offsetX,
    gifOffsetY: gifPlaced.offsetY,
    gifColors: large ? 256 : 128,
    quality: large ? ('high' as const) : ('medium' as const),
  }
}

function placeGrid(cols: number, rows: number, width: number, height: number) {
  const cell = Math.max(2, Math.floor(Math.min(width / cols, height / rows)))
  const gridWidth = cell * cols
  const gridHeight = cell * rows
  return {
    cell,
    width,
    height,
    offsetX: Math.floor((width - gridWidth) / 2),
    offsetY: Math.floor((height - gridHeight) / 2),
  }
}

export function placedRect(
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: Fit,
) {
  const scale =
    fit === 'cover'
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight)
  const dw = sourceWidth * scale
  const dh = sourceHeight * scale
  return {
    dx: x + (width - dw) / 2,
    dy: y + (height - dh) / 2,
    dw,
    dh,
  }
}
