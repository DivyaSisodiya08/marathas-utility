import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Spin, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { BranchesOutlined, GithubOutlined } from '@ant-design/icons'
import { createGithubBranch, createPullRequest, fetchGithubRepos, fetchRepoBranches } from '../services/githubService'

const { Text } = Typography
const { TextArea } = Input

function CreatePullRequestPage() {
    const [repos, setRepos] = useState([])
    const [branches, setBranches] = useState([])
    const [loadingRepos, setLoadingRepos] = useState(false)
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [creatingPr, setCreatingPr] = useState(false)
    const [result, setResult] = useState(null)
    const [lastSuggestedTitle, setLastSuggestedTitle] = useState('')

    const [form] = Form.useForm()

    const selectedRepoFullName = Form.useWatch('repoFullName', form)
    const branchMode = Form.useWatch('branchMode', form) ?? 'existing'

    useEffect(() => {
        let isMounted = true

        const hydrateRepos = async () => {
            // Always use shared repo cache so all pages stay in sync.
            try {
                const cachedRepos = await fetchGithubRepos(false)
                if (isMounted && Array.isArray(cachedRepos) && cachedRepos.length > 0) {
                    setRepos(cachedRepos)
                }
            } catch {
                // Keep manual fetch flow available when repo preload fails.
            }
        }

        hydrateRepos()

        return () => {
            isMounted = false
        }
    }, [])

    const repoOptions = useMemo(
        () => repos.map((repo) => ({ label: repo.full_name, value: repo.full_name })),
        [repos]
    )

    const branchOptions = useMemo(
        () => branches.map((branch) => ({ label: branch, value: branch })),
        [branches]
    )

    const loadRepositories = async () => {
        try {
            setLoadingRepos(true)
            const data = await fetchGithubRepos(true)
            setRepos(Array.isArray(data) ? data : [])
            message.success(`Loaded ${Array.isArray(data) ? data.length : 0} repositories`)
        } catch (error) {
            setRepos([])
            message.error(error.message || 'Failed to load repositories')
        } finally {
            setLoadingRepos(false)
        }
    }

    const loadBranches = async (repoFullName) => {
        if (!repoFullName) {
            setBranches([])
            const currentTitle = form.getFieldValue('title') || ''
            if (!currentTitle || currentTitle === lastSuggestedTitle) {
                form.setFieldValue('title', '')
            }
            setLastSuggestedTitle('')
            return
        }

        try {
            setLoadingBranches(true)
            const fetchedBranches = await fetchRepoBranches(repoFullName)
            const normalizedBranches = Array.isArray(fetchedBranches) ? fetchedBranches : []
            setBranches(normalizedBranches)

            const defaultBase = normalizedBranches.includes('master')
                ? 'master'
                : normalizedBranches.includes('main')
                    ? 'main'
                    : normalizedBranches[0] || ''

            const currentTitle = form.getFieldValue('title') || ''
            if (!currentTitle || currentTitle === lastSuggestedTitle) {
                form.setFieldValue('title', '')
            }
            setLastSuggestedTitle('')

            form.setFieldsValue({
                baseBranch: defaultBase,
                compareBranch: '',
                newBranchName: '',
            })
        } catch (error) {
            setBranches([])
            message.error(error.message || `Failed to load branches for ${repoFullName}`)
        } finally {
            setLoadingBranches(false)
        }
    }

    const onRepoChange = async (repoFullName) => {
        setResult(null)
        await loadBranches(repoFullName)
    }

    const onCompareBranchChange = (compareBranch) => {
        const suggestedTitle = String(compareBranch || '').trim()
        const currentTitle = form.getFieldValue('title') || ''

        if (!currentTitle || currentTitle === lastSuggestedTitle) {
            form.setFieldValue('title', suggestedTitle)
        }

        setLastSuggestedTitle(suggestedTitle)
        setResult(null)
    }

    const handleCreatePr = async (values) => {
        if (!values.branchMode) {
            message.warning('Select a branch option (New or Existing)')
            return
        }

        try {
            setCreatingPr(true)
            setResult(null)

            const compareBranch = values.branchMode === 'new'
                ? (await createGithubBranch({
                    repoFullName: values.repoFullName,
                    sourceBranch: values.baseBranch,
                    branchName: values.newBranchName,
                })).branchName
                : values.compareBranch

            const payload = {
                repoFullName: values.repoFullName,
                baseBranch: values.baseBranch,
                compareBranch,
                title: values.title,
                body: values.body || '',
            }

            const response = await createPullRequest(payload)
            setResult(response)

            if (response?.existing === 'true' || response?.created === 'false') {
                message.info('Existing PR found and reused')
            } else {
                message.success('Pull request created successfully')
            }
        } catch (error) {
            message.error(error.message || 'Failed to create pull request')
        } finally {
            setCreatingPr(false)
        }
    }

    return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card>
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Alert
                        type="info"
                        banner
                        message="Select repo, branches, title and body to create PR."
                    />

                    <Form layout="vertical" form={form} onFinish={handleCreatePr}>
                        <Form.Item
                            name="repoFullName"
                            label="Repository"
                            rules={[{ required: true, message: 'Repository is required' }]}
                        >
                            <Select
                                showSearch
                                allowClear
                                placeholder={repos.length > 0 ? 'Select repository' : 'Open GitHub Access and Fetch Repo first'}
                                options={repoOptions}
                                loading={loadingRepos}
                                disabled={loadingRepos || repos.length === 0}
                                onChange={onRepoChange}
                                optionFilterProp="label"
                            />
                        </Form.Item>

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                gap: 16,
                                marginBottom: 24,
                                width: '100%',
                            }}
                        >
                            <Form.Item
                                name="baseBranch"
                                label="Base Branch"
                                rules={[{ required: true, message: 'Base branch is required' }]}
                                style={{ marginBottom: 0 }}
                            >
                                <Select
                                    showSearch
                                    placeholder="Select base branch"
                                    options={branchOptions}
                                    loading={loadingBranches}
                                    disabled={!selectedRepoFullName}
                                    optionFilterProp="label"
                                />
                            </Form.Item>

                            <div>
                                <Form.Item label="Compare Branch Option" style={{ marginBottom: 0 }}>
                                    <Space size={16}>
                                        <Checkbox
                                            checked={branchMode === 'new'}
                                            onChange={(event) => {
                                                form.setFieldValue('branchMode', event.target.checked ? 'new' : '')
                                                setResult(null)
                                            }}
                                        >
                                            New Branch
                                        </Checkbox>
                                        <Checkbox
                                            checked={branchMode === 'existing'}
                                            onChange={(event) => {
                                                form.setFieldValue('branchMode', event.target.checked ? 'existing' : '')
                                                setResult(null)
                                            }}
                                        >
                                            Existing Branch
                                        </Checkbox>
                                    </Space>
                                </Form.Item>
                                <Form.Item name="branchMode" initialValue="existing" hidden>
                                    <Input type="hidden" />
                                </Form.Item>
                            </div>
                        </div>

                        {branchMode === 'existing' ? (
                            <Form.Item
                                name="compareBranch"
                                label="Compare Branch"
                                rules={[{ required: true, message: 'Compare branch is required' }]}
                                style={{ maxWidth: 720 }}
                            >
                                <Select
                                    showSearch
                                    placeholder="Select compare branch"
                                    options={branchOptions}
                                    loading={loadingBranches}
                                    disabled={!selectedRepoFullName}
                                    onChange={onCompareBranchChange}
                                    optionFilterProp="label"
                                />
                            </Form.Item>
                        ) : (
                            <Form.Item
                                name="newBranchName"
                                label="New Branch Name"
                                rules={[{ required: true, whitespace: true, message: 'New branch name is required' }]}
                                style={{ maxWidth: 720 }}
                            >
                                <Input
                                    placeholder="Enter a new branch name"
                                    disabled={!selectedRepoFullName}
                                    onChange={(event) => onCompareBranchChange(event.target.value)}
                                />
                            </Form.Item>
                        )}

                        <Form.Item
                            name="title"
                            label="PR Title"
                            rules={[{ required: true, message: 'PR title is required' }]}
                            style={{ maxWidth: 720 }}
                        >
                            <Input placeholder="Enter pull request title" />
                        </Form.Item>

                        <Form.Item
                            name="body"
                            label="PR Description"
                            style={{ maxWidth: 720 }}
                        >
                            <TextArea rows={3} placeholder="Enter pull request description" />
                        </Form.Item>

                        <Space>
                            <Button
                                type="primary"
                                htmlType="submit"
                                icon={<BranchesOutlined />}
                                loading={creatingPr}
                                disabled={!selectedRepoFullName}
                            >
                                Create PR
                            </Button>
                            {loadingBranches ? <Spin size="small" /> : null}
                        </Space>
                    </Form>
                </Space>
            </Card>

            {result ? (
                <Card title="PR Result">
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Text>
                            PR Number: <strong>{result.prNumber || 'N/A'}</strong>
                        </Text>
                        <Text>
                            Base Branch: <strong>{result.baseBranch || 'N/A'}</strong>
                        </Text>
                        <Text>
                            Compare Branch: <strong>{result.compareBranch || 'N/A'}</strong>
                        </Text>
                        <Text>
                            Status: <strong>{result.created === 'true' ? 'Created' : 'Existing/Reused'}</strong>
                        </Text>
                        {result.prUrl ? (
                            <a href={result.prUrl} target="_blank" rel="noreferrer">
                                Open Pull Request
                            </a>
                        ) : null}
                    </Space>
                </Card>
            ) : null}
        </Space>
    )
}

export default CreatePullRequestPage
