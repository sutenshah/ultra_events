# 🚀 ULTRAA EVENTS - COMPLETE BACKEND SETUP GUIDE
## SQL Server + Razorpay + Meta WhatsApp Cloud API

---

## 📋 WHAT YOU HAVE

I've created 3 complete files for you:

1. **✅ Complete Backend Code** (`server.js`) - SQL Server + Razorpay + WhatsApp ready
2. **✅ SQL Database Setup Script** (`create_table.sql`)- Creates all tables and sample data
3. **✅ This Setup Guide** - Step-by-step instructions

---

## 🎯 PREREQUISITES CHECKLIST

Before starting, ensure you have:

### ✅ **Software Installed:**
- [ ] Node.js (v16 or higher) - Download from https://nodejs.org
- [ ] SQL Server (any version) or access to SQL Server instance
- [ ] SQL Server Management Studio (SSMS) - Optional but recommended
- [ ] VS Code or any code editor
- [ ] Git (optional) - For version control

### ✅ **Accounts Created:**
- [ ] Razorpay account (with test API keys)
- [ ] SQL Server with credentials
- [ ] Meta Developer account (for WhatsApp - add later)

### ✅ **Information Ready:**
- [ ] SQL Server connection string
- [ ] Razorpay Key ID
- [ ] Razorpay Key Secret

---

## 📂 STEP 1: PROJECT SETUP

### Create Project Folder

```bash
# Create project directory
mkdir ultraa-events-backend
cd ultraa-events-backend

# Initialize npm project
npm init -y
```

### Install Dependencies

```bash
npm install express mssql dotenv razorpay cors body-parser bcrypt jsonwebtoken qrcode uuid axios
```

**What each package does:**
- `express` - Web server framework
- `mssql` - SQL Server database connector
- `dotenv` - Environment variables manager
- `razorpay` - Payment gateway integration
- `cors` - Cross-origin resource sharing
- `body-parser` - Parse JSON requests
- `bcrypt` - Password hashing
- `jsonwebtoken` - Admin authentication tokens
- `qrcode` - Generate QR codes for tickets
- `uuid` - Generate unique IDs
- `axios` - HTTP client for WhatsApp API

---

## 🗄️ STEP 2: SQL SERVER DATABASE SETUP

### Option A: Using SQL Server Management Studio (SSMS)

1. **Open SSMS**
2. **Connect to your SQL Server**
3. **Click "New Query"**
4. **Copy the entire SQL setup script** (from artifact #2)
5. **Click "Execute" or press F5**
6. **Wait for success messages**

### Option B: Using Command Line

```bash
# If using sqlcmd
sqlcmd -S your_server -U your_username -P your_password -i setup.sql
```

### Option C: Using Azure Data Studio

1. Open Azure Data Studio
2. Connect to SQL Server
3. New Query → Paste SQL script
4. Run

### Verify Database Setup

Run this query to verify:

```sql
USE UltraaEvents;

SELECT 'Users' as TableName, COUNT(*) as RowCount FROM Users
UNION ALL
SELECT 'Events', COUNT(*) FROM Events
UNION ALL
SELECT 'TicketTypes', COUNT(*) FROM TicketTypes;
```

You should see:
- Users: 0 rows
- Events: 3 rows (sample events)
- TicketTypes: 18 rows (6 tickets × 3 events)

✅ **Database is ready!**

---

## ⚙️ STEP 3: CONFIGURATION (.env FILE)

### Create .env File

In your project folder, create a file named `.env`:

```bash
# In project root folder
touch .env  # Mac/Linux
# OR
type nul > .env  # Windows
```

### Fill in Your Credentials

Open `.env` and add:

```env
# ==========================================
# SQL SERVER CONFIGURATION
# ==========================================
SQL_SERVER=your_server_address.database.windows.net
SQL_DATABASE=UltraaEvents
SQL_USER=your_username
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=true

# ==========================================
# Example SQL Server Connection Strings:
# ==========================================
# Local SQL Server: localhost
# Azure SQL: yourserver.database.windows.net
# AWS RDS SQL Server: your-rds-endpoint.region.rds.amazonaws.com
# Network SQL Server: 192.168.1.100 or server-name

# ==========================================
# RAZORPAY CONFIGURATION
# ==========================================
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_secret_key

# Get these from: https://dashboard.razorpay.com/app/keys

# ==========================================
# WHATSAPP CONFIGURATION (Add later)
# ==========================================
WHATSAPP_PHONE_NUMBER_ID=add_later_when_ready
WHATSAPP_ACCESS_TOKEN=add_later_when_ready
WHATSAPP_VERIFY_TOKEN=ultraa_secure_token_123

# ==========================================
# SERVER CONFIGURATION
# ==========================================
PORT=3000
NODE_ENV=development

# ==========================================
# ADMIN CONFIGURATION
# ==========================================
# Change these for security!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@123
JWT_SECRET=ultraa_events_super_secret_key_change_this_in_production

# ==========================================
# FRONTEND URLS (for CORS)
# ==========================================
FRONTEND_URL=http://localhost:3001
ADMIN_URL=http://localhost:3002
```

### 🔐 **IMPORTANT SECURITY NOTES:**

1. **NEVER commit .env to Git**
   ```bash
   # Add .env to .gitignore
   echo ".env" >> .gitignore
   echo "node_modules/" >> .gitignore
   ```

2. **Change default passwords** before going to production

3. **Use strong JWT_SECRET** (at least 32 characters)

---

## 🔧 STEP 4: ADD BACKEND CODE

### Create server.js

1. **Copy the complete backend code** (from artifact #1)
2. **Save as `server.js`** in your project folder

### File Structure

Your folder should look like:

```
ultraa-events-backend/
├── node_modules/
├── .env
├── .gitignore
├── package.json
├── package-lock.json
└── server.js
```

---

## 🚀 STEP 5: RUN THE SERVER

### Start Server

```bash
node server.js
```

### Expected Output

```
✅ SQL Server Connected Successfully!
✅ Database tables created/verified successfully!
========================================
🚀 ULTRAA EVENTS API SERVER
========================================
✅ Server running on port 3000
✅ API: http://localhost:3000
✅ Webhook: http://localhost:3000/webhook/whatsapp
========================================
```

### Test API

Open browser and go to: http://localhost:3000

You should see:
```json
{
  "success": true,
  "message": "Ultraa Events API Server Running",
  "version": "1.0.0",
  "timestamp": "2025-12-06T..."
}
```

✅ **Server is running!**

---

## 🧪 STEP 6: TEST API ENDPOINTS

### Using Browser

1. **Get Events:**
   ```
   http://localhost:3000/api/events
   ```

2. **Get Specific Event:**
   ```
   http://localhost:3000/api/events/1
   ```

### Using Postman or Thunder Client

#### Test 1: Create User
```http
POST http://localhost:3000/api/users
Content-Type: application/json

{
  "fullName": "Rahul Sharma",
  "phoneNumber": "9876543210",
  "email": "rahul@example.com"
}
```

#### Test 2: Admin Login
```http
POST http://localhost:3000/api/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "Admin@123"
}
```

Save the `token` from response for next requests.

#### Test 3: Get Dashboard Stats (Requires Auth)
```http
GET http://localhost:3000/api/admin/stats
Authorization: Bearer YOUR_TOKEN_HERE
```

#### Test 4: Create Order
```http
POST http://localhost:3000/api/orders/create
Content-Type: application/json

{
  "userId": 1,
  "eventId": 1,
  "ticketTypeId": 1,
  "email": "customer@example.com"
}
```

---

## 💳 STEP 7: RAZORPAY INTEGRATION TEST

### Get Test API Keys

1. **Login to Razorpay Dashboard:** https://dashboard.razorpay.com
2. **Go to Settings → API Keys**
3. **Generate Test Keys**
   - Test Key ID: `rzp_test_xxxxxxxx`
   - Test Key Secret: `xxxxxxxxxxxxxxxx`
4. **Add to .env file**

### Test Payment Flow

1. **Create Order** (use Test 4 above)
2. **Get Razorpay order ID from response**
3. **Use Razorpay Test Cards:**
   ```
   Card Number: 4111 1111 1111 1111
   CVV: 123
   Expiry: 12/25
   ```

### Verify Payment

```http
POST http://localhost:3000/api/orders/verify
Content-Type: application/json

{
  "razorpay_order_id": "order_xxxxx",
  "razorpay_payment_id": "pay_xxxxx",
  "razorpay_signature": "signature_xxxxx"
}
```

---

## 📡 STEP 8: DEPLOY TO PRODUCTION

### Option A: Deploy to Railway.app

1. **Create Railway Account:** https://railway.app
2. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```
3. **Login:**
   ```bash
   railway login
   ```
4. **Deploy:**
   ```bash
   railway init
   railway up
   ```
5. **Add Environment Variables:**
   - Go to Railway Dashboard
   - Click your project → Variables
   - Add all .env variables

6. **Get Your URL:**
   - Railway provides: `https://your-app.railway.app`

### Option B: Deploy to Render.com

1. **Push code to GitHub**
2. **Go to Render.com → New → Web Service**
3. **Connect GitHub repository**
4. **Configure:**
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. **Add environment variables**
6. **Deploy**

### Option C: Deploy to Your Own Server

If you have VPS (DigitalOcean, AWS, etc.):

```bash
# Install PM2 (process manager)
npm install -g pm2

# Start server
pm2 start server.js --name ultraa-api

# Auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs ultraa-api
```

---

## 📱 STEP 9: ADD WHATSAPP API (When Ready)

Once you get Meta Developer approval:

### Update .env File

```env
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
WHATSAPP_VERIFY_TOKEN=ultraa_secure_token_123
```

### Configure Webhook in Meta

1. **Go to Meta Developers Dashboard**
2. **WhatsApp → Configuration**
3. **Webhook URL:** `https://your-app.railway.app/webhook/whatsapp`
4. **Verify Token:** `ultraa_secure_token_123`
5. **Click "Verify and Save"**

### Test WhatsApp

Send a message to your WhatsApp Business number. Check server logs:

```bash
# If using Railway
railway logs

# If using PM2
pm2 logs ultraa-api
```

You should see: `📱 WhatsApp message from...`

---

## 🔐 SECURITY CHECKLIST

Before going live:

- [ ] Change default admin password
- [ ] Use strong JWT_SECRET (32+ characters)
- [ ] Enable HTTPS (SSL certificate)
- [ ] Set NODE_ENV=production
- [ ] Enable SQL Server firewall
- [ ] Use Razorpay LIVE keys (not test)
- [ ] Add rate limiting (install `express-rate-limit`)
- [ ] Enable SQL connection encryption
- [ ] Regular database backups
- [ ] Monitor error logs

---

## 🐛 TROUBLESHOOTING

### Issue 1: Cannot Connect to SQL Server

**Error:** `Login failed for user`

**Solutions:**
1. Check SQL Server allows remote connections
2. Verify firewall allows port 1433
3. Check username/password correct
4. Enable SQL Server authentication (not just Windows)

**Test Connection:**
```bash
# Install SQL tools
npm install -g sql-cli

# Test connection
mssql -s your_server -u your_user -p your_password -d UltraaEvents -q "SELECT @@VERSION"
```

### Issue 2: Razorpay Order Creation Fails

**Error:** `Authentication failed`

**Solutions:**
1. Verify API keys are correct
2. Ensure you're using Test keys for testing
3. Check Razorpay account is activated
4. Amount should be in paise (multiply by 100)

### Issue 3: QR Code Not Generating

**Error:** `Cannot generate QR code`

**Solutions:**
1. Check `qrcode` package installed
2. Ensure order data is valid JSON
3. Check database allows large text (NVARCHAR(MAX))

### Issue 4: Admin Login Fails

**Error:** `Invalid credentials`

**Solutions:**
1. Check default credentials: admin / Admin@123
2. Verify AdminUsers table has data
3. Reset admin password:
   ```sql
   UPDATE AdminUsers 
   SET PasswordHash = '$2b$10$...' 
   WHERE Username = 'admin'
   ```

### Issue 5: Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`

**Solutions:**
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3000 | xargs kill -9

# Or change port in .env
PORT=3001
```

---

## 📊 API DOCUMENTATION

### Public Endpoints (No Auth Required)

#### 1. Get All Events
```http
GET /api/events
```

Response:
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
      ...
    }
  ]
}
```

#### 2. Get Event Details
```http
GET /api/events/:id
```

#### 3. Create/Get User
```http
POST /api/users
{
  "fullName": "John Doe",
  "phoneNumber": "9876543210",
  "email": "john@example.com"
}
```

#### 4. Create Order
```http
POST /api/orders/create
{
  "userId": 1,
  "eventId": 1,
  "ticketTypeId": 1,
  "email": "customer@example.com"
}
```

#### 5. Verify Payment
```http
POST /api/orders/verify
{
  "razorpay_order_id": "order_xxx",
  "razorpay_payment_id": "pay_xxx",
  "razorpay_signature": "signature_xxx"
}
```

#### 6. Scan QR Code
```http
POST /api/scan
{
  "qrCode": "{\"orderNumber\":\"UE123456\"}",
  "scannedBy": "Scanner Name"
}
```

### Admin Endpoints (Requires Auth Token)

#### 1. Admin Login
```http
POST /api/admin/login
{
  "username": "admin",
  "password": "Admin@123"
}
```

#### 2. Dashboard Stats
```http
GET /api/admin/stats
Authorization: Bearer <token>
```

#### 3. Get All Events (Admin)
```http
GET /api/admin/events
Authorization: Bearer <token>
```

#### 4. Create Event
```http
POST /api/admin/events
Authorization: Bearer <token>
{
  "eventName": "New Event",
  "eventDate": "2025-12-25",
  "eventTime": "19:00",
  "venue": "Venue Name",
  "description": "Event description"
}
```

#### 5. Add Ticket Type
```http
POST /api/admin/events/:eventId/tickets
Authorization: Bearer <token>
{
  "ticketName": "VIP Pass",
  "price": 5000,
  "totalQuantity": 100
}
```

#### 6. Get All Orders
```http
GET /api/admin/orders?status=completed&eventId=1&page=1&limit=50
Authorization: Bearer <token>
```

#### 7. Export Orders CSV
```http
GET /api/admin/orders/export?eventId=1
Authorization: Bearer <token>
```

---

## 📈 MONITORING & LOGS

### View Logs

```bash
# Railway
railway logs --tail

# PM2
pm2 logs ultraa-api --lines 100

# Or check file logs (if configured)
tail -f logs/app.log
```

### Key Things to Monitor

1. **SQL Connection:** Watch for connection errors
2. **Payment Success Rate:** Monitor Razorpay webhooks
3. **API Response Times:** Slow queries?
4. **Error Rate:** Any 500 errors?
5. **WhatsApp Delivery:** Messages being sent?

---

## 🎯 NEXT STEPS

Now that backend is running:

1. ✅ **Build Frontend** (React/Next.js)
   - Event listing page
   - Ticket booking flow
   - Payment integration
   - Ticket display with QR

2. ✅ **Build Admin Panel** (React)
   - Dashboard with stats
   - Event management
   - Order tracking
   - User management

3. ✅ **Build Scanner App** (Mobile)
   - React Native app
   - QR code scanner
   - Entry validation

4. ✅ **Add WhatsApp** (When approved)
   - Complete chatbot flow
   - Message templates
   - Notifications

---

## 📞 NEED HELP?

### Common Commands Reference

```bash
# Start server
node server.js

# Start with auto-reload (install nodemon first)
npm install -g nodemon
nodemon server.js

# Check if port is free
netstat -ano | findstr :3000  # Windows
lsof -i:3000  # Mac/Linux

# Test SQL connection
sqlcmd -S server -U user -P password -Q "SELECT @@VERSION"

# View environment variables
printenv  # Mac/Linux
set  # Windows
```

---

## ✅ SETUP COMPLETE!

Your backend is now:
- ✅ Connected to SQL Server
- ✅ Integrated with Razorpay
- ✅ Ready for WhatsApp (when you get API)
- ✅ Has admin authentication
- ✅ Generates QR codes
- ✅ Tracks orders and scans
- ✅ Production-ready

**Start building your frontend and mobile apps to complete the system!**

---

**Have questions? Let me know which step you need help with!** 🚀