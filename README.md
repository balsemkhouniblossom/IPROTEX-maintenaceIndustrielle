# GMAO System - Iprotex Maintenance Management

A comprehensive full-stack web application for Gestion de Maintenance Assistée par Ordinateur (Computer-Aided Maintenance Management) designed specifically for Iprotex, an industrial textiles manufacturing company.

## Features

### Core Functionality

- **User Management**: Complete CRUD operations for system users with role-based access
- **Machine Management**: Track and manage industrial machinery with detailed specifications
- **Work Order Management**: Create, assign, and track maintenance work orders
- **Parts Catalogue**: Manage spare parts inventory with stock levels and suppliers
- **Machine Types**: Categorize equipment by type and specifications
- **Habilitations**: Manage user certifications and qualifications
- **Module Types**: Handle modular equipment components

### Dashboard Features

- Real-time statistics and KPIs
- Work order status tracking
- System health monitoring
- Quick action shortcuts
- Responsive design with custom UI colors

## Technology Stack

### Frontend

- **Next.js 16.2.4**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **Axios**: HTTP client for API communication
- **Lucide React**: Modern icon library
- **Recharts**: Data visualization (future implementation)
- **Headless UI**: Accessible UI components

### Backend

- **NestJS 11.x**: Node.js framework for scalable server-side applications
- **MongoDB 8.0**: NoSQL database for flexible data storage
- **Mongoose**: MongoDB object modeling
- **TypeScript**: Type-safe backend development

### Development Tools

- **Node.js 25.9.0**: JavaScript runtime
- **npm**: Package management
- **ESLint**: Code linting
- **Prettier**: Code formatting

## Color Scheme

The application uses a custom color palette specifically designed for Iprotex:

- Primary: `#0068b4` (Deep blue)
- Secondary: `#d1dee8` (Light blue-gray)
- Accent: `#575756` (Dark gray)
- Light Blue: `#6da8d4` (Medium blue)
- Medium Gray: `#a2a2a1` (Gray)
- Bright Blue: `#3687c4` (Bright blue)

## Project Structure

```
GMAO/
├── backend/
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   │   ├── users/           # User management module
│   │   ├── machines/        # Machine management module
│   │   ├── work-orders/     # Work order management module
│   │   ├── catalogues/      # Parts catalogue module
│   │   ├── machine-types/   # Machine types module
│   │   ├── habilitations/   # User habilitations module
│   │   ├── module-types/    # Module types module
│   │   └── schemas/         # Mongoose schemas
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx      # Main dashboard
│   │   │   ├── users/        # Users management page
│   │   │   ├── machines/     # Machines management page
│   │   │   ├── work-orders/  # Work orders page
│   │   │   └── catalogues/   # Parts catalogue page
│   │   ├── components/       # Reusable UI components
│   │   └── services/         # API service layer
│   ├── package.json
│   └── tailwind.config.ts
└── README.md
```

## Prerequisites

Before running this application, make sure you have the following installed:

1. **Node.js** (version 25.9.0 or higher)
2. **MongoDB** (version 8.0 or higher)
3. **npm** (comes with Node.js)

## Installation & Setup

### 1. Clone and Setup Project Structure

```bash
# Create project directory
mkdir GMAO
cd GMAO

# This README assumes the project is already set up
# If starting fresh, follow the workspace creation steps below
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Start MongoDB service (if not running)
# On Windows: Start MongoDB service from Services panel
# Or run: mongod --dbpath "C:\data\db"

# Start development server
npm run start:dev
```

The backend will start on `http://localhost:3001`

### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will start on `http://localhost:3000` (or next available port)

## Database Configuration

### MongoDB Setup

1. **Install MongoDB**: Download and install MongoDB 8.0 from the official website
2. **Start MongoDB Service**: Ensure MongoDB is running on the default port (27017)
3. **Database Name**: The application uses `GMAO_IPROTEX` as the database name

### Connection String

The backend automatically connects to `mongodb://localhost:27017/GMAO_IPROTEX`

## API Endpoints

### Users

- `GET /users` - Get all users
- `POST /users` - Create new user
- `GET /users/:id` - Get user by ID
- `PATCH /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Machines

- `GET /machines` - Get all machines
- `POST /machines` - Create new machine
- `GET /machines/:id` - Get machine by ID
- `PATCH /machines/:id` - Update machine
- `DELETE /machines/:id` - Delete machine

### Work Orders

- `GET /work-orders` - Get all work orders
- `POST /work-orders` - Create new work order
- `GET /work-orders/:id` - Get work order by ID
- `PATCH /work-orders/:id` - Update work order
- `DELETE /work-orders/:id` - Delete work order

### Additional Endpoints

- `/machine-types` - Machine type management
- `/catalogues` - Parts catalogue management
- `/habilitations` - User habilitations management
- `/module-types` - Module type management

## Development Workflow

### Adding New Features

1. **Backend**: Create new module in `backend/src/`
   - Create schema in `schemas/`
   - Create controller, service, and module files
   - Update `app.module.ts`

2. **Frontend**: Create new page in `frontend/src/app/`
   - Use existing components from `components/`
   - Add API calls in `services/api.ts`
   - Update navigation in `DashboardLayout.tsx`

### Code Style

- Use TypeScript for type safety
- Follow ESLint configuration
- Use Tailwind CSS classes for styling
- Maintain consistent component structure

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact local, Render backend, and Vercel frontend environment examples.

### Production Build

```bash
# Backend
cd backend
npm run build
npm run start:prod

# Frontend
cd frontend
npm run build
npm start
```

### Environment Variables

Create `.env` files for both backend and frontend with appropriate configuration:

```bash
# backend/.env
MONGODB_URI=mongodb://localhost:27017/GMAO_IPROTEX
PORT=3001

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Troubleshooting

### Common Issues

1. **Port already in use**: Change ports in configuration or kill existing processes
2. **MongoDB connection failed**: Ensure MongoDB service is running
3. **Build errors**: Check Node.js version compatibility
4. **API calls failing**: Verify backend is running and accessible

### Debug Mode

Run with debug flags:

```bash
# Backend
npm run start:debug

# Frontend
npm run dev -- --inspect
```

## Contributing

1. Follow the established code structure
2. Use TypeScript for all new code
3. Test API endpoints thoroughly
4. Maintain consistent UI/UX with existing design
5. Update documentation for new features

## License

This project is proprietary software developed for Iprotex.

## Support

For technical support or questions about the GMAO system, please contact the development team.
