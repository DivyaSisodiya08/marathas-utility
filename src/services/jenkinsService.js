async function parseJsonSafe(response) {
    return response.json().catch(() => ({}))
}

export async function fetchJenkinsConfig() {
    const response = await fetch('/api/jenkins/config', {
        credentials: 'include',
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok) {
        throw new Error(payload?.message || 'Failed to fetch Jenkins config')
    }

    return payload
}

export async function fetchJenkinsJobs(jobPath = '', recursive = false) {
    const query = new URLSearchParams()
    if (jobPath && jobPath.trim()) {
        query.set('jobPath', jobPath.trim())
    }
    query.set('recursive', String(recursive))

    const response = await fetch(`/api/jenkins/jobs?${query.toString()}`, {
        credentials: 'include',
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok || !Array.isArray(payload)) {
        const message = Array.isArray(payload)
            ? 'Failed to fetch Jenkins jobs'
            : payload?.message || 'Failed to fetch Jenkins jobs'
        throw new Error(message)
    }

    return payload
}

export async function fetchJenkinsBuilds(jobPath = '', limit = 20) {
    const query = new URLSearchParams()
    if (jobPath && jobPath.trim()) {
        query.set('jobPath', jobPath.trim())
    }
    query.set('limit', String(limit || 20))

    const response = await fetch(`/api/jenkins/builds?${query.toString()}`, {
        credentials: 'include',
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok || !Array.isArray(payload)) {
        const message = Array.isArray(payload)
            ? 'Failed to fetch Jenkins builds'
            : payload?.message || 'Failed to fetch Jenkins builds'
        throw new Error(message)
    }

    return payload
}

export async function triggerJenkinsDeploy(request) {
    const response = await fetch('/api/jenkins/deploy', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request || {}),
    })

    const payload = await parseJsonSafe(response)

    if (!response.ok) {
        throw new Error(payload?.message || 'Failed to trigger Jenkins deploy')
    }

    return payload
}
