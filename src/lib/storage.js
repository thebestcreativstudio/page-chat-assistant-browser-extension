const DEFAULTS = {
  openRouterKey: '',
  model: 'qwen/qwen3.8-27b:free',
  preferSelection: true,
  messages: [],
  /** @type {{ id: string, name: string, text: string, fileName?: string, createdAt: number }[]} */
  savedContexts: [],
  activeContextId: '',
}

export async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS))
  return { ...DEFAULTS, ...data }
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch)
}
