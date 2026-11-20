import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Input, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import {
    fetchJenkinsBuilds,
    fetchJenkinsConfig,
    fetchJenkinsJobs,
    triggerJenkinsDeploy,
} from '../services/jenkinsService'

const { Text } = Typography

function statusColor(result, building) {
    if (building) {
        return 'processing'
    }

    const normalized = (result || '').toLowerCase()
    if (normalized === 'success') {
        return 'success'
    }
    if (normalized === 'failure' || normalized === 'aborted') {
        return 'error'
    }
    if (normalized === 'unstable') {
        return 'warning'
    }
    return 'default'
}

function toJenkinsJobPath(input) {
    const raw = (input || '').trim()
    if (!raw) {
        return ''
    }

    try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            const url = new URL(raw)
            const tokens = url.pathname.split('/').filter(Boolean)
            const segments = []
            for (let i = 0; i < tokens.length; i += 1) {
                if (tokens[i].toLowerCase() === 'job' && i + 1 < tokens.length) {
                    segments.push(decodeURIComponent(tokens[i + 1]))
                    i += 1
                }
            }
            return segments.join('/')
        }
    } catch {
        // Keep raw value if URL parsing fails.
    }

    return raw
}

async function fetchRecentBuilds(jobPath) {
    const path = toJenkinsJobPath(jobPath)
    const data = await fetchJenkinsBuilds(path, 10)
    return [...data].sort((first, second) => Number(second.number) - Number(first.number))
}

function JenkinsDeployPage() {
    const [loadingConfig, setLoadingConfig] = useState(false)
    const [loadingJobs, setLoadingJobs] = useState(false)
    const [loadingBuilds, setLoadingBuilds] = useState(false)
    const [deploying, setDeploying] = useState(false)

    const [baseUrl, setBaseUrl] = useState('')
    const [jobInput, setJobInput] = useState('')
    const [selectedJobPath, setSelectedJobPath] = useState('')
    const [jobs, setJobs] = useState([])
    const [builds, setBuilds] = useState([])
    const [buildsJobPath, setBuildsJobPath] = useState('')
    const [jobFilter, setJobFilter] = useState('')
    const selectedJob = jobs.find((job) => job.jobPath === (buildsJobPath || selectedJobPath))
    const normalizedFilter = jobFilter.trim().toLowerCase()
    const filteredBuilds = builds.filter((build) =>
        [build.displayName, build.number, build.result].some((value) =>
            String(value || '').toLowerCase().includes(normalizedFilter)
        )
    )

    const buildColumns = [
        {
            title: 'Build',
            dataIndex: 'displayName',
            key: 'displayName',
            render: (_, row) => row.displayName || `#${row.number || '-'}`,
        },
        {
            title: 'Status',
            key: 'result',
            render: (_, row) => {
                const building = row.building === true || row.building === 'true'
                const text = building ? 'BUILDING' : row.result || 'UNKNOWN'
                return <Tag color={statusColor(row.result, building)}>{text}</Tag>
            },
        },
        {
            title: 'Run Date / Time',
            dataIndex: 'timestamp',
            key: 'timestamp',
            render: (value) => {
                if (!value) {
                    return '-'
                }
                const millis = Number(value)
                if (Number.isNaN(millis)) {
                    return value
                }
                return new Date(millis).toLocaleString()
            },
        },
        {
            title: 'Duration',
            dataIndex: 'duration',
            key: 'duration',
            render: (value) => {
                const millis = Number(value)
                if (Number.isNaN(millis)) {
                    return '-'
                }
                const seconds = Math.max(0, Math.round(millis / 1000))
                return `${seconds}s`
            },
        },
        {
            title: 'Open',
            dataIndex: 'url',
            key: 'url',
            render: (url) =>
                url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                        View Build
                    </a>
                ) : (
                    '-'
                ),
        },
    ]

    useEffect(() => {
        const loadConfig = async () => {
            try {
                setLoadingConfig(true)
                const config = await fetchJenkinsConfig()
                setBaseUrl(config.baseUrl || '')

                const defaultPath = toJenkinsJobPath(config.defaultJobPath || '')
                setJobInput(defaultPath)
                setSelectedJobPath(defaultPath)

                if (defaultPath) {
                    setLoadingJobs(true)
                    const data = await fetchJenkinsJobs(defaultPath, false)
                    setJobs(data)
                    if (data.length > 0) {
                        const initialJobPath = data.some((job) => job.jobPath === defaultPath)
                            ? defaultPath
                            : data[0]?.jobPath || defaultPath
                        setSelectedJobPath(initialJobPath)
                        setLoadingBuilds(true)
                        try {
                            const initialBuilds = await fetchRecentBuilds(initialJobPath)
                            setBuilds(initialBuilds)
                            setBuildsJobPath(initialJobPath)
                        } finally {
                            setLoadingBuilds(false)
                        }
                    }
                }
            } catch (error) {
                message.error(error.message || 'Failed to load Jenkins configuration')
            } finally {
                setLoadingJobs(false)
                setLoadingConfig(false)
            }
        }

        void loadConfig()
    }, [])

    const loadJobs = async () => {
        try {
            setLoadingJobs(true)
            const normalizedInput = toJenkinsJobPath(jobInput)
            const data = await fetchJenkinsJobs(normalizedInput, false)
            setJobs(data)
            setBuilds([])
            setBuildsJobPath('')
            setJobFilter('')

            if (data.length > 0) {
                const nextJobPath = data.some((job) => job.jobPath === selectedJobPath)
                    ? selectedJobPath
                    : data[0]?.jobPath || ''
                setSelectedJobPath(nextJobPath)
                if (nextJobPath) {
                    await loadBuilds(nextJobPath, false)
                }
            }

            message.success(`Loaded ${data.length} Jenkins jobs`)
        } catch (error) {
            message.error(error.message || 'Failed to fetch Jenkins jobs')
        } finally {
            setLoadingJobs(false)
        }
    }

    const loadBuilds = async (jobPath = selectedJobPath, notify = true) => {
        const path = toJenkinsJobPath(jobPath)
        if (!path) {
            message.warning('Select a Jenkins job first')
            return
        }

        try {
            setLoadingBuilds(true)
            setBuilds([])
            setBuildsJobPath(path)
            setJobFilter('')
            const data = await fetchRecentBuilds(path)
            setBuilds(data)
            setBuildsJobPath(path)
            if (notify) {
                message.success(`Loaded ${data.length} builds`)
            }
        } catch (error) {
            setBuilds([])
            message.error(error.message || 'Failed to fetch Jenkins builds')
        } finally {
            setLoadingBuilds(false)
        }
    }

    const triggerDeploy = async () => {
        const path = toJenkinsJobPath(selectedJobPath || jobInput)
        if (!path) {
            message.warning('Enter Jenkins job path or URL first')
            return
        }

        try {
            setDeploying(true)
            const result = await triggerJenkinsDeploy({ jobPath: path })
            message.success(`Deployment queued for ${result.jobPath}`)
            await loadBuilds(path, false)
        } catch (error) {
            message.error(error.message || 'Failed to trigger deployment')
        } finally {
            setDeploying(false)
        }
    }

    return (
        <Card bodyStyle={{ padding: 20 }}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Manage Jenkins deployments directly from utility. You can paste full Jenkins URL or job path."
                />

                <Card type="inner" title="Jenkins Target">
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Text type="secondary">Jenkins Base URL: {baseUrl || '-'}</Text>
                        <Row gutter={[12, 12]}>
                            <Col xs={24} md={16}>
                                <Input
                                    placeholder="Paste Jenkins URL or job path (deploy/non-prod/us-east-1/stratas-nonprod/dev)"
                                    value={jobInput}
                                    onChange={(event) => setJobInput(event.target.value)}
                                />
                            </Col>
                            <Col xs={24} md={8}>
                                <Button
                                    block
                                    icon={<ReloadOutlined />}
                                    loading={loadingJobs || loadingConfig}
                                    onClick={loadJobs}
                                >
                                    Load Jobs
                                </Button>
                            </Col>
                        </Row>

                        <Select
                            showSearch
                            allowClear
                            optionFilterProp="label"
                            placeholder="Select a Jenkins job"
                            value={selectedJobPath || undefined}
                            onChange={(value) => {
                                const path = value || ''
                                setSelectedJobPath(path)
                                if (path) {
                                    void loadBuilds(path, false)
                                } else {
                                    setBuilds([])
                                    setBuildsJobPath('')
                                }
                            }}
                            options={jobs.map((job) => ({
                                value: job.jobPath,
                                label: `${job.name} (${job.status || 'unknown'})`,
                            }))}
                            style={{ width: '100%' }}
                        />
                    </Space>
                </Card>

                <Card type="inner" title="Deployment Actions">
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                            <Button
                                block
                                type="primary"
                                icon={<PlayCircleOutlined />}
                                loading={deploying}
                                onClick={triggerDeploy}
                            >
                                Trigger Deploy
                            </Button>
                        </Col>
                        <Col xs={24} md={12}>
                            <Button block loading={loadingBuilds} onClick={() => loadBuilds()}>
                                Check Status
                            </Button>
                        </Col>
                    </Row>
                </Card>

                <Card
                    type="inner"
                    title={`Build Status${selectedJob ? `: ${selectedJob.name}` : ''}`}
                >
                    <Input
                        allowClear
                        aria-label="Filter build status"
                        placeholder="Filter builds by number or status"
                        value={jobFilter}
                        onChange={(event) => setJobFilter(event.target.value)}
                        style={{ marginBottom: 12 }}
                    />
                    <Table
                        rowKey={(row) => row.url || `${row.number}-${row.timestamp}`}
                        dataSource={filteredBuilds}
                        columns={buildColumns}
                        loading={loadingBuilds}
                        pagination={{ pageSize: 10 }}
                        scroll={{ x: 900 }}
                        locale={{
                            emptyText: normalizedFilter
                                ? 'No matching builds'
                                : (buildsJobPath ? 'No Jenkins builds found for this job' : 'Select a Jenkins job to view its builds'),
                        }}
                    />
                </Card>
            </Space>
        </Card>
    )
}

export default JenkinsDeployPage
