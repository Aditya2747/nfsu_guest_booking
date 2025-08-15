import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authMiddleware = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access denied. No token provided.'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from token
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'Token is valid but user not found.'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          status: 'error',
          message: 'User account is deactivated.'
        });
      }

      // Add user to request object
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token.'
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during authentication.'
    });
  }
};

// Middleware to check if user is admin
export const adminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Admin privileges required.'
    });
  }
};

// Middleware to check if user is staff or admin
export const staffMiddleware = (req, res, next) => {
  if (req.user && (req.user.role === 'staff' || req.user.role === 'admin')) {
    next();
  } else {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Staff privileges required.'
    });
  }
};

// Middleware to check if user owns the resource or is admin
export const ownerOrAdminMiddleware = (resourceUserId) => {
  return (req, res, next) => {
    if (req.user.role === 'admin' || req.user._id.toString() === resourceUserId.toString()) {
      next();
    } else {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. You can only access your own resources.'
      });
    }
  };
};
