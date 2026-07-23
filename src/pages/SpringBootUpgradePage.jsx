import { Card, Input, Space, Typography, Button, message, Divider, Spin, Select, Checkbox, Table, Tabs, Row, Col, Tree, Switch, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { GithubOutlined, BranchesOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { createUpgradePullRequest, discoverPomDependencyGraph, fetchGithubRepos, fetchPomInfo, fetchRepoBranches, previewUpgradePullRequest } from '../services/githubService'
import BuildStatusPage from './BuildStatusPage'

const { Text } = Typography
const SPRING_UPGRADE_STORAGE_KEY = 'spring_boot_upgrade_state_v1'

const KNOWN_DEPENDENCY_GROUPS = {
  'Print Family': [
    'salesforceclient',
    'printcommon',
    'printfactory',
    'printadmin',
    'prb',
    'prfact',
  ],
  DMS: [
    'dms-version-metadata-lambda',
    'HCLS-CIN-dms-records-loader-lib',
    'HCLS-CIN-document-parse-lib',
    'HCLS-CIN-document-search-lib',
    'HCLS-CIN-rendition-common',
    'HCLS-CIN-file-carrier-lib',
    'HCLS-CIN-import-common',
    'HCLS-CIN-rendition-broker',
    'HCLS-CIN-rendition-factory-adlib',
    'HCLS-CIN-rendition-factory',
    'HCLS-CIN-import-validator',
    'HCLS-CIN-dms-import-broker',
    'HCLS-CIN-dms-refresh-broker',
    'HCLS-CIN-dms-refresh-file-carrier',
    'HCLS-CIN-file-broker',
    'HCLS-CIN-rendition-adlib-agent-submitter',
    'HCLS-CIN-rendition-adlib-agent-results-processor',
    'HCLS-CIN-rendition-adlib-agent-receiver',
    'HCLS-CIN-dms-export-file-carrier',
    'HCLS-CIN-dms-export-broker',
    'HCLS-CIN-doc-collaboration',
    'HCLS-CIN-fts-incremental-indexing-lambda',
    'HCLS-CIN-fts-initial-file-carrier',
    'HCLS-CIN-fts-monitor-opensearch-lambda',
    'HCLS-CIN-fts-initial-indexing-broker',
    'HCLS-CIN-rendition-monitoring-lambda',
    'HCLS-CIN-dms-full-text-search-broker',
    'HCLS-CIN-dms-import-file-carrier',
    'HCLS-CIN-dms-import-upload-utility',
  ],
}

const DEFAULT_DEPENDENCY_TREE_DATA = [
  {
    key: 'fp',
    title: 'FP (FamilyPrint)',
    children: [
      {
        key: 'sbs',
        title: 'SBS',
        children: [
          {
            key: 'salesforce-client',
            title: 'Salesforce Client',
            children: [
              {
                key: 'printcom',
                title: 'Printcom',
                children: [
                  {
                    key: 'pr-b',
                    title: 'PR B',
                    children: [
                      {
                        key: 'pr-admin',
                        title: 'PR Admin',
                        children: [
                          {
                            key: 'pr-fact',
                            title: 'PR Fact',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

function collectNodeKeys(nodes) {
  const keys = []
  nodes.forEach((node) => {
    keys.push(node.key)
    if (Array.isArray(node.children) && node.children.length > 0) {
      keys.push(...collectNodeKeys(node.children))
    }
  })
  return keys
}

function buildParentLookup(nodes, parentKey = '', acc = {}) {
  nodes.forEach((node) => {
    acc[node.key] = parentKey
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildParentLookup(node.children, node.key, acc)
    }
  })
  return acc
}

function buildTitleLookup(nodes, acc = {}) {
  nodes.forEach((node) => {
    acc[node.key] = node.title
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildTitleLookup(node.children, acc)
    }
  })
  return acc
}

function buildChildLookup(nodes, acc = {}) {
  nodes.forEach((node) => {
    const children = Array.isArray(node.children) ? node.children : []
    acc[node.key] = children.map((child) => child.key)
    if (children.length > 0) {
      buildChildLookup(children, acc)
    }
  })
  return acc
}

function shortRepoName(repoFullName) {
  const value = String(repoFullName || '')
  const parts = value.split('/')
  return parts.length === 2 ? parts[1] : value
}

function normalizeRepoToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildTreeFromDependencyGraph(graphPayload) {
  const rows = Array.isArray(graphPayload?.repos) ? graphPayload.repos : []
  const edges = Array.isArray(graphPayload?.edges) ? graphPayload.edges : []
  const roots = Array.isArray(graphPayload?.roots) ? graphPayload.roots : []

  if (rows.length === 0) {
    return DEFAULT_DEPENDENCY_TREE_DATA
  }

  const repoSet = new Set()
  rows.forEach((row) => {
    const repoFullName = String(row?.repoFullName || '').trim()
    if (!repoFullName) {
      return
    }

    repoSet.add(repoFullName)
  })

  const childrenByParent = new Map()
  const incomingCount = new Map()

  repoSet.forEach((repo) => {
    incomingCount.set(repo, 0)
  })

  edges.forEach((edge) => {
    const parentRepo = String(edge?.parentRepo || '').trim()
    const childRepo = String(edge?.childRepo || '').trim()
    if (!parentRepo || !childRepo || parentRepo === childRepo) {
      return
    }

    if (!repoSet.has(parentRepo) || !repoSet.has(childRepo)) {
      return
    }

    if (!childrenByParent.has(parentRepo)) {
      childrenByParent.set(parentRepo, new Set())
    }

    const children = childrenByParent.get(parentRepo)
    if (!children.has(childRepo)) {
      children.add(childRepo)
      incomingCount.set(childRepo, (incomingCount.get(childRepo) || 0) + 1)
    }
  })

  const rootCandidates = roots
    .map((repo) => String(repo || '').trim())
    .filter((repo) => repo && repoSet.has(repo))

  const resolvedRoots = rootCandidates.length > 0
    ? rootCandidates
    : Array.from(repoSet).filter((repo) => (incomingCount.get(repo) || 0) === 0)

  // Ant Tree expects stable, unique node keys in a strict tree (not a DAG).
  // Render each repo at most once and break cycles by path.
  const rendered = new Set()
  const buildNode = (repo, path = new Set()) => {
    if (path.has(repo)) {
      return {
        key: repo,
        title: shortRepoName(repo),
        children: [],
      }
    }

    if (rendered.has(repo)) {
      return null
    }

    rendered.add(repo)

    const nextPath = new Set(path)
    nextPath.add(repo)
    const children = Array.from(childrenByParent.get(repo) || [])
      .map((childRepo) => buildNode(childRepo, nextPath))
      .filter(Boolean)

    return {
      key: repo,
      title: shortRepoName(repo),
      children,
    }
  }

  const tree = resolvedRoots
    .map((repo) => buildNode(repo))
    .filter(Boolean)

  if (tree.length === 0) {
    Array.from(repoSet).forEach((repo) => {
      const node = buildNode(repo)
      if (node) {
        tree.push(node)
      }
    })
  }

  return tree.length > 0 ? tree : DEFAULT_DEPENDENCY_TREE_DATA
}

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

function SpringBootUpgradePage({ forceDependencyOnly = false } = {}) {
  const [repos, setRepos] = useState([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepoId, setSelectedRepoId] = useState(undefined)
  const [plans, setPlans] = useState([])
  const [isHydrated, setIsHydrated] = useState(false)
  const [activeTab, setActiveTab] = useState(forceDependencyOnly ? 'build-status' : 'create')
  const [dependencyTreeData, setDependencyTreeData] = useState(DEFAULT_DEPENDENCY_TREE_DATA)
  const [selectedBuildNode, setSelectedBuildNode] = useState('')
  const [buildStates, setBuildStates] = useState({})
  const [sharedRepoFullName, setSharedRepoFullName] = useState('')
  const [sharedBranch, setSharedBranch] = useState('master')
  const [sharedVersionInfo, setSharedVersionInfo] = useState(null)
  const [loadingSharedVersion, setLoadingSharedVersion] = useState(false)
  const [dependencyRepos, setDependencyRepos] = useState([])
  const [dependencyBranch, setDependencyBranch] = useState('master')
  const [loadingDependencyGraph, setLoadingDependencyGraph] = useState(false)
  const [dependencyRepoSearch, setDependencyRepoSearch] = useState('')
  const [selectedDependencyGroup, setSelectedDependencyGroup] = useState('')
  const [dependencyExpandedKeys, setDependencyExpandedKeys] = useState([])
  const [repoFinderSearch, setRepoFinderSearch] = useState('')
  const [repoFinderSelected, setRepoFinderSelected] = useState([])

  const dependencyNodeKeys = useMemo(() => collectNodeKeys(dependencyTreeData), [dependencyTreeData])
  const dependencyParentMap = useMemo(() => buildParentLookup(dependencyTreeData), [dependencyTreeData])
  const dependencyTitleMap = useMemo(() => buildTitleLookup(dependencyTreeData), [dependencyTreeData])
  const dependencyChildMap = useMemo(() => buildChildLookup(dependencyTreeData), [dependencyTreeData])
  const repoOptions = useMemo(
    () => repos
      .map((repo) => ({
        value: String(repo?.full_name || '').trim(),
        label: String(repo?.full_name || repo?.name || '').trim(),
      }))
      .filter((option) => option.value && option.label),
    [repos]
  )
  const matchedDependencyRepoValues = useMemo(() => {
    const query = String(dependencyRepoSearch || '').trim().toLowerCase()
    if (!query) {
      return []
    }

    return repoOptions
      .filter((option) => option.label.toLowerCase().includes(query))
      .map((option) => option.value)
  }, [repoOptions, dependencyRepoSearch])

  const repoFinderFilteredOptions = useMemo(() => {
    const query = String(repoFinderSearch || '').trim().toLowerCase()
    if (!query) {
      return repoOptions
    }

    return repoOptions.filter((option) => option.label.toLowerCase().includes(query))
  }, [repoOptions, repoFinderSearch])

  useEffect(() => {
    if (dependencyNodeKeys.length === 0) {
      return
    }

    setBuildStates((prev) => {
      const next = {}
      dependencyNodeKeys.forEach((key) => {
        next[key] = prev[key] || {
          status: 'idle',
          autoStart: false,
          completedAt: '',
        }
      })
      return next
    })

    setSelectedBuildNode((current) => (current && dependencyNodeKeys.includes(current) ? current : dependencyNodeKeys[0]))
    setDependencyExpandedKeys(dependencyNodeKeys)
  }, [dependencyNodeKeys])

  useEffect(() => {
    const validRepoValues = new Set(repoOptions.map((option) => option.value))
    setRepoFinderSelected((prev) => prev.filter((value) => validRepoValues.has(value)))
  }, [repoOptions])

  useEffect(() => {
    if (forceDependencyOnly) {
      setActiveTab('build-status')
    }
  }, [forceDependencyOnly])

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

  const handleReadSharedVersion = async () => {
    if (!sharedRepoFullName) {
      message.warning('Select springboot-shared repository first')
      return
    }

    try {
      setLoadingSharedVersion(true)
      const normalizedBranch = String(sharedBranch || '').trim()
      let discoveredBranches = []
      try {
        discoveredBranches = await fetchRepoBranches(sharedRepoFullName)
      } catch {
        // Continue with fallback branches if branch discovery fails.
      }

      const candidateBranches = Array.from(new Set([
        normalizedBranch || 'master',
        ...discoveredBranches,
        'main',
        'master',
      ]))

      let resolvedInfo = null
      let resolvedBranch = ''
      let lastError = null

      for (const branch of candidateBranches) {
        try {
          const info = await fetchPomInfo(sharedRepoFullName, branch)
          resolvedInfo = info
          resolvedBranch = branch
          break
        } catch (error) {
          lastError = error
        }
      }

      if (!resolvedInfo) {
        throw new Error(
          lastError?.message
          || `pom.xml not found for ${sharedRepoFullName}. Checked branches: ${candidateBranches.join(', ')}`)
      }

      setSharedVersionInfo(resolvedInfo)
      if (resolvedBranch && resolvedBranch !== sharedBranch) {
        setSharedBranch(resolvedBranch)
      }
      message.success(`Read Spring Boot version from ${sharedRepoFullName} (${resolvedBranch})`)
    } catch (error) {
      setSharedVersionInfo(null)
      message.error(error.message || 'Failed to read springboot-shared pom.xml')
    } finally {
      setLoadingSharedVersion(false)
    }
  }

  const handleDiscoverDependencyGraph = async () => {
    if (!Array.isArray(dependencyRepos) || dependencyRepos.length === 0) {
      message.warning('Select repositories for dependency discovery')
      return
    }

    try {
      setLoadingDependencyGraph(true)
      const payload = await discoverPomDependencyGraph({
        repos: dependencyRepos,
        defaultBranch: dependencyBranch || 'master',
      })
      const discoveredTree = buildTreeFromDependencyGraph(payload)
      setDependencyTreeData(discoveredTree)
      message.success(`Discovered dependency graph for ${dependencyRepos.length} repositories`)
    } catch (error) {
      message.error(error.message || 'Failed to discover pom dependencies')
    } finally {
      setLoadingDependencyGraph(false)
    }
  }

  const handleLoadKnownGroup = () => {
    const groupName = String(selectedDependencyGroup || '').trim()
    if (!groupName) {
      message.warning('Select a dependency group first')
      return
    }

    const groupTokens = KNOWN_DEPENDENCY_GROUPS[groupName] || []
    if (groupTokens.length === 0) {
      message.warning('Selected group has no configured repos')
      return
    }

    const normalizedTokens = groupTokens.map((token) => normalizeRepoToken(token)).filter(Boolean)
    const matchedRepos = repoOptions
      .map((option) => option.value)
      .filter((repoFullName) => {
        const normalizedRepoName = normalizeRepoToken(shortRepoName(repoFullName))
        return normalizedTokens.some((token) => normalizedRepoName.includes(token) || token.includes(normalizedRepoName))
      })

    if (matchedRepos.length === 0) {
      message.warning(`No repositories matched for group ${groupName}. Refresh repositories first.`)
      return
    }

    setDependencyRepos(matchedRepos)
    message.success(`Loaded ${matchedRepos.length} repositories from ${groupName}`)
  }

  const handleAddMatchedRepos = () => {
    if (matchedDependencyRepoValues.length === 0) {
      message.info('No matching repositories found for current search')
      return
    }

    setDependencyRepos((prev) => {
      const next = Array.from(new Set([...(Array.isArray(prev) ? prev : []), ...matchedDependencyRepoValues]))
      const addedCount = next.length - (Array.isArray(prev) ? prev.length : 0)
      if (addedCount > 0) {
        message.success(`Added ${addedCount} matching repositories`)
      } else {
        message.info('All matching repositories are already selected')
      }
      return next
    })
  }

  const handleAddFinderReposToAnalyze = () => {
    if (repoFinderSelected.length === 0) {
      message.info('Select repositories from the finder first')
      return
    }

    setDependencyRepos((prev) => {
      const next = Array.from(new Set([...(Array.isArray(prev) ? prev : []), ...repoFinderSelected]))
      const addedCount = next.length - (Array.isArray(prev) ? prev.length : 0)
      if (addedCount > 0) {
        message.success(`Added ${addedCount} repository(ies) to analyze`)
      } else {
        message.info('Selected repositories are already in analyze list')
      }
      return next
    })
  }

  const canStartBuildWithState = (nodeKey, stateMap) => {
    const parentKey = dependencyParentMap[nodeKey]
    if (!parentKey) {
      return true
    }
    return stateMap[parentKey]?.status === 'completed'
  }

  const canStartBuild = (nodeKey) => {
    return canStartBuildWithState(nodeKey, buildStates)
  }

  const startEligibleSiblings = (nodeKey) => {
    const parentKey = dependencyParentMap[nodeKey]
    if (!parentKey) {
      message.info('Selected repository has no siblings under a parent')
      return
    }

    const siblingKeys = Array.isArray(dependencyChildMap[parentKey])
      ? dependencyChildMap[parentKey]
      : []

    const eligibleSiblings = siblingKeys.filter((key) => {
      const state = buildStates[key]
      return state && state.status === 'idle' && canStartBuild(key)
    })

    if (eligibleSiblings.length === 0) {
      message.info('No eligible sibling builds to start')
      return
    }

    eligibleSiblings.forEach((key) => startBuild(key))
    message.success(`Started ${eligibleSiblings.length} sibling build(s)`) 
  }

  const startBuild = (nodeKey) => {
    setBuildStates((prev) => {
      const current = prev[nodeKey]
      if (!current || current.status !== 'idle') {
        return prev
      }

      if (!canStartBuildWithState(nodeKey, prev)) {
        message.warning('Parent build must complete before starting this dependent build')
        return prev
      }

      return {
        ...prev,
        [nodeKey]: {
          ...current,
          status: 'running',
        },
      }
    })

    window.setTimeout(() => {
      setBuildStates((prev) => {
        const current = prev[nodeKey]
        if (!current || current.status !== 'running') {
          return prev
        }

        return {
          ...prev,
          [nodeKey]: {
            ...current,
            status: 'completed',
            completedAt: new Date().toISOString(),
          },
        }
      })
    }, 1500)
  }

  useEffect(() => {
    dependencyNodeKeys.forEach((nodeKey) => {
      const state = buildStates[nodeKey]
      if (!state || !state.autoStart || state.status !== 'idle') {
        return
      }

      const parentKey = dependencyParentMap[nodeKey]
      if (!parentKey) {
        return
      }

      if (buildStates[parentKey]?.status === 'completed') {
        startBuild(nodeKey)
      }
    })
  }, [buildStates, dependencyNodeKeys, dependencyParentMap])

  const selectedBuildState = buildStates[selectedBuildNode] || { status: 'idle', autoStart: false, completedAt: '' }
  const selectedBuildTitle = dependencyTitleMap[selectedBuildNode] || selectedBuildNode
  const selectedParentKey = dependencyParentMap[selectedBuildNode]
  const selectedParentTitle = selectedParentKey ? dependencyTitleMap[selectedParentKey] || selectedParentKey : ''

  const graphSummary = useMemo(() => {
    const totalNodes = dependencyNodeKeys.length
    const roots = dependencyNodeKeys.filter((key) => !dependencyParentMap[key]).length
    const leaves = dependencyNodeKeys.filter((key) => (dependencyChildMap[key] || []).length === 0).length
    const edges = dependencyNodeKeys.reduce((count, key) => count + (dependencyChildMap[key] || []).length, 0)
    return { totalNodes, roots, leaves, edges }
  }, [dependencyNodeKeys, dependencyParentMap, dependencyChildMap])

  const selectedPath = useMemo(() => {
    if (!selectedBuildNode) {
      return []
    }

    const path = []
    let current = selectedBuildNode
    while (current) {
      path.unshift(dependencyTitleMap[current] || current)
      current = dependencyParentMap[current]
    }
    return path
  }, [selectedBuildNode, dependencyTitleMap, dependencyParentMap])

  const renderDependencyNodes = (nodes) => (
    nodes.map((node) => {
      const state = buildStates[node.key] || { status: 'idle' }
      const childCount = (dependencyChildMap[node.key] || []).length
      const parentKey = dependencyParentMap[node.key]
      const parentLabel = parentKey ? (dependencyTitleMap[parentKey] || parentKey) : 'Root'
      const statusTag =
        state.status === 'completed'
          ? <Tag color="success">Completed</Tag>
          : state.status === 'running'
            ? <Tag color="processing">Running</Tag>
            : <Tag>Pending</Tag>

      return {
        key: node.key,
        title: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBlock: 2 }}>
            <Space size={6} wrap>
              <Text strong>{node.title}</Text>
              {statusTag}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Parent: {parentLabel} | Dependents: {childCount}
            </Text>
          </div>
        ),
        children: Array.isArray(node.children) ? renderDependencyNodes(node.children) : [],
      }
    })
  )

  return (
    <Card>
      {!forceDependencyOnly ? (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key)}
          items={[
            { key: 'create', label: 'Create' },
            { key: 'build-status', label: 'Check Build Status' },
          ]}
        />
      ) : null}

      {!forceDependencyOnly && activeTab === 'create' ? (
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
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card type="inner" title="Springboot Shared & Dependency Discovery">
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Springboot Shared Repository</Text>
                  <Select
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    placeholder="Select springboot-shared repository"
                    value={sharedRepoFullName || undefined}
                    onChange={(value) => setSharedRepoFullName(value || '')}
                    options={repoOptions}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={24} md={6}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Branch</Text>
                  <Input value={sharedBranch} onChange={(event) => setSharedBranch(event.target.value)} placeholder="master" />
                </Col>
                <Col xs={24} md={6}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>&nbsp;</Text>
                  <Button block loading={loadingSharedVersion} onClick={handleReadSharedVersion}>
                    Read Shared Version
                  </Button>
                </Col>
              </Row>

              {sharedVersionInfo ? (
                <div style={{ padding: 10, background: '#f6ffed', borderRadius: 8 }}>
                  <Text>
                    Current Spring Boot Version: <Text strong>{sharedVersionInfo.springBootVersion || 'Not found'}</Text>
                  </Text>
                </div>
              ) : null}

              <Divider style={{ margin: '6px 0' }} />

              <Row gutter={[12, 12]}>
                <Col xs={24} md={14}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Known Dependency Group</Text>
                  <Select
                    allowClear
                    placeholder="Select a known group"
                    value={selectedDependencyGroup || undefined}
                    onChange={(value) => setSelectedDependencyGroup(value || '')}
                    options={Object.keys(KNOWN_DEPENDENCY_GROUPS).map((name) => ({ value: name, label: name }))}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={24} md={5}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>&nbsp;</Text>
                  <Button block onClick={handleLoadKnownGroup}>Load Group Repos</Button>
                </Col>
              </Row>

              <Card
                size="small"
                title="Repository Finder (All Loaded Repositories)"
                styles={{ body: { paddingTop: 10 } }}
              >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Row gutter={[8, 8]}>
                    <Col xs={24} md={14}>
                      <Input
                        value={repoFinderSearch}
                        onChange={(event) => setRepoFinderSearch(event.target.value || '')}
                        placeholder="Search repositories by name"
                      />
                    </Col>
                    <Col xs={24} md={10}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={() => setRepoFinderSelected(repoFinderFilteredOptions.map((option) => option.value))}>
                          Select Filtered ({repoFinderFilteredOptions.length})
                        </Button>
                        <Button size="small" onClick={() => setRepoFinderSelected([])}>
                          Clear
                        </Button>
                        <Button type="primary" size="small" onClick={handleAddFinderReposToAnalyze}>
                          Add Selected To Analyze ({repoFinderSelected.length})
                        </Button>
                      </div>
                    </Col>
                  </Row>

                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                    {repoFinderFilteredOptions.length > 0 ? (
                      <Checkbox.Group
                        style={{ width: '100%' }}
                        value={repoFinderSelected}
                        onChange={(values) => setRepoFinderSelected(values.map((value) => String(value || '')).filter(Boolean))}
                      >
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          {repoFinderFilteredOptions.map((option) => (
                            <Checkbox key={option.value} value={option.value}>
                              {option.label}
                            </Checkbox>
                          ))}
                        </Space>
                      </Checkbox.Group>
                    ) : (
                      <Text type="secondary">No repositories match current search</Text>
                    )}
                  </div>

                  <Text type="secondary">
                    Loaded repos: {repoOptions.length} | Filtered: {repoFinderFilteredOptions.length}
                  </Text>
                </Space>
              </Card>

              <Row gutter={[12, 12]}>
                <Col xs={24} md={14}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    Repositories To Analyze
                  </Text>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    placeholder="Select repositories for pom dependency discovery"
                    value={dependencyRepos}
                    onSearch={(value) => setDependencyRepoSearch(value || '')}
                    filterOption={(input, option) => String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase())}
                    onChange={(value) => {
                      const sanitized = Array.isArray(value)
                        ? value.map((item) => String(item || '').trim()).filter(Boolean)
                        : []
                      setDependencyRepos(sanitized)
                    }}
                    options={repoOptions}
                    style={{ width: '100%' }}
                  />
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="small" onClick={handleAddMatchedRepos} disabled={matchedDependencyRepoValues.length === 0}>
                      Add All Matched ({matchedDependencyRepoValues.length})
                    </Button>
                    <Text type="secondary">Search then click to add all matched repos in one go.</Text>
                  </div>
                </Col>

                <Col xs={24} md={5}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>Default Branch</Text>
                  <Input value={dependencyBranch} onChange={(event) => setDependencyBranch(event.target.value)} placeholder="master" />
                </Col>
                <Col xs={24} md={5}>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>&nbsp;</Text>
                  <Button block type="primary" loading={loadingDependencyGraph} onClick={handleDiscoverDependencyGraph}>
                    Discover Graph
                  </Button>
                </Col>
              </Row>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button loading={loadingRepos} onClick={loadRepositories}>Refresh Repositories</Button>
                <Button
                  onClick={() => {
                    setDependencyTreeData(DEFAULT_DEPENDENCY_TREE_DATA)
                    setDependencyRepos([])
                    setDependencyRepoSearch('')
                    message.success('Reset to default dependency template')
                  }}
                >
                  Reset Default Tree
                </Button>
              </div>
            </Space>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card type="inner" title="Dependency Tree">
                <Space wrap size={8} style={{ marginBottom: 10 }}>
                  <Tag color="blue">Nodes: {graphSummary.totalNodes}</Tag>
                  <Tag color="purple">Edges: {graphSummary.edges}</Tag>
                  <Tag color="geekblue">Roots: {graphSummary.roots}</Tag>
                  <Tag color="cyan">Leaves: {graphSummary.leaves}</Tag>
                </Space>

                <Space wrap size={8} style={{ marginBottom: 10 }}>
                  <Tag>Pending</Tag>
                  <Tag color="processing">Running</Tag>
                  <Tag color="success">Completed</Tag>
                  <Button size="small" onClick={() => setDependencyExpandedKeys(dependencyNodeKeys)}>
                    Expand All
                  </Button>
                  <Button size="small" onClick={() => setDependencyExpandedKeys([])}>
                    Collapse All
                  </Button>
                </Space>

                <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fafafa', borderRadius: 8 }}>
                  <Text type="secondary" style={{ display: 'block' }}>Selected Dependency Path</Text>
                  <Text strong>{selectedPath.length > 0 ? selectedPath.join(' -> ') : 'No node selected'}</Text>
                </div>

                <Tree
                  blockNode
                  expandedKeys={dependencyExpandedKeys}
                  onExpand={(keys) => setDependencyExpandedKeys(keys)}
                  showLine
                  selectedKeys={selectedBuildNode ? [selectedBuildNode] : []}
                  onSelect={(keys) => {
                    if (Array.isArray(keys) && keys.length > 0) {
                      setSelectedBuildNode(keys[0])
                    }
                  }}
                  treeData={renderDependencyNodes(dependencyTreeData)}
                />
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Card type="inner" title="HT Build Section">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div>
                    <Text strong>{selectedBuildTitle}</Text>
                    <br />
                    <Text type="secondary">
                      {selectedParentTitle
                        ? `Depends on: ${selectedParentTitle}`
                        : 'Root build (no dependency)'}
                    </Text>
                  </div>

                  <Divider style={{ margin: '8px 0' }} />

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text strong>Auto start after parent completion</Text>
                    <Switch
                      checked={selectedBuildState.autoStart}
                      onChange={(checked) => {
                        setBuildStates((prev) => ({
                          ...prev,
                          [selectedBuildNode]: {
                            ...prev[selectedBuildNode],
                            autoStart: checked,
                          },
                        }))
                      }}
                      disabled={!selectedParentKey}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => startBuild(selectedBuildNode)}
                      disabled={selectedBuildState.status !== 'idle' || !canStartBuild(selectedBuildNode)}
                    >
                      Start Build
                    </Button>

                    <Button
                      onClick={() => startEligibleSiblings(selectedBuildNode)}
                      disabled={!selectedParentKey}
                    >
                      Start Eligible Siblings
                    </Button>

                    {selectedBuildState.status === 'completed' ? (
                      <Tag color="success">Checked</Tag>
                    ) : selectedBuildState.status === 'running' ? (
                      <Tag color="processing">Running</Tag>
                    ) : (
                      <Tag>Pending</Tag>
                    )}
                  </div>

                  {!canStartBuild(selectedBuildNode) && selectedParentTitle ? (
                    <Text type="secondary">This build will unlock after {selectedParentTitle} is completed.</Text>
                  ) : null}

                  {selectedBuildState.completedAt ? (
                    <Text type="secondary">Completed at: {new Date(selectedBuildState.completedAt).toLocaleString()}</Text>
                  ) : null}

                  {Array.isArray(dependencyChildMap[selectedBuildNode]) && dependencyChildMap[selectedBuildNode].length > 0 ? (
                    <Text type="secondary">
                      Dependents: {dependencyChildMap[selectedBuildNode].map((key) => dependencyTitleMap[key] || key).join(', ')}
                    </Text>
                  ) : (
                    <Text type="secondary">No dependent builds under this node.</Text>
                  )}
                </Space>
              </Card>
            </Col>
          </Row>

          <BuildStatusPage />
        </Space>
      )}
    </Card>
  )
}

export default SpringBootUpgradePage
