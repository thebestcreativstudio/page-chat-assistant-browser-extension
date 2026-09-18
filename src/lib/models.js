/** Fallback if OpenRouter catalog is unreachable. */
export const FALLBACK_FREE_MODELS = [
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
  'liquid/lfm-2.5-2.6b:free',
  'z-ai/glm-5.2:free',
]

export const DEFAULT_MODEL = FALLBACK_FREE_MODELS[0]

const CACHE_KEY = 'freeModelsCache'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const MIN_CONTEXT_LENGTH = 25000

/** Skip models that are a bad fit for cover letters. */
const SKIP_RE =
  /(content-safety|embed|whisper|tts|stt|coder?|code-|vl:|vision|omni|router\/free|openrouter\/auto)/i

/**
 * @param {any} m
 * @returns {boolean}
 */
function isUsableFreeChat(m) {
  const id = m?.id
  if (typeof id !== 'string' || !id.endsWith(':free')) return false
  if (SKIP_RE.test(id)) return false

  const arch = m.architecture || {}
  const outs = arch.output_modalities || []
  if (outs.length && !outs.includes('text')) return false

  const ins = arch.input_modalities || []
  if (ins.length && !ins.includes('text')) return false

  const context_length = m.context_length || 0
  if (context_length < MIN_CONTEXT_LENGTH) return false

  return true
}

/**
 * Soft ranking: known good general chat models first, then larger context.
 * @param {any} m
 * @returns {number}
 */
function scoreModel(m) {
  const id = m.id.toLowerCase()
  let score = 0
  if (id.includes('qwen')) score += 40
  if (id.includes('gemma')) score += 35
  if (id.includes('glm')) score += 30
  if (id.includes('nemotron') && id.includes('lightning')) score += 28
  if (id.includes('liquid') || id.includes('lfm')) score += 22
  if (id.includes('deepseek')) score += 25
  if (id.includes('instruct') || id.includes('-it')) score += 8
  if (id.includes('ultra') || id.includes('550b') || id.includes('120b')) score -= 15
  const ctx = Number(m.context_length) || 0
  score += Math.min(20, Math.floor(ctx / 16000))
  return score
}

/**
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function fetchFreeCatalog() {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`models HTTP ${res.status}`)
  const data = await res.json()
  const list = (data?.data || [])
    .filter(isUsableFreeChat)
    // .sort((a, b) => scoreModel(b) - scoreModel(a))
    .map((m) => ({
      id: m.id,
      name: (m.name || m.id).replace(/\s*\(free\)\s*$/i, '').trim(),
    }))

  if (!list.length) throw new Error('no free models')
  return list
}

/**
 * Live free models for UI + fallbacks. Cached 12h in chrome.storage.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function getFreeModels({ force = false } = {}) {
  if (!force) {
    const cached = await chrome.storage.local.get(CACHE_KEY)
    const hit = cached[CACHE_KEY]
    if (hit?.at && Date.now() - hit.at < CACHE_TTL_MS && Array.isArray(hit.models) && hit.models.length) {
      return hit.models
    }
  }

  try {
    const models = await fetchFreeCatalog()
    await chrome.storage.local.set({
      [CACHE_KEY]: { at: Date.now(), models },
    })
    return models
  } catch {
    return FALLBACK_FREE_MODELS.map((id) => ({ id, name: id }))
  }
}

/**
 * Up to 3 model ids for OpenRouter `models` array.
 * @param {string} primary
 * @returns {Promise<string[]>}
 */
export async function resolveModelQueue(primary) {
  const catalog = await getFreeModels()
  const ids = catalog.map((m) => m.id)
  const id = (primary || DEFAULT_MODEL).trim()
  const rest = ids.filter((m) => m !== id)
  return [id, ...rest].slice(0, 3)
}
