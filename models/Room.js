import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  roomNumber: {
    type: String,
    required: [true, 'Room number is required'],
    unique: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['single', 'double'],
    required: [true, 'Room type is required']
  },
  status: {
    type: String,
    enum: ['vacant', 'booked', 'held', 'maintenance'],
    default: 'vacant'
  },
  // Temporary hold metadata for real-time selection and checkout
  holdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  holdUntil: {
    type: Date,
    default: null
  },
  floor: {
    type: String,
    required: [true, 'Floor number is required'],
    enum: ['1', '2', '3', '4', '5', '6']
  },
  block: {
    type: String,
    required: [true, 'Block letter is required'],
    enum: ['A', 'B', 'C', 'D', 'E', 'F']
  },
  pricePerNight: {
    type: Number,
    required: [true, 'Price per night is required'],
    min: [0, 'Price cannot be negative']
  },
  facilities: [{
    type: String,
    enum: ['Gym', 'WiFi', 'AC', 'TV', 'Refrigerator', 'Balcony', 'Parking']
  }],
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  images: [{
    type: String,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'Please provide valid image URLs'
    }
  }],
  amenities: [{
    name: String,
    available: {
      type: Boolean,
      default: true
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastCleaned: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  }
}, {
  timestamps: true
});

// Indexes for better query performance (roomNumber already has unique index)
roomSchema.index({ status: 1 });
roomSchema.index({ type: 1 });
roomSchema.index({ floor: 1, block: 1 });
roomSchema.index({ pricePerNight: 1 });
roomSchema.index({ holdUntil: 1 });

// Virtual for room availability
roomSchema.virtual('isAvailable').get(function() {
  if (this.status === 'vacant') return true;
  if (this.status === 'held' && this.holdUntil && this.holdUntil < new Date()) return true;
  return false;
});

// Virtual for room identifier
roomSchema.virtual('roomIdentifier').get(function() {
  return `${this.block}-${this.roomNumber}`;
});

// Method to check if room can be booked
roomSchema.methods.canBeBooked = function() {
  const now = new Date();
  const notEffectivelyHeld = this.status !== 'held' || (this.holdUntil && this.holdUntil < now);
  return this.isActive && (this.status === 'vacant' || (this.status === 'held' && notEffectivelyHeld));
};

// Method to update room status
roomSchema.methods.updateStatus = function(newStatus) {
  if (['vacant', 'booked', 'held', 'maintenance'].includes(newStatus)) {
    this.status = newStatus;
    if (newStatus !== 'held') {
      this.holdBy = null;
      this.holdUntil = null;
    }
    return this.save();
  }
  throw new Error('Invalid room status');
};

// Atomically acquire a temporary hold on a room if available
roomSchema.statics.acquireHold = function(roomId, userId, ttlSeconds = 600) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  return this.findOneAndUpdate(
    {
      _id: roomId,
      isActive: true,
      // Only acquire if vacant OR held but expired, and not booked/maintenance
      $or: [
        { status: 'vacant' },
        { status: 'held', $or: [ { holdUntil: null }, { holdUntil: { $lt: now } } ] }
      ]
    },
    { $set: { status: 'held', holdBy: userId, holdUntil: expires } },
    { new: true }
  );
};

// Release hold if held by the user or force if admin path uses direct call
roomSchema.statics.releaseHold = function(roomId, userId = null) {
  const filter = { _id: roomId, status: 'held' };
  if (userId) {
    filter.holdBy = userId;
  }
  return this.findOneAndUpdate(
    filter,
    { $set: { status: 'vacant' }, $unset: { holdBy: "", holdUntil: "" } },
    { new: true }
  );
};

// Static method to get available rooms
roomSchema.statics.getAvailableRooms = function(filters = {}) {
  const query = { status: 'vacant', isActive: true, ...filters };
  return this.find(query);
};

// Static method to get room statistics
roomSchema.statics.getRoomStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$type',
        total: { $sum: 1 },
        vacant: {
          $sum: { $cond: [{ $eq: ['$status', 'vacant'] }, 1, 0] }
        },
        booked: {
          $sum: { $cond: [{ $eq: ['$status', 'booked'] }, 1, 0] }
        },
        held: {
          $sum: { $cond: [{ $eq: ['$status', 'held'] }, 1, 0] }
        },
        maintenance: {
          $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
        }
      }
    }
  ]);
};

const Room = mongoose.model('Room', roomSchema);

export default Room;
