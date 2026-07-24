# Deployment Environment

This project uses Render for the NestJS backend and Vercel for the Next.js frontend.

## Local Development

Backend local `.env` example:

```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/GMAO_IPROTEX
JWT_SECRET=replace-with-strong-random-secret
JWT_REFRESH_SECRET=replace-with-strong-random-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
EMAIL_VERIFICATION_SECRET=replace-with-strong-random-email-verification-secret
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback
BACKEND_URL=http://localhost:3001
FRONTEND_BASE_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
FILE_STORAGE_DRIVER=local
```

Frontend local `frontend/.env.local` example:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

## Production Backend: Render

Configure these as Render backend environment variables or secrets:

```env
NODE_ENV=production
PORT=3001
MONGODB_URI=<mongodb-atlas-uri>
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-refresh-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
EMAIL_VERIFICATION_SECRET=<strong-email-verification-secret>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://your-backend.onrender.com/auth/google/callback
BACKEND_URL=https://your-backend.onrender.com
FRONTEND_BASE_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app
FILE_STORAGE_DRIVER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=<supabase-service-role-secret>
SUPABASE_STORAGE_BUCKET=uploads
SUPABASE_STORAGE_BUCKET_PUBLIC=false
SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS=604800
```

Production startup requires `FILE_STORAGE_DRIVER=supabase` plus `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET`. If any are missing or the driver is not `supabase`, the backend exits during startup validation.

## Production Frontend: Vercel

Configure only public frontend variables in Vercel:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com
```

Do not configure `SUPABASE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, or `FILE_STORAGE_DRIVER` in Vercel. Supabase Storage is accessed only by the NestJS backend.
