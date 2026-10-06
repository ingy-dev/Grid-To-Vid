import { kindOf } from './files'
import { frameById, gridShape, outputLayout, usedSeconds } from './layout'
import { disposeClip } from './state'
import type { Clip, Fit, FrameFit, FrameId, ShapePref, VideoClip } from './types'
import { MAX_BYTES, MAX_CLIPS } from './types'

const empty = document.querySelector<HTMLElement>('#empty')!
const workspace = document.querySelector<HTMLElement>('#workspace')!
const dropTarget = document.querySelector<HTMLButtonElement>('#drop-target')!
const demoButton = document.querySelector<HTMLButtonElement>('#demo')!
const stage = document.querySelector<HTMLElement>('#stage')!
const grid = document.querySelector<HTMLElement>('#grid')!
const soundHint = document.querySelector<HTMLElement>('#sound-hint')!
const frameSelect = document.querySelector<HTMLSelectElement>('#frame')!
const frameNote = document.querySelector<HTMLElement>('#frame-note')!
const frameFitRow = document.querySelector<HTMLElement>('#frame-fit')!
const hint = document.querySelector<HTMLElement>('#hint')!
const addButton = document.querySelector<HTMLButtonElement>('#add')!
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!
const gifButton = document.querySelector<HTMLButtonElement>('#download-gif')!
const downloadInstead = document.querySelector<HTMLButtonElement>('#download-instead')!
const status = document.querySelector<HTMLElement>('#status')!
const emptyStatus = document.querySelector<HTMLElement>('#empty-status')!
const adjustToggle = document.querySelector<HTMLButtonElement>('#adjust-toggle')!
const adjust = document.querySelector<HTMLElement>('#adjust')!
const fileInput = document.querySelector<HTMLInputElement>('#file')!
const toast = document.querySelector<HTMLElement>('#toast')!
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!
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
let background = '#000000'
let soundId: string | null = null
let exporting = false
let reading = false
let lastExport: 'video' | 'gif' | null = null
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
const gifViews: {
  canvas: HTMLCanvasElement
  clip: Extract<Clip, { kind: 'gif' }>
  index: number
  time: number
  last: number
}[] = []

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
downloadButton.addEventListener('click', () => void save(shareMode))
gifButton.addEventListener('click', () => void saveGif())
downloadInstead.addEventListener('click', () => void save(false))
undoButton.addEventListener('click', restoreRemoved)
fileInput.addEventListener('change', () => {
  const files = fileInput.files
  if (files?.length) void ingestFiles([...files])
  fileInput.value = ''
})

adjustToggle.addEventListener('click', () => {
  const open = adjust.hidden
  adjust.hidden = !open
  adjustToggle.setAttribute('aria-expanded', String(open))
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
    colorInput.value = background
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

window.addEventListener('beforeunload', (event) => {
  if (!clips.length && !undo) return
  event.preventDefault()
  event.returnValue = ''
})

function setStatus(text: string) {
  status.textContent = text
  emptyStatus.textContent = text
}

function markDirty() {
  lastExport = null
  if (!exporting) setStatus('')
}

async function runDemo() {
  if (reading || exporting) return
  reading = true
  setStatus('')
  demoButton.disabled = true
  try {
    clearUndo(true)
    for (const clip of clips) disposeClip(clip)
    clips.splice(0, clips.length)
    const { makeDemo } = await import('./demo')
    clips.push(...(await makeDemo()))
    soundId = null
    gridKey = ''
    render()
  } finally {
    reading = false
    demoButton.disabled = false
    render()
  }
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
    setStatus('Drop the GIF or video files themselves.')
    return
  }
  await ingestFiles(files)
}

async function ingestFiles(incoming: File[]) {
  if (reading || exporting) return
  reading = true
  render()
  const notes: string[] = []
  const capacity = customGrid ? currentGrid().cols * currentGrid().rows : MAX_CLIPS
  const room = Math.max(0, capacity - clips.length)
  let files = incoming.filter((file) => file.size > 0 || file.type || file.name)
  if (files.length > room) {
    notes.push(
      room === 0 && customGrid
        ? 'Add a row or a column to fit another clip.'
        : room === 0
          ? 'Using the first 12. Remove one to add another.'
          : 'Using the first ones that fit.',
    )
    files = files.slice(0, room)
  }
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      setStatus(`Reading ${index + 1} of ${files.length}…`)
      if (file.size > MAX_BYTES) {
        notes.push('That one’s too big. Try a GIF or video under 15 MB.')
        continue
      }
      const kind = kindOf(file)
      if (!kind) {
        notes.push('Use a GIF or a video.')
        continue
      }
      try {
        const clip =
          kind === 'gif'
            ? await import('./gif').then((mod) => mod.loadGif(file))
            : await import('./video').then((mod) => mod.loadVideo(file))
        clips.push(clip)
        gridKey = ''
        render()
      } catch (error) {
        notes.push(error instanceof Error ? error.message : 'Use a GIF or a video.')
      }
    }
  } finally {
    reading = false
    markDirty()
    setStatus([...new Set(notes)].slice(0, 2).join(' '))
    render()
  }
}

function removeClip(id: string) {
  const index = clips.findIndex((clip) => clip.id === id)
  if (index < 0) return
  clearUndo(true)
  const [clip] = clips.splice(index, 1)
  if (soundId === id) soundId = null
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
  const current = currentGrid()
  let cols = current.cols
  let rows = current.rows
  if (axis === 'cols') cols += delta
  else rows += delta
  if (cols < 1 || rows < 1 || cols > MAX_CLIPS || rows > MAX_CLIPS) return
  if (axis === 'cols') rows = Math.max(rows, Math.ceil(clips.length / cols))
  else cols = Math.max(cols, Math.ceil(clips.length / rows))
  if (cols > MAX_CLIPS || rows > MAX_CLIPS || cols * rows > MAX_CLIPS) {
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
  document.documentElement.style.setProperty('--matte', background)
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
    if (clip.kind === 'gif') {
      const canvas = document.createElement('canvas')
      canvas.width = clip.width
      canvas.height = clip.height
      cell.append(canvas)
      gifViews.push({ canvas, clip, index: 0, time: 0, last: performance.now() })
    } else {
      cell.append(makeVideo(clip))
      if (clip.hasAudio) {
        const speaker = document.createElement('button')
        speaker.type = 'button'
        speaker.className = 'icon-btn speaker'
        speaker.innerHTML = speakerIcon()
        speaker.addEventListener('click', () => {
          soundId = soundId === clip.id ? null : clip.id
          markDirty()
          render()
        })
        cell.append(speaker)
      }
    }
    if (clip.duration > clipSeconds + 0.05) {
      const badge = document.createElement('p')
      badge.className = 'badge'
      badge.textContent = `First ${clipSeconds} seconds`
      cell.append(badge)
    }
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
  if (holes > 0 && clips.length < MAX_CLIPS) {
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'cell add'
    add.textContent = 'Add'
    add.addEventListener('click', () => fileInput.click())
    grid.append(add)
  }
  drawGifFrame()
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
  if (target.classList.contains('add')) {
    if (placeholder.nextElementSibling === target) return
    beforeNode = target
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
  for (const video of grid.querySelectorAll('video')) {
    const cell = video.closest<HTMLElement>('[data-id]')
    const on = cell?.dataset.id === soundId
    video.muted = !on
    if (on) video.removeAttribute('muted')
    else video.setAttribute('muted', '')
    if (on) void video.play().catch(() => {})
  }
  for (const button of grid.querySelectorAll<HTMLButtonElement>('.speaker')) {
    const cell = button.closest<HTMLElement>('[data-id]')
    const on = cell?.dataset.id === soundId
    button.setAttribute('aria-pressed', String(on))
    button.setAttribute('aria-label', on ? 'Turn sound off' : 'Use sound from this video')
  }
}

function updateHints() {
  hint.hidden = clips.length < 2
  hint.textContent = 'Drag to rearrange'
  const videos = clips.filter((clip) => clip.kind === 'video')
  soundHint.hidden = videos.length < 2 || soundId !== null
}

function updateChoices() {
  const layout = currentGrid()
  colsValue.textContent = String(layout.cols)
  rowsValue.textContent = String(layout.rows)
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
  const picture = outputLayout(layout.cols, layout.rows, frameId, frameFit)
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
  for (const button of $('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color?.toLowerCase() === background.toLowerCase()))
  }
}

function updateButtons() {
  const locked = exporting || reading
  addButton.disabled = locked
  downloadButton.disabled = locked
  gifButton.disabled = locked
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
}

async function save(share: boolean) {
  if (exporting || reading || !clips.length) return
  exporting = true
  lastExport = null
  setStatus('')
  downloadButton.textContent = 'Making your video…'
  render()
  try {
    const { cols, rows } = currentGrid()
    const sound = clips.find((clip): clip is VideoClip => clip.id === soundId && clip.kind === 'video') ?? null
    const { exportGrid } = await import('./export')
    const { blob, soundFailed } = await exportGrid({
      clips,
      cols,
      rows,
      fit,
      background,
      frame: frameId,
      frameFit,
      sound,
      clipSeconds,
      lengthSeconds: lengthChoice === 'auto' ? null : lengthChoice,
      onProgress: (done, total) => {
        downloadButton.textContent = `Making your video… ${done} of ${total}`
      },
    })
    const shared = share ? await shareFile(blob) : false
    if (!shared) downloadBlob(blob, 'gif-grid.mp4')
    lastExport = 'video'
    const picture = outputLayout(cols, rows, frameId, frameFit)
    const saved = shared
      ? `Shared a ${picture.width}×${picture.height} video.`
      : `Check your Downloads folder for gif-grid.mp4 (${picture.width}×${picture.height}).`
    setStatus(soundFailed ? `${saved} This one has no sound.` : saved)
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : 'Couldn’t make the video in this browser. Open this page in Chrome and try again.',
    )
  } finally {
    exporting = false
    render()
  }
}

async function saveGif() {
  if (exporting || reading || !clips.length) return
  exporting = true
  lastExport = null
  setStatus('')
  gifButton.textContent = 'Making your GIF…'
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
      onProgress: (done, total) => {
        gifButton.textContent = `Making your GIF… ${done} of ${total}`
      },
    })
    downloadBlob(blob, 'grid.gif')
    lastExport = 'gif'
    const picture = outputLayout(cols, rows, frameId, frameFit)
    const saved = `Check your Downloads folder for grid.gif (${picture.gifWidth}×${picture.gifHeight}).`
    setStatus(soundId ? `${saved} GIFs play with no sound.` : saved)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Couldn’t make the GIF. Try again.')
  } finally {
    exporting = false
    render()
  }
}

async function shareFile(blob: Blob) {
  const file = new File([blob], 'gif-grid.mp4', { type: 'video/mp4' })
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: 'Grid to Vid' })
    return true
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return true
    return false
  }
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
