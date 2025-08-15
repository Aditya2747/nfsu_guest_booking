import express from 'express';
import { query, param, body, validationResult } from 'express-validator';
import Room from '../models/Room.js';
import { getIO } from '../realtime/socket.js';
import { authMiddleware, adminMiddleware, staffMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// @route   GET /api/rooms
// @desc    Get all rooms with filters
// @access  Public
router.get('/', [
  query('type').optional().isIn(['single', 'double']),
  query('status').optional().isIn(['vacant', 'booked', 'held', 'maintenance']),
  query('floor').optional().isIn(['1', '2', '3', '4', '5', '6']),
  query('block').optional().isIn(['A', 'B', 'C', 'D', 'E', 'F']),
  query('minPrice').optional().isNumeric(),
  query('maxPrice').optional().isNumeric(),
  query('facilities').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  // Optional date filters to filter rooms available between dates
  query('checkIn').optional().isISO8601(),
  query('checkOut').optional().isISO8601()
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
    type,
    status,
    floor,
    block,
    minPrice,
    maxPrice,
    facilities,
    page = 1,
    limit = 20,
    checkIn,
    checkOut
  } = req.query;

  // Build filter object
  const filters = { isActive: true };
  
  if (type) filters.type = type;
  if (status) filters.status = status;
  if (floor) filters.floor = floor;
  if (block) filters.block = block;
  
  if (minPrice || maxPrice) {
    filters.pricePerNight = {};
    if (minPrice) filters.pricePerNight.$gte = Number(minPrice);
    if (maxPrice) filters.pricePerNight.$lte = Number(maxPrice);
  }
  
  if (facilities) {
    const facilityArray = facilities.split(',').map(f => f.trim());
    filters.facilities = { $in: facilityArray };
  }

  // If both dates provided, filter out rooms with conflicting bookings
  let rooms;
  if (checkIn && checkOut) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    
    // Validate dates
    if (start >= end) {
      return res.status(400).json({
        status: 'error',
        message: 'Check-out date must be after check-in date'
      });
    }

    // Get all rooms that match basic filters
    const allRooms = await Room.find(filters).select('_id');
    const roomIds = allRooms.map(r => r._id);

    // Find rooms with conflicting bookings
    const conflictingBookings = await (await import('../models/Booking.js')).default.find({
      room: { $in: roomIds },
      status: { $in: ['confirmed', 'pending'] },
      $or: [
        { checkIn: { $lt: end }, checkOut: { $gt: start } }
      ]
    }).select('room');

    const conflictingRoomIds = new Set(conflictingBookings.map(b => b.room.toString()));
    
    // Get available rooms (excluding conflicting ones)
    const availableRoomIds = roomIds.filter(id => !conflictingRoomIds.has(id.toString()));
    
    // Fetch full room data for available rooms with pagination
    const skip = (page - 1) * limit;
    rooms = await Room.find({ 
      _id: { $in: availableRoomIds },
      ...filters 
    })
      .sort({ floor: 1, block: 1, roomNumber: 1 })
      .skip(skip)
      .limit(Number(limit));

    const total = availableRoomIds.length;

    return res.json({
      status: 'success',
      data: {
        rooms,
        pagination: {
          currentPage: Number(page),
          totalPages: Math.ceil(total / limit),
          totalRooms: total,
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1
        }
      }
    });
  }

  // Calculate pagination
  const skip = (page - 1) * limit;
  
  // Get rooms with pagination
  rooms = await Room.find(filters)
    .sort({ floor: 1, block: 1, roomNumber: 1 })
    .skip(skip)
    .limit(Number(limit));

  // Get total count for pagination
  const total = await Room.countDocuments(filters);

  res.json({
    status: 'success',
    data: {
      rooms,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / limit),
        totalRooms: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    }
  });
}));

// @route   GET /api/rooms/stats
// @desc    Get room statistics
// @access  Public
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await Room.getRoomStats();
  
  // Get total counts
  const totalRooms = await Room.countDocuments({ isActive: true });
  const availableRooms = await Room.countDocuments({ 
    status: 'vacant', 
    isActive: true 
  });

  res.json({
    status: 'success',
    data: {
      stats,
      summary: {
        totalRooms,
        availableRooms,
        occupancyRate: totalRooms > 0 ? ((totalRooms - availableRooms) / totalRooms * 100).toFixed(2) : 0
      }
    }
  });
}));

// @route   GET /api/rooms/floors
// @desc    Get floor information with room counts
// @access  Public
router.get('/floors', asyncHandler(async (req, res) => {
  const floors = await Room.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: { floor: '$floor', block: '$block' },
        totalRooms: { $sum: 1 },
        singleRooms: {
          $sum: { $cond: [{ $eq: ['$type', 'single'] }, 1, 0] }
        },
        doubleRooms: {
          $sum: { $cond: [{ $eq: ['$type', 'double'] }, 1, 0] }
        },
        vacantRooms: {
          $sum: { $cond: [{ $eq: ['$status', 'vacant'] }, 1, 0] }
        },
        bookedRooms: {
          $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
        },
        facilities: { $addToSet: '$facilities' }
      }
    },
    {
      $group: {
        _id: '$_id.floor',
        floors: {
          $push: {
            block: '$_id.block',
            totalRooms: '$totalRooms',
            singleRooms: '$singleRooms',
            doubleRooms: '$doubleRooms',
            vacantRooms: '$vacantRooms',
            bookedRooms: '$bookedRooms',
            facilities: '$facilities'
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  res.json({
    status: 'success',
    data: {
      floors
    }
  });
}));

// @route   GET /api/rooms/availability
// @desc    Get room availability with real-time booking status
// @access  Public
router.get('/availability', [
  query('type').optional().isIn(['single', 'double']),
  query('floor').optional().isIn(['1', '2', '3', '4', '5', '6']),
  query('block').optional().isIn(['A', 'B', 'C', 'D', 'E', 'F']),
  query('checkIn').optional().isISO8601(),
  query('checkOut').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 1000 })
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
    type,
    floor,
    block,
    checkIn,
    checkOut,
    limit = 1000
  } = req.query;

  // Build filter object
  const filters = { isActive: true };
  
  if (type) filters.type = type;
  if (floor) filters.floor = floor;
  if (block) filters.block = block;

  // Get all rooms matching basic filters
  const allRooms = await Room.find(filters).sort({ floor: 1, block: 1, roomNumber: 1 });

  // If dates are provided, check availability for those specific dates
  if (checkIn && checkOut) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    
    // Validate dates
    if (start >= end) {
      return res.status(400).json({
        status: 'error',
        message: 'Check-out date must be after check-in date'
      });
    }

    const roomIds = allRooms.map(r => r._id);

    // Find rooms with conflicting bookings for the selected dates
    const conflictingBookings = await (await import('../models/Booking.js')).default.find({
      room: { $in: roomIds },
      status: { $in: ['confirmed', 'pending'] },
      $or: [
        { checkIn: { $lt: end }, checkOut: { $gt: start } }
      ]
    }).select('room');

    const conflictingRoomIds = new Set(conflictingBookings.map(b => b.room.toString()));
    
    // Process each room to determine availability and status
    const roomsWithStatus = allRooms.map(room => {
      const isAvailableForDates = !conflictingRoomIds.has(room._id.toString());
      
      // Determine availability message based on current status and date availability
      let availabilityMessage = '';
      let isAvailable = false;
      
      if (isAvailableForDates) {
        if (room.status === 'vacant') {
          availabilityMessage = 'Available';
          isAvailable = true;
        } else if (room.status === 'booked') {
          // Check if the room will be available by the check-in date
          availabilityMessage = 'Currently booked but available for selected dates';
          isAvailable = true;
        } else if (room.status === 'held') {
          availabilityMessage = 'Currently held but available for selected dates';
          isAvailable = true;
        } else {
          availabilityMessage = 'Under maintenance';
          isAvailable = false;
        }
      } else {
        // Room has conflicting bookings for the selected dates
        if (room.status === 'vacant') {
          availabilityMessage = 'Not available for selected dates';
          isAvailable = false;
        } else if (room.status === 'booked') {
          availabilityMessage = 'Booked for selected dates';
          isAvailable = false;
        } else if (room.status === 'held') {
          availabilityMessage = 'Held for selected dates';
          isAvailable = false;
        } else {
          availabilityMessage = 'Under maintenance';
          isAvailable = false;
        }
      }

      return {
        ...room.toObject(),
        isAvailable,
        availabilityMessage,
        // Add current status for reference
        currentStatus: room.status
      };
    });

    return res.json({
      status: 'success',
      data: {
        rooms: roomsWithStatus,
        totalAvailable: roomsWithStatus.filter(r => r.isAvailable).length,
        totalRooms: allRooms.length,
        searchDates: { checkIn, checkOut }
      }
    });
  }

  // If no dates provided, return all rooms with their current status
  const roomsWithStatus = allRooms.map(room => ({
    ...room.toObject(),
    isAvailable: room.status === 'vacant',
    availabilityMessage: room.status === 'vacant' ? 'Available' : 
                        room.status === 'booked' ? 'Currently Booked' :
                        room.status === 'held' ? 'Temporarily Held' : 'Under Maintenance',
    currentStatus: room.status
  }));

  return res.json({
    status: 'success',
    data: {
      rooms: roomsWithStatus,
      totalAvailable: roomsWithStatus.filter(r => r.isAvailable).length,
      totalRooms: roomsWithStatus.length
    }
  });
}));

// @route   GET /api/rooms/:id
// @desc    Get room by ID
// @access  Public
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid room ID')
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

  const room = await Room.findById(req.params.id);
  
  if (!room) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  res.json({
    status: 'success',
    data: {
      room
    }
  });
}));

// @route   POST /api/rooms
// @desc    Create a new room (Admin/Staff only)
// @access  Private (Admin/Staff)
router.post('/', [
  authMiddleware,
  staffMiddleware,
  body('roomNumber').notEmpty().withMessage('Room number is required'),
  body('type').isIn(['single', 'double']).withMessage('Invalid room type'),
  body('floor').isIn(['1', '2', '3', '4', '5', '6']).withMessage('Invalid floor'),
  body('block').isIn(['A', 'B', 'C', 'D', 'E', 'F']).withMessage('Invalid block'),
  body('pricePerNight').isNumeric().withMessage('Price must be a number')
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

  const roomData = req.body;
  
  // Check if room number already exists
  const existingRoom = await Room.findOne({ roomNumber: roomData.roomNumber });
  if (existingRoom) {
    return res.status(400).json({
      status: 'error',
      message: 'Room with this number already exists'
    });
  }

  const room = new Room(roomData);
  await room.save();
  try { getIO().emit('roomStatusUpdated', { roomId: room._id, status: room.status }); } catch {}

  res.status(201).json({
    status: 'success',
    message: 'Room created successfully',
    data: {
      room
    }
  });
}));

// @route   PUT /api/rooms/:id
// @desc    Update room (Admin/Staff only)
// @access  Private (Admin/Staff)
router.put('/:id', [
  authMiddleware,
  staffMiddleware,
  param('id').isMongoId().withMessage('Invalid room ID')
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

  const room = await Room.findById(req.params.id);
  
  if (!room) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  // Update room
  Object.assign(room, req.body);
  await room.save();

  res.json({
    status: 'success',
    message: 'Room updated successfully',
    data: {
      room
    }
  });
}));

// @route   DELETE /api/rooms/:id
// @desc    Delete room (Admin only)
// @access  Private (Admin)
router.delete('/:id', [
  authMiddleware,
  adminMiddleware,
  param('id').isMongoId().withMessage('Invalid room ID')
], asyncHandler(async (req, res) => {
  const room = await Room.findById(req.params.id);
  
  if (!room) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  // Soft delete - mark as inactive
  room.isActive = false;
  await room.save();

  res.json({
    status: 'success',
    message: 'Room deleted successfully'
  });
}));

// @route   PUT /api/rooms/:id/status
// @desc    Update room status (Admin/Staff only)
// @access  Private (Admin/Staff)
router.put('/:id/status', [
  authMiddleware,
  staffMiddleware,
  param('id').isMongoId().withMessage('Invalid room ID'),
  body('status').isIn(['vacant', 'booked', 'held', 'maintenance']).withMessage('Invalid status')
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

  const { status } = req.body;
  const room = await Room.findById(req.params.id);
  
  if (!room) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found'
    });
  }

  await room.updateStatus(status);
  try { getIO().emit('roomStatusUpdated', { roomId: room._id, status: room.status }); } catch {}

  res.json({
    status: 'success',
    message: 'Room status updated successfully',
    data: {
      room
    }
  });
}));

export default router;
