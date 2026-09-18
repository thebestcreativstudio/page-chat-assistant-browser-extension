import { getSettings, saveSettings } from '../lib/storage.js'
import { chatCompletion, DEFAULT_MODEL, getFreeModels } from '../lib/openrouter.js'

const $ = (id) => document.getElementById(id)

const apiKeyEl = $('apiKey')
const modelEl = $('model')
const modelPresetEl = $('modelPreset')
const preferSelectionEl = $('preferSelection')
const settingsEl = $('settings')
const contextCreateEl = $('contextCreate')
const threadEl = $('thread')
const inputEl = $('input')
const statusEl = $('status')
const pageMetaEl = $('pageMeta')
const savedCtxMetaEl = $('savedCtxMeta')
const sendBtn = $('send')
const clearChatBtn = $('clearChat')
const activeContextEl = $('activeContext')
const ctxListPanelEl = $('ctxListPanel')
const ctxNameEl = $('ctxName')
const ctxTextEl = $('ctxText')
const ctxFileEl = $('ctxFile')
const ctxFileMetaEl = $('ctxFileMeta')
const ctxFormStatusEl = $('ctxFormStatus')
const composerEl = $('composer')

const MAX_CTX_CHARS = 100_000

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let messages = []
/** @type {{ url: string, title: string, text: string, selection: string, chars: number } | null} */
let pageCtx = null
/** @type {string[]} */
let knownModelIds = []
/** @type {{ id: string, name: string, text: string, fileName?: string, createdAt: number }[]} */
let savedContexts = []
let activeContextId = ''
/** @type {{ name: string, text: string }[]} */
let pendingFiles = []

function setStatus(text, isErr = false) {
  if (!text) {
    statusEl.hidden = true
    statusEl.textContent = ''
    return
  }
  statusEl.hidden = false
  statusEl.textContent = text
  statusEl.classList.toggle('err', isErr)
}

/** Статуси лише у формі створення контексту */
function setCtxFormStatus(text, isErr = false) {
  if (!text) {
    ctxFormStatusEl.hidden = true
    ctxFormStatusEl.textContent = ''
    return
  }
  ctxFormStatusEl.hidden = false
  ctxFormStatusEl.textContent = text
  ctxFormStatusEl.classList.toggle('err', isErr)
}

function syncModelPreset(model) {
  const id = (model || DEFAULT_MODEL).trim()
  modelEl.value = id
  modelPresetEl.value = knownModelIds.includes(id) ? id : '__custom'
}

async function fillModelPresets(selected) {
  const models = await getFreeModels({ force: true })
  knownModelIds = models.map((m) => m.id)
  const keep = selected || modelEl.value.trim() || DEFAULT_MODEL

  modelPresetEl.innerHTML = ''
  for (const m of models.slice(0, 12)) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name || m.id
    modelPresetEl.appendChild(opt)
  }
  const custom = document.createElement('option')
  custom.value = '__custom'
  custom.textContent = 'Інша (поле нижче)'
  modelPresetEl.appendChild(custom)
  syncModelPreset(keep)
}

modelPresetEl.addEventListener('change', () => {
  if (modelPresetEl.value !== '__custom') modelEl.value = modelPresetEl.value
})

modelEl.addEventListener('change', () => {
  syncModelPreset(modelEl.value.trim() || DEFAULT_MODEL)
})

function getActiveSavedContext() {
  if (!activeContextId) return null
  return savedContexts.find((c) => c.id === activeContextId) || null
}

function updateSavedCtxMeta() {
  const ctx = getActiveSavedContext()
  if (!ctx) {
    savedCtxMetaEl.hidden = true
    savedCtxMetaEl.textContent = ''
    return
  }
  savedCtxMetaEl.hidden = false
  savedCtxMetaEl.textContent = `Збережений контекст: ${ctx.name} (${Math.round(ctx.text.length / 1000)}k симв.)`
}

function fillContextSelect() {
  const keep = activeContextId
  activeContextEl.innerHTML = ''
  const none = document.createElement('option')
  none.value = ''
  none.textContent = '— немає —'
  activeContextEl.appendChild(none)

  for (const c of savedContexts) {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.name
    activeContextEl.appendChild(opt)
  }

  const still = savedContexts.some((c) => c.id === keep)
  activeContextId = still ? keep : ''
  activeContextEl.value = activeContextId
  updateSavedCtxMeta()
}

function showSettingsView() {
  contextCreateEl.hidden = true
  settingsEl.hidden = false
  threadEl.hidden = false
  composerEl.hidden = false
  setCtxFormStatus('')
}

function showCreateView() {
  settingsEl.hidden = true
  contextCreateEl.hidden = false
  threadEl.hidden = true
  composerEl.hidden = true
  setStatus('')
  setCtxFormStatus('')
  ctxNameEl.value = ''
  ctxTextEl.value = ''
  ctxFileEl.value = ''
  pendingFiles = []
  ctxFileMetaEl.textContent = ''
}

function renderThread() {
  threadEl.innerHTML = ''
  if (!messages.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Задай питання про відкриту вкладку. Контекст сторінки підтягнеться автоматично.'
    threadEl.appendChild(empty)
    return
  }
  for (const m of messages) {
    const el = document.createElement('div')
    el.className = `msg ${m.role}`

    const head = document.createElement('div')
    head.className = 'msg-head'
    const role = document.createElement('span')
    role.className = 'role'
    role.textContent = m.role === 'user' ? 'Ти' : 'Асистент'
    head.appendChild(role)

    if (m.role === 'assistant') {
      const copyBtn = document.createElement('button')
      copyBtn.type = 'button'
      copyBtn.className = 'ghost msg-copy'
      copyBtn.textContent = 'Копіювати'
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(m.content)
          copyBtn.textContent = 'Скопійовано'
          setTimeout(() => { copyBtn.textContent = 'Копіювати' }, 1200)
        } catch {
          setStatus('Не вдалося скопіювати', true)
        }
      })
      head.appendChild(copyBtn)
    }

    el.appendChild(head)
    const body = document.createElement('div')
    body.className = 'msg-body'
    body.textContent = m.content
    el.appendChild(body)
    threadEl.appendChild(el)
  }
  threadEl.scrollTop = threadEl.scrollHeight
}

function updatePageMeta() {
  if (!pageCtx) {
    pageMetaEl.textContent = 'Контекст сторінки ще не зчитано'
    return
  }
  const sel = pageCtx.selection ? ` · виділення ${pageCtx.selection.length} симв.` : ''
  pageMetaEl.textContent = `${pageCtx.title || pageCtx.url} · ${pageCtx.chars} симв.${sel}`
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('Немає активної вкладки')
  return tab
}

async function fetchPageContext() {
  const tab = await activeTab()
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('edge://')) {
    throw new Error('На системних сторінках Chrome контекст недоступний — відкрий звичайний сайт')
  }

  const ask = () => chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' })

  try {
    return await ask()
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/page.js'],
    })
    return ask()
  }
}

async function refreshPageContext() {
  setStatus('Читаю сторінку…')
  const snap = await fetchPageContext()
  if (!snap?.ok) throw new Error(snap?.error || 'Не вдалося зчитати сторінку')
  pageCtx = {
    url: snap.url,
    title: snap.title,
    text: snap.text,
    selection: snap.selection || '',
    chars: snap.chars,
  }
  updatePageMeta()
  setStatus('')
  return pageCtx
}

/**
 * @param {typeof pageCtx} ctx
 * @param {boolean} preferSelection
 * @param {{ name: string, text: string } | null} saved
 */
function buildSystemPrompt(ctx, preferSelection, saved) {
  const useSel = preferSelection && ctx.selection
  const focus = useSel
    ? `Користувач виділив фрагмент — відповідай насамперед по ньому.\n\n## Виділення\n${ctx.selection}`
    : ''

  const savedBlock = saved
    ? `\n## Збережений контекст користувача («${saved.name}»)\nВикористовуй ці факти (напр. портфоліо) разом зі сторінкою. Не вигадуй поза ними.\n${saved.text}\n`
    : ''

  return `Ти асистент у бічній панелі браузера. Відповідай коротко і по суті мовою питання користувача.
Базуйся на контексті поточної вебсторінки${saved ? ' і збереженому контексті користувача' : ''}. Якщо відповіді немає в наданих даних — скажи чесно.
Не вигадуй факти поза контекстом.
${savedBlock}
## Сторінка
URL: ${ctx.url}
Title: ${ctx.title}

${focus}

## Текст сторінки
${ctx.text}`
}

async function loadUi() {
  const s = await getSettings()
  apiKeyEl.value = s.openRouterKey
  preferSelectionEl.checked = s.preferSelection !== false
  messages = Array.isArray(s.messages) ? s.messages.slice(-40) : []
  savedContexts = Array.isArray(s.savedContexts) ? s.savedContexts : []
  activeContextId = typeof s.activeContextId === 'string' ? s.activeContextId : ''
  fillContextSelect()
  await fillModelPresets(s.model || DEFAULT_MODEL)
  renderThread()
  try {
    await refreshPageContext()
  } catch (err) {
    pageMetaEl.textContent = err.message
  }
}

$('toggleSettings').addEventListener('click', () => {
  if (!contextCreateEl.hidden) {
    showSettingsView()
    return
  }
  settingsEl.hidden = !settingsEl.hidden
  if (!settingsEl.hidden) ctxListPanelEl.hidden = true
})

$('toggleCtxList').addEventListener('click', () => {
  ctxListPanelEl.hidden = !ctxListPanelEl.hidden
})

$('openCreateContext').addEventListener('click', () => {
  showCreateView()
})

$('cancelCreateContext').addEventListener('click', () => {
  showSettingsView()
})

ctxFileEl.addEventListener('change', async () => {
  pendingFiles = []
  ctxFileMetaEl.textContent = ''
  setCtxFormStatus('')
  const files = [...(ctxFileEl.files || [])]
  if (!files.length) return

  const bad = files.filter(
    (f) => !/\.(txt|md)$/i.test(f.name) && f.type && !/^text\/(plain|markdown)$/i.test(f.type),
  )
  if (bad.length) {
    setCtxFormStatus('Лише .txt або .md', true)
    ctxFileEl.value = ''
    return
  }

  for (const file of files) {
    pendingFiles.push({ name: file.name, text: await file.text() })
  }
  const total = pendingFiles.reduce((n, f) => n + f.text.length, 0)
  ctxFileMetaEl.textContent = `${pendingFiles.length} файл(ів): ${pendingFiles.map((f) => f.name).join(', ')} (${Math.round(total / 1000)}k)`
})

$('createContext').addEventListener('click', async () => {
  const typed = ctxTextEl.value.trim()
  if (!typed) {
    setCtxFormStatus('Текст контексту обов’язковий', true)
    return
  }

  let text = typed
  if (pendingFiles.length) {
    const parts = pendingFiles.map((f) => `---\nФайл: ${f.name}\n${f.text.trim()}`)
    text = `${typed}\n\n${parts.join('\n\n')}`
  }
  text = text.slice(0, MAX_CTX_CHARS)

  const name =
    ctxNameEl.value.trim() ||
    typed.split('\n').find((l) => l.trim())?.trim().slice(0, 48) ||
    `Контекст ${savedContexts.length + 1}`

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    text,
    fileName: pendingFiles.map((f) => f.name).join(', ') || undefined,
    createdAt: Date.now(),
  }

  savedContexts = [...savedContexts, item]
  await saveSettings({ savedContexts })
  fillContextSelect()
  showSettingsView()
  ctxListPanelEl.hidden = false
  setStatus(`Контекст «${name}» створено`)
})

activeContextEl.addEventListener('change', async () => {
  activeContextId = activeContextEl.value
  await saveSettings({ activeContextId })
  updateSavedCtxMeta()
  setStatus(activeContextId ? 'Контекст обрано для чату' : 'Контекст знято')
})

$('deleteContext').addEventListener('click', async () => {
  const id = activeContextEl.value
  if (!id) {
    setStatus('Спочатку обери контекст у списку', true)
    return
  }
  const item = savedContexts.find((c) => c.id === id)
  if (!confirm(`Видалити контекст «${item?.name || id}»?`)) return

  savedContexts = savedContexts.filter((c) => c.id !== id)
  activeContextId = ''
  await saveSettings({ savedContexts, activeContextId: '' })
  fillContextSelect()
  setStatus('Контекст видалено')
})

$('saveSettings').addEventListener('click', async () => {
  await saveSettings({
    openRouterKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim() || DEFAULT_MODEL,
    preferSelection: preferSelectionEl.checked,
    activeContextId,
  })
  setStatus('Збережено')
})

$('refreshPage').addEventListener('click', () => {
  refreshPageContext().catch((e) => setStatus(e.message, true))
})

async function clearChat() {
  messages = []
  await saveSettings({ messages: [] })
  renderThread()
  setStatus('Чат очищено')
}

async function send() {
  const text = inputEl.value.trim()
  if (!text) return

  const s = await getSettings()
  const apiKey = apiKeyEl.value.trim() || s.openRouterKey
  const model = modelEl.value.trim() || s.model || DEFAULT_MODEL

  if (!apiKey) {
    settingsEl.hidden = false
    throw new Error('Додай OpenRouter API key у налаштуваннях')
  }

  if (!pageCtx) await refreshPageContext()
  try {
    const tab = await activeTab()
    if (tab.url && pageCtx.url && tab.url !== pageCtx.url) await refreshPageContext()
  } catch {
    /* keep old ctx */
  }

  messages.push({ role: 'user', content: text })
  inputEl.value = ''
  renderThread()
  setStatus('Думаю…')
  sendBtn.disabled = true

  const saved = getActiveSavedContext()
  const system = buildSystemPrompt(pageCtx, preferSelectionEl.checked, saved)
  const history = messages
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  try {
    const reply = await chatCompletion({
      apiKey,
      model,
      system,
      user: history,
    })
    messages.push({ role: 'assistant', content: reply })
    await saveSettings({
      openRouterKey: apiKey,
      model,
      preferSelection: preferSelectionEl.checked,
      messages: messages.slice(-40),
      activeContextId,
    })
    renderThread()
    setStatus('')
  } finally {
    sendBtn.disabled = false
  }
}

sendBtn.addEventListener('click', () => send().catch((e) => setStatus(e.message, true)))

clearChatBtn.addEventListener('click', () => {
  clearChat().catch((e) => setStatus(e.message, true))
})

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send().catch((err) => setStatus(err.message, true))
  }
})

loadUi()
