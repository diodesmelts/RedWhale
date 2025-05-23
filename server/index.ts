import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import adminRouter from "./admin-routes";
import cors from "cors";
import path from "path";

// Simple CORS configuration for a unified web service architecture
const corsOptions = {
  // For a single service architecture, we can be more permissive with CORS
  // Since API requests come from the same origin as the frontend
  origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Simple logging for CORS requests
    console.log(`🔄 CORS request from origin: ${origin || 'same-origin'}`);
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }
    
    // In production, add explicit allowed origins if needed
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : [];
      
    // Always include standard domains
    allowedOrigins.push(
      // Production domains
      'https://bluewhalecompetitions.co.uk',
      'https://www.bluewhalecompetitions.co.uk',
      'https://mobycomps.co.uk',
      'https://www.mobycomps.co.uk',
      'http://mobycomps.co.uk',   // Allow HTTP during transition
      'http://www.mobycomps.co.uk', // Allow HTTP during transition
      // Render domains (for testing/development)
      'https://blue-whale-competitions.onrender.com',
      'https://blue-whale-competitions-api.onrender.com',
      'https://redwhale.onrender.com'
    );
    
    // Log the allowed origins for debugging
    console.log('🔒 Allowed origins:', allowedOrigins);
    
    // If no origin header (same-origin request) or it's in our allowed list
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS not allowed for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};

const app = express();

// Apply CORS with our enhanced configuration
app.use(cors(corsOptions));

// Special preflighted requests handler for cross-domain requests with cookies
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Set up authentication
  console.log('🔐 Setting up authentication...');
  setupAuth(app);
  
  // Register admin routes
  console.log('🛡️ Registering admin routes...');
  app.use('/api/admin', adminRouter);
  
  // Serve uploads directory as static files before registering routes
  const uploadsPath = path.join(process.cwd(), 'uploads');
  console.log('📁 Serving uploads directory from:', uploadsPath);
  app.use('/uploads', express.static(uploadsPath));
  
  // Then register all other routes
  console.log('🌐 Registering API routes...');
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Use port from environment or fallback to 5000
  // Render sets PORT environment variable for us
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
