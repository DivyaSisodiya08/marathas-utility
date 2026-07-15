async function parseJsonSafe(response) {
  return response.json().catch(() => ({}))
}

const REPOS_CACHE_KEY = 'github_repos_cache_v2'
const PAT_SESSION_KEY = 'github_pat_token'

// Get stored PAT token from session
function getStoredPat() {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(PAT_SESSION_KEY)
}

// Build headers with optional PAT token
function getHeadersWithPat() {
  const headers = {}
  const pat = getStoredPat()
  if (pat) {
    headers['X-GitHub-PAT'] = pat
  }
  return headers
}

function readReposCache() {
  try {
    const sessionRaw = sessionStorage.getItem(REPOS_CACHE_KEY)
    if (sessionRaw) {
      const sessionParsed = JSON.parse(sessionRaw)
      if (Array.isArray(sessionParsed)) {
        return sessionParsed
      }
    }

    const localRaw = localStorage.getItem(REPOS_CACHE_KEY)
    if (!localRaw) {
      return null
    }

    const localParsed = JSON.parse(localRaw)
    return Array.isArray(localParsed) ? localParsed : null
  } catch {
    return null
  }
}

function writeReposCache(repos) {
  try {
    sessionStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(repos))
    localStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(repos))
  } catch {
    // Ignore cache write failures and continue with API data.
  }
}

export async function fetchGithubRepos(refresh = false) {
  if (!refresh) {
    const cachedRepos = readReposCache()
    if (cachedRepos) {
      return cachedRepos
    }
  }

  const response = await fetch(`/api/github/repos?refresh=${refresh}`, {
    credentials: 'include',
    headers: getHeadersWithPat(),
  })

  const payload = await parseJsonSafe(response)

  if (!response.ok || !Array.isArray(payload)) {
    const message = Array.isArray(payload)
      ? 'Unable to fetch repositories'
      : payload?.message || 'Unable to fetch repositories'
    throw new Error(message)
  }

  writeReposCache(payload)

  return payload
}

export async function fetchPomInfo(repoFullName, branch = 'master') {
  const response = await fetch(
    `/api/github/pom?repoFullName=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(branch)}`,
    { credentials: 'include' }
  )

  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Failed to read pom.xml')
  }

  return payload
}

export async function fetchRepoBranches(repoFullName) {
  const response = await fetch(
    `/api/github/branches?repoFullName=${encodeURIComponent(repoFullName)}`,
    { credentials: 'include' }
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
