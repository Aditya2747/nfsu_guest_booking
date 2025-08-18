import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
// Stripe removed for now

import { initSocket, getIO } from './realtime/socket.js';
// Payments routes removed for now
import Room from './models/Room.js';

// Import routes
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import bookingRoutes from './routes/bookings.js';
import userRoutes from './routes/users.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';

// Load environment variables
dotenv.config({ path: './config.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
// Stripe init removed

// CORS configuration (must be before any other middleware)
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://nfsu-frontend.vercel.app',
  'https://yourdomain.com'
];

// Add custom origins from environment variable
if (process.env.ALLOWED_ORIGINS) {
  const customOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  allowedOrigins.push(...customOrigins);
}

console.log('🌐 Allowed CORS Origins:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Debug middleware to log CORS requests
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    console.log(`🔍 Request from origin: ${origin}, Method: ${req.method}, Path: ${req.path}`);
  }
  next();
});

// Explicitly handle preflight
app.options('*', cors(corsOptions));

// Manual CORS middleware as fallback
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
  }
  
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  
  next();
});

// Security middleware
app.use(helmet());

// Stripe webhook removed

// Body parsing middleware (after Stripe webhook registration)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB successfully');
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'success', 
    message: 'Campus Stay Suite API is running',
    timestamp: new Date().toISOString(),
    corsOrigins: allowedOrigins,
    requestOrigin: req.headers.origin || 'no-origin'
  });
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'CORS test endpoint',
    origin: req.headers.origin,
    allowedOrigins: allowedOrigins,
    headers: req.headers
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', authMiddleware, bookingRoutes);
// Payments routes removed
app.use('/api/users', authMiddleware, userRoutes);

// Serve static files in production only if dist folder exists
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  
  // Check if dist folder exists (for monorepo deployments)
  try {
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      console.log('📁 Serving static files from:', distPath);
    } else {
      console.log('📁 No dist folder found - frontend deployed separately');
    }
  } catch (error) {
    console.log('📁 Static file serving disabled - frontend deployed separately');
  }
}

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

// Create HTTP server and initialize Socket.IO
const server = http.createServer(app);
initSocket(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Periodic cleanup of expired holds
setInterval(async () => {
  const now = new Date();
  try {
    const expiredHeldRooms = await Room.find({ status: 'held', holdUntil: { $lt: now } });
    for (const r of expiredHeldRooms) {
      r.status = 'vacant';
      r.holdBy = null;
      r.holdUntil = null;
      await r.save();
      try { getIO().emit('roomStatusUpdated', { roomId: r._id, status: 'vacant' }); } catch {}
    }
  } catch (e) {
    console.error('Error cleaning up expired holds:', e.message);
  }
}, 60 * 1000);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});
