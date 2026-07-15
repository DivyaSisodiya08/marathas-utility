import { Alert, Button, Card, Checkbox, Divider, Input, Select, Space, Spin, Table, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { GithubOutlined, BranchesOutlined, UpOutlined, DownOutlined } from '@ant-design/icons'
import {
  applySnapshotUpgrade,
  fetchGithubRepos,
  fetchPomInfo,
  fetchRepoBranches,
  fetchSnapshotUpgradePreview,
} from '../services/githubService'

const { Text } = Typography
const SNAPSHOT_UPGRADE_STORAGE_KEY = 'snapshot_upgrade_state_v1'

function SnapshotUpgradePage() {
  const [repos, setRepos] = useState([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepoId, setSelectedRepoId] = useState(undefined)
  const [plans, setPlans] = useState([])
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    let isMounted = true

    const hydrateState = async () => {
      try {
        const raw = sessionStorage.getItem(SNAPSHOT_UPGRADE_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.plans) && isMounted) {
            setPlans(parsed.plans.map((plan) => ({
              ...plan,
              isExpanded: plan?.isExpanded !== false,
            })))
          }
        }
      } catch {
        sessionStorage.removeItem(SNAPSHOT_UPGRADE_STORAGE_KEY)
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
      sessionStorage.setItem(
        SNAPSHOT_UPGRADE_STORAGE_KEY,
        JSON.stringify({ plans })
      )
    } catch {
      // Ignore storage write failures so page remains functional.
    }
  }, [plans, isHydrated])

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

  const buildBranchName = (repoName, jiraTicket, snapshotVersion) => {
    const jiraPart = `feature/${jiraTicket ? jiraTicket.toLowerCase() : 'upgrade'}`
    const snapshotPart = snapshotVersion ? `snap-${snapshotVersion}` : 'snap'
    return `${jiraPart}/${repoName}-${snapshotPart}`
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/\/+$/, '')
  }

  const handleSelectRepo = (repo) => {
    const alreadyAdded = plans.some((plan) => plan.repo.id === repo.id)
    if (alreadyAdded) {
      message.info(`${repo.full_name} is already added`)
      return
    }

    setPlans((prev) => [
      ...prev,
      {
        repo,
        branch: 'master',
        existingBranch: 'master',
        branchMode: '',
        branches: [],
        loadingBranches: true,
        pomInfo: null,
        loadingPom: false,
        loadingPreview: false,
        runningUpgrade: false,
        snapshotVersion: '',
        jiraTicket: '',
        branchName: '',
        useNewBranch: true,
        createPullRequest: false,
        confirmPreview: false,
        selectedPomFindingIds: [],
        selectedDockerFindingIds: [],
        preview: null,
        result: null,
        prUrl: '',
        prNumber: '',
        isExpanded: true,
      },
    ])

    loadBranchesForRepo(repo)
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

  const updatePlan = (repoId, patch) => {
    setPlans((prev) =>
      prev.map((plan) => (plan.repo.id === repoId ? { ...plan, ...patch } : plan))
    )
  }

  const removePlan = (repoId) => {
    setPlans((prev) => prev.filter((plan) => plan.repo.id !== repoId))
  }

  const togglePlanExpanded = (repoId) => {
    setPlans((prev) => prev.map((plan) => (
      plan.repo.id === repoId
        ? { ...plan, isExpanded: !plan.isExpanded }
        : plan
    )))
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
        existingBranch: defaultBranch,
        loadingBranches: false,
      })
    } catch (error) {
      updatePlan(repo.id, { loadingBranches: false })
      message.warning(error.message || `Failed to load branches for ${repo.name}. Using master.`)
    }
  }

  const handleReadPom = async (plan) => {
    try {
      updatePlan(plan.repo.id, { loadingPom: true })
      const info = await fetchPomInfo(plan.repo.full_name, plan.branch)
      const resolvedSnapshot = info.snapshotVersion || info.projectVersion || ''

      updatePlan(plan.repo.id, {
        pomInfo: info,
        snapshotVersion: resolvedSnapshot,
        branchName: buildBranchName(plan.repo.name, plan.jiraTicket, resolvedSnapshot),
        preview: null,
        confirmPreview: false,
        selectedPomFindingIds: [],
        selectedDockerFindingIds: [],
        result: null,
        prUrl: '',
        prNumber: '',
      })

      if (!resolvedSnapshot) {
        message.warning(`pom.xml found for ${plan.repo.name}, but snapshot/project version not detected`)
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

    if (!plan.snapshotVersion) {
      message.warning(`Provide target snapshot version for ${plan.repo.name}`)
      return
    }

    const isNewBranchMode = plan.branchMode === 'new'
    const workingBranch = isNewBranchMode
      ? plan.branch
      : (plan.existingBranch || plan.branch)

    try {
      updatePlan(plan.repo.id, {
        loadingPreview: true,
        preview: null,
        confirmPreview: false,
        selectedPomFindingIds: [],
        selectedDockerFindingIds: [],
        result: null,
      })

      const preview = await fetchSnapshotUpgradePreview({
        repoFullName: plan.repo.full_name,
        sourceBranch: workingBranch,
        targetSnapshotVersion: plan.snapshotVersion,
      })

      updatePlan(plan.repo.id, {
        loadingPreview: false,
        preview,
        confirmPreview: false,
        selectedPomFindingIds: [],
        selectedDockerFindingIds: [],
      })
      message.success(`Preview generated for ${plan.repo.name}`)
    } catch (error) {
      updatePlan(plan.repo.id, {
        loadingPreview: false,
        preview: null,
        confirmPreview: false,
        selectedPomFindingIds: [],
        selectedDockerFindingIds: [],
      })
      message.error(error.message || `Failed to generate preview for ${plan.repo.name}`)
    }
  }

  const handleRunSnapshotUpgrade = async (plan) => {
    if (!plan.pomInfo) {
      message.warning(`Read pom.xml first for ${plan.repo.name}`)
      return
    }

    if (!plan.snapshotVersion) {
      message.warning(`Provide target snapshot version for ${plan.repo.name}`)
      return
    }

    if (!plan.preview) {
      message.warning(`Generate preview first for ${plan.repo.name}`)
      return
    }

    const pomFindings = Array.isArray(plan.preview.pomSnapshotFindings) ? plan.preview.pomSnapshotFindings : []
    const dockerFindings = Array.isArray(plan.preview.dockerSnapshotFindings) ? plan.preview.dockerSnapshotFindings : []
    const selectedFindingIds = [
      ...(Array.isArray(plan.selectedPomFindingIds) ? plan.selectedPomFindingIds : []),
      ...(Array.isArray(plan.selectedDockerFindingIds) ? plan.selectedDockerFindingIds : []),
    ]

    if ((pomFindings.length + dockerFindings.length) > 0 && selectedFindingIds.length === 0) {
      message.warning(`Select at least one preview line to upgrade for ${plan.repo.name}`)
      return
    }

    if (!plan.confirmPreview) {
      message.warning(`Confirm preview changes before running upgrade for ${plan.repo.name}`)
      return
    }

    if (!plan.branchMode) {
      message.warning(`Select branch option (New or Existing) for ${plan.repo.name}`)
      return
    }

    if (plan.branchMode === 'new' && !plan.branchName) {
      message.warning(`Branch name is required for ${plan.repo.name}`)
      return
    }

    if (plan.branchMode === 'existing' && !plan.existingBranch) {
      message.warning(`Select existing branch for ${plan.repo.name}`)
      return
    }

    const workingBranch = plan.branchMode === 'new'
      ? plan.branch
      : (plan.existingBranch || plan.branch)

    try {
      updatePlan(plan.repo.id, { runningUpgrade: true, result: null })

      const result = await applySnapshotUpgrade({
        repoFullName: plan.repo.full_name,
        sourceBranch: workingBranch,
        baseBranch: plan.branch,
        branchName: plan.branchName,
        targetSnapshotVersion: plan.snapshotVersion,
        jiraTicket: plan.jiraTicket,
        useNewBranch: String(plan.branchMode === 'new'),
        createPullRequest: String(plan.createPullRequest),
        selectedFindingIds: selectedFindingIds.join(','),
      })

      updatePlan(plan.repo.id, {
        runningUpgrade: false,
        result,
        prUrl: result.prUrl || '',
        prNumber: result.prNumber || '',
        branchName: result.branchName || plan.branchName,
      })

      if (String(result.createPullRequest).toLowerCase() === 'false') {
        message.success(`Snapshot files updated on ${result.branchName} for ${plan.repo.name}`)
      } else if (String(result.prExisting).toLowerCase() === 'true') {
        message.info(`Existing PR reused for ${plan.repo.name}`)
      } else {
        message.success(`Snapshot upgrade completed for ${plan.repo.name}`)
      }
    } catch (error) {
      updatePlan(plan.repo.id, { runningUpgrade: false })
      message.error(error.message || `Failed snapshot upgrade for ${plan.repo.name}`)
    }
  }

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Preview and apply snapshot upgrades across all pom.xml files and Docker workflow VERSION_TAG."
        />

        <Card type="inner" title="Select Repository">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              showSearch
              allowClear
              placeholder={repos.length > 0 ? 'Select repository' : 'Open GitHub Access and Fetch Repo first'}
              optionFilterProp="label"
              value={selectedRepoId}
              onChange={handleRepoDropdownChange}
              options={repos.map((repo) => ({
                value: String(repo.id),
                label: repo.full_name,
              }))}
              style={{ width: '100%' }}
              disabled={repos.length === 0}
            />

            {plans.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f0f5ff', borderRadius: '6px' }}>
                <GithubOutlined />
                <Text strong>{plans.length} repository card(s) added</Text>
              </div>
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
                    <Text>Snapshot Plan - <Text strong>{plan.repo.name} /  <Text type="secondary">{plan.repo.full_name}</Text></Text></Text>
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
                {plan.isExpanded !== false ? (
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>

                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <Text strong style={{ display: 'block', marginBottom: 4 }}>
                          <BranchesOutlined /> Branch
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
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))',
                              gap: 16,
                              width: '100%',
                            }}
                          >
                            <div>
                              <Text strong style={{ display: 'block', marginBottom: 4 }}>Current Snapshot Version</Text>
                              <Input
                                value={plan.pomInfo.snapshotVersion || plan.pomInfo.projectVersion || 'Not found'}
                                readOnly
                                style={{ width: '100%', background: '#fafafa' }}
                              />
                            </div>

                            <div>
                              <Text strong style={{ display: 'block', marginBottom: 4 }}>Target Snapshot Version</Text>
                              <Input
                                value={plan.snapshotVersion}
                                onChange={(e) => {
                                  const snapshotVersion = e.target.value
                                  updatePlan(plan.repo.id, {
                                    snapshotVersion,
                                    branchName: buildBranchName(plan.repo.name, plan.jiraTicket, snapshotVersion),
                                    preview: null,
                                    confirmPreview: false,
                                    selectedPomFindingIds: [],
                                    selectedDockerFindingIds: [],
                                    result: null,
                                  })
                                }}
                                placeholder="e.g. 1.0.1-SNAPSHOT"
                                style={{ width: '100%' }}
                              />
                            </div>
                          </div>

                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Button onClick={() => handlePreviewChanges(plan)} loading={plan.loadingPreview} style={{ width: 'fit-content' }}>
                              Preview Snapshot Changes
                            </Button>
                          </Space>

                          {plan.loadingPreview && <Spin tip="Building preview..." />}

                          {plan.preview && (
                            <Card size="small" title="Preview: Snapshot Changes" style={{ background: '#fffbe6' }}>
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Text>
                                  Total findings: <Text strong>{plan.preview.totalSnapshotFindings ?? 0}</Text>
                                </Text>

                                <Text strong>pom.xml findings</Text>
                                <Table
                                  size="small"
                                  rowKey={(row, idx) => row.findingId || `pom-${idx}`}
                                  pagination={false}
                                  dataSource={Array.isArray(plan.preview.pomSnapshotFindings) ? plan.preview.pomSnapshotFindings : []}
                                  rowSelection={{
                                    selectedRowKeys: Array.isArray(plan.selectedPomFindingIds) ? plan.selectedPomFindingIds : [],
                                    onChange: (selectedRowKeys) => updatePlan(plan.repo.id, {
                                      selectedPomFindingIds: selectedRowKeys.map((key) => String(key)),
                                      result: null,
                                    }),
                                  }}
                                  columns={[
                                    { title: 'File', dataIndex: 'filePath', key: 'filePath' },
                                    { title: 'Line', dataIndex: 'line', key: 'line', width: 90 },
                                    { title: 'Current', dataIndex: 'currentValue', key: 'currentValue' },
                                    { title: 'New', dataIndex: 'newValue', key: 'newValue' },
                                  ]}
                                  locale={{ emptyText: 'No pom.xml changes detected' }}
                                />

                                <Text strong>Docker.yml VERSION_TAG findings</Text>
                                <Table
                                  size="small"
                                  rowKey={(row, idx) => row.findingId || `docker-${idx}`}
                                  pagination={false}
                                  dataSource={Array.isArray(plan.preview.dockerSnapshotFindings) ? plan.preview.dockerSnapshotFindings : []}
                                  rowSelection={{
                                    selectedRowKeys: Array.isArray(plan.selectedDockerFindingIds) ? plan.selectedDockerFindingIds : [],
                                    onChange: (selectedRowKeys) => updatePlan(plan.repo.id, {
                                      selectedDockerFindingIds: selectedRowKeys.map((key) => String(key)),
                                      result: null,
                                    }),
                                  }}
                                  columns={[
                                    { title: 'File', dataIndex: 'filePath', key: 'filePath' },
                                    { title: 'Line', dataIndex: 'line', key: 'line', width: 90 },
                                    { title: 'Current', dataIndex: 'currentValue', key: 'currentValue' },
                                    { title: 'New', dataIndex: 'newValue', key: 'newValue' },
                                  ]}
                                  locale={{ emptyText: 'No Docker workflow snapshot updates detected' }}
                                />
                              </Space>
                            </Card>
                          )}

                          {plan.preview && (
                            <>
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Checkbox
                                  checked={plan.confirmPreview}
                                  onChange={(e) => updatePlan(plan.repo.id, { confirmPreview: e.target.checked })}
                                >
                                  I confirm previewed changes and want to run snapshot upgrade
                                </Checkbox>
                              </Space>

                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'minmax(220px, 1fr)',
                                  gap: 16,
                                  alignItems: 'end',
                                  width: '100%',
                                }}
                              >
                                <div>
                                  <Space size={16}>
                                    <Checkbox
                                      checked={plan.branchMode === 'new'}
                                      onChange={(e) => updatePlan(plan.repo.id, {
                                        branchMode: e.target.checked ? 'new' : '',
                                        result: null,
                                      })}
                                    >
                                      New Branch
                                    </Checkbox>
                                    <Checkbox
                                      checked={plan.branchMode === 'existing'}
                                      onChange={(e) => updatePlan(plan.repo.id, {
                                        branchMode: e.target.checked ? 'existing' : '',
                                        result: null,
                                      })}
                                    >
                                      Existing Branch
                                    </Checkbox>
                                  </Space>
                                </div>
                              </div>

                              {plan.branchMode === 'existing' ? (
                                <div style={{ width: '100%' }}>
                                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Existing Branch</Text>
                                  <Select
                                    value={plan.existingBranch}
                                    onChange={(value) => updatePlan(plan.repo.id, { existingBranch: value, result: null })}
                                    options={(plan.branches || []).map((name) => ({ value: name, label: name }))}
                                    loading={plan.loadingBranches}
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select existing branch"
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              ) : null}

                              {plan.branchMode === 'new' ? (
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(220px, 1fr) minmax(320px, 2fr)',
                                    gap: 16,
                                    alignItems: 'end',
                                    width: '100%',
                                  }}
                                >
                                  <div>
                                    <Text strong style={{ display: 'block', marginBottom: 4 }}>Jira Ticket</Text>
                                    <Input
                                      value={plan.jiraTicket}
                                      onChange={(e) => {
                                        const jiraTicket = e.target.value
                                        updatePlan(plan.repo.id, {
                                          jiraTicket,
                                          branchName: buildBranchName(plan.repo.name, jiraTicket, plan.snapshotVersion),
                                          result: null,
                                        })
                                      }}
                                      placeholder="e.g. PROJ-1234"
                                      style={{ width: '100%' }}
                                    />
                                  </div>

                                  <div>
                                    <Text strong style={{ display: 'block', marginBottom: 4 }}>New Branch Name</Text>
                                    <Input
                                      value={plan.branchName}
                                      onChange={(e) => updatePlan(plan.repo.id, { branchName: e.target.value })}
                                      placeholder="e.g. feature/proj-1234/repo-snap-1.0.1-snapshot"
                                      style={{ width: '100%' }}
                                    />
                                  </div>
                                </div>
                              ) : null}

                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Checkbox
                                  checked={plan.createPullRequest}
                                  onChange={(e) => updatePlan(plan.repo.id, { createPullRequest: e.target.checked, result: null })}
                                >
                                  Create PR after snapshot updates
                                </Checkbox>

                                <Button type="primary" onClick={() => handleRunSnapshotUpgrade(plan)} loading={plan.runningUpgrade} disabled={!plan.branchMode} style={{ width: 'fit-content' }}>
                                  Upgrade Snapshot
                                </Button>
                              </Space>
                            </>
                          )}

                          {plan.result && (
                            <Card size="small" title="Result" style={{ background: '#fafafa' }}>
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Text>
                                  Branch: <Text strong>{plan.result.branchName || '-'}</Text>
                                </Text>
                                <Text>
                                  pom.xml files updated: <Text strong>{plan.result.pomFilesUpdated || '0'}</Text>
                                </Text>
                                <Text>
                                  Docker files updated: <Text strong>{plan.result.dockerFilesUpdated || '0'}</Text>
                                </Text>
                                <Text>
                                  PR: {plan.result.prUrl ? (
                                    <a href={plan.result.prUrl} target="_blank" rel="noreferrer">{plan.result.prUrl}</a>
                                  ) : (
                                    'Not created'
                                  )}
                                </Text>
                              </Space>
                            </Card>
                          )}

                          {plan.prUrl && (
                            <Button type="link" onClick={() => window.open(plan.prUrl, '_blank', 'noopener,noreferrer')} style={{ padding: 0, width: 'fit-content' }}>
                              View PR #{plan.prNumber || ''}
                            </Button>
                          )}
                        </Space>
                      </>
                    )}
                  </Space>
                ) : (
                  <Text type="secondary">Collapsed. Click Expand to continue editing this snapshot plan.</Text>
                )}
              </Card>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  )
}

export default SnapshotUpgradePage
