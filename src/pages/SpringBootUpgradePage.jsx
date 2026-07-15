import { Card, Input, Space, Typography, Button, message, Divider, Spin, Select, Checkbox, Table } from 'antd'
import { useEffect, useState } from 'react'
import { GithubOutlined, BranchesOutlined } from '@ant-design/icons'
import { createUpgradePullRequest, fetchGithubRepos, fetchPomInfo, fetchRepoBranches, previewUpgradePullRequest } from '../services/githubService'

const { Text } = Typography
const SPRING_UPGRADE_STORAGE_KEY = 'spring_boot_upgrade_state_v1'

function toVersionKey(field) {
  const value = String(field || '')
  if (value.startsWith('parent:')) {
    return value.replace('parent:', 'parent ')
  }
  if (value.startsWith('property:')) {
    return value.replace('property:', 'property ')
  }
  if (value.startsWith('dependency:')) {
    return value.replace('dependency:', 'dependency ')
  }
  if (value.startsWith('plugin:')) {
    return value.replace('plugin:', 'plugin ')
  }
  return value
}

function SpringBootUpgradePage() {
  const [repos, setRepos] = useState([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepoId, setSelectedRepoId] = useState(undefined)
  const [plans, setPlans] = useState([])
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    let isMounted = true

    const hydrateState = async () => {
      try {
        const raw = sessionStorage.getItem(SPRING_UPGRADE_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.plans) && isMounted) {
            setPlans(parsed.plans.map((plan) => ({
              ...plan,
              branchMode: plan?.branchMode || 'new',
              existingBranch: plan?.existingBranch || plan?.branch || 'master',
              loadingPreview: plan?.loadingPreview || false,
              preview: plan?.preview || null,
              confirmPreview: plan?.confirmPreview || false,
            })))
          }
        }
      } catch {
        sessionStorage.removeItem(SPRING_UPGRADE_STORAGE_KEY)
      }

      // Always use shared repo cache so all pages stay in sync.
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
        SPRING_UPGRADE_STORAGE_KEY,
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
        loadingPreview: false,
        creatingPr: false,
        targetVersion: '',
        existingBranch: 'master',
        branchMode: 'new',
        jiraTicket: '',
        branchName: '',
        preview: null,
        confirmPreview: false,
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

  const updatePlan = (repoId, patch) => {
    setPlans((prev) =>
      prev.map((plan) => (plan.repo.id === repoId ? { ...plan, ...patch } : plan))
    )
  }

  const removePlan = (repoId) => {
    setPlans((prev) => prev.filter((plan) => plan.repo.id !== repoId))
  }

  const handleReadPom = async (plan) => {
    try {
      updatePlan(plan.repo.id, { loadingPom: true })
      const info = await fetchPomInfo(plan.repo.full_name, plan.branch)
      updatePlan(plan.repo.id, {
        pomInfo: info,
        targetVersion: info.springBootVersion || '',
        branchName: buildBranchName(plan.repo.name, plan.jiraTicket, info.springBootVersion),
        preview: null,
        confirmPreview: false,
        prUrl: '',
        prNumber: '',
      })

      if (!info.springBootVersion) {
        message.warning(`pom.xml found for ${plan.repo.name}, but Spring Boot parent version not detected`)
      } else {
        message.success(`pom.xml read successfully for ${plan.repo.name}`)
      }
    } catch (error) {
      message.error(error.message || `Failed to read pom.xml for ${plan.repo.name}`)
    } finally {
      updatePlan(plan.repo.id, { loadingPom: false })
    }
  }

  const buildBranchName = (repoName, jiraTicket, targetVersion) => {
    const jiraPart = `feature/${jiraTicket ? jiraTicket.toLowerCase() : 'upgrade'}`
    const springPart = targetVersion ? `sb-${targetVersion}` : 'sb'
    return `${jiraPart}/${repoName}-${springPart}`
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/\/+$/, '')
  }

  const handleCreatePr = async (plan) => {
    if (!plan.pomInfo) {
      message.warning(`Read pom.xml first for ${plan.repo.name}`)
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

    if (!plan.targetVersion) {
      message.warning(`Provide target Spring Boot version for ${plan.repo.name}`)
      return
    }

    if (!plan.preview) {
      message.warning(`Generate preview first for ${plan.repo.name}`)
      return
    }

    if (!plan.confirmPreview) {
      message.warning(`Confirm preview changes before creating PR for ${plan.repo.name}`)
      return
    }

    try {
      updatePlan(plan.repo.id, { creatingPr: true })
      const targetBranchName = plan.branchMode === 'existing' ? plan.existingBranch : plan.branchName
      const result = await createUpgradePullRequest({
        repoFullName: plan.repo.full_name,
        sourceBranch: plan.branch,
        baseBranch: plan.branch,
        branchName: targetBranchName,
        targetSpringBootVersion: plan.targetVersion,
        jiraTicket: plan.branchMode === 'new' ? plan.jiraTicket : '',
      })

      updatePlan(plan.repo.id, {
        creatingPr: false,
        prUrl: result.prUrl || '',
        prNumber: result.prNumber || '',
        branchName: result.branchName || targetBranchName,
        existingBranch: result.branchName || plan.existingBranch,
      })
      message.success(`Created PR for ${plan.repo.name}`)
    } catch (error) {
      updatePlan(plan.repo.id, { creatingPr: false })
      message.error(error.message || `Failed to create PR for ${plan.repo.name}`)
    }
  }

  const handlePreviewChanges = async (plan) => {
    if (!plan.pomInfo) {
      message.warning(`Read pom.xml first for ${plan.repo.name}`)
      return
    }

    if (!plan.targetVersion) {
      message.warning(`Provide target Spring Boot version for ${plan.repo.name}`)
      return
    }

    try {
      updatePlan(plan.repo.id, {
        loadingPreview: true,
        preview: null,
        confirmPreview: false,
      })

      const preview = await previewUpgradePullRequest({
        repoFullName: plan.repo.full_name,
        sourceBranch: plan.branch,
        targetSpringBootVersion: plan.targetVersion,
      })

      updatePlan(plan.repo.id, {
        loadingPreview: false,
        preview,
        confirmPreview: false,
      })
      message.success(`Preview generated for ${plan.repo.name}`)
    } catch (error) {
      updatePlan(plan.repo.id, {
        loadingPreview: false,
        preview: null,
        confirmPreview: false,
      })
      message.error(error.message || `Failed to generate preview for ${plan.repo.name}`)
    }
  }

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* <Text type="secondary">
          Load repositories, select one, then read its pom.xml to plan the upgrade.
        </Text> */}

        {/* Repo Selection Card */}
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
                    <Text>Upgrade Plan — <Text strong>{plan.repo.name}</Text></Text>
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
                            <Text strong style={{ display: 'block', marginBottom: 4 }}>Current Spring Boot Version</Text>
                            <Input
                              value={plan.pomInfo.springBootVersion || 'Not found'}
                              readOnly
                              style={{ width: '100%', background: '#fafafa' }}
                            />
                          </div>

                          <div>
                            <Text strong style={{ display: 'block', marginBottom: 4 }}>Target Spring Boot Version</Text>
                            <Input
                              value={plan.targetVersion}
                              onChange={(e) => updatePlan(plan.repo.id, {
                                targetVersion: e.target.value,
                                preview: null,
                                confirmPreview: false,
                              })}
                              placeholder="e.g. 3.3.2"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>

                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Button onClick={() => handlePreviewChanges(plan)} loading={plan.loadingPreview} style={{ width: 'fit-content' }}>
                            Preview Spring Boot Changes
                          </Button>
                        </Space>

                        {plan.loadingPreview && <Spin tip="Building preview..." />}

                        {plan.preview && (
                          <Card size="small" title="Preview: Spring Boot Changes" style={{ background: '#fffbe6' }}>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                              <Text>
                                Total findings: <Text strong>{plan.preview.totalSpringBootFindings ?? 0}</Text>
                              </Text>

                              <Table
                                size="small"
                                rowKey={(row, idx) => `${row.filePath || 'pom'}-${row.line || idx}-${idx}`}
                                pagination={false}
                                dataSource={Array.isArray(plan.preview.pomSpringBootFindings) ? plan.preview.pomSpringBootFindings : []}
                                columns={[
                                  { title: 'File', dataIndex: 'filePath', key: 'filePath' },
                                  {
                                    title: 'Version Key',
                                    dataIndex: 'field',
                                    key: 'field',
                                    width: 260,
                                    render: (value) => toVersionKey(value),
                                  },
                                  { title: 'Line', dataIndex: 'line', key: 'line', width: 90 },
                                  { title: 'Current', dataIndex: 'currentValue', key: 'currentValue' },
                                  { title: 'New', dataIndex: 'newValue', key: 'newValue' },
                                ]}
                                locale={{ emptyText: 'No Spring Boot changes detected' }}
                              />
                            </Space>
                          </Card>
                        )}

                        {plan.preview && (
                          <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Checkbox
                              checked={plan.confirmPreview}
                              onChange={(e) => updatePlan(plan.repo.id, { confirmPreview: e.target.checked })}
                            >
                              I confirm previewed changes and want to create branch and PR
                            </Checkbox>
                          </Space>
                        )}

                        <div>
                          <Space size={16}>
                            <Checkbox
                              checked={plan.branchMode === 'new'}
                              onChange={(e) => updatePlan(plan.repo.id, {
                                branchMode: e.target.checked ? 'new' : '',
                                preview: null,
                                confirmPreview: false,
                              })}
                            >
                              New Branch
                            </Checkbox>
                            <Checkbox
                              checked={plan.branchMode === 'existing'}
                              onChange={(e) => updatePlan(plan.repo.id, {
                                branchMode: e.target.checked ? 'existing' : '',
                                preview: null,
                                confirmPreview: false,
                              })}
                            >
                              Existing Branch
                            </Checkbox>
                          </Space>
                        </div>

                        {plan.branchMode === 'existing' ? (
                          <div style={{ width: '100%' }}>
                            <Text strong style={{ display: 'block', marginBottom: 4 }}>Existing Branch</Text>
                            <Select
                              value={plan.existingBranch}
                              onChange={(value) => updatePlan(plan.repo.id, {
                                existingBranch: value,
                                preview: null,
                                confirmPreview: false,
                              })}
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
                                    branchName: buildBranchName(
                                      plan.repo.name,
                                      jiraTicket,
                                      plan.targetVersion || plan.pomInfo.springBootVersion || ''
                                    ),
                                    preview: null,
                                    confirmPreview: false,
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
                                onChange={(e) => updatePlan(plan.repo.id, {
                                  branchName: e.target.value,
                                  preview: null,
                                  confirmPreview: false,
                                })}
                                placeholder="e.g. feature/proj-1234/repo-sb-3.3.3"
                                style={{ width: '100%' }}
                              />
                            </div>
                          </div>
                        ) : null}

                        <Button type="primary" onClick={() => handleCreatePr(plan)} loading={plan.creatingPr} disabled={!plan.branchMode}>
                          Create Branch & PR
                        </Button>

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

export default SpringBootUpgradePage
