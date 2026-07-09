async function parseJsonSafe(response) {
  return response.json().catch(() => ({}))
}

export async function login(loginId, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ loginId, password }),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || 'Authentication failed')
  }

  return payload
}

export async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
}
