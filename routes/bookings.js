import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import Booking from '../models/Booking.js';
import Room from '../models/Room.js';
import { authMiddleware, adminMiddleware, staffMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getIO } from '../realtime/socket.js';

const router = express.Router();

// @route   POST /api/bookings
// @desc    Create a new booking
// @access  Private
// Create booking and optionally start payment flow
router.post('/', [
  body('roomId').isMongoId().withMessage('Valid room ID is required'),
  body('checkIn').isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').isISO8601().withMessage('Valid check-out date is required'),
  body('guestName').trim().isLength({ min: 2, max: 100 }).withMessage('Guest name must be between 2 and 100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
  body('purpose').isIn(['academic', 'business', 'personal', 'other']).withMessage('Invalid purpose'),
  body('purposeDetails').optional().isLength({ max: 500 }).withMessage('Purpose details cannot exceed 500 characters'),
  body('numberOfGuests').isInt({ min: 1, max: 4 }).withMessage('Number of guests must be between 1 and 4'),
  body('paymentOption').optional().isIn(['pay_now','pay_later']).withMessage('Invalid payment option')
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
    roomId,
    checkIn,
    checkOut,
    guestName,
    email,
    phone,
    purpose,
    purposeDetails,
    numberOfGuests,
    specialRequests,
    paymentOption = 'pay_now'
  } = req.body;

  // Try to acquire a temporary hold on the room for this user
  const room = await Room.acquireHold(roomId, req.user._id, 10 * 60); // 10 minutes hold
  if (!room) {
    return res.status(404).json({
      status: 'error',
      message: 'Room not found or not available to hold'
    });
  }

  // Check room availability for the requested dates
  const isAvailable = await Booking.checkRoomAvailability(roomId, new Date(checkIn), new Date(checkOut));
  if (!isAvailable) {
    return res.status(400).json({
      status: 'error',
      message: 'Room is not available for the selected dates'
    });
  }

  // Calculate total amount
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  const totalAmount = nights * room.pricePerNight;

  // Create booking
  const booking = new Booking({
    user: req.user._id,
    room: roomId,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    guestName,
    email,
    phone,
    purpose,
    purposeDetails,
    numberOfGuests,
    totalAmount,
    specialRequests
  });

  await booking.save();

  // If user chooses pay later, confirm booking immediately and set room to booked
  if (paymentOption === 'pay_later') {
    booking.status = 'confirmed';
    booking.paymentMethod = 'cash';
    booking.paymentStatus = 'pending';
    await booking.save();
    await Room.findByIdAndUpdate(room._id, { status: 'booked', holdBy: null, holdUntil: null });

    // Populate and emit events
    await booking.populate('room', 'roomNumber type floor block pricePerNight');
    try { getIO().emit('roomStatusUpdated', { roomId: room._id, status: 'booked' }); } catch {}
    try { getIO().emit('bookingUpdated', { bookingId: booking._id, status: 'confirmed' }); } catch {}

    return res.status(201).json({
      status: 'success',
      message: 'Booking confirmed. Pay at reception to complete payment.',
      data: { booking }
    });
  }

  // Otherwise keep room in held state until payment confirmation
  await booking.populate('room', 'roomNumber type floor block pricePerNight');
  try { getIO().emit('roomStatusUpdated', { roomId: room._id, status: 'held' }); } catch {}

  return res.status(201).json({
    status: 'success',
    message: 'Booking created and room held. Proceed to payment to confirm.',
    data: { booking }
  });
}));

// @route   POST /api/bookings/:id/mark-paid
// @desc    Mark a booking as paid at reception (cash)
// @access  Private (Admin/Staff)
router.post('/:id/mark-paid', [
  authMiddleware,
  staffMiddleware,
  param('id').isMongoId().withMessage('Invalid booking ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
  }

  const booking = await Booking.findById(req.params.id);
  if (!booking) {
    return res.status(404).json({ status: 'error', message: 'Booking not found' });
  }

  booking.paymentStatus = 'paid';
  booking.paymentMethod = 'cash';
  await booking.save();
  try { getIO().emit('bookingUpdated', { bookingId: booking._id, paymentStatus: 'paid' }); } catch {}

  res.json({ status: 'success', message: 'Booking marked as paid', data: { booking } });
}));

// @route   POST /api/bookings/:id/checkout
// @desc    Create Stripe PaymentIntent for a booking
// @access  Private
// Checkout route removed for now (Stripe)

// @route   GET /api/bookings
// @desc    Get user's bookings or all bookings (admin/staff)
// @access  Private
router.get('/', [
  query('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'completed', 'no-show']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
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

  const { status, page = 1, limit = 20 } = req.query;
  
  // Build query
  let query = { isActive: true };
  
  // Regular users can only see their own bookings
  if (req.user.role === 'user') {
    query.user = req.user._id;
  }
  
  if (status) {
    query.status = status;
  }

  // Calculate pagination
  const skip = (page - 1) * limit;
  
  // Get bookings with pagination
  const bookings = await Booking.find(query)
    .populate('room', 'roomNumber type floor block pricePerNight')
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  // Get total count for pagination
  const total = await Booking.countDocuments(query);

  res.json({
    status: 'success',
    data: {
      bookings,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / limit),
        totalBookings: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    }
  });
}));

// @route   GET /api/bookings/:id
// @desc    Get booking by ID
// @access  Private
router.get('/:id', [
  param('id').isMongoId().withMessage('Invalid booking ID')
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

  const booking = await Booking.findById(req.params.id)
    .populate('room', 'roomNumber type floor block pricePerNight')
    .populate('user', 'name email');

  if (!booking) {
    return res.status(404).json({
      status: 'error',
      message: 'Booking not found'
    });
  }

  // Check if user can access this booking
  if (req.user.role === 'user' && booking.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. You can only view your own bookings.'
    });
  }

  res.json({
    status: 'success',
    data: {
      booking
    }
  });
}));

// @route   PUT /api/bookings/:id
// @desc    Update booking
// @access  Private
router.put('/:id', [
  param('id').isMongoId().withMessage('Invalid booking ID'),
  body('checkIn').optional().isISO8601().withMessage('Valid check-in date is required'),
  body('checkOut').optional().isISO8601().withMessage('Valid check-out date is required'),
  body('guestName').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Guest name must be between 2 and 100 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('phone').optional().matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
  body('specialRequests').optional().isLength({ max: 500 }).withMessage('Special requests cannot exceed 500 characters')
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

  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    return res.status(404).json({
      status: 'error',
      message: 'Booking not found'
    });
  }

  // Check if user can update this booking
  if (req.user.role === 'user' && booking.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. You can only update your own bookings.'
    });
  }

  // Check if booking can be updated
  if (['cancelled', 'completed'].includes(booking.status)) {
    return res.status(400).json({
      status: 'error',
      message: 'Cannot update cancelled or completed bookings'
    });
  }

  // If dates are being updated, check availability
  if ((req.body.checkIn || req.body.checkOut) && req.user.role === 'user') {
    const checkIn = req.body.checkIn ? new Date(req.body.checkIn) : booking.checkIn;
    const checkOut = req.body.checkOut ? new Date(req.body.checkOut) : booking.checkOut;
    
    const isAvailable = await Booking.checkRoomAvailability(
      booking.room,
      checkIn,
      checkOut,
      booking._id
    );
    
    if (!isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: 'Room is not available for the selected dates'
      });
    }
  }

  // Update booking
  Object.assign(booking, req.body);
  await booking.save();

  // Populate room details for response
  await booking.populate('room', 'roomNumber type floor block pricePerNight');

  res.json({
    status: 'success',
    message: 'Booking updated successfully',
    data: {
      booking
    }
  });
}));

// @route   PUT /api/bookings/:id/status
// @desc    Update booking status (Admin/Staff only)
// @access  Private (Admin/Staff)
router.put('/:id/status', [
  authMiddleware,
  staffMiddleware,
  param('id').isMongoId().withMessage('Invalid booking ID'),
  body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed', 'no-show']).withMessage('Invalid status'),
  body('notes').optional().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters')
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

  const { status, notes } = req.body;
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    return res.status(404).json({
      status: 'error',
      message: 'Booking not found'
    });
  }

  const oldStatus = booking.status;
  booking.status = status;
  if (notes) booking.notes = notes;

  // If cancelling, add cancellation details
  if (status === 'cancelled' && oldStatus !== 'cancelled') {
    booking.cancelledAt = new Date();
    booking.cancelledBy = req.user._id;
  }

  await booking.save();

  // Update room status if needed
  if (oldStatus === 'confirmed' && status !== 'confirmed') {
    // Check if there are other confirmed bookings for this room
    const otherConfirmedBookings = await Booking.find({
      room: booking.room,
      status: 'confirmed',
      _id: { $ne: booking._id }
    });

    if (otherConfirmedBookings.length === 0) {
      await Room.findByIdAndUpdate(booking.room, { status: 'vacant', holdBy: null, holdUntil: null });
    }
  } else if (oldStatus !== 'confirmed' && status === 'confirmed') {
    await Room.findByIdAndUpdate(booking.room, { status: 'booked', holdBy: null, holdUntil: null });
  }

  // Populate room details for response
  await booking.populate('room', 'roomNumber type floor block pricePerNight');

  res.json({
    status: 'success',
    message: 'Booking status updated successfully',
    data: {
      booking
    }
  });
}));

// @route   DELETE /api/bookings/:id
// @desc    Cancel booking
// @access  Private
router.delete('/:id', [
  param('id').isMongoId().withMessage('Invalid booking ID'),
  body('reason').optional().isLength({ max: 200 }).withMessage('Cancellation reason cannot exceed 200 characters')
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

  const { reason } = req.body;
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    return res.status(404).json({
      status: 'error',
      message: 'Booking not found'
    });
  }

  // Check if user can cancel this booking
  if (req.user.role === 'user' && booking.user.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. You can only cancel your own bookings.'
    });
  }

  // Check if booking can be cancelled
  if (['cancelled', 'completed'].includes(booking.status)) {
    return res.status(400).json({
      status: 'error',
      message: 'Booking cannot be cancelled'
    });
  }

  // Cancel booking
  const oldStatus = booking.status;
  await booking.cancel(reason || 'Cancelled by user', req.user._id);

  // Update room status if it was confirmed
  if (oldStatus === 'confirmed') {
    await Room.findByIdAndUpdate(booking.room, { status: 'vacant', holdBy: null, holdUntil: null });
  }

  res.json({
    status: 'success',
    message: 'Booking cancelled successfully'
  });
}));

export default router;
