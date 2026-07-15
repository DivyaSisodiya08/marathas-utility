import { useEffect, useState } from 'react'
import { Button, Card, List, Space, Typography, message, Tag, Divider, Input, Steps, Alert, Collapse, Row, Col } from 'antd'
import { GithubOutlined, StarOutlined, CodeOutlined, DeleteOutlined, KeyOutlined, CheckCircleOutlined, FileTextOutlined, BranchesOutlined, ThunderboltOutlined, AuditOutlined } from '@ant-design/icons'
import { fetchGithubRepos } from '../services/githubService'

const { Text, Title, Paragraph } = Typography

const GITHUB_URL = 'https://github.com/'
const PAT_SESSION_KEY = 'github_pat_token'
const FINE_GRAINED_PAT_URL = 'https://github.com/settings/tokens?type=beta'

function GithubAccessPage() {
  const [repos, setRepos] = useState([])
  const [isFetching, setIsFetching] = useState(false)
  const [patToken, setPatToken] = useState('')
  const [storedPat, setStoredPat] = useState(null)
  const [isSavingPat, setIsSavingPat] = useState(false)

  const openGithub = () => {
    window.open(GITHUB_URL, '_blank', 'noopener,noreferrer')
  }

  const handleFetchRepos = async () => {
    try {
      setIsFetching(true)
      const data = await fetchGithubRepos(true)
      setRepos(data)
      message.success(`Fetched ${data.length} repositories from GitHub.`)
    } catch (error) {
      message.error(error.message || 'Failed to fetch repositories')
    } finally {
      setIsFetching(false)
    }
  }

  const handleSavePat = async () => {
    if (!patToken.trim()) {
      message.error('Please enter a PAT token')
      return
    }

    try {
      setIsSavingPat(true)
      // Store PAT in session storage
      sessionStorage.setItem(PAT_SESSION_KEY, patToken)
      setStoredPat(patToken)
      setPatToken('')
      message.success('PAT token saved to session. Ready to fetch repositories!')
    } catch (error) {
      message.error('Failed to save PAT token')
    } finally {
      setIsSavingPat(false)
    }
  }

  const handleClearPat = () => {
    sessionStorage.removeItem(PAT_SESSION_KEY)
    setStoredPat(null)
    message.success('PAT token cleared from session')
  }

  useEffect(() => {
    const loadCachedRepos = async () => {
      try {
        const data = await fetchGithubRepos(false)
        setRepos(data)
      } catch {
        // Keep page usable even when cached/live fetch is unavailable.
      }
    }

    // Load stored PAT from session
    const savedPat = sessionStorage.getItem(PAT_SESSION_KEY)
    if (savedPat) {
      setStoredPat(savedPat)
    }

    loadCachedRepos()
  }, [])

  return (
    <Card title="GitHub Access">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>

        {/* PAT Configuration Section */}
        <Card
          type="inner"
          title={
            <Space>
              <KeyOutlined style={{ color: '#1890ff' }} />
              <span>GitHub Personal Access Token (PAT)</span>
              {storedPat && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
            </Space>
          }
          style={{ backgroundColor: '#fafafa', borderColor: '#d9d9d9' }}
        >
          {!storedPat ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Alert
                message="Add a Fine-Grained PAT Token"
                description="Store your GitHub PAT in this session to fetch repositories without environment variables."
                type="info"
                showIcon
              />

              <Collapse
                items={[
                  {
                    key: '1',
                    label: (
                      <Space>
                        <AuditOutlined style={{ fontSize: 16 }} />
                        <span style={{ fontWeight: 600 }}>Create a Fine-Grained Personal Access Token</span>
                      </Space>
                    ),
                    children: (
                      <Space direction="vertical" size={24} style={{ width: '100%' }}>
                        <Steps
                          direction="vertical"
                          current={-1}
                          items={[
                            {
                              title: (
                                <Space>
                                  <span style={{ fontSize: 16, fontWeight: 600 }}>Step 1: Open GitHub Settings</span>
                                </Space>
                              ),
                              description: (
                                <Space direction="vertical" size={8} style={{ marginTop: 8 }}>
                                  <Text>Navigate to GitHub fine-grained PAT settings:</Text>
                                  <Button
                                    type="primary"
                                    icon={<GithubOutlined />}
                                    onClick={() => window.open(FINE_GRAINED_PAT_URL, '_blank')}
                                  >
                                    Open GitHub Fine-Grained PAT Settings
                                  </Button>
                                </Space>
                              ),
                              status: 'process',
                            },
                            {
                              title: (
                                <Space>
                                  <span style={{ fontSize: 16, fontWeight: 600 }}>Step 2: Generate New Token</span>
                                </Space>
                              ),
                              description: (
                                <Space direction="vertical" size={8} style={{ marginTop: 8 }}>
                                  <Text>Click <strong>"Generate new token"</strong> button</Text>
                                  <Text type="secondary">Make sure to select <strong>"Fine-grained tokens (beta)"</strong></Text>
                                </Space>
                              ),
                              status: 'process',
                            },
                            {
                              title: (
                                <Space>
                                  <span style={{ fontSize: 16, fontWeight: 600 }}>Step 3: Configure Token Details</span>
                                </Space>
                              ),
                              description: (
                                <Space direction="vertical" size={12} style={{ marginTop: 8 }}>
                                  <div>
                                    <Text strong style={{ display: 'block', marginBottom: 8 }}>Fill in the following:</Text>
                                    <ul style={{ marginLeft: 20, marginBottom: 0 }}>
                                      <li><Text><strong>Token name:</strong> e.g., "Marathas Utility"</Text></li>
                                      <li><Text><strong>Expiration:</strong> Choose 30, 60, or 90 days</Text></li>
                                      <li><Text><strong>Resource owner:</strong> Select your organization or user</Text></li>
                                    </ul>
                                  </div>
                                </Space>
                              ),
                              status: 'process',
                            },
                            {
                              title: (
                                <Space>
                                  <span style={{ fontSize: 16, fontWeight: 600 }}>Step 4: Set Repository Permissions</span>
                                </Space>
                              ),
                              description: (
                                <Space direction="vertical" size={16} style={{ marginTop: 8 }}>
                                  <Text strong style={{ display: 'block' }}>Under "Repository permissions", enable the following:</Text>
                                  <Row gutter={16} style={{ width: '100%' }}>
                                    <Col xs={24} sm={12}>
                                      <div style={{
                                        padding: 12,
                                        border: '1px solid #e8e8e8',
                                        borderRadius: 6,
                                        backgroundColor: '#fafafa'
                                      }}>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <FileTextOutlined style={{ color: '#1890ff', fontSize: 18 }} />
                                            <span style={{ fontWeight: 600 }}>Contents</span>
                                          </div>
                                          <Text type="secondary" style={{ marginLeft: 26 }}>Read & Write</Text>
                                        </Space>
                                      </div>
                                    </Col>
                                    <Col xs={24} sm={12}>
                                      <div style={{
                                        padding: 12,
                                        border: '1px solid #e8e8e8',
                                        borderRadius: 6,
                                        backgroundColor: '#fafafa'
                                      }}>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <BranchesOutlined style={{ color: '#52c41a', fontSize: 18 }} />
                                            <span style={{ fontWeight: 600 }}>Pull Requests</span>
                                          </div>
                                          <Text type="secondary" style={{ marginLeft: 26 }}>Read & Write</Text>
                                        </Space>
                                      </div>
                                    </Col>
                                  </Row>
                                  <Row gutter={16} style={{ width: '100%' }}>
                                    <Col xs={24} sm={12}>
                                      <div style={{
                                        padding: 12,
                                        border: '1px solid #e8e8e8',
                                        borderRadius: 6,
                                        backgroundColor: '#fafafa'
                                      }}>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <ThunderboltOutlined style={{ color: '#faad14', fontSize: 18 }} />
                                            <span style={{ fontWeight: 600 }}>Actions</span>
                                          </div>
                                          <Text type="secondary" style={{ marginLeft: 26 }}>Read & Write</Text>
                                        </Space>
                                      </div>
                                    </Col>
                                    <Col xs={24} sm={12}>
                                      <div style={{
                                        padding: 12,
                                        border: '1px solid #e8e8e8',
                                        borderRadius: 6,
                                        backgroundColor: '#fafafa'
                                      }}>
                                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <CodeOutlined style={{ color: '#f5222d', fontSize: 18 }} />
                                            <span style={{ fontWeight: 600 }}>Workflows</span>
                                          </div>
                                          <Text type="secondary" style={{ marginLeft: 26 }}>Read & Write</Text>
                                        </Space>
                                      </div>
                                    </Col>
                                  </Row>
                                  <div style={{
                                    padding: 12,
                                    border: '1px solid #d4d4d4',
                                    borderRadius: 6,
                                    backgroundColor: '#f0f2f5'
                                  }}>
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <AuditOutlined style={{ color: '#9254de', fontSize: 18 }} />
                                        <span style={{ fontWeight: 600 }}>Metadata</span>
                                      </div>
                                      <Text type="secondary" style={{ marginLeft: 26 }}>Read only (automatic)</Text>
                                    </Space>
                                  </div>
                                  <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                                    Under <strong>"Repository access"</strong>, select <strong>"All repositories"</strong>
                                  </Text>
                                </Space>
                              ),
                              status: 'process',
                            },
                            {
                              title: (
                                <Space>
                                  <span style={{ fontSize: 16, fontWeight: 600 }}>Step 5: Copy & Paste Token</span>
                                </Space>
                              ),
                              description: (
                                <Space direction="vertical" size={8} style={{ marginTop: 8 }}>
                                  <Alert
                                    message="⚠️ Important: This is your only chance to copy the token!"
                                    description="Once you leave the page, you won't be able to see it again. Copy it immediately."
                                    type="warning"
                                    showIcon
                                  />
                                  <Text>Paste the token in the field below and click <strong>"Save PAT to Session"</strong></Text>
                                </Space>
                              ),
                              status: 'process',
                            },
                          ]}
                        />
                      </Space>
                    ),
                  },
                ]}
              />

              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Paste your PAT token below:</Text>
                <Input.Password
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={patToken}
                  onChange={(e) => setPatToken(e.target.value)}
                  size="large"
                  prefix={<KeyOutlined />}
                />
                <Button
                  type="primary"
                  icon={<KeyOutlined />}
                  onClick={handleSavePat}
                  loading={isSavingPat}
                  block
                  size="large"
                >
                  Save PAT to Session
                </Button>
              </Space>
            </Space>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Alert
                message="PAT Token Stored"
                description="Your PAT is stored in this session. You can now fetch repositories."
                type="success"
                showIcon
              />
              <Button
                icon={<DeleteOutlined />}
                onClick={handleClearPat}
                danger
              >
                Clear PAT from Session
              </Button>
            </Space>
          )}
        </Card>

        <Title level={5} style={{ margin: 0 }}>
          Open GitHub
        </Title>
        <Text type="secondary">Click the button below to open GitHub in a new tab.</Text>
        <Space>
          <Button type="primary" icon={<GithubOutlined />} onClick={openGithub}>
            Go to GitHub
          </Button>
          <Button type="primary" icon={<GithubOutlined />} onClick={handleFetchRepos} loading={isFetching}>
            Fetch Repo
          </Button>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            {GITHUB_URL}
          </a>
        </Space>

        <Card type="inner" title={`Repositories (${repos.length})`}>
          {repos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text strong>Repository Names:</Text>
              <Divider style={{ margin: '8px 0' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: 16 }}>
                {repos.map((repo, idx) => (
                  <Tag key={idx} color="blue">{repo.name}</Tag>
                ))}
              </div>
            </div>
          )}

          <List
            dataSource={repos}
            locale={{ emptyText: 'No repositories fetched yet.' }}
            renderItem={(repo) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<GithubOutlined />}
                  title={
                    <a href={repo.html_url} target="_blank" rel="noreferrer">
                      {repo.full_name}
                    </a>
                  }
                  description={
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary">{repo.description || 'No description'}</Text>
                      <Space size="large">
                        {repo.language && (
                          <span>
                            <CodeOutlined /> {repo.language}
                          </span>
                        )}
                        {repo.stargazers_count > 0 && (
                          <span>
                            <StarOutlined /> {repo.stargazers_count}
                          </span>
                        )}
                      </Space>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Space>
    </Card>
  )
}

export default GithubAccessPage
