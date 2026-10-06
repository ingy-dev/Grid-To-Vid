import type { ImportJob } from './live'
import { exportFrameCount, exportMegabytes, FPS, frameById, gridShape, outputLayout, usedSeconds } from './layout'
import { disposeClip } from './state'
import { liveStill, type Clip, type FileSize, type Fit, type FrameFit, type FrameId, type ShapePref, type VideoClip } from './types'
import { MAX_BYTES, MAX_CLIPS, MAX_GRID } from './types'

const empty = document.querySelector<HTMLElement>('#empty')!
const workspace = document.querySelector<HTMLElement>('#workspace')!
const dropTarget = document.querySelector<HTMLButtonElement>('#drop-target')!
const demoButton = document.querySelector<HTMLButtonElement>('#demo')!
const stage = document.querySelector<HTMLElement>('#stage')!
const grid = document.querySelector<HTMLElement>('#grid')!
const soundHint = document.querySelector<HTMLElement>('#sound-hint')!
const frameSelect = document.querySelector<HTMLSelectElement>('#frame')!
const frameNote = document.querySelector<HTMLElement>('#frame-note')!
const fileSizeSelect = document.querySelector<HTMLSelectElement>('#file-size')!
const fileSizeNote = document.querySelector<HTMLElement>('#file-size-note')!
const frameFitRow = document.querySelector<HTMLElement>('#frame-fit')!
const hint = document.querySelector<HTMLElement>('#hint')!
const addButton = document.querySelector<HTMLButtonElement>('#add')!
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!
const gifButton = document.querySelector<HTMLButtonElement>('#download-gif')!
const pngButton = document.querySelector<HTMLButtonElement>('#download-png')!
const downloadInstead = document.querySelector<HTMLButtonElement>('#download-instead')!
const savePhotosButton = document.querySelector<HTMLButtonElement>('#save-photos')!
const photosNote = document.querySelector<HTMLElement>('#photos-note')!
const status = document.querySelector<HTMLElement>('#status')!
const emptyStatus = document.querySelector<HTMLElement>('#empty-status')!
const fileInput = document.querySelector<HTMLInputElement>('#file')!
const adjustToggle = document.querySelector<HTMLButtonElement>('#adjust-toggle')!
const adjust = document.querySelector<HTMLElement>('#adjust')!
const toast = document.querySelector<HTMLElement>('#toast')!
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!
const shareButton = document.querySelector<HTMLButtonElement>('#share')!
const busy = document.querySelector<HTMLElement>('#busy')!
const busyLabel = document.querySelector<HTMLElement>('#busy-label')!
const busyFill = document.querySelector<HTMLElement>('#busy-fill')!
const colorInput = document.querySelector<HTMLInputElement>('#color')!
const colsValue = document.querySelector<HTMLElement>('#cols-value')!
const rowsValue = document.querySelector<HTMLElement>('#rows-value')!
const colsMinus = document.querySelector<HTMLButtonElement>('#cols-minus')!
const colsPlus = document.querySelector<HTMLButtonElement>('#cols-plus')!
const rowsMinus = document.querySelector<HTMLButtonElement>('#rows-minus')!
const rowsPlus = document.querySelector<HTMLButtonElement>('#rows-plus')!

const clips: Clip[] = []
let shape: ShapePref = 'square'
let fit: Fit = 'contain'
let frameId: FrameId = 'grid'
let frameFit: FrameFit = 'letterbox'
let fileSize: FileSize = 'medium'
let background = '#000000'
const soundIds = new Set<string>()
let exporting = false
let reading = false
let lastExport: 'video' | 'gif' | 'png' | null = null
let readyVideo: Blob | null = null
let photosSave = false
let gridKey = ''
let customGrid = false
let lockedCols = 2
let lockedRows = 2
let clipSeconds = 10
let lengthChoice: 'auto' | 3 | 5 | 10 = 'auto'
let undo: { clip: Clip; index: number } | null = null
let undoTimer = 0
let drag: {
  id: string
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  active: boolean
  moved: boolean
  cell: HTMLElement
} | null = null

const shareMode = canShareFiles()
const SHARE_TEXT =
  'Grid to Vid - An easy way to make a grid from your photos, GIFs and clips and share or save video, .gif or .png.'
const LIVE_SITE = 'https://ingy-dev.github.io/Grid-To-Vid/'
const gifViews: {
  canvas: HTMLCanvasElement
  clip: Extract<Clip, { kind: 'gif' }>
  index: number
  time: number
  last: number
}[] = []

function isIos() {
  const agent = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(agent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function canShareFiles() {
  if (!navigator.canShare) return false
  try {
    return navigator.canShare({
      files: [new File(['x'], 'gif-grid.mp4', { type: 'video/mp4' })],
    })
  } catch {
    return false
  }
}

function $(selector: string) {
  return document.querySelectorAll<HTMLButtonElement>(selector)
}

dropTarget.addEventListener('click', () => fileInput.click())
addButton.addEventListener('click', () => fileInput.click())
demoButton.addEventListener('click', () => void runDemo())
downloadButton.addEventListener('click', () => {
  photosSave = false
  void save(shareMode)
})
gifButton.addEventListener('click', () => void saveGif())
pngButton.addEventListener('click', () => void savePng())
downloadInstead.addEventListener('click', () => {
  photosSave = false
  void save(false)
})
shareButton.addEventListener('click', () => void shareVideo())
savePhotosButton.addEventListener('click', () => void saveToPhotos())
undoButton.addEventListener('click', restoreRemoved)
fileInput.addEventListener('change', () => {
  const files = fileInput.files
  if (files?.length) void ingestFiles([...files])
  fileInput.value = ''
})
adjustToggle.addEventListener('click', () => showAdjust(adjust.hidden))
adjustToggle.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || adjust.hidden) return
  event.preventDefault()
  showAdjust(false)
})
adjust.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || adjust.hidden) return
  event.preventDefault()
  showAdjust(false)
  adjustToggle.focus()
})

for (const button of $('[data-shape]')) {
  button.addEventListener('click', () => {
    shape = button.dataset.shape as ShapePref
    customGrid = false
    markDirty()
    render()
  })
}
colsMinus.addEventListener('click', () => resizeGrid('cols', -1))
colsPlus.addEventListener('click', () => resizeGrid('cols', 1))
rowsMinus.addEventListener('click', () => resizeGrid('rows', -1))
rowsPlus.addEventListener('click', () => resizeGrid('rows', 1))
for (const button of $('[data-length]')) {
  button.addEventListener('click', () => {
    const value = button.dataset.length
    lengthChoice = value === 'auto' ? 'auto' : (Number(value) as 3 | 5 | 10)
    markDirty()
    render()
  })
}
for (const button of $('[data-clip]')) {
  button.addEventListener('click', () => {
    clipSeconds = Number(button.dataset.clip)
    markDirty()
    render()
  })
}
for (const button of $('[data-fit]')) {
  button.addEventListener('click', () => {
    fit = button.dataset.fit as Fit
    markDirty()
    render()
  })
}
frameSelect.addEventListener('change', () => {
  frameId = frameSelect.value as FrameId
  markDirty()
  render()
})
fileSizeSelect.addEventListener('change', () => {
  fileSize = fileSizeSelect.value as FileSize
  markDirty()
  render()
})
for (const button of $('[data-frame-fit]')) {
  button.addEventListener('click', () => {
    frameFit = button.dataset.frameFit as FrameFit
    markDirty()
    render()
  })
}
for (const button of $('[data-color]')) {
  button.addEventListener('click', () => {
    background = button.dataset.color || '#000000'
    if (background !== 'transparent') colorInput.value = background
    markDirty()
    render()
  })
}
colorInput.addEventListener('input', () => {
  background = colorInput.value
  markDirty()
  render()
})

window.addEventListener('dragover', (event) => {
  if (![...event.dataTransfer?.items ?? []].some((item) => item.kind === 'file')) return
  event.preventDefault()
  document.body.classList.add('is-dragover')
})
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('is-dragover')
})
window.addEventListener('drop', (event) => {
  document.body.classList.remove('is-dragover')
  if (![...event.dataTransfer?.items ?? []].some((item) => item.kind === 'file')) return
  event.preventDefault()
  void ingestDrop(event.dataTransfer!)
})
window.addEventListener('paste', (event) => {
  if (typingTarget(event.target) || !event.clipboardData) return
  const files = filesFromClipboard(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void ingestFiles(files)
})

window.addEventListener('beforeunload', (event) => {
  if (!clips.length && !undo) return
  event.preventDefault()
  event.returnValue = ''
})

function showAdjust(open: boolean) {
  adjust.hidden = !open
  adjustToggle.setAttribute('aria-expanded', String(open))
}

function setStatus(text: string) {
  status.textContent = text
  emptyStatus.textContent = text
}

function setBusy(label: string, done?: number, total?: number) {
  busy.hidden = false
  busyLabel.textContent = label
  const known = done != null && total != null && total > 0
  busy.classList.toggle('is-indeterminate', !known)
  busyFill.style.width = known ? `${Math.max(4, Math.round((done / total) * 100))}%` : ''
}

function clearBusy() {
  busy.hidden = true
  busyLabel.textContent = ''
  busyFill.style.width = ''
  busy.classList.remove('is-indeterminate')
}

function markDirty() {
  lastExport = null
  readyVideo = null
  if (!exporting) setStatus('')
}

async function runDemo() {
  if (reading || exporting) return
  reading = true
  setStatus('')
  setBusy('Adding the demo…')
  demoButton.disabled = true
  try {
    clearUndo(true)
    for (const clip of clips) disposeClip(clip)
    clips.splice(0, clips.length)
    const { makeDemo } = await import('./demo')
    clips.push(...(await makeDemo()))
    soundIds.clear()
    gridKey = ''
    render()
  } finally {
    reading = false
    demoButton.disabled = false
    clearBusy()
    render()
  }
}

function typingTarget(target: EventTarget | null) {
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  const type = target.type
  return type === 'text' || type === 'search' || type === 'email' || type === 'url' || type === 'password' || type === ''
}

const PASTE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

function pastedFile(file: File, index: number) {
  const type = file.type.toLowerCase()
  const ext = PASTE_EXT[type]
  if (!ext || /\.[a-z0-9]+$/i.test(file.name)) return file
  const base = file.name && file.name !== 'blob' ? file.name : `Pasted ${index + 1}`
  return new File([file], `${base}.${ext}`, { type: file.type, lastModified: file.lastModified })
}

function filesFromClipboard(data: DataTransfer) {
  const found: File[] = []
  for (const item of data.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) found.push(file)
  }
  if (!found.length) found.push(...data.files)
  const seen = new Set<string>()
  return found.flatMap((file, index) => {
    const named = pastedFile(file, index)
    const key = `${named.name}:${named.size}:${named.type}:${named.lastModified}`
    if (seen.has(key)) return []
    seen.add(key)
    return [named]
  })
}

async function ingestDrop(transfer: DataTransfer) {
  const files: File[] = []
  let folder = false
  for (const item of transfer.items) {
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      folder = true
      continue
    }
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  if (!files.length && folder) {
    setStatus('Drop the photos or videos themselves.')
    return
  }
  await ingestFiles(files)
}

async function ingestFiles(incoming: File[]) {
  if (reading || exporting) return
  reading = true
  setBusy('Adding your photos…')
  render()
  const notes: string[] = []
  const slots = customGrid ? currentGrid().cols * currentGrid().rows : MAX_CLIPS
  const capacity = Math.min(MAX_CLIPS, slots)
  const room = Math.max(0, capacity - clips.length)
  const files = incoming.filter((file) => file.size > 0 || file.type || file.name)
  try {
    const { planImports } = await import('./live')
    const planned = await planImports(files)
    notes.push(...planned.notes)
    let jobs = planned.jobs
    if (jobs.length > room) {
      const gridFull = customGrid && slots <= clips.length
      notes.push(
        room === 0 && gridFull && clips.length < MAX_CLIPS
          ? 'Add a row or a column to fit another clip.'
          : room === 0
            ? `Using the first ${MAX_CLIPS}. Remove one to add another.`
            : 'Using the first ones that fit.',
      )
      jobs = jobs.slice(0, room)
    }
    for (let index = 0; index < jobs.length; index++) {
      setBusy(`Adding ${index + 1} of ${jobs.length}`, index + 1, jobs.length)
      setStatus(`Adding ${index + 1} of ${jobs.length}…`)
      const { clip, note } = await loadJob(jobs[index])
      if (note) notes.push(note)
      if (!clip) continue
      clips.push(clip)
      gridKey = ''
      render()
    }
  } finally {
    reading = false
    clearBusy()
    markDirty()
    setStatus([...new Set(notes)].slice(0, 2).join(' '))
    render()
  }
}

async function loadJob(job: ImportJob): Promise<{ clip: Clip | null; note?: string }> {
  const tooBig = 'That one’s too big. Try one under 40 MB.'
  if (job.kind === 'pair') {
    if (job.video.size <= MAX_BYTES) {
      try {
        const clip = await import('./video').then((mod) => mod.loadVideo(job.video))
        return { clip: await attachLiveStill({ ...clip, live: true, liveOn: true }, job.still) }
      } catch {
        if (job.still.size > MAX_BYTES) return { clip: null, note: tooBig }
        try {
          const clip = await import('./image').then((mod) => mod.loadImage(job.still))
          return { clip, note: 'Showing the photo. This browser can’t play the motion.' }
        } catch (error) {
          return { clip: null, note: error instanceof Error ? error.message : 'Couldn’t use that Live Photo.' }
        }
      }
    }
    if (job.still.size > MAX_BYTES) return { clip: null, note: tooBig }
    try {
      const clip = await import('./image').then((mod) => mod.loadImage(job.still))
      return { clip, note: 'That video’s too big. Showing the photo instead.' }
    } catch (error) {
      return { clip: null, note: error instanceof Error ? error.message : tooBig }
    }
  }
  if (job.file.size > MAX_BYTES) return { clip: null, note: tooBig }
  try {
    if (job.kind === 'gif') return { clip: await import('./gif').then((mod) => mod.loadGif(job.file)) }
    if (job.kind === 'video') {
      const clip = await import('./video').then((mod) => mod.loadVideo(job.file))
      return { clip: clip.live ? await attachLiveStill({ ...clip, liveOn: true }) : clip }
    }
    return { clip: await import('./image').then((mod) => mod.loadImage(job.file)) }
  } catch (error) {
    return { clip: null, note: error instanceof Error ? error.message : 'Use a photo, a GIF, or a video.' }
  }
}

async function attachLiveStill(clip: VideoClip, stillFile?: File): Promise<VideoClip> {
  if (stillFile && stillFile.size <= MAX_BYTES) {
    try {
      const photo = await import('./image').then((mod) => mod.loadImage(stillFile))
      const still = photo.frames[0]
      for (const frame of photo.frames.slice(1)) frame.close()
      if (still) return { ...clip, live: true, liveOn: true, still }
    } catch {
      // The motion can still play without the key photo.
    }
  }
  const still = await import('./video').then((mod) =>
    mod.posterFrame(clip.file, Math.max(0, Math.min(clip.duration / 2, clip.duration - 0.05))),
  )
  return still ? { ...clip, live: true, liveOn: true, still } : { ...clip, live: true, liveOn: true }
}

function removeClip(id: string) {
  const index = clips.findIndex((clip) => clip.id === id)
  if (index < 0) return
  clearUndo(true)
  const [clip] = clips.splice(index, 1)
  soundIds.delete(id)
  undo = { clip, index }
  toast.hidden = false
  window.clearTimeout(undoTimer)
  undoTimer = window.setTimeout(() => clearUndo(true), 5000)
  markDirty()
  gridKey = ''
  render()
}

function restoreRemoved() {
  if (!undo) return
  const { clip, index } = undo
  undo = null
  toast.hidden = true
  window.clearTimeout(undoTimer)
  clips.splice(Math.min(index, clips.length), 0, clip)
  markDirty()
  gridKey = ''
  render()
}

function clearUndo(dispose: boolean) {
  window.clearTimeout(undoTimer)
  if (undo && dispose) disposeClip(undo.clip)
  undo = null
  toast.hidden = true
}

function currentGrid() {
  if (!customGrid) return gridShape(Math.max(clips.length, 1), shape)
  return { cols: lockedCols, rows: lockedRows }
}

function gridIdentity() {
  const { cols, rows } = currentGrid()
  return `${cols}x${rows}:${clipSeconds}:${clips.map((clip) => clip.id).join(',')}`
}

function playable(clip: Clip) {
  return usedSeconds(clip.duration, clipSeconds)
}

function resizeGrid(axis: 'cols' | 'rows', delta: number) {
  if (exporting || reading) return
  const current = currentGrid()
  const cols = axis === 'cols' ? current.cols + delta : current.cols
  const rows = axis === 'rows' ? current.rows + delta : current.rows
  if (cols < 1 || rows < 1 || cols > MAX_GRID || rows > MAX_GRID) return
  if (cols * rows < clips.length) {
    setStatus(axis === 'cols' ? 'Remove a clip to use fewer columns.' : 'Remove a clip to use fewer rows.')
    return
  }
  customGrid = true
  lockedCols = cols
  lockedRows = rows
  markDirty()
  render()
}

function render() {
  if (drag?.active) return
  const hasClips = clips.length > 0
  empty.hidden = hasClips
  workspace.hidden = !hasClips
  workspace.classList.toggle('is-busy', exporting || reading)
  if (!hasClips) {
    gifViews.length = 0
    grid.innerHTML = ''
    gridKey = ''
    return
  }

  const { cols, rows } = currentGrid()
  const key = gridIdentity()
  if (key !== gridKey) {
    gridKey = key
    paintGrid(cols, rows)
  }
  const clear = background === 'transparent'
  document.body.classList.toggle('is-clear', clear)
  document.documentElement.style.setProperty('--matte', clear ? 'transparent' : background)
  grid.dataset.fit = fit
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`
  sizeGrid(cols, rows)
  updateSound()
  updateHints()
  updateChoices()
  updateButtons()
}

function paintGrid(cols: number, rows: number) {
  gifViews.length = 0
  grid.innerHTML = ''
  for (const clip of clips) {
    const cell = document.createElement('div')
    cell.className = 'cell'
    cell.dataset.id = clip.id
    mountMedia(cell, clip)
    const note = tileNote(clip)
    if (note) cell.append(makeBadge(note))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-btn remove'
    remove.setAttribute('aria-label', `Remove ${clip.name}`)
    remove.textContent = '×'
    remove.addEventListener('click', () => removeClip(clip.id))
    cell.append(remove)
    bindPointer(cell, clip.id)
    grid.append(cell)
  }

  const holes = cols * rows - clips.length
  for (let hole = 0; hole < holes; hole++) {
    if (hole === 0 && clips.length < MAX_CLIPS) {
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'cell add'
      add.textContent = 'Add'
      add.addEventListener('click', () => fileInput.click())
      grid.append(add)
      continue
    }
    const empty = document.createElement('div')
    empty.className = 'cell hole'
    empty.setAttribute('aria-hidden', 'true')
    grid.append(empty)
  }
  drawGifFrame()
}

function tileNote(clip: Clip): string {
  if (liveStill(clip)) return ''
  if (clip.duration > clipSeconds + 0.05) return `First ${clipSeconds} seconds`
  return ''
}

function mountMedia(cell: HTMLElement, clip: Clip) {
  if (clip.kind === 'gif') {
    const canvas = document.createElement('canvas')
    canvas.width = clip.width
    canvas.height = clip.height
    cell.append(canvas)
    gifViews.push({ canvas, clip, index: 0, time: 0, last: performance.now() })
    return
  }
  const stillMode = liveStill(clip)
  cell.append(stillMode ? makeStill(clip.still) : makeVideo(clip))
  if (clip.live && clip.still) cell.append(makeLiveButton(clip))
  if (!stillMode && clip.hasAudio) cell.append(makeSpeaker(clip))
}

function makeStill(bitmap: ImageBitmap) {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return canvas
}

function makeBadge(text: string) {
  const badge = document.createElement('p')
  badge.className = 'badge'
  badge.textContent = text
  return badge
}

function makeLiveButton(clip: VideoClip) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-btn live'
  const on = clip.liveOn !== false
  button.setAttribute('aria-pressed', String(on))
  button.setAttribute('aria-label', 'Live Photo')
  button.innerHTML = liveIcon(on)
  button.addEventListener('click', () => toggleLive(clip.id))
  return button
}

function makeSpeaker(clip: VideoClip) {
  const speaker = document.createElement('button')
  speaker.type = 'button'
  speaker.className = 'icon-btn speaker'
  speaker.innerHTML = speakerIcon()
  speaker.addEventListener('click', () => {
    if (soundIds.has(clip.id)) soundIds.delete(clip.id)
    else soundIds.add(clip.id)
    markDirty()
    render()
  })
  return speaker
}

function toggleLive(id: string) {
  if (exporting || reading) return
  const clip = clips.find((item) => item.id === id)
  if (!clip || clip.kind !== 'video' || !clip.still) return
  clip.liveOn = clip.liveOn === false
  if (clip.liveOn === false) soundIds.delete(id)
  markDirty()
  const cell = grid.querySelector<HTMLElement>(`.cell[data-id="${id}"]`)
  if (cell) {
    cell.querySelector('video')?.remove()
    cell.querySelector('canvas')?.remove()
    cell.querySelector('.speaker')?.remove()
    cell.querySelector('.badge')?.remove()
    const stillMode = liveStill(clip)
    const media = stillMode ? makeStill(clip.still) : makeVideo(clip)
    cell.prepend(media)
    if (!stillMode && clip.hasAudio) {
      const live = cell.querySelector('.live')
      const speaker = makeSpeaker(clip)
      if (live) live.after(speaker)
      else cell.append(speaker)
    }
    const live = cell.querySelector<HTMLButtonElement>('.live')
    if (live) {
      const on = clip.liveOn !== false
      live.setAttribute('aria-pressed', String(on))
      live.innerHTML = liveIcon(on)
    }
    const note = tileNote(clip)
    if (note) {
      const remove = cell.querySelector('.remove')
      const badge = makeBadge(note)
      if (remove) remove.before(badge)
      else cell.append(badge)
    }
  }
  render()
}

function liveIcon(on: boolean) {
  const slash = on
    ? ''
    : '<line x1="4.2" y1="19.8" x2="19.8" y2="4.2" stroke="#000" stroke-width="4.4" stroke-linecap="round"/><line x1="4.2" y1="19.8" x2="19.8" y2="4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="2.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.7"/><circle cx="12" cy="12" r="9.15"/>${slash}</svg>`
}

function makeVideo(clip: VideoClip) {
  const video = document.createElement('video')
  const limit = playable(clip)
  const trimmed = clip.duration > clipSeconds + 0.05
  video.src = clip.url
  video.playsInline = true
  video.autoplay = true
  video.loop = !trimmed
  video.muted = true
  video.setAttribute('playsinline', '')
  video.setAttribute('muted', '')
  video.preload = 'auto'
  if (trimmed) {
    video.addEventListener('timeupdate', () => {
      if (video.currentTime >= limit) video.currentTime = 0
    })
  }
  const play = () => void video.play().catch(() => {})
  video.addEventListener('loadeddata', play)
  play()
  return video
}

function bindPointer(cell: HTMLElement, id: string) {
  cell.addEventListener('pointerdown', (event) => {
    if (exporting || reading || drag) return
    if ((event.target as HTMLElement).closest('button')) return
    if (event.button !== 0) return
    const rect = cell.getBoundingClientRect()
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      active: false,
      moved: false,
      cell,
    }
  })
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.active) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) + 6) {
      drag = null
      return
    }
    if (Math.hypot(dx, dy) < 8) return
    liftCell(event)
  }
  event.preventDefault()
  drag.cell.style.left = `${event.clientX - drag.offsetX}px`
  drag.cell.style.top = `${event.clientY - drag.offsetY}px`
  const target = cellUnder(event.clientX, event.clientY)
  if (target) shiftPlaceholder(target, event.clientX, event.clientY)
}

function liftCell(event: PointerEvent) {
  if (!drag) return
  const cell = drag.cell
  const rect = cell.getBoundingClientRect()
  drag.active = true
  const placeholder = document.createElement('div')
  placeholder.className = 'cell placeholder'
  placeholder.dataset.placeholder = drag.id
  cell.before(placeholder)
  cell.classList.add('is-lifted')
  cell.style.width = `${rect.width}px`
  cell.style.height = `${rect.height}px`
  cell.style.left = `${event.clientX - drag.offsetX}px`
  cell.style.top = `${event.clientY - drag.offsetY}px`
  document.body.append(cell)
  document.body.classList.add('is-rearranging')
  try {
    cell.setPointerCapture(event.pointerId)
  } catch {
    // The pointer can already be gone.
  }
}

function cellUnder(x: number, y: number) {
  for (const node of document.elementsFromPoint(x, y)) {
    if (!(node instanceof Element)) continue
    const cell = node.closest<HTMLElement>('#grid .cell')
    if (!cell || cell.classList.contains('placeholder')) continue
    return cell
  }
  return null
}

function shiftPlaceholder(target: HTMLElement, x: number, y: number) {
  const placeholder = grid.querySelector<HTMLElement>('.placeholder')
  if (!placeholder) return
  let beforeNode: Element | null
  if (target.classList.contains('add') || target.classList.contains('hole')) {
    const anchor = grid.querySelector('.add, .hole')
    if (!anchor || placeholder.nextElementSibling === anchor) return
    beforeNode = anchor
  } else {
    const rect = target.getBoundingClientRect()
    const after = x - rect.left + (y - rect.top) > (rect.width + rect.height) / 2
    if (after) {
      if (target.nextElementSibling === placeholder) return
      beforeNode = target.nextElementSibling
    } else {
      if (placeholder.nextElementSibling === target) return
      beforeNode = target
    }
  }
  const before = new Map<HTMLElement, DOMRect>()
  for (const el of grid.querySelectorAll<HTMLElement>('.cell:not(.is-lifted)')) {
    before.set(el, el.getBoundingClientRect())
  }
  if (beforeNode) beforeNode.before(placeholder)
  else grid.append(placeholder)
  syncOrder()
  for (const [el, prev] of before) {
    const now = el.getBoundingClientRect()
    const dx = prev.left - now.left
    const dy = prev.top - now.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    for (const animation of el.getAnimations()) animation.cancel()
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 180, easing: 'ease-out' },
    )
  }
}

function syncOrder() {
  if (!drag) return
  const ids: string[] = []
  for (const el of grid.children) {
    if (!(el instanceof HTMLElement) || el.classList.contains('add')) continue
    const id = el.dataset.id || el.dataset.placeholder
    if (id) ids.push(id)
  }
  if (ids.length !== clips.length || ids.some((id) => !clips.some((clip) => clip.id === id))) return
  if (ids.every((id, index) => clips[index]?.id === id)) return
  const next = ids.map((id) => clips.find((clip) => clip.id === id)!)
  clips.splice(0, clips.length, ...next)
  drag.moved = true
}

function endDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const state = drag
  drag = null
  if (!state.active) return
  const cell = state.cell
  cell.classList.remove('is-lifted')
  cell.style.width = ''
  cell.style.height = ''
  cell.style.left = ''
  cell.style.top = ''
  const placeholder = grid.querySelector('.placeholder')
  if (placeholder) placeholder.replaceWith(cell)
  else {
    const add = grid.querySelector('.add')
    if (add) add.before(cell)
    else grid.append(cell)
  }
  document.body.classList.remove('is-rearranging')
  gridKey = gridIdentity()
  if (state.moved) markDirty()
  render()
}

function sizeGrid(cols: number, rows: number) {
  const box =
    frameId === 'grid'
      ? { width: cols, height: rows }
      : frameById(frameId)
  const maxWidth = Math.min(720, stage.parentElement?.clientWidth || 720)
  const maxHeight = Math.max(180, window.innerHeight - 420)
  const scale = Math.min(maxWidth / box.width, maxHeight / box.height)
  const stageWidth = Math.max(160, box.width * scale)
  const stageHeight = stageWidth * (box.height / box.width)
  stage.style.width = `${stageWidth}px`
  stage.style.height = `${stageHeight}px`
  const cover = frameId !== 'grid' && frameFit === 'crop'
  const cell = cover
    ? Math.max(stageWidth / cols, stageHeight / rows)
    : Math.min(stageWidth / cols, stageHeight / rows)
  grid.style.width = `${cell * cols}px`
}

function updateSound() {
  const playing = [...grid.querySelectorAll('video')].filter((video) => {
    const cell = video.closest<HTMLElement>('[data-id]')
    return cell?.dataset.id != null && soundIds.has(cell.dataset.id)
  })
  const gain = playing.length ? 1 / playing.length : 1
  for (const video of grid.querySelectorAll('video')) {
    const on = playing.includes(video)
    video.volume = gain
    video.muted = !on
    if (on) video.removeAttribute('muted')
    else video.setAttribute('muted', '')
    if (on) void video.play().catch(() => {})
  }
  for (const button of grid.querySelectorAll<HTMLButtonElement>('.speaker')) {
    const cell = button.closest<HTMLElement>('[data-id]')
    const on = cell?.dataset.id != null && soundIds.has(cell.dataset.id)
    button.setAttribute('aria-pressed', String(on))
    button.setAttribute('aria-label', on ? 'Turn this sound off' : 'Add sound from this clip')
  }
}

function updateHints() {
  hint.hidden = clips.length < 2
  hint.textContent = 'Drag to rearrange'
  const audible = clips.filter((clip) => clip.kind === 'video' && clip.hasAudio && !liveStill(clip))
  soundHint.hidden = audible.length < 2 || soundIds.size > 0
}

function updateChoices() {
  const layout = currentGrid()
  colsValue.textContent = String(layout.cols)
  rowsValue.textContent = String(layout.rows)
  const busy = exporting || reading
  colsPlus.disabled = busy || layout.cols >= MAX_GRID
  rowsPlus.disabled = busy || layout.rows >= MAX_GRID
  colsMinus.disabled = busy || layout.cols <= 1 || (layout.cols - 1) * layout.rows < clips.length
  rowsMinus.disabled = busy || layout.rows <= 1 || layout.cols * (layout.rows - 1) < clips.length
  for (const button of $('[data-shape]')) {
    button.setAttribute('aria-pressed', String(!customGrid && button.dataset.shape === shape))
  }
  for (const button of $('[data-length]')) {
    const value = button.dataset.length
    const selected = value === 'auto' ? lengthChoice === 'auto' : Number(value) === lengthChoice
    button.setAttribute('aria-pressed', String(selected))
  }
  for (const button of $('[data-clip]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.clip) === clipSeconds))
  }
  for (const button of $('[data-fit]')) {
    button.setAttribute('aria-pressed', String(button.dataset.fit === fit))
  }
  frameSelect.value = frameId
  fileSizeSelect.value = fileSize
  const picture = outputLayout(layout.cols, layout.rows, frameId, frameFit, fileSize)
  const mismatched =
    frameId !== 'grid' && Math.abs(layout.cols / layout.rows - frameById(frameId).width / frameById(frameId).height) > 0.02
  frameFitRow.hidden = !mismatched
  for (const button of $('[data-frame-fit]')) {
    button.setAttribute('aria-pressed', String(button.dataset.frameFit === frameFit))
  }
  if (frameId === 'grid') {
    frameNote.textContent = `Exports this grid at ${picture.width}×${picture.height}.`
  } else {
    const spec = frameById(frameId)
    frameNote.textContent = mismatched
      ? `${spec.use}. ${spec.width}×${spec.height}.`
      : `${spec.use}. ${spec.width}×${spec.height}, same shape as the grid.`
  }
  const seconds =
    exportFrameCount(
      clips.map((clip) => usedSeconds(clip.duration, clipSeconds)),
      lengthChoice === 'auto' ? null : lengthChoice,
    ) / FPS
  const withAudio = clips.some((clip) => soundIds.has(clip.id) && clip.kind === 'video' && !liveStill(clip))
  fileSizeNote.textContent = fileSizeCopy(
    exportMegabytes(picture.width, picture.height, seconds, fileSize, withAudio),
    fileSize,
  )
  for (const button of $('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color?.toLowerCase() === background.toLowerCase()))
  }
}

function updateButtons() {
  const locked = exporting || reading
  addButton.disabled = locked
  downloadButton.disabled = locked
  gifButton.disabled = locked
  pngButton.disabled = locked
  shareButton.disabled = locked
  savePhotosButton.hidden = !isIos()
  photosNote.hidden = savePhotosButton.hidden
  savePhotosButton.disabled = locked
  downloadInstead.hidden = !shareMode || exporting
  if (exporting) return
  downloadButton.textContent = shareMode
    ? lastExport === 'video'
      ? 'Share again'
      : 'Share video'
    : lastExport === 'video'
      ? 'Download again'
      : 'Download video'
  gifButton.textContent = lastExport === 'gif' ? 'Download GIF again' : 'Download GIF'
  pngButton.textContent = lastExport === 'png' ? 'Download PNG again' : 'Download PNG'
}

async function save(share: boolean) {
  if (exporting || reading || !clips.length) return
  exporting = true
  lastExport = null
  setStatus('')
  downloadButton.textContent = 'Making your video…'
  setBusy('Making your video…')
  render()
  try {
    const { cols, rows } = currentGrid()
    const sounds = clips.filter((clip): clip is VideoClip => soundIds.has(clip.id) && clip.kind === 'video' && !liveStill(clip))
    const { exportGrid } = await import('./export')
    const { blob, soundFailed, soundPartial } = await exportGrid({
      clips,
      cols,
      rows,
      fit,
      background,
      frame: frameId,
      frameFit,
      sounds,
      clipSeconds,
      lengthSeconds: lengthChoice === 'auto' ? null : lengthChoice,
      fileSize,
      onProgress: (done, total) => {
        const label = `Making your video… ${done} of ${total}`
        downloadButton.textContent = label
        setBusy(label, done, total)
      },
    })
    readyVideo = blob
    const forPhotos = share && photosSave
    const result = share ? await shareFile(blob, forPhotos) : 'download'
    lastExport = 'video'
    const picture = outputLayout(cols, rows, frameId, frameFit, fileSize)
    if (result === 'cancelled') return
    if (result === 'again') {
      setStatus(
        forPhotos ? 'Tap Save to Photos again, then tap Save Video.' : 'Tap Share again to send the video.',
      )
      return
    }
    if (result !== 'shared') downloadBlob(blob, 'gif-grid.mp4')
    const saved = videoSaved(result === 'shared', forPhotos, picture.width, picture.height, blob.size)
    const clearNote = background === 'transparent' ? ' Clear areas are black in the video.' : ''
    setStatus(
      soundFailed
        ? `${saved} This one has no sound.${clearNote}`
        : soundPartial
          ? `${saved} Some of the sound couldn’t be added.${clearNote}`
          : `${saved}${clearNote}`,
    )
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'Couldn’t make the video in this browser. Open this page in Chrome and try again.',
    )
  } finally {
    exporting = false
    clearBusy()
    render()
  }
}

async function saveGif() {
  if (exporting || reading || !clips.length) return
  exporting = true
  lastExport = null
  setStatus('')
  gifButton.textContent = 'Making your GIF…'
  setBusy('Making your GIF…')
  render()
  try {
    const { cols, rows } = currentGrid()
    const { exportGif } = await import('./export')
    const blob = await exportGif({
      clips,
      cols,
      rows,
      fit,
      background,
      frame: frameId,
      frameFit,
      clipSeconds,
      lengthSeconds: lengthChoice === 'auto' ? null : lengthChoice,
      fileSize,
      onProgress: (done, total) => {
        const label = `Making your GIF… ${done} of ${total}`
        gifButton.textContent = label
        setBusy(label, done, total)
      },
    })
    downloadBlob(blob, 'grid.gif')
    lastExport = 'gif'
    const picture = outputLayout(cols, rows, frameId, frameFit, fileSize)
    const saved = `Check your Downloads folder for grid.gif (${picture.gifWidth}×${picture.gifHeight}, ${formatBytes(blob.size)}).`
    const notes = [soundIds.size ? 'GIFs play with no sound.' : ''].filter(Boolean)
    setStatus(notes.length ? `${saved} ${notes.join(' ')}` : saved)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Couldn’t make the GIF. Try again.')
  } finally {
    exporting = false
    clearBusy()
    render()
  }
}

async function savePng() {
  if (exporting || reading || !clips.length) return
  exporting = true
  lastExport = null
  setStatus('')
  pngButton.textContent = 'Making your picture…'
  setBusy('Making your picture…')
  render()
  try {
    const { cols, rows } = currentGrid()
    const { exportPng } = await import('./export')
    const blob = await exportPng({
      clips,
      cols,
      rows,
      fit,
      background,
      frame: frameId,
      frameFit,
      clipSeconds,
      lengthSeconds: lengthChoice === 'auto' ? null : lengthChoice,
      fileSize,
    })
    downloadBlob(blob, 'gif-grid.png')
    lastExport = 'png'
    const picture = outputLayout(cols, rows, frameId, frameFit, fileSize)
    const saved = `Check your Downloads folder for gif-grid.png (${picture.width}×${picture.height}, ${formatBytes(blob.size)}).`
    const notes = [soundIds.size ? 'Pictures have no sound.' : ''].filter(Boolean)
    setStatus(notes.length ? `${saved} ${notes.join(' ')}` : saved)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Couldn’t make the picture. Try again.')
  } finally {
    exporting = false
    clearBusy()
    render()
  }
}

function siteAddress() {
  const host = location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return LIVE_SITE
  return new URL('./', location.href).href
}

function shareMessage() {
  return `${SHARE_TEXT}\n${siteAddress()}`
}

async function shareVideo() {
  photosSave = false
  await offerVideo()
}

async function saveToPhotos() {
  photosSave = true
  await offerVideo()
}

async function offerVideo() {
  if (exporting || reading) return
  if (!clips.length) {
    setStatus('Add a photo or video first.')
    return
  }
  if (readyVideo) {
    await sendReadyVideo(readyVideo)
    return
  }
  await save(true)
}

function videoSaved(shared: boolean, forPhotos: boolean, width: number, height: number, bytes: number) {
  if (shared && forPhotos) return 'Check the Photos app.'
  if (shared) return `Shared a ${width}×${height} video (${formatBytes(bytes)}).`
  if (forPhotos) {
    return `Couldn’t open the Photos menu. Check your Downloads folder for gif-grid.mp4 (${width}×${height}, ${formatBytes(bytes)}).`
  }
  return `Check your Downloads folder for gif-grid.mp4 (${width}×${height}, ${formatBytes(bytes)}).`
}

async function sendReadyVideo(blob: Blob) {
  const forPhotos = photosSave
  const { cols, rows } = currentGrid()
  const picture = outputLayout(cols, rows, frameId, frameFit, fileSize)
  const result = await shareFile(blob, forPhotos)
  if (result === 'cancelled') return
  if (result === 'again') {
    setStatus(forPhotos ? 'Tap Save to Photos again, then tap Save Video.' : 'Tap Share again to send the video.')
    return
  }
  if (result !== 'shared') downloadBlob(blob, 'gif-grid.mp4')
  setStatus(videoSaved(result === 'shared', forPhotos, picture.width, picture.height, blob.size))
}

async function shareFile(blob: Blob, photos = false): Promise<'shared' | 'cancelled' | 'again' | 'download'> {
  if (!navigator.share) return 'download'
  const file = new File([blob], 'gif-grid.mp4', { type: 'video/mp4' })
  const withText: ShareData = { files: [file], title: 'Grid to Vid', text: shareMessage() }
  const filesOnly: ShareData = photos ? { files: [file] } : { files: [file], title: 'Grid to Vid' }
  const allowed = (data: ShareData) => {
    if (!navigator.canShare) return true
    try {
      return navigator.canShare(data)
    } catch {
      return false
    }
  }
  const data = photos ? (allowed(filesOnly) ? filesOnly : null) : allowed(withText) ? withText : allowed(filesOnly) ? filesOnly : null
  if (!data) return 'download'
  try {
    await navigator.share(data)
    return 'shared'
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError') return 'again'
    if (data !== filesOnly && allowed(filesOnly)) {
      try {
        await navigator.share(filesOnly)
        return 'shared'
      } catch (again) {
        const next = again instanceof DOMException ? again.name : ''
        if (next === 'AbortError') return 'cancelled'
        if (next === 'NotAllowedError') return 'again'
      }
    }
    return 'download'
  }
}

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024)
  const rounded = mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)
  const text = rounded < 10 && !Number.isInteger(rounded) ? rounded.toFixed(1) : String(Math.max(rounded, 0.1))
  return `${text} MB`
}

function fileSizeCopy(mb: number, size: FileSize) {
  const about = formatBytes(mb * 1024 * 1024)
  if (size === 'small') return `About ${about}. Easiest to put on a website.`
  if (size === 'medium') return `About ${about}. A good size for a website.`
  if (size === 'large') return `About ${about}. Sharper, and still fine for most sites.`
  return mb >= 20
    ? `About ${about}. Best quality. Some websites won’t take a file this big.`
    : `About ${about}. Best quality.`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 15000)
}

function drawGifFrame() {
  const now = performance.now()
  for (const view of gifViews) {
    const dt = Math.min(100, now - view.last)
    view.last = now
    const limit = playable(view.clip)
    view.time = (view.time + dt / 1000) % limit
    let remaining = view.time * 1000
    let index = 0
    let guard = 0
    const count = view.clip.frames.length
    while (count > 0 && remaining >= view.clip.delays[index] && guard < count) {
      remaining -= view.clip.delays[index]
      index = (index + 1) % count
      guard += 1
    }
    view.index = index
    const ctx = view.canvas.getContext('2d')
    const frame = view.clip.frames[view.index]
    if (!ctx || !frame) continue
    ctx.clearRect(0, 0, view.canvas.width, view.canvas.height)
    ctx.drawImage(frame, 0, 0, view.canvas.width, view.canvas.height)
  }
}

function speakerIcon() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/></svg>`
}

function tick(now: number) {
  for (const view of gifViews) view.last ||= now
  drawGifFrame()
  requestAnimationFrame(tick)
}

requestAnimationFrame(tick)
window.addEventListener('pointermove', onPointerMove, { passive: false })
window.addEventListener('pointerup', endDrag)
window.addEventListener('pointercancel', endDrag)
window.addEventListener('resize', () => {
  if (clips.length) render()
})
render()
