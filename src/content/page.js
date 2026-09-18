(() => {
  if (window.__pageChatReady) return
  window.__pageChatReady = true

  const MAX_CHARS = 60_000

  function cleanText(raw) {
    return (raw || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function pickRoot() {
    return (
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.body
    )
  }

  function pageSnapshot() {
    const selection = cleanText(window.getSelection()?.toString() || '')
    const root = pickRoot()
    let body = cleanText(root?.innerText || document.body?.innerText || '')
    if (body.length > MAX_CHARS) {
      body = `${body.slice(0, MAX_CHARS)}\n\n[…truncated ${body.length - MAX_CHARS} chars]`
    }
    return {
      ok: true,
      url: location.href,
      title: document.title || '',
      selection,
      text: body,
      chars: body.length,
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_PAGE_CONTEXT') {
      try {
        sendResponse(pageSnapshot())
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) })
      }
      return true
    }
    return false
  })
})()
