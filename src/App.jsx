import { useState } from 'react'
import { message } from 'antd'
import { BrowserRouter } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AppRouter from './router/AppRouter'
import { login as loginRequest, logout as logoutRequest } from './services/authService'
import './App.css'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const handleLogin = async (values) => {
    const ldapId = values?.username?.trim()
    const password = values?.password

    if (!ldapId || !password) {
      message.error('User ID and password are required')
      return
    }

    try {
      await loginRequest(ldapId, password)

      setIsAuthenticated(true)
      message.success('Login successful')
    } catch (error) {
      setIsAuthenticated(false)
      message.error(error.message || 'Login failed')
    }
  }

  const handleLogout = async () => {
    try {
      await logoutRequest()
    } catch {
      // Silent fail
    }

    setIsAuthenticated(false)
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
      <AppRouter onLogout={handleLogout} />
    </BrowserRouter>
  )
}

export default App
