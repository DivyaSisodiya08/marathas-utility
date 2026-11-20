import { Card } from 'antd'
import { RightOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { utilityMenuItems } from '../components/AppSidebar'

const moduleDescriptions = {
    '/pr-create': 'Prepare a pull request for your repository changes.',
    '/snapshot-upgrade': 'Review and upgrade snapshot dependencies.',
    '/build-status': 'Check the status of image builds.',
    '/spring-boot-upgrade': 'Review Spring Boot upgrade options.',
    '/find-dependency': 'Search for dependencies in your repositories.',
    '/repo-tree': 'Explore repository dependency relationships.',
    '/release-cut': 'Prepare a release cut for a project.',
    '/jenkins-deploy': 'Run and review Jenkins deployments.',
    '/github-access': 'Manage GitHub access for your account.',
}

function HomePage() {
    const modules = utilityMenuItems.filter(({ key }) => key !== '/')

    return (
        <main className="home-page">
            <header className="home-intro">
                <div>
                    <h1>Engineering utilities</h1>
                    <p>Repository, build, and release tools</p>
                </div>
                <span className="home-count">{modules.length} modules</span>
            </header>

            <nav className="home-module-grid" aria-label="Utility modules">
                {modules.map(({ key, icon, label }) => (
                    <Link className="home-module-link" key={key} to={key}>
                        <Card className="home-module-card" hoverable>
                            <div className="home-module-heading">
                                <span className="home-module-icon" aria-hidden="true">{icon}</span>
                                <span>{label}</span>
                            </div>
                            <p className="home-module-description">{moduleDescriptions[key]}</p>
                            <span className="home-module-open" aria-hidden="true">
                                <RightOutlined />
                            </span>
                        </Card>
                    </Link>
                ))}
            </nav>
        </main>
    )
}

export default HomePage