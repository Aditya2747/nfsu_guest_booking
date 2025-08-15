import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: [true, 'Room is required']
  },
  checkIn: {
    type: Date,
    required: [true, 'Check-in date is required'],
    validate: {
      validator: function(value) {
        return value > new Date();
      },
      message: 'Check-in date must be in the future'
    }
  },
  checkOut: {
    type: Date,
    required: [true, 'Check-out date is required'],
    validate: {
      validator: function(value) {
        return value > this.checkIn;
      },
      message: 'Check-out date must be after check-in date'
    }
  },
  guestName: {
    type: String,
    required: [true, 'Guest name is required'],
    trim: true,
    maxlength: [100, 'Guest name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^[0-9]{10}$/, 'Please provide a valid 10-digit phone number']
  },
  purpose: {
    type: String,
    required: [true, 'Purpose of stay is required'],
    enum: ['academic', 'business', 'personal', 'other'],
    default: 'personal'
  },
  // Free-text purpose details captured from booking form
  purposeDetails: {
    type: String,
    maxlength: [500, 'Purpose details cannot exceed 500 characters']
  },
  numberOfGuests: {
    type: Number,
    required: [true, 'Number of guests is required'],
    min: [1, 'At least 1 guest is required'],
    max: [4, 'Maximum 4 guests allowed']
  },
  totalAmount: {
    type: Number,
    required: [true, 'Total amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  // Stripe fields removed for now
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'bank_transfer'],
    default: 'cash'
  },
  specialRequests: {
    type: String,
    maxlength: [500, 'Special requests cannot exceed 500 characters']
  },
  cancellationReason: {
    type: String,
    maxlength: [200, 'Cancellation reason cannot exceed 200 characters']
  },
  cancelledAt: {
    type: Date
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
bookingSchema.index({ user: 1 });
bookingSchema.index({ room: 1 });
bookingSchema.index({ checkIn: 1 });
bookingSchema.index({ checkOut: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ paymentStatus: 1 });
bookingSchema.index({ createdAt: -1 });

// Virtual for duration of stay
bookingSchema.virtual('duration').get(function() {
  if (this.checkIn && this.checkOut) {
    const diffTime = Math.abs(this.checkOut - this.checkIn);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  return 0;
});

// Virtual for is current booking
bookingSchema.virtual('isCurrent').get(function() {
  const now = new Date();
  return this.checkIn <= now && this.checkOut >= now && this.status === 'confirmed';
});

// Virtual for is upcoming booking
bookingSchema.virtual('isUpcoming').get(function() {
  const now = new Date();
  return this.checkIn > now && this.status === 'confirmed';
});

// Pre-save middleware to validate dates
bookingSchema.pre('save', function(next) {
  if (this.checkIn && this.checkOut) {
    if (this.checkIn >= this.checkOut) {
      next(new Error('Check-out date must be after check-in date'));
      return;
    }
    
    // Check if check-in is at least 1 day in the future
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (this.checkIn < tomorrow) {
      next(new Error('Check-in date must be at least 1 day in the future'));
      return;
    }
  }
  next();
});

// Method to cancel booking
bookingSchema.methods.cancel = function(reason, cancelledBy) {
  if (this.status === 'cancelled') {
    throw new Error('Booking is already cancelled');
  }
  
  if (this.status === 'completed') {
    throw new Error('Cannot cancel completed booking');
  }
  
  this.status = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  this.cancelledBy = cancelledBy;
  
  return this.save();
};

// Method to complete booking
bookingSchema.methods.complete = function() {
  if (this.status !== 'confirmed') {
    throw new Error('Only confirmed bookings can be completed');
  }
  
  this.status = 'completed';
  return this.save();
};

// Static method to check room availability
bookingSchema.statics.checkRoomAvailability = async function(roomId, checkIn, checkOut, excludeBookingId = null) {
  const query = {
    room: roomId,
    status: { $in: ['confirmed', 'pending'] },
    $or: [
      {
        checkIn: { $lt: checkOut },
        checkOut: { $gt: checkIn }
      }
    ]
  };
  
  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }
  
  const conflictingBookings = await this.find(query);
  return conflictingBookings.length === 0;
};

// Static method to get user bookings
bookingSchema.statics.getUserBookings = function(userId, status = null) {
  const query = { user: userId, isActive: true };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('room', 'roomNumber type floor block pricePerNight')
    .sort({ createdAt: -1 });
};

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;
