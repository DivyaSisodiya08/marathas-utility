import { Alert, Button, Card, Checkbox, Divider, Input, Select, Space, Spin, Table, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { BranchesOutlined, DownOutlined, GithubOutlined, RocketOutlined, UpOutlined } from '@ant-design/icons'
import { createReleaseCut, fetchGithubRepos, fetchPomInfo, fetchReleaseCutPreview, fetchRepoBranches } from '../services/githubService'

const { Text, Link } = Typography
const RELEASE_CUT_STORAGE_KEY = 'release_cut_state_v1'

function stripSnapshot(version) {
    if (!version) {
        return ''
    }
    if (version.toUpperCase().endsWith('-SNAPSHOT')) {
        return version.slice(0, -'-SNAPSHOT'.length)
    }
    return version
}

function buildReleaseBranch(version) {
    const releaseVersion = stripSnapshot(version)
    return releaseVersion ? `release/${releaseVersion}` : ''
}

function sanitizeBranchPart(value) {
    return (value || '')
        .trim()
        .replace(/[^A-Za-z0-9/_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^\/+|\/+$/g, '')
}

function buildDefaultReleaseCutBranch(releaseVersion, jiraTicket) {
    const normalizedTicket = String(jiraTicket || '').trim()
    if (normalizedTicket) {
        return `feature/${normalizedTicket}-release-cut`
    }

    const branchSuffix = sanitizeBranchPart(`release-cut-${releaseVersion || 'version'}`)
    return `feature/${branchSuffix}`
}

function toVersionKey(field) {
    const value = String(field || '')
    if (value.startsWith('property:')) {
        return value.slice('property:'.length)
    }
    if (value.startsWith('dependency:')) {
        return `dependency ${value.slice('dependency:'.length)}`
    }
    if (value.startsWith('plugin:')) {
        return `plugin ${value.slice('plugin:'.length)}`
    }
    if (value.startsWith('parent:')) {
        return `parent ${value.slice('parent:'.length)}`
    }
    if (value === 'project.version') {
        return 'project.version'
    }
    return value || 'version'
}

function ReleaseCutPage() {
    const [repos, setRepos] = useState([])
    const [loadingRepos, setLoadingRepos] = useState(false)
    const [selectedRepoId, setSelectedRepoId] = useState(undefined)
    const [plans, setPlans] = useState([])
    const [isHydrated, setIsHydrated] = useState(false)

    useEffect(() => {
        let isMounted = true

        const hydrateState = async () => {
            try {
                const raw = sessionStorage.getItem(RELEASE_CUT_STORAGE_KEY)
                if (raw) {
                    const parsed = JSON.parse(raw)
                    if (Array.isArray(parsed.plans) && isMounted) {
                        setPlans(parsed.plans)
                    }
                }
            } catch {
                sessionStorage.removeItem(RELEASE_CUT_STORAGE_KEY)
            }

            if (isMounted) {
                try {
                    const cachedRepos = await fetchGithubRepos(false)
                    if (Array.isArray(cachedRepos) && cachedRepos.length > 0) {
                        setRepos(cachedRepos)
                    }
                } catch {
                    // Ignore fallback cache fetch errors.
                }
            }

            if (isMounted) {
                setIsHydrated(true)
            }
        }

        hydrateState()

        return () => {
            isMounted = false
        }
    }, [])

    useEffect(() => {
        if (!isHydrated) {
            return
        }

        try {
            sessionStorage.setItem(RELEASE_CUT_STORAGE_KEY, JSON.stringify({ plans }))
        } catch {
            // Ignore storage write failures so page remains functional.
        }
    }, [plans, isHydrated])

    const updatePlan = (repoId, patch) => {
        setPlans((prev) => prev.map((plan) => (plan.repo.id === repoId ? { ...plan, ...patch } : plan)))
    }

    const removePlan = (repoId) => {
        setPlans((prev) => prev.filter((plan) => plan.repo.id !== repoId))
    }

    const loadRepositories = async () => {
        try {
            setLoadingRepos(true)
            const data = await fetchGithubRepos(true)
            setRepos(data)
            message.success(`Loaded ${data.length} repositories`)
        } catch (error) {
            message.error(error.message || 'Failed to load repositories')
        } finally {
            setLoadingRepos(false)
        }
    }

    const loadBranchesForRepo = async (repo) => {
        try {
            const branches = await fetchRepoBranches(repo.full_name)
            const defaultBranch = branches.includes('master')
                ? 'master'
                : branches.includes('main')
                    ? 'main'
                    : branches[0] || 'master'

            updatePlan(repo.id, {
                branches,
                branch: defaultBranch,
                loadingBranches: false,
            })
        } catch (error) {
            updatePlan(repo.id, { loadingBranches: false })
            message.warning(error.message || `Failed to load branches for ${repo.name}. Using master.`)
        }
    }

    const handleSelectRepo = (repo) => {
        const normalizedFullName = String(repo.full_name || '').toLowerCase()
        const alreadyAdded = plans.some(
            (plan) => plan.repo.id === repo.id || String(plan.repo.full_name || '').toLowerCase() === normalizedFullName
        )
        if (alreadyAdded) {
            message.info(`${repo.full_name} is already added`)
            return
        }

        setPlans((prev) => [
            ...prev,
            {
                repo,
                branch: 'master',
                branches: [],
                loadingBranches: true,
                loadingPom: false,
                loadingPreview: false,
                cutting: false,
                pomInfo: null,
                currentVersion: '',
                releaseVersion: '',
                releaseBranch: '',
                jiraTicket: '',
                releaseCutBranch: '',
                preview: null,
                confirmReleaseCut: false,
                result: null,
                isExpanded: true,
            },
        ])

        loadBranchesForRepo(repo)
    }

    const togglePlanExpanded = (repoId) => {
        setPlans((prev) => prev.map((plan) => (
            plan.repo.id === repoId
                ? { ...plan, isExpanded: !plan.isExpanded }
                : plan
        )))
    }

    const handleRepoDropdownChange = (value) => {
        setSelectedRepoId(value || undefined)

        if (!value) {
            return
        }

        const selectedRepo = repos.find((repo) => String(repo.id) === String(value))
        if (!selectedRepo) {
            return
        }

        handleSelectRepo(selectedRepo)
        setSelectedRepoId(undefined)
    }

    const handleReadPom = async (plan) => {
        try {
            updatePlan(plan.repo.id, { loadingPom: true, result: null })
            const info = await fetchPomInfo(plan.repo.full_name, plan.branch)
            const currentVersion = info.projectVersion || info.snapshotVersion || ''
            const releaseVersion = stripSnapshot(currentVersion)
            const releaseBranch = buildReleaseBranch(currentVersion)

            updatePlan(plan.repo.id, {
                pomInfo: info,
                currentVersion,
                releaseVersion,
                releaseBranch,
                releaseCutBranch: plan.releaseCutBranch || buildDefaultReleaseCutBranch(releaseVersion, plan.jiraTicket),
                preview: null,
                confirmReleaseCut: false,
            })

            if (!currentVersion) {
                message.warning(`pom.xml found for ${plan.repo.name}, but project version not detected`)
            } else {
                message.success(`pom.xml read successfully for ${plan.repo.name}`)
            }
        } catch (error) {
            message.error(error.message || `Failed to read pom.xml for ${plan.repo.name}`)
        } finally {
            updatePlan(plan.repo.id, { loadingPom: false })
        }
    }

    const handlePreviewChanges = async (plan) => {
        if (!plan.pomInfo) {
            message.warning(`Read pom.xml first for ${plan.repo.name}`)
            return
        }

        try {
            updatePlan(plan.repo.id, { loadingPreview: true, preview: null, confirmReleaseCut: false })

            const preview = await fetchReleaseCutPreview({
                repoFullName: plan.repo.full_name,
                sourceBranch: plan.branch,
            })

            updatePlan(plan.repo.id, {
                loadingPreview: false,
                preview,
                releaseBranch: preview.releaseBranch || plan.releaseBranch,
                releaseVersion: preview.releaseVersion || plan.releaseVersion,
                confirmReleaseCut: false,
                result: null,
            })

            message.success(`Preview generated for ${plan.repo.name}`)
        } catch (error) {
            updatePlan(plan.repo.id, { loadingPreview: false, preview: null, confirmReleaseCut: false })
            message.error(error.message || `Failed to preview release cut for ${plan.repo.name}`)
        }
    }

    const handleReleaseCut = async (plan) => {
        if (!plan.pomInfo) {
            message.warning(`Read pom.xml first for ${plan.repo.name}`)
            return
        }

        if (!plan.releaseVersion) {
            message.warning(`Project version is missing for ${plan.repo.name}`)
            return
        }

        if (!plan.releaseCutBranch) {
            message.warning(`Release cut branch is required for ${plan.repo.name}`)
            return
        }

        if (!plan.preview) {
            message.warning(`Generate preview first for ${plan.repo.name}`)
            return
        }

        if (!plan.confirmReleaseCut) {
            message.warning(`Confirm previewed changes first for ${plan.repo.name}`)
            return
        }

        try {
            updatePlan(plan.repo.id, { cutting: true, result: null })

            const result = await createReleaseCut({
                repoFullName: plan.repo.full_name,
                sourceBranch: plan.branch,
                jiraTicket: plan.jiraTicket,
                releaseCutBranch: plan.releaseCutBranch,
            })

            updatePlan(plan.repo.id, {
                cutting: false,
                result,
                releaseBranch: result.releaseBranch || plan.releaseBranch,
            })
            if (String(result.prExisting).toLowerCase() === 'true' && result.prUrl) {
                message.info(`PR already exists for ${plan.repo.name}: ${result.prUrl}`)
            } else {
                message.success(`Release cut completed for ${plan.repo.name}`)
            }
        } catch (error) {
            updatePlan(plan.repo.id, { cutting: false })
            const errorText = String(error.message || '')
            if (errorText.toLowerCase().includes('no commits between')) {
                message.error(`PR not created for ${plan.repo.name}: no commits between feature and release branch`)
            } else {
                message.error(error.message || `Failed release cut for ${plan.repo.name}`)
            }
        }
    }

    return (
        <Card>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Release Cut Automation"
                    description="Creates permanent release/<version> branch, creates a version-cut branch, removes -SNAPSHOT from pom/dependencies, updates Docker workflow version, and opens PR against release branch."
                />

                <Card type="inner" title="Select Repository">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Button
                            type="primary"
                            icon={<GithubOutlined />}
                            onClick={loadRepositories}
                            loading={loadingRepos}
                        >
                            {repos.length > 0 ? 'Refresh Repositories' : 'Fetch Repositories'}
                        </Button>

                        {repos.length > 0 && (
                            <>
                                <Select
                                    showSearch
                                    allowClear
                                    placeholder="Select repository"
                                    optionFilterProp="label"
                                    value={selectedRepoId}
                                    onChange={handleRepoDropdownChange}
                                    options={repos.map((repo) => ({
                                        value: String(repo.id),
                                        label: repo.full_name,
                                    }))}
                                    style={{ width: '100%' }}
                                />

                                {plans.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f6ffed', borderRadius: '6px' }}>
                                        <RocketOutlined />
                                        <Text strong>{plans.length} release plan(s) added</Text>
                                    </div>
                                )}
                            </>
                        )}
                    </Space>
                </Card>

                {plans.length > 0 && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        {plans.map((plan) => (
                            <Card
                                key={plan.repo.id}
                                type="inner"
                                title={
                                    <Space>
                                        <GithubOutlined />
                                        <Text>Release Plan - <Text strong>{plan.repo.name}</Text></Text>
                                    </Space>
                                }
                                extra={
                                    <Space>
                                        <Button size="small" onClick={() => togglePlanExpanded(plan.repo.id)}>
                                            {plan.isExpanded ? <UpOutlined /> : <DownOutlined />}
                                        </Button>
                                        <Button size="small" danger onClick={() => removePlan(plan.repo.id)}>
                                            Remove
                                        </Button>
                                    </Space>
                                }
                            >
                                {plan.isExpanded ? (
                                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                        <Text type="secondary">{plan.repo.full_name}</Text>

                                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                                            <div>
                                                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                                                    <BranchesOutlined /> Source Branch
                                                </Text>
                                                <Select
                                                    value={plan.branch}
                                                    onChange={(value) => updatePlan(plan.repo.id, { branch: value })}
                                                    options={(plan.branches || []).map((name) => ({ value: name, label: name }))}
                                                    loading={plan.loadingBranches}
                                                    showSearch
                                                    optionFilterProp="label"
                                                    style={{ width: 240 }}
                                                    placeholder="Select branch"
                                                    notFoundContent={plan.loadingBranches ? 'Loading branches...' : 'No branches'}
                                                />
                                            </div>

                                            <Button type="primary" onClick={() => handleReadPom(plan)} loading={plan.loadingPom}>
                                                Read pom.xml
                                            </Button>
                                        </div>

                                        {plan.loadingPom && <Spin tip="Reading pom.xml..." />}

                                        {plan.pomInfo && (
                                            <>
                                                <Divider style={{ margin: '4px 0' }} />

                                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 16 }}>
                                                        <div>
                                                            <Text type="secondary">Current Version</Text>
                                                            <div><Text strong>{plan.currentVersion || 'N/A'}</Text></div>
                                                        </div>
                                                        <div>
                                                            <Text type="secondary">Release Version</Text>
                                                            <div><Text strong>{plan.releaseVersion || 'N/A'}</Text></div>
                                                        </div>
                                                    </div>

                                                    <Input
                                                        addonBefore="Release Branch"
                                                        value={plan.releaseBranch}
                                                        readOnly
                                                    />

                                                    <Input
                                                        addonBefore="Cut Branch"
                                                        value={plan.releaseCutBranch}
                                                        onChange={(e) => updatePlan(plan.repo.id, { releaseCutBranch: sanitizeBranchPart(e.target.value) })}
                                                        placeholder="feature/CIN-53810-release-cut"
                                                    />

                                                    <Input
                                                        addonBefore="Jira Ticket"
                                                        value={plan.jiraTicket}
                                                        onChange={(e) => updatePlan(plan.repo.id, { jiraTicket: e.target.value })}
                                                        placeholder="Optional"
                                                    />

                                                    <Button onClick={() => handlePreviewChanges(plan)} loading={plan.loadingPreview}>
                                                        Preview SNAPSHOT Changes
                                                    </Button>

                                                    {plan.loadingPreview && <Spin tip="Building preview..." />}

                                                    {plan.preview && (
                                                        <Card size="small" title="Preview: SNAPSHOT Changes" style={{ background: '#fffbe6' }}>
                                                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                                                <Text>
                                                                    Total findings: <Text strong>{plan.preview.totalSnapshotFindings ?? 0}</Text>
                                                                </Text>

                                                                <Text strong>pom.xml findings</Text>
                                                                <Table
                                                                    size="small"
                                                                    rowKey={(row, idx) => `pom-${idx}`}
                                                                    pagination={false}
                                                                    dataSource={Array.isArray(plan.preview.pomSnapshotFindings) ? plan.preview.pomSnapshotFindings : []}
                                                                    columns={[
                                                                        { title: 'File', dataIndex: 'filePath', key: 'filePath' },
                                                                        {
                                                                            title: 'Version Key',
                                                                            dataIndex: 'field',
                                                                            key: 'field',
                                                                            width: 260,
                                                                            render: (value) => toVersionKey(value),
                                                                        },
                                                                        { title: 'Current', dataIndex: 'currentValue', key: 'currentValue' },
                                                                        { title: 'New', dataIndex: 'newValue', key: 'newValue' },
                                                                    ]}
                                                                    locale={{ emptyText: 'No pom.xml SNAPSHOT occurrences found' }}
                                                                />

                                                                <Text strong>Docker.yml VERSION_TAG findings</Text>
                                                                <Table
                                                                    size="small"
                                                                    rowKey={(row, idx) => `docker-${idx}`}
                                                                    pagination={false}
                                                                    dataSource={Array.isArray(plan.preview.dockerSnapshotFindings) ? plan.preview.dockerSnapshotFindings : []}
                                                                    columns={[
                                                                        { title: 'File', dataIndex: 'filePath', key: 'filePath' },
                                                                        {
                                                                            title: 'Version Key',
                                                                            dataIndex: 'field',
                                                                            key: 'field',
                                                                            width: 260,
                                                                            render: (value) => toVersionKey(value),
                                                                        },
                                                                        { title: 'Current', dataIndex: 'currentValue', key: 'currentValue' },
                                                                        { title: 'New', dataIndex: 'newValue', key: 'newValue' },
                                                                    ]}
                                                                    locale={{ emptyText: 'No VERSION_TAG SNAPSHOT in .github/workflows/Docker.yml' }}
                                                                />

                                                                <Checkbox
                                                                    checked={plan.confirmReleaseCut}
                                                                    onChange={(e) => updatePlan(plan.repo.id, { confirmReleaseCut: e.target.checked })}
                                                                >
                                                                    I confirm these preview changes and want to run release cut
                                                                </Checkbox>
                                                            </Space>
                                                        </Card>
                                                    )}

                                                    <Button
                                                        type="primary"
                                                        icon={<RocketOutlined />}
                                                        onClick={() => handleReleaseCut(plan)}
                                                        loading={plan.cutting}
                                                        disabled={!plan.preview || !plan.confirmReleaseCut}
                                                    >
                                                        Run Release Cut
                                                    </Button>

                                                    {plan.result && (
                                                        <Card size="small" title="Result" style={{ background: '#fafafa' }}>
                                                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                                <Text>
                                                                    Release branch: <Text strong>{plan.result.releaseBranch || '-'}</Text>
                                                                </Text>
                                                                <Text>
                                                                    Version cut PR: {plan.result.prUrl ? <Link href={plan.result.prUrl} target="_blank">{plan.result.prUrl}</Link> : '-'}
                                                                </Text>
                                                                {String(plan.result.prExisting).toLowerCase() === 'true' && (
                                                                    <Text type="warning">
                                                                        Existing PR reused (no new PR created)
                                                                    </Text>
                                                                )}
                                                                {String(plan.result.prCreated).toLowerCase() === 'true' && (
                                                                    <Text type="success">
                                                                        New PR created successfully
                                                                    </Text>
                                                                )}
                                                                <Text>
                                                                    Docker workflow update: <Text strong>{plan.result.dockerWorkflowUpdateStatus || 'n/a'}</Text>
                                                                </Text>
                                                                {plan.result.dockerWorkflowSkipReason && (
                                                                    <Text type="warning">
                                                                        {plan.result.dockerWorkflowSkipReason}
                                                                    </Text>
                                                                )}
                                                            </Space>
                                                        </Card>
                                                    )}
                                                </Space>
                                            </>
                                        )}
                                    </Space>
                                ) : (
                                    <Text type="secondary">Collapsed. Click Expand to continue editing this release plan.</Text>
                                )}
                            </Card>
                        ))}
                    </Space>
                )}
            </Space>
        </Card>
    )
}

export default ReleaseCutPage
