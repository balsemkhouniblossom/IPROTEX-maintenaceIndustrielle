# IPROTEX Maintenance Industrielle - GMAO

A full-stack GMAO/CMMS application for industrial maintenance management at IPROTEX. The system helps administrators, operators, and technicians manage machines, preventive maintenance, corrective work orders, spare parts, documents, reports, live monitoring, notifications, and maintenance analytics.

GMAO means "Gestion de Maintenance Assistee par Ordinateur", also known as Computerized Maintenance Management System (CMMS).

## Table Of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Testing And Quality](#testing-and-quality)
- [Deployment](#deployment)
- [Security Notes](#security-notes)
- [Contributing](#contributing)
- [License](#license)

## Overview

This repository contains three applications:

- `backend`: NestJS API with MongoDB, authentication, role-based authorization, reports, schedulers, device monitoring, storage, and business services.
- `frontend`: Next.js application with role dashboards, localized UI, protected routes, maintenance workflows, and API integration.
- `ai-service`: FastAPI service that serves a validated IMS bearing anomaly-detection model (data audit, feature engineering, and inference notebooks/pipeline included). The backend's `ai-anomaly` module calls this service over HTTP when `AI_SERVICE_ENABLED=true`.

The application is designed around three main roles:

- `admin`: manages users, machines, catalogues, maintenance plans, documents, reports, and system settings.
- `operator`: executes preventive and corrective maintenance workflows and submits reports.
- `technician`: handles assigned work orders, interventions, parts usage, and technical follow-up.

## Features

### Maintenance Operations

- Machine and module management
- Machine types and module types
- Preventive maintenance plans
- Preventive task checklists
- Corrective maintenance reports
- Work order lifecycle management
- Technician assignment and validation workflows
- Machine timeline and maintenance history

### Inventory And Documents

- Spare parts catalogue
- Stock management and movement history
- Parts requests and consumption tracking
- Lubrication logs
- Document upload, validation, previews, lifecycle states, and versioning
- Machine manuals and attached technical documents

### Users And Access

- Local authentication
- Google authentication and profile completion
- JWT access and refresh token flow
- Role-based access control
- User approval workflow
- Pending, approved, and rejected account states
- Protected frontend routes

### Monitoring, Reporting, And Intelligence

- Role-scoped dashboards and KPIs
- Notification center
- Live device monitoring through WebSockets and MQTT ingestion
- Predictive maintenance services
- Scheduled reports
- PDF, Excel, and CSV report rendering
- Optional Gemini-powered AI assistant
- IMS bearing anomaly detection served by the standalone `ai-service` FastAPI app, integrated through the backend's `ai-anomaly` module
- Predictive maintenance health scoring and history
- SonarCloud quality and coverage configuration
- Playwright browser tests enforced in CI
- Prometheus/Grafana production monitoring configuration under `monitoring/`

### Frontend Experience

- Next.js App Router
- TypeScript-first UI
- Internationalized routes and messages
- Responsive dashboard layouts
- Accessible modal, pagination, table, and form patterns
- Dark-mode aware operator pages

## Tech Stack

### Backend

- NestJS 11
- TypeScript
- MongoDB with Mongoose
- Passport, JWT, Google OAuth
- Socket.IO
- MQTT
- Nodemailer
- Supabase storage support
- Sentry support
- Jest
- ESLint and Prettier

### Frontend

- Next.js 16
- React 18
- TypeScript
- Tailwind CSS
- Axios
- next-intl
- Lucide React
- Headless UI
- Recharts
- React PDF / PDF.js
- Node test runner with coverage
- ESLint

### AI Service

- Python 3.12
- FastAPI
- scikit-learn, pandas, numpy, scipy, joblib
- Jupyter notebooks for data audit, feature engineering, and anomaly-detection validation
- pytest

## Repository Structure

```text
GMAO/
|-- backend/
|   |-- src/
|   |   |-- ai-anomaly/
|   |   |-- ai-assistant/
|   |   |-- auth/
|   |   |-- catalogues/
|   |   |-- common/
|   |   |-- config/
|   |   |-- device-monitoring/
|   |   |-- documents/
|   |   |-- knowledge-base/
|   |   |-- machine-timeline/
|   |   |-- machines/
|   |   |-- maintenance-plans/
|   |   |-- notifications/
|   |   |-- operator/
|   |   |-- predictive-maintenance/
|   |   |-- reports/
|   |   |-- scheduler/
|   |   |-- stocks/
|   |   |-- technician/
|   |   |-- users/
|   |   `-- work-orders/
|   |-- test/
|   |-- package.json
|   `-- tsconfig.json
|-- frontend/
|   |-- messages/
|   |-- public/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- config/
|   |   |-- contexts/
|   |   |-- hooks/
|   |   `-- services/
|   |-- tests/
|   |-- package.json
|   `-- next.config.mjs
|-- ai-service/
|   |-- app/
|   |   |-- api/routes/
|   |   |-- core/
|   |   |-- schemas/
|   |   `-- services/
|   |-- src/
|   |   |-- preprocessing/
|   |   |-- features/
|   |   |-- models/
|   |   `-- evaluation/
|   |-- notebooks/
|   |-- data/
|   |-- artifacts/
|   |-- tests/
|   `-- requirements.txt
|-- scripts/
|-- sonar-project.properties
|-- render.yaml
|-- DEPLOYMENT.md
|-- DEPLOYMENT_GUIDE.md
`-- README.md
```

## Requirements

- Node.js 20 or newer
- npm
- MongoDB 8 or a MongoDB Atlas database
- Git
- Python 3.12 or newer (only required to run the optional `ai-service`)

Optional integrations:

- Google OAuth credentials
- Gemini API key
- Sentry DSN
- Supabase project and bucket
- SMTP credentials
- MQTT broker
- SonarCloud project token
- Standalone `ai-service` for IMS anomaly-detection inference

## Quick Start

Clone the repository:

```bash
git clone https://github.com/balsemkhouniblossom/IPROTEX-maintenaceIndustrielle.git
cd IPROTEX-maintenaceIndustrielle
```

Install dependencies:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Create environment files:

```bash
cd ../backend
cp .env.example .env

cd ../frontend
cp .env.example .env.local
```

If `backend/.env.example` is not present in your checkout, create `backend/.env` using the backend variables listed below.

Start MongoDB locally or configure `MONGODB_URI` for MongoDB Atlas.

Run the backend:

```bash
cd backend
npm run start:dev
```

Run the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Optionally run the AI service in a third terminal (only needed if `AI_SERVICE_ENABLED=true` in the backend):

```bash
cd ai-service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8011
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- AI service: `http://localhost:8011`

## Environment Variables

Do not commit real secrets. Use local `.env` files and platform secret managers for production.

### Backend Environment

Required for normal development:

```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/GMAO_IPROTEX
JWT_SECRET=replace-with-a-long-random-secret
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
JWT_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=7d
APP_URL=http://localhost:3000
BACKEND_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000
FILE_STORAGE_DRIVER=local
```

Common optional backend variables:

```env
DEFAULT_LOCALE=en
BUSINESS_TIMEZONE=Africa/Tunis
EMAIL_VERIFICATION_SECRET=replace-with-email-token-secret
ENABLE_EVENT_BASED_EMAILS=false
ENABLE_LEGACY_EMAIL_TOKENS=false
ENABLE_LEGACY_RESET_TOKENS=false

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY=

AI_ASSISTANT_ENABLED=false
AI_ASSISTANT_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
AI_ASSISTANT_TIMEOUT_MS=30000
AI_ASSISTANT_RATE_LIMIT_PER_HOUR=20

PREDICTIVE_MAINTENANCE_ENABLED=true
PREDICTION_HISTORY_RETENTION_SECONDS=2592000

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=

SENTRY_DSN=
LOG_FORMAT=pretty
REQUEST_TIMEOUT_MS=30000
TRUST_PROXY=false

AI_SERVICE_ENABLED=false
AI_SERVICE_URL=http://127.0.0.1:8011
AI_SERVICE_TIMEOUT_MS=12000
```

### AI Service Environment

```env
AI_SERVICE_ENV=development
IMS_ANOMALY_ARTIFACT_PATH=
IMS_ANOMALY_METADATA_PATH=
AI_SERVICE_CORS_ORIGINS=http://localhost:3000
AI_SERVICE_MAX_REQUEST_BYTES=1048576
AI_SERVICE_MAX_BATCH_ROWS=512
```

### Frontend Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0
```

In production, `NEXT_PUBLIC_API_BASE_URL` must point to the HTTPS backend URL.

## Available Scripts

### Backend Scripts

Run from `backend/`.

```bash
npm run start:dev       # Start NestJS in watch mode
npm run build           # Compile production build
npm run start:prod      # Run compiled backend from dist/
npm run lint            # Run ESLint
npm run lint:fix        # Run ESLint with fixes
npm run test            # Run Jest tests
npm run test:cov        # Run Jest coverage and prefix LCOV paths for Sonar
npm run test:e2e        # Run e2e tests
```

Useful maintenance scripts:

```bash
npm run mongodb:indexes:check
npm run mongodb:indexes:apply
npm run preventive-occurrences:audit
npm run audit:preventive-scheduling
npm run smoke-test
```

### Frontend Scripts

Run from `frontend/`.

```bash
npm run dev             # Start Next.js dev server
npm run build           # Build production frontend
npm run start           # Start production frontend
npm run lint            # Run ESLint
npm run type-check      # Run TypeScript type check
npm run test            # Run frontend tests
npm run test:cov        # Run frontend tests with coverage and LCOV output
npm run test:e2e        # Run Playwright browser tests
```

### AI Service Scripts

Run from `ai-service/` with the local `.venv` activated.

```bash
uvicorn app.main:app --reload --port 8011   # Start the FastAPI dev server
pytest                                       # Run AI service tests
jupyter notebook                             # Explore data-audit and training notebooks
```

## Testing And Quality

Recommended checks before opening or merging a pull request:

```bash
cd backend
npm run lint
npm run test:cov

cd ../frontend
npm run lint
npm run type-check
npm run test:cov
```

Quality tooling:

- Backend coverage: Jest
- Frontend coverage: Node test runner
- Static analysis: ESLint and TypeScript
- SonarCloud: configured by `sonar-project.properties`
- SonarCloud quality gate: CI waits for it before the workflow can pass.
- LCOV reports:
  - `backend/coverage/lcov.info`
  - `frontend/coverage/lcov.info`

The SonarCloud configuration imports both LCOV reports and applies coverage exclusions for bootstrap files, UI shells, DTOs, schemas, controllers, modules, and integration boundary files. Those files are still analyzed for issues; they are just excluded from the coverage denominator.

## Deployment

Deployment documentation is available in:

- [DEPLOYMENT.md](DEPLOYMENT.md)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- [DEPLOYMENT_REPORT.md](DEPLOYMENT_REPORT.md)

The repository includes:

- `render.yaml` for backend deployment on Render
- `frontend/vercel.json` for frontend deployment on Vercel
- `monitoring/` for Render-deployed Prometheus/Grafana config

Typical production build commands:

```bash
cd backend
npm install
npm run build
npm run start:prod
```

```bash
cd frontend
npm install
npm run build
npm run start
```

## Security Notes

- Never expose `GEMINI_API_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, SMTP credentials, or Supabase service-role keys to the frontend.
- Frontend variables must use the `NEXT_PUBLIC_` prefix only when they are safe for browsers.
- Production API URLs must use HTTPS.
- Keep `CORS_ORIGINS` restricted to trusted frontend origins in production.
- Use strong, unique secrets for JWT access tokens, refresh tokens, email verification, and OAuth exchange encryption.
- Use platform secret managers for Render, Vercel, GitHub Actions, and SonarCloud.

## Contributing

1. Create a feature branch.
2. Keep changes scoped and typed.
3. Add or update tests for business logic.
4. Run backend and frontend quality checks.
5. Update documentation when behavior, setup, or deployment changes.
6. Open a pull request with a clear summary and test results.

## License

This project is proprietary software developed for IPROTEX.

## Support

For technical support, deployment help, or functional questions, contact the project maintainers.
