import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardLayout from '../layout/DashboardLayout'
import RepoTreePage from '../pages/RepoTreePage'
import SpringBootUpgradePage from '../pages/SpringBootUpgradePage'
import SnapshotUpgradePage from '../pages/SnapshotUpgradePage'
import GithubAccessPage from '../pages/GithubAccessPage'
import BuildStatusPage from '../pages/BuildStatusPage'
import ReleaseCutPage from '../pages/ReleaseCutPage'
import CreatePullRequestPage from '../pages/CreatePullRequestPage'

function AppRouter({ onLogout }) {
  return (
    <Routes>
      <Route element={<DashboardLayout onLogout={onLogout} />}>
        <Route path="/pr-create" element={<CreatePullRequestPage />} />
        <Route path="/repo-tree" element={<RepoTreePage />} />
        <Route path="/spring-boot-upgrade" element={<SpringBootUpgradePage />} />
        <Route path="/snapshot-upgrade" element={<SnapshotUpgradePage />} />
        <Route path="/release-cut" element={<ReleaseCutPage />} />
        <Route path="/github-access" element={<GithubAccessPage />} />
        <Route path="/build-status" element={<BuildStatusPage />} />
        <Route path="*" element={<Navigate to="/pr-create" replace />} />
      </Route>
    </Routes>
  )
}

export default AppRouter
