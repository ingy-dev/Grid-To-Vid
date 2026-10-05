import type { GifClip } from './types'

const SIZE = 240
const FRAMES = 20
const DELAY = 100

function paint(draw: (ctx: CanvasRenderingContext2D, t: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  return { canvas, ctx, draw }
}

async function clip(
  name: string,
  draw: (ctx: CanvasRenderingContext2D, t: number) => void,
): Promise<GifClip> {
  const { canvas, ctx } = paint(draw)
  const frames: ImageBitmap[] = []
  for (let i = 0; i < FRAMES; i++) {
    draw(ctx, i / FRAMES)
    frames.push(await createImageBitmap(canvas))
  }
  return {
    id: crypto.randomUUID(),
    kind: 'gif',
    name,
    frames,
    delays: frames.map(() => DELAY),
    duration: (FRAMES * DELAY) / 1000,
    width: SIZE,
    height: SIZE,
  }
}

export function makeDemo(): Promise<GifClip[]> {
  return Promise.all([
    clip('Demo ball', (ctx, t) => {
      ctx.fillStyle = '#1c3f73'
      ctx.fillRect(0, 0, SIZE, SIZE)
      const x = 36 + Math.abs((t * 2) % 2 - 1) * (SIZE - 72)
      ctx.fillStyle = '#ffb703'
      ctx.beginPath()
      ctx.arc(x, SIZE / 2, 28, 0, Math.PI * 2)
      ctx.fill()
    }),
    clip('Demo bars', (ctx, t) => {
      ctx.fillStyle = '#0f766e'
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#f8fafc'
      for (let i = -1; i < 6; i++) {
        ctx.fillRect(((i + t) % 6) * 48 - 10, 0, 18, SIZE)
      }
    }),
    clip('Demo pulse', (ctx, t) => {
      ctx.fillStyle = '#3b0764'
      ctx.fillRect(0, 0, SIZE, SIZE)
      const radius = 30 + Math.sin(t * Math.PI * 2) * 22
      ctx.strokeStyle = '#f9a8d4'
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.arc(SIZE / 2, SIZE / 2, radius, 0, Math.PI * 2)
      ctx.stroke()
    }),
    clip('Demo orbit', (ctx, t) => {
      ctx.fillStyle = '#111827'
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.save()
      ctx.translate(SIZE / 2, SIZE / 2)
      ctx.rotate(t * Math.PI * 2)
      ctx.fillStyle = '#34d399'
      ctx.fillRect(-32, -32, 64, 64)
      ctx.restore()
    }),
  ])
}
