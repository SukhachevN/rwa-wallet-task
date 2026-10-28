const rateLimit = require('express-rate-limit');

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: 15 * 60
    });
  }
});


// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts',
    message: 'Too many authentication attempts from this IP, please try again later.',
    retryAfter: 15 * 60
  },
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Too many authentication attempts from this IP, please try again later.',
      retryAfter: 15 * 60
    });
  }
});

// File upload rate limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 uploads per minute
  message: {
    error: 'Too many file uploads',
    message: 'Too many file uploads from this IP, please try again later.',
    retryAfter: 60
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many file uploads',
      message: 'Too many file uploads from this IP, please try again later.',
      retryAfter: 60
    });
  }
});

// API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  message: {
    error: 'API rate limit exceeded',
    message: 'API rate limit exceeded, please try again later.',
    retryAfter: 60
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'API rate limit exceeded',
      message: 'API rate limit exceeded, please try again later.',
      retryAfter: 60
    });
  }
});

// Dynamic rate limiter based on user type
const dynamicLimiter = (req, res, next) => {
  let maxRequests = 100; // default limit
  
  // Premium users get higher limits
  if (req.user && req.user.roles && req.user.roles.includes('premium')) {
    maxRequests = 500;
  }
  
  // Admin users get unlimited
  if (req.user && req.user.roles && req.user.roles.includes('admin')) {
    return next();
  }
  
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: maxRequests,
    message: {
      error: 'Rate limit exceeded',
      message: `Rate limit exceeded. You can make ${maxRequests} requests per 15 minutes.`,
      retryAfter: 15 * 60
    }
  });
  
  limiter(req, res, next);
};


// IP whitelist middleware
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (allowedIPs.length > 0 && allowedIPs.includes(clientIP)) {
      next();
    } else {
      res.status(403).json({
        error: 'Access denied',
        message: 'Your IP address is not authorized to access this resource.'
      });
    }
  };
};

// Request size limiter
const requestSizeLimiter = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('content-length') || '0');
    const maxSizeBytes = parseInt(maxSize.replace('mb', '')) * 1024 * 1024;
    
    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        error: 'Request too large',
        message: `Request size exceeds the limit of ${maxSize}.`
      });
    }
    
    next();
  };
};

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  apiLimiter,
  dynamicLimiter,
  ipWhitelist,
  requestSizeLimiter,
};
