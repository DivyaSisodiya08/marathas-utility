import { Button, Layout, Space, Typography } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import AppSidebar from '../components/AppSidebar'

const { Header, Sider, Content, Footer } = Layout
const { Title } = Typography

const pageTitles = {
  '/pr-create': 'Create Pull Request',
  '/repo-tree': 'Repo Dependency Tree',
  '/spring-boot-upgrade': 'Spring Boot Upgrade',
  '/snapshot-upgrade': 'Snapshot Upgrade',
  '/release-cut': 'Release Cut',
  '/jenkins-deploy': 'Jenkins Deploy',
  '/github-access': 'GitHub Access',
  '/build-status': 'Build Image Status',
}

function DashboardLayout({ onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const pageTitle = pageTitles[location.pathname] || 'Marathas Utility'

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth={70}>
        <AppSidebar selectedKey={location.pathname} onNavigate={navigate} />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Title level={4} style={{ margin: 0 }}>
              {pageTitle}
            </Title>
            <Button icon={<LogoutOutlined />} onClick={onLogout}>
              Logout
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        <Footer className="app-footer">
          Copyright Marathas Team
        </Footer>
      </Layout>
    </Layout>
  )
}

export default DashboardLayout
