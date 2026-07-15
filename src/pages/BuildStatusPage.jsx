import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Divider, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import { GithubOutlined, PlayCircleOutlined, SyncOutlined } from '@ant-design/icons'
import { fetchGithubActionRuns, fetchGithubRepos, fetchRepoBranches, triggerGithubActionRun } from '../services/githubService'

const { Text } = Typography

function statusColor(status, conclusion) {
    if (status === 'in_progress' || status === 'queued') {
        return 'processing'
    }
    if (status === 'completed' && conclusion === 'success') {
        return 'success'
    }
    if (status === 'completed' && (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out')) {
        return 'error'
    }
    return 'default'
}

const buildTypeOptions = [
    { value: 'all', label: 'All Builds' },
    { value: 'docker', label: 'Build and Test Docker Image' },
    { value: 'coverity', label: 'Coverity' },
    { value: 'blackduck', label: 'BDH' },
    { value: 'twistlock', label: 'Twistlock' },
]

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

function matchesBuildType(run, buildType) {
    if (buildType === 'all') {
        return true
    }

    const workflowText = [run?.name, run?.displayTitle, run?.event]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

    if (buildType === 'docker') {
        return workflowText.includes('docker') || workflowText.includes('image build')
    }

    if (buildType === 'coverity') {
        return workflowText.includes('coverity')
    }

    if (buildType === 'blackduck') {
        return workflowText.includes('blackduck')
    }

    if (buildType === 'twistlock') {
        return workflowText.includes('twistlock')
    }

    return true
}

function BuildStatusPage() {
    const [repoFullName, setRepoFullName] = useState('')
    const [repos, setRepos] = useState([])
    const [reposReady, setReposReady] = useState(false)
    const [loadingRepos, setLoadingRepos] = useState(false)
    const [branch, setBranch] = useState('')
    const [branches, setBranches] = useState([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [loadingRuns, setLoadingRuns] = useState(false)
    const [triggeringRun, setTriggeringRun] = useState(false)
    const [runs, setRuns] = useState([])
    const [buildType, setBuildType] = useState('all')

    const filteredRuns = useMemo(
        () => runs.filter((run) => matchesBuildType(run, buildType)),
        [runs, buildType]
    )

    const columns = useMemo(
        () => [
            {
                title: 'Workflow',
                dataIndex: 'name',
                key: 'name',
                render: (_, row) => (
                    <Space direction="vertical" size={2}>
                        <Text strong>{row.name || 'Unnamed workflow'}</Text>
                        <Text type="secondary">{row.displayTitle || '-'}</Text>
                    </Space>
                ),
            },
            {
                title: 'Branch',
                dataIndex: 'headBranch',
                key: 'headBranch',
            },
            {
                title: 'Run #',
                dataIndex: 'runNumber',
                key: 'runNumber',
            },
            {
                title: 'Status',
                key: 'status',
                render: (_, row) => {
                    const color = statusColor(row.status, row.conclusion)
                    const text = row.status === 'completed' ? `${row.status}/${row.conclusion || 'unknown'}` : row.status
                    return <Tag color={color}>{text || 'unknown'}</Tag>
                },
            },
            {
                title: 'Updated',
                dataIndex: 'updatedAt',
                key: 'updatedAt',
                render: (value) => (value ? new Date(value).toLocaleString() : '-'),
            },
            {
                title: 'Open',
                dataIndex: 'htmlUrl',
                key: 'htmlUrl',
                render: (url) =>
                    url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                            View Run
                        </a>
                    ) : (
                        '-'
                    ),
            },
        ],
        []
    )

    useEffect(() => {
        const loadCachedRepos = async () => {
            try {
                const data = await fetchGithubRepos(false)
                if (Array.isArray(data) && data.length > 0) {
                    setRepos(data)
                    setReposReady(true)
                }
            } catch {
                // Keep explicit fetch button flow when cache or API is unavailable.
            }
        }

        loadCachedRepos()
    }, [])

    const loadRepos = async () => {
        try {
            setLoadingRepos(true)
            const data = await fetchGithubRepos(true)
            setRepos(data)
            setReposReady(true)
            setBranches([])
            setBranch('')
            setRuns([])
            setRepoFullName('')
            message.success(`Fetched ${data.length} repositories`)
        } catch (error) {
            setRepos([])
            setReposReady(false)
            setRepoFullName('')
            setBranches([])
            setBranch('')
            setRuns([])
            message.error(error.message || 'Failed to fetch repositories')
        } finally {
            setLoadingRepos(false)
        }
    }

    const loadBranchesForRepo = async (repo) => {
        const trimmedRepo = repo.trim()
        try {
            setLoadingBranches(true)
            const data = await fetchRepoBranches(trimmedRepo)
            setBranches(data)
            // Keep branch optional so users can view all workflow runs across branches.
            setBranch((current) => (data.includes(current) ? current : ''))
        } catch (error) {
            message.error(error.message || 'Failed to load branches')
        } finally {
            setLoadingBranches(false)
        }
    }

    const handleRepoChange = async (value) => {
        const selectedRepo = value || ''
        setRepoFullName(selectedRepo)
        setBranches([])
        setBranch('')
        setRuns([])

        if (!selectedRepo.trim()) {
            return
        }

        await loadBranchesForRepo(selectedRepo)
    }

    const loadRuns = async ({ silent = false } = {}) => {
        if (!reposReady) {
            message.warning('Fetch repositories first')
            return []
        }

        const trimmedRepo = repoFullName.trim()
        if (!trimmedRepo) {
            message.warning('Select a repository first')
            return []
        }

        try {
            setLoadingRuns(true)
            const workflowTypeFilter = buildType === 'all' ? '' : buildType
            const data = await fetchGithubActionRuns(trimmedRepo, branch, workflowTypeFilter)
            setRuns(data)
            if (!silent) {
                if (workflowTypeFilter) {
                    message.success(`Loaded ${data.length} ${workflowTypeFilter} workflow runs`)
                } else {
                    message.success(`Loaded ${data.length} workflow runs`)
                }
            }
            return data
        } catch (error) {
            message.error(error.message || 'Failed to fetch build status')
            return []
        } finally {
            setLoadingRuns(false)
        }
    }

    const refreshAfterTrigger = async (previousRunIds) => {
        const maxAttempts = 5
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                await sleep(2000)
            }

            const latestRuns = await loadRuns({ silent: true })
            const hasNewRun = latestRuns.some((run) => run.id && !previousRunIds.has(run.id))
            if (hasNewRun) {
                message.success('Build started and latest status is now visible.')
                return
            }
        }

        message.info('Build was triggered. GitHub may take a few more seconds to show the new run.')
    }

    const triggerRun = async () => {
        if (!reposReady) {
            message.warning('Fetch repositories first')
            return
        }

        const trimmedRepo = repoFullName.trim()
        if (!trimmedRepo) {
            message.warning('Select a repository first')
            return
        }

        if (!branch) {
            message.warning('Select a branch before triggering build')
            return
        }

        if (buildType === 'all') {
            message.warning('Select build type: Build and Test Docker Image, Coverity, BDH, or Twistlock')
            return
        }

        try {
            setTriggeringRun(true)
            const previousRunIds = new Set(runs.map((run) => run.id).filter(Boolean))
            const result = await triggerGithubActionRun(trimmedRepo, branch, buildType)
            setTriggeringRun(false)
            message.success(`Triggered ${result.workflowType} workflow on ${result.branch}. Refreshing status...`)
            await refreshAfterTrigger(previousRunIds)
        } catch (error) {
            message.error(error.message || 'Failed to trigger GitHub Action')
        } finally {
            setTriggeringRun(false)
        }
    }

    return (
        <Card bodyStyle={{ padding: 20 }}>
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Use this page after creating PR to monitor GitHub Actions / Docker image build progress. Leave branch empty to see all runs."
                />

                <Card type="inner" title="Repository & Branch">
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={10}>
                            <Select
                                showSearch
                                disabled={!reposReady}
                                placeholder={reposReady ? 'Select repository' : 'Open GitHub Access and Fetch Repo first'}
                                optionFilterProp="label"
                                value={repoFullName || undefined}
                                onChange={handleRepoChange}
                                options={repos.map((repo) => ({
                                    value: repo.full_name,
                                    label: repo.full_name,
                                }))}
                                style={{ width: '100%' }}
                            />
                        </Col>
                        <Col xs={24} md={10}>
                            <Select
                                allowClear
                                showSearch
                                placeholder={loadingBranches ? 'Loading branches...' : 'Branch (optional)'}
                                optionFilterProp="label"
                                loading={loadingBranches}
                                value={branch || undefined}
                                onChange={(value) => setBranch(value || '')}
                                options={branches.map((name) => ({ value: name, label: name }))}
                                style={{ width: '100%' }}
                            />
                        </Col>
                    </Row>
                </Card>

                <Card type="inner" title="Build Actions">
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={8}>
                            <Select
                                value={buildType}
                                onChange={(value) => setBuildType(value || 'all')}
                                options={buildTypeOptions}
                                style={{ width: '100%' }}
                            />
                        </Col>

                        <Col xs={24} md={8}>
                            <Button
                                block
                                type="primary"
                                onClick={() => {
                                    void loadRuns()
                                }}
                                loading={loadingRuns}
                                disabled={triggeringRun}
                                icon={<SyncOutlined />}
                            >
                                Check Build Status
                            </Button>
                        </Col>
                        <Col xs={24} md={8}>
                            <Button
                                block
                                type="primary"
                                onClick={triggerRun}
                                loading={triggeringRun}
                                icon={<PlayCircleOutlined />}
                            >
                                Run Build
                            </Button>
                        </Col>
                    </Row>

                    <Divider style={{ margin: '12px 0 0' }} />
                    <Space wrap style={{ marginTop: 12 }}>
                        <Tag color="blue">Total Runs: {runs.length}</Tag>
                        <Tag color="geekblue">Filtered: {filteredRuns.length}</Tag>
                    </Space>
                </Card>

                <Card type="inner" title="Workflow Runs">
                    <Table
                        rowKey={(row) => row.id || `${row.name}-${row.runNumber}-${row.updatedAt}`}
                        columns={columns}
                        dataSource={filteredRuns}
                        loading={loadingRuns}
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 900 }}
                        locale={{ emptyText: 'No workflow runs found for the selected filters' }}
                    />
                </Card>
            </Space>
        </Card>
    )
}

export default BuildStatusPage
