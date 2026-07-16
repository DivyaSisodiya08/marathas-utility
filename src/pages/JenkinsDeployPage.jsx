import { useEffect, useMemo, useState } from 'react'
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

    const jobColumns = useMemo(
        () => [
            {
                title: 'Job Name',
                dataIndex: 'name',
                key: 'name',
            },
            {
                title: 'Job Path',
                dataIndex: 'jobPath',
                key: 'jobPath',
            },
            {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (value) => {
                    const normalized = (value || '').toLowerCase()
                    const color =
                        normalized === 'success'
                            ? 'success'
                            : normalized === 'failed'
                                ? 'error'
                                : normalized === 'unstable'
                                    ? 'warning'
                                    : normalized === 'running'
                                        ? 'processing'
                                        : 'default'
                    return <Tag color={color}>{value || 'unknown'}</Tag>
                },
            },
            {
                title: 'Open',
                dataIndex: 'url',
                key: 'url',
                render: (url) =>
                    url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                            View Job
                        </a>
                    ) : (
                        '-'
                    ),
            },
            {
                title: 'Action',
                key: 'action',
                render: (_, row) => (
                    <Button size="small" onClick={() => setSelectedJobPath(row.jobPath || '')}>
                        Select
                    </Button>
                ),
            },
        ],
        []
    )

    const buildColumns = useMemo(
        () => [
            {
                title: 'Build',
                dataIndex: 'displayName',
                key: 'displayName',
                render: (_, row) => row.displayName || `#${row.number || '-'}`,
            },
            {
                title: 'Result',
                key: 'result',
                render: (_, row) => {
                    const building = row.building === true || row.building === 'true'
                    const text = building ? 'BUILDING' : row.result || 'UNKNOWN'
                    return <Tag color={statusColor(row.result, building)}>{text}</Tag>
                },
            },
            {
                title: 'Started',
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
        ],
        []
    )

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
                        setSelectedJobPath((current) => {
                            if (current && data.some((job) => job.jobPath === current)) {
                                return current
                            }
                            return data[0]?.jobPath || current
                        })
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

            if (data.length > 0) {
                const firstJobPath = data[0]?.jobPath || ''
                setSelectedJobPath((current) => {
                    if (current && data.some((job) => job.jobPath === current)) {
                        return current
                    }
                    return firstJobPath
                })
            }

            message.success(`Loaded ${data.length} Jenkins jobs`)
        } catch (error) {
            message.error(error.message || 'Failed to fetch Jenkins jobs')
        } finally {
            setLoadingJobs(false)
        }
    }

    const loadBuilds = async () => {
        const path = toJenkinsJobPath(selectedJobPath || jobInput)
        if (!path) {
            message.warning('Enter Jenkins job path or URL first')
            return
        }

        try {
            setLoadingBuilds(true)
            const data = await fetchJenkinsBuilds(path, 20)
            setBuilds(data)
            message.success(`Loaded ${data.length} builds`)
        } catch (error) {
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
            await loadBuilds()
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
                            onChange={(value) => setSelectedJobPath(value || '')}
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
                            <Button block loading={loadingBuilds} onClick={loadBuilds}>
                                Refresh Builds
                            </Button>
                        </Col>
                    </Row>
                </Card>

                <Card type="inner" title="Jenkins Jobs">
                    <Table
                        rowKey={(row) => row.jobPath || row.url || row.name}
                        dataSource={jobs}
                        columns={jobColumns}
                        loading={loadingJobs}
                        pagination={{ pageSize: 10 }}
                        scroll={{ x: 900 }}
                        locale={{ emptyText: 'No Jenkins jobs found for this path' }}
                    />
                </Card>

                <Card type="inner" title="Recent Builds">
                    <Table
                        rowKey={(row) => row.url || `${row.number}-${row.timestamp}`}
                        dataSource={builds}
                        columns={buildColumns}
                        loading={loadingBuilds}
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 900 }}
                        locale={{ emptyText: 'No Jenkins builds found for this job' }}
                    />
                </Card>
            </Space>
        </Card>
    )
}

export default JenkinsDeployPage
