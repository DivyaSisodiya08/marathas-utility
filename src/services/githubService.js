async function parseJsonSafe(response) {
  const raw = await response.text().catch(() => '')
  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw)
  } catch {
    const trimmed = raw.trim()
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      return { error: response.statusText || 'Unexpected HTML response from server' }
    }

    return { message: trimmed.slice(0, 500) }
  }
}

function getApiErrorMessage(payload, fallbackMessage) {
  return payload?.message || payload?.error || payload?.detail || fallbackMessage
}

const REPOS_CACHE_KEY = 'github_repos_cache_v2'
let reposMemoryCache = null

function normalizePat(value) {
  const token = String(value || '').trim()
  return token || null
}

export async function getStoredPatToken() {
  const response = await fetch('/api/github/pat/status', { credentials: 'include' })
  if (!response.ok) {
    return null
  }
  const payload = await parseJsonSafe(response)
  return payload?.configured ? (payload.login || 'configured') : null
}

async function requireConfiguredPat() {
  const response = await fetch('/api/github/pat/status', { credentials: 'include' })
  if (!response.ok) {
    throw new Error('Unable to verify GitHub PAT. Log in again.')
  }
  const payload = await parseJsonSafe(response)
  if (!payload?.configured) {
    throw new Error('GitHub PAT is not configured. Save a PAT in GitHub Access first.')
  }
}

export function clearRepositoryCache() {
  reposMemoryCache = null
  try {
    sessionStorage.removeItem(REPOS_CACHE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
  try {
    localStorage.removeItem(REPOS_CACHE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

export async function savePatToken(token) {
  const normalized = normalizePat(token)
  if (!normalized) {
    throw new Error('PAT token is required')
  }

  const response = await fetch('/api/github/pat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pat: normalized }),
  })
  const payload = await parseJsonSafe(response)
  if (!response.ok || !payload?.configured) {
    throw new Error(payload?.message || 'Failed to save PAT token')
  }
  clearRepositoryCache()
  return payload.login || 'configured'
}

export async function clearPatToken() {
  clearRepositoryCache()
  await fetch('/api/github/pat', {
    method: 'DELETE',
    credentials: 'include',
  })
}

function readReposCache() {
  if (Array.isArray(reposMemoryCache) && reposMemoryCache.length > 0) {
    return reposMemoryCache
  }

  try {
    const sessionRaw = sessionStorage.getItem(REPOS_CACHE_KEY)
    if (sessionRaw) {
      const sessionParsed = JSON.parse(sessionRaw)
      if (Array.isArray(sessionParsed) && sessionParsed.length > 0) {
        reposMemoryCache = sessionParsed
        return sessionParsed
      }
    }

    const localRaw = localStorage.getItem(REPOS_CACHE_KEY)
    if (!localRaw) {
      return null
    }

    const localParsed = JSON.parse(localRaw)
    if (Array.isArray(localParsed) && localParsed.length > 0) {
      reposMemoryCache = localParsed
      try {
        sessionStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(localParsed))
      } catch {
        // Ignore session write failures.
      }
      return localParsed
    }
    return null
  } catch {
    return null
  }
}

function writeReposCache(repos) {
  if (!Array.isArray(repos) || repos.length === 0) {
    return
  }

  reposMemoryCache = repos
  try {
    sessionStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(repos))
    localStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(repos))
  } catch {
    // Ignore cache write failures and continue with API data.
  }
}

export async function fetchGithubRepos(refresh = false) {
  await requireConfiguredPat()
  const cachedRepos = readReposCache()
  if (!refresh) {
    if (cachedRepos) {
      return cachedRepos
    }
  }

  const response = await fetch(`/api/github/repos?refresh=${refresh}`, {
    credentials: 'include',

  })

  const payload = await parseJsonSafe(response)

  if (!response.ok || !Array.isArray(payload)) {
    if (cachedRepos) {
      return cachedRepos
    }
    const message = Array.isArray(payload)
      ? 'Unable to fetch repositories'
      : payload?.message || 'Unable to fetch repositories'
    throw new Error(message)
  }

  writeReposCache(payload)

  return payload
}

export async function fetchPomInfo(repoFullName, branch = 'master') {
  await requireConfiguredPat()
  const response = await fetch(
    `/api/github/pom?repoFullName=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}`,
    {
      credentials: 'include',
  
    }
  )

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to read pom.xml'))
  }

  return payload
}

export async function discoverPomDependencyGraph(request) {
  await requireConfiguredPat()
  const response = await fetch('/api/github/pom/dependency-graph', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to discover pom dependency graph'))
  }

  return payload
}

export async function fetchRepoBranches(repoFullName) {
  await requireConfiguredPat()
  const response = await fetch(
    `/api/github/branches?repoFullName=${encodeURIComponent(repoFullName)}`,
    {
      credentials: 'include',
  
    }
  )

  const payload = await parseJsonSafe(response)

  if (!response.ok || !Array.isArray(payload)) {
    const message = Array.isArray(payload)
      ? 'Failed to fetch branches'
      : payload?.message || 'Failed to fetch branches'
    throw new Error(message)
  }

  return payload
}

export async function createUpgradePullRequest(request) {
  const response = await fetch('/api/github/upgrade-pr', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to create upgrade pull request')
  }

  return payload
}

export async function createUpgradeBranch(request) {
  const response = await fetch('/api/github/upgrade-branch', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to create or update branch for Spring Boot upgrade')
  }

  return payload
}

export async function createUpgradePullRequestOnly(request) {
  const response = await fetch('/api/github/upgrade-pr/create', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to create Spring Boot upgrade pull request')
  }

  return payload
}

export async function previewUpgradePullRequest(request) {
  const response = await fetch('/api/github/upgrade-pr/preview', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to preview Spring Boot upgrade')
  }

  return payload
}

export async function fetchSnapshotUpgradePreview(request) {
  const response = await fetch('/api/github/snapshot-upgrade/preview', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to preview snapshot upgrade')
  }

  return payload
}

export async function applySnapshotUpgrade(request) {
  const response = await fetch('/api/github/snapshot-upgrade', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to apply snapshot upgrade')
  }

  return payload
}

export async function createPullRequest(request) {
  const response = await fetch('/api/github/pr', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to create pull request')
  }

  return payload
}

export async function createReleaseCut(request) {
  const response = await fetch('/api/github/release-cut', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to create release cut')
  }

  return payload
}

export async function fetchReleaseCutPreview(request) {
  const response = await fetch('/api/github/release-cut/preview', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to preview release cut')
  }

  return payload
}

export async function fetchGithubActionRuns(repoFullName, branch = '', workflowType = '') {
  const query = new URLSearchParams({
    repoFullName,
  })

  if (branch && branch.trim()) {
    query.set('branch', branch.trim())
  }

  if (workflowType && workflowType.trim()) {
    query.set('workflowType', workflowType.trim())
  }

  const response = await fetch(`/api/github/actions/runs?${query.toString()}`, {
    credentials: 'include',
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok || !Array.isArray(payload)) {
    const message = Array.isArray(payload)
      ? 'Failed to fetch build status'
      : payload?.message || 'Failed to fetch build status'
    throw new Error(message)
  }

  return payload
}

export async function triggerGithubActionRun(repoFullName, branch, workflowType) {
  const query = new URLSearchParams({
    repoFullName,
    branch,
    workflowType,
  })

  const response = await fetch(`/api/github/actions/dispatch?${query.toString()}`, {
    method: 'POST',
    credentials: 'include',
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to trigger GitHub Action')
  }

  return payload
}
