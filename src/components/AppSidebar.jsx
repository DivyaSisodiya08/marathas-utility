import { Menu } from 'antd'
import {
  PullRequestOutlined,
  ApartmentOutlined,
  CalculatorOutlined,
  GithubOutlined,
  DeploymentUnitOutlined,
  SwapOutlined,
  RocketOutlined,
  CloudServerOutlined,
  SearchOutlined,
} from '@ant-design/icons'

const utilityMenuItems = [
  {
    key: '/pr-create',
    icon: <PullRequestOutlined />,
    label: 'Create PR',
  },
  {
    key: '/snapshot-upgrade',
    icon: <SwapOutlined />,
    label: 'Snapshot Upgrade',
  },
  {
    key: '/build-status',
    icon: <DeploymentUnitOutlined />,
    label: 'Build Status',
  },
  {
    key: '/spring-boot-upgrade',
    icon: <CalculatorOutlined />,
    label: 'Spring Boot Upgrade',
  },
  {
    key: '/find-dependency',
    icon: <SearchOutlined />,
    label: 'Find dependency',
  },
  {
    key: '/repo-tree',
    icon: <ApartmentOutlined />,
    label: 'Repo Dependency Tree',
  },
  {
    key: '/release-cut',
    icon: <RocketOutlined />,
    label: 'Release Cut',
  },
  {
    key: '/jenkins-deploy',
    icon: <CloudServerOutlined />,
    label: 'Jenkins Deploy',
  },
  {
    key: '/github-access',
    icon: <GithubOutlined />,
    label: 'GitHub Access',
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
