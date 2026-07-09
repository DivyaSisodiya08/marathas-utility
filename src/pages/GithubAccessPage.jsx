import { useEffect, useState } from 'react'
import { Button, Card, List, Space, Typography, message, Tag, Divider } from 'antd'
import { GithubOutlined, StarOutlined, CodeOutlined } from '@ant-design/icons'
import { fetchGithubRepos } from '../services/githubService'

const { Text, Title } = Typography

const GITHUB_URL = 'https://github.com/'

function GithubAccessPage() {
  const [repos, setRepos] = useState([])
  const [isFetching, setIsFetching] = useState(false)

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

  useEffect(() => {
    const loadCachedRepos = async () => {
      try {
        const data = await fetchGithubRepos(false)
        setRepos(data)
      } catch {
        // Keep page usable even when cached/live fetch is unavailable.
      }
    }

    loadCachedRepos()
  }, [])

  return (
    <Card title="GitHub Access">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Title level={5} style={{ margin: 0 }}>
          Open GitHub
        </Title>
        <Text type="secondary">Click the button below to open GitHub in a new tab.</Text>
        <Space>
          <Button type="primary" icon={<GithubOutlined />} onClick={openGithub}>
            Go to GitHub
          </Button>
          <Button type="primary" icon={<GithubOutlined />} onClick={handleFetchRepos} loading={isFetching}>
            Fetch Repositories
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
