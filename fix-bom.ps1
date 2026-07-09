$servicePath = 'c:\marathas-utility\backend\src\main\java\com\marathas\utility\backend\service\GithubOAuthService.java'
$controllerPath = 'c:\marathas-utility\backend\src\main\java\com\marathas\utility\backend\controller\GithubController.java'

foreach ($path in @($servicePath, $controllerPath)) {
  if (Test-Path $path) {
    $content = [System.IO.File]::ReadAllText($path)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = $utf8NoBom.GetBytes($content)
    [System.IO.File]::WriteAllBytes($path, $bytes)
    Write-Host "Fixed $path"
  }
}
