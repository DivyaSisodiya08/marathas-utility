# Marathas Utility

This workspace now has:

- React + Vite frontend
- Spring Boot backend for GitHub OAuth and repository APIs

## Project structure

- Frontend: [src](src)
- Backend: [backend](backend)

## Backend API added

- `GET /api/github/connect-url`
- `GET /api/github/callback`
- `GET /api/github/status`
- `GET /api/github/repos`

## Environment variables for backend

Set these before starting backend:

**GitHub:**
- `GITHUB_PERSONAL_TOKEN` - Your personal GitHub token (for repo fetching). Generate at https://github.com/settings/tokens

**GitHub OAuth (optional, for OAuth flow only):**
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI` (default: `http://localhost:8080/api/github/callback`)
- `FRONTEND_SUCCESS_URL` (default: `http://localhost:5174/?github=connected`)

**LDAP/Auth variables:**
- `LDAP_AUTH_MODE` (`dummy`, `ldap`, or `external`)
- `AUTH_MODE` (legacy alias for `LDAP_AUTH_MODE`)
- `DUMMY_ID`
- `DUMMY_PASSWORD`
- `LDAP_URL`
- `LDAP_BASE_DN`
- `LDAP_USER_SEARCH_BASE` (optional, for example: `ou=people`)
- `LDAP_USER_SEARCH_FILTER` (RDN pattern, for example: `uid={0}` or `cn={0}`)
- `LDAP_EXTERNAL_URL` (example: `https://dev.r53.stratas.net/cm/login`)
- `LDAP_EXTERNAL_SUBMIT_VALUE` (default: `Login`)

## Run backend

From [backend](backend):

- `mvn spring-boot:run`

## VS Code token setup (recommended)

This workspace is configured to read backend environment variables from [ .vscode/backend.env ](.vscode/backend.env) when launching from VS Code.

1. Open [ .vscode/backend.env ](.vscode/backend.env)
2. Set:
	- `GITHUB_PERSONAL_TOKEN=your_token_here`
3. Run the VS Code debug configuration: `Backend (Spring Boot)`

The backend already reads `GITHUB_PERSONAL_TOKEN` via `application.yml` (`github.oauth.personal-token: ${GITHUB_PERSONAL_TOKEN:}`).

## Run frontend

From root:

- `npm install`
- `npm run dev`

Frontend dev server proxies `/api/*` to backend at `http://localhost:8080`.
