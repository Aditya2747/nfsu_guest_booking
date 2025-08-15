# Campus Stay Suite Backend

A complete backend API for the Campus Stay Suite room booking system built with Node.js, Express, MongoDB, and JWT authentication.

## 🚀 Features

- **JWT Authentication** - Secure user authentication and authorization
- **Role-based Access Control** - Admin, Staff, and User roles with different permissions
- **Room Management** - CRUD operations for rooms with status tracking
- **Booking System** - Complete booking lifecycle management
- **User Management** - User registration, login, and profile management
- **Data Validation** - Input validation using express-validator
- **Error Handling** - Comprehensive error handling middleware
- **Security** - Helmet, CORS, rate limiting, and input sanitization
- **MongoDB Integration** - Mongoose ODM with optimized schemas

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Password Hashing**: bcryptjs
- **Validation**: express-validator
- **Security**: helmet, cors, express-rate-limit
- **Logging**: morgan

## 📋 Prerequisites

- Node.js (v16 or higher)
- MongoDB database (local or cloud)
- npm or yarn package manager

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd campus-stay-suite-main/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   - Copy `config.env.example` to `config.env`
   - Update the MongoDB connection string and other environment variables

4. **Database Setup**
   - Ensure MongoDB is running
   - The application will automatically connect to the database

## ⚙️ Configuration

Create a `config.env` file in the backend directory:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRE=7d
PORT=5000
NODE_ENV=development
```

## 🗄️ Database Seeding

To populate the database with sample data:

```bash
npm run seed
```

This will create:
- Sample rooms (72 rooms across 6 floors)
- Admin user: `admin@campusstay.com` / `admin123`
- Staff user: `staff@campusstay.com` / `staff123`
- Regular user: `user@campusstay.com` / `user123`

## 🚀 Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:5000`

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/profile` - Update user profile
- `PUT /api/auth/change-password` - Change password
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout

### Rooms
- `GET /api/rooms` - Get all rooms with filters
- `GET /api/rooms/stats` - Get room statistics
- `GET /api/rooms/floors` - Get floor information
- `GET /api/rooms/:id` - Get room by ID
- `POST /api/rooms` - Create new room (Admin/Staff)
- `PUT /api/rooms/:id` - Update room (Admin/Staff)
- `DELETE /api/rooms/:id` - Delete room (Admin)
- `PUT /api/rooms/:id/status` - Update room status (Admin/Staff)

### Bookings
- `POST /api/bookings` - Create new booking
- `GET /api/bookings` - Get user's bookings
- `GET /api/bookings/:id` - Get booking by ID
- `PUT /api/bookings/:id` - Update booking
- `PUT /api/bookings/:id/status` - Update booking status (Admin/Staff)
- `DELETE /api/bookings/:id` - Cancel booking

### Users (Admin Only)
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user
- `PUT /api/users/:id/activate` - Activate user
- `PUT /api/users/:id/reset-password` - Reset user password
- `GET /api/users/stats` - Get user statistics

## 🔐 Authentication & Authorization

### JWT Token
Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

### Role Permissions
- **Admin**: Full access to all endpoints
- **Staff**: Can manage rooms and bookings
- **User**: Can view rooms and manage their own bookings

## 📊 Database Models

### User
- Basic info (name, email, phone)
- Role-based access control
- Address and preferences
- Password hashing

### Room
- Room details (number, type, floor, block)
- Status tracking (vacant, booked, held, maintenance)
- Pricing and facilities
- Availability methods

### Booking
- Complete booking information
- Date validation and conflict checking
- Status lifecycle management
- Room status synchronization

## 🛡️ Security Features

- **Password Hashing**: bcryptjs with salt rounds
- **JWT Security**: Secure token generation and validation
- **Input Validation**: Comprehensive request validation
- **Rate Limiting**: API rate limiting to prevent abuse
- **CORS Protection**: Configurable cross-origin resource sharing
- **Helmet**: Security headers for Express

## 🔍 Error Handling

The API provides consistent error responses:
```json
{
  "status": "error",
  "message": "Error description",
  "errors": [] // Validation errors if applicable
}
```

## 📝 Logging

- **Development**: Detailed request logging with morgan
- **Production**: Minimal logging for performance
- **Error Logging**: Comprehensive error tracking

## 🧪 Testing

To run tests (when implemented):
```bash
npm test
```

## 📦 Production Deployment

1. Set `NODE_ENV=production`
2. Update CORS origins for production domains
3. Use strong JWT secrets
4. Enable HTTPS
5. Set up proper MongoDB connection pooling
6. Configure logging and monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Contact the development team

## 🔄 API Versioning

The current API version is v1. All endpoints are prefixed with `/api/`.

## 📈 Performance

- Database indexing for optimal queries
- Pagination for large datasets
- Efficient aggregation pipelines
- Connection pooling for MongoDB

## 🔧 Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Check connection string
   - Ensure MongoDB is running
   - Verify network access

2. **JWT Token Issues**
   - Check JWT_SECRET in environment
   - Verify token expiration
   - Ensure proper Authorization header

3. **Validation Errors**
   - Check request body format
   - Verify required fields
   - Check data types and formats

### Debug Mode

Enable debug logging by setting `NODE_ENV=development` in your environment variables.
