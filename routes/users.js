import express from 'express';
import { param, query, body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users (Admin only)
// @access  Private (Admin)
router.get('/', [
  authMiddleware,
  adminMiddleware,
  query('role').optional().isIn(['user', 'admin', 'staff']),
  query('isActive').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString()
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const {
    role,
    isActive,
    page = 1,
    limit = 20,
    search
  } = req.query;

  // Build filter object
  const filters = {};
  
  if (role) filters.role = role;
  if (isActive !== undefined) filters.isActive = isActive === 'true';
  
  if (search) {
    filters.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  // Calculate pagination
  const skip = (page - 1) * limit;
  
  // Get users with pagination
  const users = await User.find(filters)
    .select('-password')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  // Get total count for pagination
  const total = await User.countDocuments(filters);

  res.json({
    status: 'success',
    data: {
      users,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    }
  });
}));

// @route   GET /api/users/:id
// @desc    Get user by ID (Admin only)
// @access  Private (Admin)
router.get('/:id', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid user ID')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id).select('-password');
  
  if (!user) {
    return res.status(404).json({
      status: 'error',
      message: 'User not found'
    });
  }

  res.json({
    status: 'success',
    data: {
      user
    }
  });
}));

// @route   PUT /api/users/:id
// @desc    Update user (Admin only)
// @access  Private (Admin)
router.put('/:id', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
  body('role').optional().isIn(['user', 'admin', 'staff']).withMessage('Invalid role'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      status: 'error',
      message: 'User not found'
    });
  }

  // Prevent admin from changing their own role to non-admin
  if (req.params.id === req.user._id.toString() && req.body.role && req.body.role !== 'admin') {
    return res.status(400).json({
      status: 'error',
      message: 'You cannot change your own role from admin'
    });
  }

  // Update user
  Object.assign(user, req.body);
  await user.save();

  res.json({
    status: 'success',
    message: 'User updated successfully',
    data: {
      user: user.toJSON()
    }
  });
}));

// @route   DELETE /api/users/:id
// @desc    Deactivate user (Admin only)
// @access  Private (Admin)
router.delete('/:id', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid user ID')
], asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      status: 'error',
      message: 'User not found'
    });
  }

  // Prevent admin from deactivating themselves
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({
      status: 'error',
      message: 'You cannot deactivate your own account'
    });
  }

  // Soft delete - mark as inactive
  user.isActive = false;
  await user.save();

  res.json({
    status: 'success',
    message: 'User deactivated successfully'
  });
}));

// @route   PUT /api/users/:id/activate
// @desc    Activate user (Admin only)
// @access  Private (Admin)
router.put('/:id/activate', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid user ID')
], asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      status: 'error',
      message: 'User not found'
    });
  }

  if (user.isActive) {
    return res.status(400).json({
      status: 'error',
      message: 'User is already active'
    });
  }

  // Activate user
  user.isActive = true;
  await user.save();

  res.json({
    status: 'success',
    message: 'User activated successfully'
  });
}));

// @route   PUT /api/users/:id/reset-password
// @desc    Reset user password (Admin only)
// @access  Private (Admin)
router.put('/:id/reset-password', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { newPassword } = req.body;
  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      status: 'error',
      message: 'User not found'
    });
  }

  // Reset password
  user.password = newPassword;
  await user.save();

  res.json({
    status: 'success',
    message: 'Password reset successfully'
  });
}));

// @route   GET /api/users/stats
// @desc    Get user statistics (Admin only)
// @access  Private (Admin)
router.get('/stats', [
  authMiddleware,
  adminMiddleware
], asyncHandler(async (req, res) => {
  const stats = await User.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        activeCount: {
          $sum: { $cond: ['$isActive', 1, 0] }
        }
      }
    }
  ]);

  // Get total counts
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ isActive: true });
  const inactiveUsers = totalUsers - activeUsers;

  res.json({
    status: 'success',
    data: {
      stats,
      summary: {
        totalUsers,
        activeUsers,
        inactiveUsers,
        activationRate: totalUsers > 0 ? (activeUsers / totalUsers * 100).toFixed(2) : 0
      }
    }
  });
}));

export default router;
