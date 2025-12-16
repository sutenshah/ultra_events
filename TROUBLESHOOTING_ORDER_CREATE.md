# 🔧 Troubleshooting: Order Creation 500 Error

## Common Causes & Solutions

### 1. **Razorpay Credentials Missing**

**Error:** `Payment gateway not configured`

**Solution:**
1. Check your `.env` file has:
   ```env
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=your_secret_key
   ```
2. Verify keys are from Razorpay Dashboard → Settings → API Keys
3. Restart the server after adding credentials

**Test:**
```bash
# Check if environment variables are loaded
node -e "require('dotenv').config(); console.log('Key ID:', process.env.RAZORPAY_KEY_ID ? 'Set' : 'Missing');"
```

---

### 2. **Razorpay API Error**

**Error:** `Failed to create payment order`

**Possible Causes:**
- Invalid Razorpay keys
- Network connectivity issues
- Razorpay account not activated

**Solution:**
1. Verify keys in Razorpay Dashboard
2. Test keys are **Test Keys** (start with `rzp_test_`)
3. Check Razorpay account status
4. Try creating order directly via Razorpay API

**Test Razorpay Connection:**
```javascript
// Test script: test-razorpay.js
const Razorpay = require('razorpay');
require('dotenv').config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

razorpay.orders.create({
  amount: 50000,
  currency: 'INR',
  receipt: 'TEST123'
}).then(order => {
  console.log('✅ Razorpay working:', order.id);
}).catch(err => {
  console.error('❌ Razorpay error:', err.message);
});
```

Run: `node test-razorpay.js`

---

### 3. **Database Table Missing**

**Error:** `Invalid object name 'Orders'`

**Solution:**
1. Restart the server - tables are auto-created on startup
2. Check server logs for table creation messages
3. Manually run `create_table.sql` if needed

**Check Tables:**
```sql
-- Run in SQL Server Management Studio
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_TYPE = 'BASE TABLE';
```

---

### 4. **Email Column Missing (Old Database)** ⚠️ **COMMON ISSUE**

**Error:** `Invalid column name 'Email'`

This happens when the Orders table was created before the Email column was added to the schema.

**Solution Option 1: Restart Server (Auto-Migration)**
The server now automatically adds missing columns on startup. Simply:
```bash
# Stop server (Ctrl+C)
# Start again
node server.js
```

**Solution Option 2: Run Migration Script Manually**
1. Open SQL Server Management Studio
2. Connect to your database
3. Open `migrate_add_email_column.sql`
4. Execute the script

**Solution Option 3: Run SQL Command Directly**
```sql
USE UltraaEvents;
GO

-- Add Email column if it doesn't exist
IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('Orders') 
    AND name = 'Email'
)
BEGIN
    ALTER TABLE Orders ADD Email NVARCHAR(150) NULL;
    PRINT '✅ Email column added to Orders table';
END
GO
```

**Verify Column Exists:**
```sql
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Orders' AND COLUMN_NAME = 'Email';
```

---

### 5. **Foreign Key Constraint Error**

**Error:** `Foreign key constraint violation`

**Solution:**
1. Verify `userId` exists in Users table
2. Verify `eventId` exists in Events table
3. Verify `ticketTypeId` exists in TicketTypes table

**Check Data:**
```sql
-- Check if IDs exist
SELECT 'Users' AS TableName, COUNT(*) AS Count FROM Users
UNION ALL
SELECT 'Events', COUNT(*) FROM Events WHERE IsActive = 1
UNION ALL
SELECT 'TicketTypes', COUNT(*) FROM TicketTypes;
```

---

### 6. **Invalid Amount/Price**

**Error:** `Invalid ticket price`

**Solution:**
1. Verify ticket has a valid price
2. Check Price is not NULL
3. Ensure Price > 0

**Check Ticket:**
```sql
SELECT TicketTypeID, TicketName, Price, AvailableQuantity
FROM TicketTypes
WHERE TicketTypeID = 1; -- Replace with your ticket ID
```

---

## 🔍 Debugging Steps

### Step 1: Check Server Logs

Look at the terminal output when you make the request. You should see:
```
❌ Order creation error: [error message]
```

This will tell you exactly what failed.

### Step 2: Test Each Component

**Test 1: Health Check**
```bash
curl http://localhost:3000/
```

**Test 2: Get Events**
```bash
curl http://localhost:3000/api/events
```

**Test 3: Create User**
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test","phoneNumber":"9876543210"}'
```

**Test 4: Create Order (This is where it fails)**
```bash
curl -X POST http://localhost:3000/api/orders/create \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"eventId":1,"ticketTypeId":1,"email":"test@example.com"}'
```

### Step 3: Check Request Body

Ensure your request has:
```json
{
  "userId": 1,        // Must be integer, must exist in Users table
  "eventId": 1,      // Must be integer, must exist in Events table
  "ticketTypeId": 1, // Must be integer, must exist in TicketTypes table
  "email": "test@example.com" // Optional
}
```

### Step 4: Verify Database Connection

Check server startup logs:
```
✅ SQL Server connected
✅ Tables verified/created
```

If you don't see these, database connection failed.

---

## 🛠️ Quick Fixes

### Fix 1: Restart Server
```bash
# Stop server (Ctrl+C)
# Start again
node server.js
```

### Fix 2: Check .env File
```bash
# Windows PowerShell
Get-Content .env

# Mac/Linux
cat .env
```

### Fix 3: Verify Razorpay Keys
1. Go to https://dashboard.razorpay.com
2. Settings → API Keys
3. Copy Test Key ID and Secret
4. Update `.env` file
5. Restart server

### Fix 4: Recreate Tables
```sql
-- Drop and recreate (WARNING: Deletes all data)
DROP TABLE IF EXISTS Orders;
DROP TABLE IF EXISTS TicketTypes;
DROP TABLE IF EXISTS Events;
DROP TABLE IF EXISTS Users;

-- Then restart server to auto-create tables
```

---

## 📝 Common Error Messages

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `Payment gateway not configured` | Missing Razorpay keys | Add to .env |
| `Failed to create payment order` | Invalid Razorpay keys | Verify keys in dashboard |
| `Ticket type not found` | Invalid ticketTypeId | Use valid ticket ID |
| `Tickets sold out` | AvailableQuantity = 0 | Use different ticket |
| `Invalid ticket price` | Price is NULL or 0 | Check ticket data |
| `Foreign key constraint` | Invalid userId/eventId | Verify IDs exist |
| `Invalid object name 'Orders'` | Table doesn't exist | Restart server |

---

## ✅ Verification Checklist

Before testing order creation:

- [ ] Server is running (`node server.js`)
- [ ] Database connected (see ✅ SQL Server connected)
- [ ] Tables created (see ✅ Tables verified/created)
- [ ] Razorpay keys in `.env` file
- [ ] At least one user exists (UserID = 1)
- [ ] At least one active event exists (EventID = 1)
- [ ] At least one ticket type exists (TicketTypeID = 1)
- [ ] Ticket has available quantity > 0
- [ ] Ticket has valid price > 0

---

## 🆘 Still Not Working?

1. **Check full error in terminal** - Look for the complete error stack trace
2. **Enable detailed logging** - Set `NODE_ENV=development` in `.env`
3. **Test Razorpay separately** - Use the test script above
4. **Check database directly** - Verify data exists using SQL queries

**Share the complete error message from terminal for further help!**

