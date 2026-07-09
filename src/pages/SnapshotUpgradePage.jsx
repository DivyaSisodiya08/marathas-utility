import { Card, Input, Space, Typography, Button, message, Divider, Spin, Select } from 'antd'
import { useEffect, useState } from 'react'
import { GithubOutlined, BranchesOutlined } from '@ant-design/icons'
import { createUpgradePullRequest, fetchGithubRepos, fetchPomInfo, fetchRepoBranches } from '../services/githubService'

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
            setPlans(parsed.plans)
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
        branches: [],
        loadingBranches: true,
        pomInfo: null,
        loadingPom: false,
        creatingPr: false,
        snapshotVersion: '',
        jiraTicket: '',
        branchName: '',
        prUrl: '',
        prNumber: '',
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

  const handleReadPom = async (plan) => {
    try {
      updatePlan(plan.repo.id, { loadingPom: true })
      const info = await fetchPomInfo(plan.repo.full_name, plan.branch)
      const resolvedSnapshot = info.snapshotVersion || info.projectVersion || ''

      updatePlan(plan.repo.id, {
        pomInfo: info,
        snapshotVersion: resolvedSnapshot,
        branchName: buildBranchName(plan.repo.name, plan.jiraTicket, resolvedSnapshot),
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

  const handleCreatePr = async (plan) => {
    if (!plan.pomInfo) {
      message.warning(`Read pom.xml first for ${plan.repo.name}`)
      return
    }

    if (!plan.branchName) {
      message.warning(`Branch name is required for ${plan.repo.name}`)
      return
    }

    if (!plan.snapshotVersion) {
      message.warning(`Provide target snapshot version for ${plan.repo.name}`)
      return
    }

    try {
      updatePlan(plan.repo.id, { creatingPr: true })
      const result = await createUpgradePullRequest({
        repoFullName: plan.repo.full_name,
        sourceBranch: plan.branch,
        baseBranch: 'master',
        branchName: plan.branchName,
        targetSpringBootVersion: '',
        targetSnapshotVersion: plan.snapshotVersion,
        jiraTicket: plan.jiraTicket,
      })

      updatePlan(plan.repo.id, {
        creatingPr: false,
        prUrl: result.prUrl || '',
        prNumber: result.prNumber || '',
        branchName: result.branchName || plan.branchName,
      })
      message.success(`Created PR for ${plan.repo.name}`)
    } catch (error) {
      updatePlan(plan.repo.id, { creatingPr: false })
      message.error(error.message || `Failed to create PR for ${plan.repo.name}`)
    }
  }

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card type="inner" title="Select Repository">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              showSearch
              allowClear
              placeholder={repos.length > 0 ? 'Select repository' : 'Fetch repositories first'}
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

            <Button
              type="primary"
              icon={<GithubOutlined />}
              onClick={loadRepositories}
              loading={loadingRepos}
            >
              {repos.length > 0 ? 'Refresh Repositories' : 'Fetch Repositories'}
            </Button>

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
                    <Text>Snapshot Plan - <Text strong>{plan.repo.name}</Text></Text>
                  </Space>
                }
                extra={
                  <Button size="small" danger onClick={() => removePlan(plan.repo.id)}>
                    Remove
                  </Button>
                }
              >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Text type="secondary">{plan.repo.full_name}</Text>

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
                                })
                              }}
                              placeholder="e.g. 1.0.1-SNAPSHOT"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(220px, 1fr) minmax(320px, 2fr) auto',
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

                          <Button type="primary" onClick={() => handleCreatePr(plan)} loading={plan.creatingPr}>
                            Create Branch & PR
                          </Button>
                        </div>

                        {plan.prUrl && (
                          <Button type="link" onClick={() => window.open(plan.prUrl, '_blank', 'noopener,noreferrer')} style={{ padding: 0, width: 'fit-content' }}>
                            View PR #{plan.prNumber || ''}
                          </Button>
                        )}
                      </Space>
                    </>
                  )}
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  )
}

export default SnapshotUpgradePage
