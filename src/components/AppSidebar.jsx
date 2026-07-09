import { Menu } from 'antd'
import {
  PullRequestOutlined,
  ApartmentOutlined,
  CalculatorOutlined,
  GithubOutlined,
  DeploymentUnitOutlined,
  SwapOutlined,
  RocketOutlined,
} from '@ant-design/icons'

const utilityMenuItems = [
  {
    key: '/pr-create',
    icon: <PullRequestOutlined />,
    label: 'Create PR',
  },
  {
    key: '/spring-boot-upgrade',
    icon: <CalculatorOutlined />,
    label: 'Spring Boot Upgrade',
  },
  {
    key: '/repo-tree',
    icon: <ApartmentOutlined />,
    label: 'Repo Dependency Tree',
  },
  {
    key: '/snapshot-upgrade',
    icon: <SwapOutlined />,
    label: 'Snapshot Upgrade',
  },
  {
    key: '/release-cut',
    icon: <RocketOutlined />,
    label: 'Release Cut',
  },
  {
    key: '/github-access',
    icon: <GithubOutlined />,
    label: 'GitHub Access',
  },
  {
    key: '/build-status',
    icon: <DeploymentUnitOutlined />,
    label: 'Build Status',
  },
]

function AppSidebar({ selectedKey, onNavigate }) {
  return (
    <>
      <div className="brand">Marathas Utility</div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={utilityMenuItems}
        onClick={({ key }) => onNavigate(key)}
      />
    </>
  )
}

export default AppSidebar
