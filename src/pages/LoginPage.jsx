import { Button, Card, Form, Input, Space, Typography } from 'antd'
import { LoginOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

function LoginPage({ onLogin }) {
  return (
    <div className="login-wrapper">
      <Card className="login-card" variant="borderless">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Title level={3}>Welcome to Marathas Utility</Title>
          <Text type="secondary">Login with your user ID and password.</Text>
          <Form layout="vertical" onFinish={onLogin} requiredMark={false}>
            <Form.Item
              label="User ID"
              name="username"
              rules={[{ required: true, message: 'Please enter user ID' }]}
            >
              <Input placeholder="Enter user ID" prefix={<LoginOutlined />} />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, message: 'Please enter password' }]}
            >
              <Input.Password placeholder="Enter password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              Login
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  )
}

export default LoginPage
