import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Space, Tree, Typography, message, Select, Popconfirm } from 'antd'
import { GithubOutlined, CloseOutlined } from '@ant-design/icons'
import { fetchGithubRepos } from '../services/githubService'

const { Text } = Typography
const REPO_TREE_STATE_KEY = 'repo_tree_structure_state_v1'
const TREE_ROOT_KEY = 'repo-root'
const TREE_ROOT_TITLE = 'GitHub repositories'
const DEFAULT_TREE_NAME = 'Default Relation Tree'

function createDefaultTreeData(children = []) {
  return [
    {
      title: TREE_ROOT_TITLE,
      key: TREE_ROOT_KEY,
      children,
    },
  ]
}

function sanitizeTreeNode(node) {
  if (!node || typeof node !== 'object') {
    return null
  }

  const key = typeof node.key === 'string' ? node.key : ''
  if (!key) {
    return null
  }

  const title = typeof node.title === 'string' && node.title.trim() ? node.title : key
  const children = Array.isArray(node.children)
    ? node.children.map(sanitizeTreeNode).filter(Boolean)
    : []

  return {
    title,
    key,
    children,
  }
}

function pruneUnmappedTopLevelNodes(children) {
  return children.filter((node) => {
    if (!String(node.key).startsWith('gh-')) {
      return true
    }

    return Array.isArray(node.children) && node.children.length > 0
  })
}

function normalizeTreeData(rawTreeData) {
  if (!Array.isArray(rawTreeData) || rawTreeData.length === 0) {
    return createDefaultTreeData()
  }

  const existingRoot = rawTreeData.find((node) => node?.key === TREE_ROOT_KEY)
  const rawChildren = Array.isArray(existingRoot?.children) ? existingRoot.children : rawTreeData
  const sanitizedChildren = rawChildren.map(sanitizeTreeNode).filter(Boolean)

  return createDefaultTreeData(pruneUnmappedTopLevelNodes(sanitizedChildren))
}

function createDefaultNamedTrees() {
  return {
    [DEFAULT_TREE_NAME]: createDefaultTreeData(),
  }
}

function sanitizeNamedTrees(rawNamedTrees) {
  if (!rawNamedTrees || typeof rawNamedTrees !== 'object') {
    return createDefaultNamedTrees()
  }

  const entries = Object.entries(rawNamedTrees)
    .filter(([name, data]) => typeof name === 'string' && name.trim() && Array.isArray(data))
    .map(([name, data]) => [name.trim(), normalizeTreeData(data)])

  if (entries.length === 0) {
    return createDefaultNamedTrees()
  }

  return Object.fromEntries(entries)
}

function RepoTreePage() {
  const [selectedTreeNodeKey, setSelectedTreeNodeKey] = useState(TREE_ROOT_KEY)
  const [namedTrees, setNamedTrees] = useState(() => createDefaultNamedTrees())
  const [activeTreeName, setActiveTreeName] = useState(DEFAULT_TREE_NAME)
  const [treeNameSearch, setTreeNameSearch] = useState('')
  const [isFetchingRepos, setIsFetchingRepos] = useState(false)
  const [repos, setRepos] = useState([])
  const [githubLogin, setGithubLogin] = useState('')
  const [parentRepoId, setParentRepoId] = useState(undefined)
  const [childRepoId, setChildRepoId] = useState(undefined)
  const [customParentKey, setCustomParentKey] = useState(undefined)
  const [customChildRepoId, setCustomChildRepoId] = useState(undefined)
  const [isHydrated, setIsHydrated] = useState(false)

  const treeData = useMemo(() => {
    return normalizeTreeData(namedTrees[activeTreeName])
  }, [namedTrees, activeTreeName])

  const displayRootTitle = useMemo(() => {
    if (githubLogin) {
      return `${githubLogin} repositories`
    }
    return 'GitHub repositories'
  }, [githubLogin])

  const addChildNodeAtAnyLevel = (nodes, parentKey, newNode) =>
    nodes.map((node) => {
      if (node.key === parentKey) {
        return {
          ...node,
          children: [...(node.children || []), newNode],
        }
      }

      if (node.children?.length) {
        return {
          ...node,
          children: addChildNodeAtAnyLevel(node.children, parentKey, newNode),
        }
      }

      return node
    })

  const removeNodeAtAnyLevel = (nodes, targetKey) =>
    nodes
      .filter((node) => node.key !== targetKey)
      .map((node) => ({
        ...node,
        children: node.children?.length ? removeNodeAtAnyLevel(node.children, targetKey) : node.children,
      }))

  const findNodeByKey = (nodes, targetKey) => {
    for (const node of nodes) {
      if (node.key === targetKey) {
        return node
      }

      if (node.children?.length) {
        const nested = findNodeByKey(node.children, targetKey)
        if (nested) {
          return nested
        }
      }
    }

    return null
  }

  const collectNestedNodeOptions = (nodes, parentPath = '', depth = 0) =>
    nodes.flatMap((node) => {
      const title = String(node.title || '')
      const path = parentPath ? `${parentPath} / ${title}` : title
      const current = depth >= 2 ? [{ value: String(node.key), label: path }] : []
      const children = node.children?.length
        ? collectNestedNodeOptions(node.children, path, depth + 1)
        : []
      return [...current, ...children]
    })

  const nestedParentOptions = useMemo(() => collectNestedNodeOptions(treeData), [treeData])

  const treeNameOptions = useMemo(() => {
    const options = Object.keys(namedTrees).map((name) => ({ value: name, label: name }))
    const candidateName = treeNameSearch.trim()

    if (!candidateName) {
      return options
    }

    const exists = Object.keys(namedTrees).some((name) => name.toLowerCase() === candidateName.toLowerCase())
    if (exists) {
      return options
    }

    return [
      {
        value: `__add__:${candidateName}`,
        label: `+ Add tree: ${candidateName}`,
      },
      ...options,
    ]
  }, [namedTrees, treeNameSearch])

  const allTreeDetails = useMemo(() => {
    return Object.keys(namedTrees).map((name) => {
      const normalized = normalizeTreeData(namedTrees[name])
      const rootNode = normalized.find((node) => node.key === TREE_ROOT_KEY)
      const children = rootNode?.children || []

      const parentCount = children.length
      const relationCount = children.reduce((count, parentNode) => {
        return count + (Array.isArray(parentNode.children) ? parentNode.children.length : 0)
      }, 0)

      return {
        name,
        parentCount,
        relationCount,
        treeData: children,
      }
    })
  }, [namedTrees])

  const upsertParentRepoAtRoot = (nodes, parentRepo) => {
    const parentKey = `gh-${parentRepo.id}`

    return nodes.map((node) => {
      if (node.key !== TREE_ROOT_KEY) {
        return node
      }

      const children = node.children || []
      const hasParent = children.some((child) => child.key === parentKey)
      if (hasParent) {
        return node
      }

      return {
        ...node,
        children: [...children, { title: parentRepo.full_name, key: parentKey }],
      }
    })
  }

  const updateActiveTreeData = (updater) => {
    setNamedTrees((prev) => {
      const current = normalizeTreeData(prev[activeTreeName])
      const nextValue = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [activeTreeName]: normalizeTreeData(nextValue),
      }
    })
  }

  const createNamedTree = (treeName) => {
    const trimmedName = String(treeName || '').trim()
    if (!trimmedName) {
      message.warning('Enter a tree name')
      return
    }

    const existingName = Object.keys(namedTrees).find((name) => name.toLowerCase() === trimmedName.toLowerCase())
    if (existingName) {
      setActiveTreeName(existingName)
      setTreeNameSearch('')
      message.info(`Switched to ${existingName}`)
      return
    }

    setNamedTrees((prev) => ({
      ...prev,
      [trimmedName]: createDefaultTreeData(),
    }))
    setActiveTreeName(trimmedName)
    setTreeNameSearch('')
    setSelectedTreeNodeKey(TREE_ROOT_KEY)
    setCustomParentKey(undefined)
    message.success(`Created relation tree: ${trimmedName}`)
  }

  const handleTreeNameChange = (value) => {
    if (!value) {
      return
    }

    if (String(value).startsWith('__add__:')) {
      createNamedTree(String(value).replace('__add__:', ''))
      return
    }

    setActiveTreeName(value)
    setTreeNameSearch('')
  }

  const addRepoRelation = () => {
    if (!parentRepoId || !childRepoId) {
      message.warning('Select both parent and child repositories')
      return
    }

    if (String(parentRepoId) === String(childRepoId)) {
      message.warning('Parent and child repositories must be different')
      return
    }

    const parentRepo = repos.find((repo) => String(repo.id) === String(parentRepoId))
    const childRepo = repos.find((repo) => String(repo.id) === String(childRepoId))

    if (!parentRepo || !childRepo) {
      message.warning('Selected repositories are not available. Open GitHub Access and Fetch Repo once.')
      return
    }

    const parentKey = `gh-${parentRepo.id}`
    const relationKey = `rel-${parentRepo.id}-${childRepo.id}`

    updateActiveTreeData((prev) => {
      const withParent = upsertParentRepoAtRoot(prev, parentRepo)
      const parentNode = findNodeByKey(withParent, parentKey)
      const alreadyLinked = (parentNode?.children || []).some((child) => child.key === relationKey)

      if (alreadyLinked) {
        return normalizeTreeData(withParent)
      }

      return normalizeTreeData(
        addChildNodeAtAnyLevel(withParent, parentKey, {
          title: childRepo.full_name,
          key: relationKey,
        })
      )
    })

    setSelectedTreeNodeKey(parentKey)
    message.success(`Linked ${parentRepo.name} -> ${childRepo.name}`)
  }

  const deleteNodeByKey = (targetKey) => {
    if (!targetKey || targetKey === TREE_ROOT_KEY) {
      return
    }

    updateActiveTreeData((prev) => normalizeTreeData(removeNodeAtAnyLevel(prev, targetKey)))
    if (selectedTreeNodeKey === targetKey) {
      setSelectedTreeNodeKey(TREE_ROOT_KEY)
    }
    message.success('Node deleted')
  }

  const deleteNodeInTree = (treeName, targetKey) => {
    if (!targetKey || targetKey === TREE_ROOT_KEY) {
      return
    }

    setNamedTrees((prev) => {
      const currentTree = normalizeTreeData(prev[treeName])
      return {
        ...prev,
        [treeName]: normalizeTreeData(removeNodeAtAnyLevel(currentTree, targetKey)),
      }
    })

    if (activeTreeName === treeName && selectedTreeNodeKey === targetKey) {
      setSelectedTreeNodeKey(TREE_ROOT_KEY)
    }

    message.success('Node deleted')
  }

  const deleteTreeByName = (treeName) => {
    setNamedTrees((prev) => {
      const remainingEntries = Object.entries(prev).filter(([name]) => name !== treeName)
      const nextTrees = remainingEntries.length === 0
        ? createDefaultNamedTrees()
        : Object.fromEntries(remainingEntries)

      const nextActiveTree = nextTrees[activeTreeName]
        ? activeTreeName
        : (Object.keys(nextTrees)[0] || DEFAULT_TREE_NAME)

      if (nextActiveTree !== activeTreeName) {
        setActiveTreeName(nextActiveTree)
        setSelectedTreeNodeKey(TREE_ROOT_KEY)
        setCustomParentKey(undefined)
      }

      return nextTrees
    })

    message.success(`Deleted tree: ${treeName}`)
  }

  const addCustomChildNode = () => {
    const parentKey = String(customParentKey || '').trim()
    const selectedRepo = repos.find((repo) => String(repo.id) === String(customChildRepoId))

    if (!parentKey) {
      message.warning('Select a parent node')
      return
    }

    if (!selectedRepo) {
      message.warning('Select child repository')
      return
    }

    const childKey = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    updateActiveTreeData((prev) =>
      normalizeTreeData(
        addChildNodeAtAnyLevel(prev, parentKey, {
          title: selectedRepo.full_name,
          key: childKey,
        })
      )
    )
    setSelectedTreeNodeKey(childKey)
    setCustomChildRepoId(undefined)
    message.success(`Added ${selectedRepo.name}`)
  }

  const fetchAllGithubRepos = async () => {
    try {
      setIsFetchingRepos(true)
      const fetchedRepos = await fetchGithubRepos(true)
      setRepos(fetchedRepos)

      const owner = fetchedRepos.length > 0 ? fetchedRepos[0].owner?.login : ''
      setGithubLogin(owner || '')

      setParentRepoId(undefined)
      setChildRepoId(undefined)
      setCustomChildRepoId(undefined)
      message.success(`Fetched ${fetchedRepos.length} repositories.`)
    } catch (error) {
      message.error(error.message || 'Failed to fetch repositories')
    } finally {
      setIsFetchingRepos(false)
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REPO_TREE_STATE_KEY)
      if (!raw) {
        setIsHydrated(true)
        return
      }

      const parsed = JSON.parse(raw)

      let hydratedNamedTrees = createDefaultNamedTrees()

      if (parsed?.namedTrees) {
        hydratedNamedTrees = sanitizeNamedTrees(parsed.namedTrees)
      } else if (Array.isArray(parsed?.treeData) && parsed.treeData.length > 0) {
        hydratedNamedTrees = {
          [DEFAULT_TREE_NAME]: normalizeTreeData(parsed.treeData),
        }
      }

      setNamedTrees(hydratedNamedTrees)

      const requestedActiveTree = typeof parsed?.activeTreeName === 'string'
        ? parsed.activeTreeName.trim()
        : ''
      const firstAvailableTree = Object.keys(hydratedNamedTrees)[0] || DEFAULT_TREE_NAME
      setActiveTreeName(
        requestedActiveTree && hydratedNamedTrees[requestedActiveTree]
          ? requestedActiveTree
          : firstAvailableTree
      )

      if (typeof parsed?.selectedTreeNodeKey === 'string') {
        setSelectedTreeNodeKey(parsed.selectedTreeNodeKey || TREE_ROOT_KEY)
      }
      if (typeof parsed?.customParentKey === 'string') {
        setCustomParentKey(parsed.customParentKey)
      }
      if (typeof parsed?.parentRepoId === 'string') {
        setParentRepoId(parsed.parentRepoId)
      }
      if (typeof parsed?.childRepoId === 'string') {
        setChildRepoId(parsed.childRepoId)
      }
      if (typeof parsed?.customChildRepoId === 'string') {
        setCustomChildRepoId(parsed.customChildRepoId)
      }
    } catch {
      localStorage.removeItem(REPO_TREE_STATE_KEY)
    } finally {
      setIsHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    try {
      localStorage.setItem(
        REPO_TREE_STATE_KEY,
        JSON.stringify({
          namedTrees,
          activeTreeName,
          selectedTreeNodeKey,
          customParentKey,
          parentRepoId: parentRepoId || null,
          childRepoId: childRepoId || null,
          customChildRepoId: customChildRepoId || null,
        })
      )
    } catch {
      // Ignore storage write failures so page remains functional.
    }
  }, [namedTrees, activeTreeName, selectedTreeNodeKey, customParentKey, parentRepoId, childRepoId, customChildRepoId, isHydrated])

  useEffect(() => {
    const loadCachedRepos = async () => {
      try {
        const data = await fetchGithubRepos(false)
        if (Array.isArray(data) && data.length > 0) {
          setRepos(data)
          setGithubLogin(data[0]?.owner?.login || '')
        }
      } catch {
        // Keep explicit fetch button flow when cache/API is unavailable.
      }
    }

    loadCachedRepos()
  }, [])

  useEffect(() => {
    if (!customParentKey) {
      return
    }

    const exists = nestedParentOptions.some((option) => option.value === customParentKey)
    if (!exists) {
      setCustomParentKey(undefined)
    }
  }, [nestedParentOptions, customParentKey])

  useEffect(() => {
    setSelectedTreeNodeKey(TREE_ROOT_KEY)
    setCustomParentKey(undefined)
  }, [activeTreeName])

  return (
    <Card>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card type="inner" title="Tree Name + Parent Child Mapping">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              showSearch
              value={activeTreeName}
              onChange={handleTreeNameChange}
              onSearch={(value) => setTreeNameSearch(value)}
              options={treeNameOptions}
              style={{ width: '100%' }}
              placeholder="Select tree name or type to add"
              filterOption={(inputValue, option) =>
                String(option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
              }
            />

            <Text type="secondary">Active tree: {activeTreeName}</Text>

            <Select
              showSearch
              allowClear
              placeholder={repos.length > 0 ? 'Search parent repository' : 'Open GitHub Access and Fetch Repo first'}
              optionFilterProp="label"
              value={parentRepoId}
              onChange={(value) => setParentRepoId(value || undefined)}
              disabled={repos.length === 0}
              options={repos.map((repo) => ({
                value: String(repo.id),
                label: repo.full_name,
              }))}
              style={{ width: '100%' }}
            />

            <Select
              showSearch
              allowClear
              placeholder={repos.length > 0 ? 'Search child repository' : 'Open GitHub Access and Fetch Repo first'}
              optionFilterProp="label"
              value={childRepoId}
              onChange={(value) => setChildRepoId(value || undefined)}
              disabled={repos.length === 0}
              options={repos.map((repo) => ({
                value: String(repo.id),
                label: repo.full_name,
              }))}
              style={{ width: '100%' }}
            />

            <Button type="primary" onClick={addRepoRelation} disabled={repos.length === 0}>
              Add Parent to Child Relation
            </Button>
          </Space>
        </Card>

        <Card type="inner" title="Nested Node Builder">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              value={customParentKey}
              onChange={(value) => setCustomParentKey(value || undefined)}
              options={nestedParentOptions}
              style={{ width: '100%' }}
              placeholder="Select nested parent node"
            />

            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              value={customChildRepoId}
              onChange={(value) => setCustomChildRepoId(value || undefined)}
              disabled={repos.length === 0}
              options={repos.map((repo) => ({
                value: String(repo.id),
                label: repo.full_name,
              }))}
              style={{ width: '100%' }}
              placeholder={repos.length > 0 ? 'Search child repository for nested node' : 'Open GitHub Access and Fetch Repo first'}
            />

            <Button type="primary" onClick={addCustomChildNode}>
              Add Child Node
            </Button>
          </Space>
        </Card>

        <Text type="secondary">You can now add unlimited levels: select any parent node and add child nodes repeatedly.</Text>

        <Card type="inner" title="All Created Trees">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {allTreeDetails.map((detail) => (
              <Card
                key={detail.name}
                type="inner"
                title={detail.name}
                extra={(
                  <Popconfirm
                    title="Delete tree"
                    description={`Are you sure you want to delete tree \"${detail.name}\"?`}
                    okText="Delete"
                    cancelText="Cancel"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deleteTreeByName(detail.name)}
                  >
                    <Button danger size="small">Delete Tree</Button>
                  </Popconfirm>
                )}
              >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text type="secondary">
                    Parents: {detail.parentCount} | Relations: {detail.relationCount}
                  </Text>

                  <Tree
                    showLine
                    defaultExpandAll
                    titleRender={(node) => (
                      <Space size={8}>
                        <span>{node.title}</span>
                        <Button
                          type="text"
                          size="small"
                          icon={<CloseOutlined style={{ fontSize: 10 }} />}
                          style={{ color: '#000', width: 18, height: 18, minWidth: 18, padding: 0 }}
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteNodeInTree(detail.name, node.key)
                          }}
                        />
                      </Space>
                    )}
                    treeData={detail.treeData}
                  />
                </Space>
              </Card>
            ))}
          </Space>
        </Card>
      </Space>
    </Card>
  )
}

export default RepoTreePage
