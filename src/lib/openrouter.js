import { DEFAULT_MODEL, resolveModelQueue } from './models.js'

export { DEFAULT_MODEL, FALLBACK_FREE_MODELS as FREE_MODELS, getFreeModels } from './models.js'

/**
 * @param {unknown} content
 * @returns {string}
 */
function normalizeContent(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text
          if (typeof part.content === 'string') return part.content
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

/**
 * @param {any} data
 * @returns {string}
 */
function extractText(data) {
  const choice = data?.choices?.[0]
  const message = choice?.message || {}
  const fromContent = normalizeContent(message.content)
  if (fromContent) return fromContent

  if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
    return message.reasoning.trim()
  }
  if (Array.isArray(message.reasoning_details)) {
    const bits = message.reasoning_details
      .map((d) => d?.text || d?.summary || '')
      .filter(Boolean)
      .join('\n')
      .trim()
    if (bits) return bits
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    return message.refusal.trim()
  }

  return ''
}

/**
 * @param {any} data
 * @param {number} status
 * @returns {string}
 */
function formatApiError(data, status) {
  const err = data?.error
  const parts = []
  if (typeof err?.message === 'string' && err.message.trim()) parts.push(err.message.trim())
  else if (typeof err === 'string' && err.trim()) parts.push(err.trim())
  if (err?.code) parts.push(`code=${err.code}`)
  if (err?.metadata?.provider_name) parts.push(`provider=${err.metadata.provider_name}`)
  if (err?.metadata?.raw) {
    const raw = typeof err.metadata.raw === 'string' ? err.metadata.raw : JSON.stringify(err.metadata.raw)
    if (raw && raw.length < 200) parts.push(raw)
  }
  const choiceErr = data?.choices?.[0]?.error?.message
  if (choiceErr) parts.push(String(choiceErr))
  if (!parts.length) parts.push(status ? `HTTP ${status}` : 'OpenRouter error')
  return parts.join(' · ')
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isRateLimited(message) {
  const m = (message || '').toLowerCase()
  return m.includes('rate limit') || m.includes('rate-limit') || m.includes('429') || m.includes('too many')
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isRetryable(message) {
  const m = (message || '').toLowerCase()
  return (
    isRateLimited(m) ||
    m.includes('provider returned error') ||
    m.includes('no endpoints') ||
    m.includes('temporarily') ||
    m.includes('timeout') ||
    m.includes('overloaded') ||
    m.includes('503') ||
    m.includes('502') ||
    m.includes('capacity') ||
    m.includes('порожня відповідь')
  )
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {{ apiKey: string, models: string[], system: string, user: string }} opts
 */
async function requestOnce({ apiKey, models, system, user }) {
  const body = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
    max_tokens: 2048,
    provider: { allow_fallbacks: true },
  }

  if (models.length > 1) {
    body.models = models
  } else {
    body.model = models[0]
  }

  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/thebestcreativstudio/page-chat-assistant',
      'X-Title': 'Page Chat',
    },
    body: JSON.stringify(body),
  })
}

/**
 * @param {{ apiKey: string, model: string, system: string, user: string }} opts
 * @returns {Promise<string>}
 */
export async function chatCompletion({ apiKey, model, system, user }) {
  if (!apiKey?.trim()) {
    throw new Error('Додай OpenRouter API key у налаштуваннях')
  }

  const models = await resolveModelQueue(model)
  /** @type {string[]} */
  const failures = []
  const maxAttempts = 2

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await requestOnce({ apiKey, models, system, user })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = formatApiError(data, res.status)
      failures.push(msg)
      if (isRetryable(msg) && attempt < maxAttempts - 1) {
        await sleep(isRateLimited(msg) ? 2500 : 800)
        continue
      }
      break
    }

    const choiceErr = data?.choices?.[0]?.error?.message
    if (choiceErr) {
      failures.push(String(choiceErr))
      if (isRetryable(choiceErr) && attempt < maxAttempts - 1) {
        await sleep(isRateLimited(choiceErr) ? 2500 : 800)
        continue
      }
      break
    }

    const text = extractText(data)
    if (!text) {
      const used = data?.model || models[0]
      const finish = data?.choices?.[0]?.finish_reason || '?'
      failures.push(`порожня відповідь (model=${used}, finish=${finish})`)
      if (attempt < maxAttempts - 1) {
        await sleep(600)
        continue
      }
      break
    }

    return text
  }

  const detail = failures.slice(0, 2).join(' | ')
  throw new Error(
    `Не вдалося згенерувати. Зачекай ~1 хв (free rate limit) або зміни модель. ${detail}`,
  )
}
