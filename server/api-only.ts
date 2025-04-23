import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { log } from "./vite";

// Create Express application
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Setup CORS for separate frontend deployment
app.use((req, res, next) => {
  console.log("⚡ Processing request:", {
    url: req.url,
    method: req.method,
    origin: req.headers.origin,
    referer: req.headers.referer,
    host: req.headers.host
  });

  // Initialize with default allowed origins
  let allowedOrigins = [
    'https://redwhale.onrender.com', 
    'https://www.bluewhalecompetitions.co.uk',
    'https://bluewhalecompetitions.co.uk',
    'https://blue-whale.onrender.com',
    'http://localhost:5000',
    'http://localhost:3000'
  ];
  
  // Check for ALLOWED_ORIGINS env variable (comma-separated list)
  if (process.env.ALLOWED_ORIGINS) {
    try {
      const configuredOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
      console.log(`🔒 Using configured origins from ALLOWED_ORIGINS: ${configuredOrigins.join(', ')}`);
      
      // Replace default origins with configured ones if valid
      if (configuredOrigins.length > 0) {
        allowedOrigins = configuredOrigins;
      }
    } catch (error) {
      console.error(`❌ Error parsing ALLOWED_ORIGINS: ${error}`);
    }
  }
  
  // Use configured frontend URL if set
  if (process.env.FRONTEND_URL) {
    const frontendUrl = process.env.FRONTEND_URL;
    if (!allowedOrigins.includes(frontendUrl)) {
      allowedOrigins.push(frontendUrl);
      console.log(`Added FRONTEND_URL to allowed origins: ${frontendUrl}`);
    }
  }
  
  const origin = req.headers.origin;
  console.log(`🔒 Request origin: ${origin || 'none'}`);
  console.log(`🔒 Allowed origins: ${allowedOrigins.join(', ')}`);
  
  // In development, allow all origins
  if (process.env.NODE_ENV !== "production") {
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      console.log(`✅ Allowed origin (dev mode): ${origin}`);
    }
  } 
  // In production, check against allowed list
  else if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    console.log(`✅ Allowed origin: ${origin}`);
  } else if (origin) {
    console.log(`❌ Blocked origin: ${origin}`);
  }
  
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") {
    console.log("✅ Responding to OPTIONS request");
    return res.sendStatus(200);
  }
  next();
});

// Logging middleware
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
    let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
    if (capturedJsonResponse) {
      logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
    }

    if (logLine.length > 80) {
      logLine = logLine.slice(0, 79) + "…";
    }

    log(logLine);
  });

  next();
});

// Start server
(async () => {
  // First register the authentication routes
  setupAuth(app);
  
  // Then register all other routes
  const server = await registerRoutes(app);

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Use port from environment or fallback to default
  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`API server running on port ${port}`);
  });
})();