# 🎉 Ultraa Events - Backend API Documentation

Complete backend API for Ultraa Events system with SQL Server, Razorpay payment integration, and WhatsApp chatbot.

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Environment Setup](#environment-setup)
- [API Endpoints](#api-endpoints)
- [Postman Testing Guide](#postman-testing-guide)
- [Testing Workflow](#testing-workflow)
- [Error Handling](#error-handling)
- [WhatsApp Integration](#whatsapp-integration)

---

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- SQL Server (remote or local)
- Razorpay account (test keys)
- WhatsApp Business API credentials (optional)

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env  # Or create .env manually

# Start server
node server.js
```

**Expected Output:**
```
✅ SQL Server connected
✅ Tables verified/created
========================================
🚀 ULTRAA EVENTS API SERVER
========================================
✅ Server: http://localhost:3000
✅ Health: GET /
✅ Events: GET /api/events
✅ Event:  GET /api/events/:id
✅ Users:  POST /api/users
✅ Orders: POST /api/orders/create
✅ Verify: POST /api/orders/verify
✅ Scan:   POST /api/scan
✅ Webhook: GET/POST /webhook/whatsapp
========================================
```

---

## ⚙️ Environment Setup

Create a `.env` file in the root directory:

```env
# SQL Server Configuration
SQL_SERVER=your-server.database.windows.net
SQL_DATABASE=UltraaEvents
SQL_USER=your_username
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERTIFICATE=true

# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key

# WhatsApp Configuration
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
WHATSAPP_VERIFY_TOKEN=ultraa_secure_token_123

# Server Configuration
PORT=3000
NODE_ENV=development

# Admin Configuration
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@123
JWT_SECRET=ultraa_events_super_secret_key_change_this_in_production
```

**See `SQL_SERVER_CONNECTION_GUIDE.md` for detailed SQL Server connection setup.**

---

## 📡 API Endpoints

### Base URL
```
http://localhost:3000
```

### Public Endpoints (No Authentication Required)

#### 1. Health Check
```http
GET /
```

**Response:**
```json
{
  "success": true,
  "message": "Ultraa Events API Server Running",
  "version": "1.0.0",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

#### 2. Create/Get User
```http
POST /api/users
Content-Type: application/json
```

**Request Body:**
```json
{
  "fullName": "John Doe",
  "phoneNumber": "9876543210",
  "email": "john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "UserID": 1,
    "FullName": "John Doe",
    "PhoneNumber": "919876543210",
    "Email": "john@example.com",
    "CreatedAt": "2025-01-15T10:30:00.000Z"
  },
  "isNew": true
}
```

**Notes:**
- Phone number is automatically formatted (adds country code 91)
- If user exists, returns existing user with `isNew: false`
- Email is optional

---

#### 3. Get All Active Events
```http
GET /api/events
```

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "EventID": 1,
      "EventName": "Neon Nights Festival",
      "EventDate": "2025-12-15",
      "EventTime": "20:00:00",
      "Venue": "Phoenix Arena, Mumbai",
      "Description": "Amazing music festival",
      "ImageURL": "https://example.com/image.jpg",
      "IsActive": true,
      "TicketTypesCount": 3,
      "TotalAvailable": 250
    }
  ]
}
```

---

#### 4. Get Event Details with Ticket Types
```http
GET /api/events/:id
```

**Example:**
```http
GET /api/events/1
```

**Response:**
```json
{
  "success": true,
  "event": {
    "EventID": 1,
    "EventName": "Neon Nights Festival",
    "EventDate": "2025-12-15",
    "EventTime": "20:00:00",
    "Venue": "Phoenix Arena, Mumbai",
    "Description": "Amazing music festival",
    "ImageURL": "https://example.com/image.jpg"
  },
  "ticketTypes": [
    {
      "TicketTypeID": 1,
      "EventID": 1,
      "TicketName": "Early Bird",
      "Price": 500.00,
      "AvailableQuantity": 100,
      "TotalQuantity": 100
    },
    {
      "TicketTypeID": 2,
      "EventID": 1,
      "TicketName": "VIP",
      "Price": 2000.00,
      "AvailableQuantity": 50,
      "TotalQuantity": 50
    }
  ]
}
```

---

#### 5. Create Order & Generate Razorpay Order
```http
POST /api/orders/create
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": 1,
  "eventId": 1,
  "ticketTypeId": 1,
  "email": "customer@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "OrderID": 1,
    "OrderNumber": "UE1705312345678",
    "UserID": 1,
    "EventID": 1,
    "TicketTypeID": 1,
    "RazorpayOrderID": "order_Mxxxxxxxxxxxxx",
    "Amount": 500.00,
    "Status": "pending",
    "CreatedAt": "2025-01-15T10:30:00.000Z"
  },
  "razorpay": {
    "orderId": "order_Mxxxxxxxxxxxxx",
    "amount": 50000,
    "currency": "INR",
    "keyId": "rzp_test_xxxxxxxxxxxxx"
  }
}
```

**Notes:**
- Amount is returned in paise (multiply by 100)
- Use `razorpay.orderId` and `razorpay.keyId` in frontend for payment
- Order status is `pending` until payment is verified
- ⚠️ **`razorpay_payment_id` is NULL** - This is normal! Payment ID only comes AFTER user completes payment
- ⚠️ **`razorpay_signature` is not available** - Signature comes from Razorpay payment handler callback in frontend
- See `RAZORPAY_PAYMENT_FLOW_GUIDE.md` for complete payment flow

---

#### 6. Verify Payment & Complete Order
```http
POST /api/orders/verify
Content-Type: application/json
```

**Request Body:**
```json
{
  "razorpay_order_id": "order_Mxxxxxxxxxxxxx",
  "razorpay_payment_id": "pay_Mxxxxxxxxxxxxx",
  "razorpay_signature": "abc123def456..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment verified",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Notes:**
- Signature verification is performed automatically
- QR code is generated and stored in database
- Order status changes to `completed`
- Available ticket quantity is decremented

---

#### 7. Get Order Details
```http
GET /api/orders/:orderNumber
```

**Example:**
```http
GET /api/orders/UE1705312345678
```

**Response:**
```json
{
  "success": true,
  "order": {
    "OrderID": 1,
    "OrderNumber": "UE1705312345678",
    "UserID": 1,
    "EventID": 1,
    "TicketTypeID": 1,
    "RazorpayOrderID": "order_Mxxxxxxxxxxxxx",
    "RazorpayPaymentID": "pay_Mxxxxxxxxxxxxx",
    "Amount": 500.00,
    "Status": "completed",
    "QRCode": "data:image/png;base64,...",
    "IsScanned": false,
    "FullName": "John Doe",
    "PhoneNumber": "919876543210",
    "Email": "john@example.com",
    "EventName": "Neon Nights Festival",
    "EventDate": "2025-12-15",
    "EventTime": "20:00:00",
    "Venue": "Phoenix Arena, Mumbai",
    "TicketName": "Early Bird"
  }
}
```

---

#### 8. Scan QR Code (Entry Validation)
```http
POST /api/scan
Content-Type: application/json
```

**Request Body:**
```json
{
  "qrCode": "{\"orderNumber\":\"UE1705312345678\",\"orderId\":1,\"eventId\":1,\"timestamp\":\"2025-01-15T10:30:00.000Z\"}",
  "scannedBy": "Security Guard 1"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Entry granted",
  "details": {
    "userName": "John Doe",
    "phoneNumber": "919876543210",
    "eventName": "Neon Nights Festival",
    "ticketType": "Early Bird",
    "orderNumber": "UE1705312345678"
  }
}
```

**Response (Already Scanned):**
```json
{
  "success": false,
  "message": "Ticket already used",
  "scannedAt": "2025-01-15T11:00:00.000Z"
}
```

**Response (Payment Not Completed):**
```json
{
  "success": false,
  "message": "Payment not completed"
}
```

---

### Admin Endpoints (Authentication Required)

#### 9. Admin Login
```http
POST /api/admin/login
Content-Type: application/json
```

**Request Body:**
```json
{
  "username": "admin",
  "password": "Admin@123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Save the token for authenticated requests!**

---

### WhatsApp Webhook Endpoints

#### 10. WhatsApp Webhook Verification
```http
GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=ultraa_secure_token_123&hub.challenge=CHALLENGE_STRING
```

**Used by Meta to verify webhook during setup.**

---

#### 11. WhatsApp Webhook (Receive Messages)
```http
POST /webhook/whatsapp
Content-Type: application/json
```

**This endpoint receives messages from WhatsApp. Configure in Meta Developer Dashboard.**

---

## 🧪 Postman Testing Guide

### Step 1: Import Postman Collection

Create a new collection in Postman named "Ultraa Events API" and add the following requests:

---

### Step 2: Set Up Environment Variables

In Postman, create an environment with these variables:

| Variable | Initial Value | Current Value |
|----------|---------------|---------------|
| `base_url` | `http://localhost:3000` | `http://localhost:3000` |
| `auth_token` | (empty) | (will be set after login) |
| `user_id` | (empty) | (will be set after creating user) |
| `event_id` | `1` | `1` |
| `ticket_type_id` | `1` | `1` |
| `order_number` | (empty) | (will be set after creating order) |
| `razorpay_order_id` | (empty) | (will be set after creating order) |

---

### Step 3: Test Requests (In Order)

#### ✅ Test 1: Health Check

**Request:**
```
GET {{base_url}}/
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Ultraa Events API Server Running"
}
```

---

#### ✅ Test 2: Create User

**Request:**
```
POST {{base_url}}/api/users
Content-Type: application/json

{
  "fullName": "Test User",
  "phoneNumber": "9876543210",
  "email": "test@example.com"
}
```

**Expected Response:** `200 OK`
- Copy `user.UserID` → Set as `user_id` environment variable

---

#### ✅ Test 3: Get All Events

**Request:**
```
GET {{base_url}}/api/events
```

**Expected Response:** `200 OK`
- Copy an `EventID` → Set as `event_id` environment variable
- Copy a `TicketTypeID` → Set as `ticket_type_id` environment variable

---

#### ✅ Test 4: Get Event Details

**Request:**
```
GET {{base_url}}/api/events/{{event_id}}
```

**Expected Response:** `200 OK`
- Verify ticket types are returned

---

#### ✅ Test 5: Create Order

**Request:**
```
POST {{base_url}}/api/orders/create
Content-Type: application/json

{
  "userId": {{user_id}},
  "eventId": {{event_id}},
  "ticketTypeId": {{ticket_type_id}},
  "email": "test@example.com"
}
```

**Expected Response:** `200 OK`
- Copy `order.OrderNumber` → Set as `order_number` environment variable
- Copy `razorpay.orderId` → Set as `razorpay_order_id` environment variable
- **Note:** Use `razorpay.orderId` and `razorpay.keyId` in frontend for Razorpay checkout

---

#### ✅ Test 6: Get Order Details

**Request:**
```
GET {{base_url}}/api/orders/{{order_number}}
```

**Expected Response:** `200 OK`
- Verify order status is `pending`

---

#### ✅ Test 7: Admin Login

**Request:**
```
POST {{base_url}}/api/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "Admin@123"
}
```

**Expected Response:** `200 OK`
- Copy `token` → Set as `auth_token` environment variable

---

#### ✅ Test 8: Verify Payment (After Razorpay Payment)

**Request:**
```
POST {{base_url}}/api/orders/verify
Content-Type: application/json

{
  "razorpay_order_id": "{{razorpay_order_id}}",
  "razorpay_payment_id": "pay_TEST123456789",
  "razorpay_signature": "test_signature_here"
}
```

**Note:** 
- In production, get real values from Razorpay payment response
- For testing, you can use Razorpay test cards and complete payment in frontend

**Expected Response:** `200 OK` (if signature is valid)
```json
{
  "success": true,
  "message": "Payment verified",
  "qrCode": "data:image/png;base64,..."
}
```

---

#### ✅ Test 9: Scan QR Code

**Request:**
```
POST {{base_url}}/api/scan
Content-Type: application/json

{
  "qrCode": "{\"orderNumber\":\"{{order_number}}\",\"orderId\":1,\"eventId\":{{event_id}},\"timestamp\":\"2025-01-15T10:30:00.000Z\"}",
  "scannedBy": "Test Scanner"
}
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "message": "Entry granted"
}
```

**Test Again:** Should return `400 Bad Request` with "Ticket already used"

---

#### ✅ Test 10: WhatsApp Webhook Verification

**Request:**
```
GET {{base_url}}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=ultraa_secure_token_123&hub.challenge=TEST_CHALLENGE
```

**Expected Response:** `200 OK` with body: `TEST_CHALLENGE`

---

## 🔄 Testing Workflow

### Complete End-to-End Flow:

1. **Start Server**
   ```bash
   node server.js
   ```

2. **Create User** → Get `user_id`

3. **Get Events** → Get `event_id` and `ticket_type_id`

4. **Create Order** → Get `razorpay_order_id`

5. **Complete Payment** (in frontend with Razorpay test card):
   - Card: `4111 1111 1111 1111`
   - CVV: `123`
   - Expiry: `12/25`

6. **Verify Payment** → Get `qrCode`

7. **Scan QR Code** → Validate entry

---

## ⚠️ Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "success": false,
  "message": "Missing required fields"
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "message": "Token required"
}
```

#### 403 Forbidden
```json
{
  "success": false,
  "message": "Invalid token"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "message": "Event not found"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Detailed error (only in development)"
}
```

---

## 📱 WhatsApp Integration

### Setup WhatsApp Webhook

1. **Get WhatsApp Credentials** from Meta Developer Dashboard
2. **Add to .env:**
   ```env
   WHATSAPP_PHONE_NUMBER_ID=123456789012345
   WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
   WHATSAPP_VERIFY_TOKEN=ultraa_secure_token_123
   ```

3. **Configure Webhook in Meta Dashboard:**
   - URL: `https://your-domain.com/webhook/whatsapp`
   - Verify Token: `ultraa_secure_token_123`
   - Subscribe to `messages` events

4. **Test:** Send a message to your WhatsApp Business number

### WhatsApp Chatbot Flow

1. User sends any message → Bot asks for name
2. User provides name → Bot shows main menu
3. User selects "View Events" → Bot shows event list
4. User selects event → Bot shows event details
5. User replies "YES" → Bot shows ticket types
6. User selects ticket → Bot asks for email
7. User provides email → Bot creates order and sends payment link

---

## 🔍 Troubleshooting

### SQL Connection Issues

**Error:** `SQL connection error`
- Check `.env` SQL credentials
- Verify SQL Server is accessible
- Check firewall rules
- See `SQL_SERVER_CONNECTION_GUIDE.md`

### Razorpay Issues

**Error:** `Authentication failed`
- Verify Razorpay keys in `.env`
- Ensure using test keys for testing
- Check Razorpay account is active

### WhatsApp Issues

**Error:** `WhatsApp send error`
- Verify credentials in `.env`
- Check phone number ID is correct
- Ensure access token is valid
- Verify webhook is configured in Meta Dashboard

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3000 | xargs kill -9
```

---

## 📚 Additional Resources

- **SQL Server Setup:** See `SQL_SERVER_CONNECTION_GUIDE.md`
- **Complete Setup Guide:** See `complete_setup_guide.md`
- **Database Schema:** See `create_table.sql`

---

## ✅ API Checklist

- [x] Health check endpoint
- [x] User creation/retrieval
- [x] Event listing and details
- [x] Order creation with Razorpay
- [x] Payment verification
- [x] QR code generation
- [x] QR code scanning
- [x] Admin authentication
- [x] WhatsApp webhook
- [x] Error handling
- [x] Database schema creation

---

## 🚀 Next Steps

1. **Test all endpoints** using Postman
2. **Set up frontend** to integrate with these APIs
3. **Configure WhatsApp** webhook in Meta Dashboard
4. **Deploy to production** (Railway, Render, etc.)
5. **Add admin dashboard** endpoints (if needed)

---

## 📞 Support

For issues or questions:
- Check error logs in console
- Review `complete_setup_guide.md`
- Verify `.env` configuration
- Test SQL connection separately

---

**Happy Testing! 🎉**

