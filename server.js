// ============================================================
// ULTRAA EVENTS - BACKEND (SQL Server + Razorpay + WhatsApp Bot)
// Complete server setup with chatbot flow and robust lifecycle
// ============================================================

'use strict';

const express = require('express');
const sql = require('mssql');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

// ------------------------------------------------------------
// App & Middleware
// ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


//--------------------------------SUTEN TRIAL STARTS HERE--------------------------------

//const axios = require('axios');

// Phone number formatting function (optimized for Indian numbers)
// Handles all Indian number formats: 9876543210, 919876543210, +919876543210, 09876543210
// WhatsApp webhooks typically send numbers with country code already included
function formatPhoneNumber(phone) {
  if (!phone) return null;
  
  // Remove all non-digits (removes +, spaces, dashes, etc.)
  let digits = `${phone}`.replace(/\D/g, '');
  
  // Remove leading 0 if present (Indian numbers sometimes have leading 0: 09876543210)
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  
  // Handle different input formats for Indian numbers
  if (digits.length === 10) {
    // Format: 9876543210 (10 digits without country code)
    // Add India country code 91
    digits = `91${digits}`;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    // Format: 919876543210 (12 digits with country code) - Perfect!
    // Keep as is
  } else if (digits.length === 11) {
    // Format: 91987654321 (11 digits) - might be missing last digit or has extra
    // Or: 09876543210 (11 digits with leading 0) - already removed above
    if (digits.startsWith('91')) {
      // Has 91 but wrong length, take first 12 or pad
      if (digits.length < 12) {
        // Missing digit, this shouldn't happen but handle gracefully
        console.warn(`⚠️ Phone number has 11 digits with 91: ${digits}`);
      }
      // Try to extract valid 10-digit number after 91
      const numberPart = digits.substring(2); // Remove '91'
      if (numberPart.length === 9) {
        // Missing one digit, this is invalid
        console.error(`❌ Invalid Indian phone number: missing digit`);
        return null;
      }
    } else {
      // 11 digits without 91, remove first digit (likely a 0 that wasn't stripped)
      digits = `91${digits.substring(1)}`;
    }
  } else if (digits.length > 12) {
    // Too many digits - extract valid Indian number
    if (digits.startsWith('91')) {
      // Take first 12 digits (91 + 10 digits)
      digits = digits.substring(0, 12);
    } else {
      // Look for 91 followed by 10 digits in the string
      const match = digits.match(/91\d{10}/);
      if (match) {
        digits = match[0];
      } else {
        // Fallback: take last 10 digits and add 91
        digits = `91${digits.slice(-10)}`;
      }
    }
  } else if (digits.length < 10) {
    // Too few digits - invalid
    console.error(`❌ Invalid phone number: too short (${digits.length} digits)`);
    return null;
  }
  
  // Final validation: Indian numbers must be exactly 12 digits starting with 91
  if (digits.length !== 12 || !digits.startsWith('91')) {
    console.error(`❌ Invalid Indian phone number format: ${digits} (length: ${digits.length})`);
    return null;
  }
  
  // WhatsApp API requires + prefix
  // Return format: +919876543210
  return `+${digits}`;
}

// Send WhatsApp Message Function
async function sendWhatsAppMessage(to, message) {
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.log('⚠️ WhatsApp credentials not configured');
    return;
  }
  
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  
  // Format phone number with + prefix (required by WhatsApp API)
  const formattedTo = formatPhoneNumber(to);
  if (!formattedTo) {
    console.error('❌ Invalid phone number:', to);
    return;
  }
  
  try {
    const response = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo, // Format: +919876543210 (with + prefix)
      type: 'text',
      text: {
        preview_url: false,
        body: message
      }
    }, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Message sent successfully:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('❌ Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

// Export for use in other files
module.exports = { sendWhatsAppMessage };



// Test route to send message
app.get('/test-whatsapp', async (req, res) => {
  try {
    // Replace with YOUR phone number
    await sendWhatsAppMessage('919422750728', 'Hello from Ultraa Events! 🎉 This is a test message from our API.');
    
    res.json({ success: true, message: 'WhatsApp message sent! Check your phone.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



//--------------------------------SUTEN TRIAL ENDS HERE--------------------------------

// ------------------------------------------------------------
// SQL Server Connection
// Supports both connection string and individual parameters
// ------------------------------------------------------------
let sqlConfig;

// Option 1: Use connection string if provided
if (process.env.SQL_CONNECTION_STRING) {
  // Parse connection string format: "Server=...;Database=...;User Id=...;Password=...;Port=..."
  const connStr = process.env.SQL_CONNECTION_STRING;
  sqlConfig = {
    connectionString: connStr,
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true' || connStr.includes('Encrypt=True'),
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
} else {
  // Option 2: Use individual parameters (recommended)
  sqlConfig = {
    server: process.env.SQL_SERVER || process.env.SQL_DATA_SOURCE,
    database: process.env.SQL_DATABASE || process.env.SQL_INITIAL_CATALOG,
    user: process.env.SQL_USER || process.env.SQL_USER_ID,
    password: process.env.SQL_PASSWORD,
    port: parseInt(process.env.SQL_PORT || '1433', 10),
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE !== 'false',
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

let pool;

async function connectDB() {
  try {
    pool = await sql.connect(sqlConfig);
    console.log('✅ SQL Server connected');
    await createTables();
  } catch (err) {
    console.error('❌ SQL connection error:', err.message);
    process.exit(1);
  }
}

// ------------------------------------------------------------
// Razorpay
// ------------------------------------------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
// formatPhoneNumber is defined at the top of the file

function generateOrderNumber() {
  return `UE${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function generateQRCode(data) {
  try {
    return await QRCode.toDataURL(data);
  } catch (err) {
    console.error('QR generation failed:', err.message);
    return null;
  }
}

function logStartup(port) {
  console.log('========================================');
  console.log('🚀 ULTRAA EVENTS API SERVER');
  console.log('========================================');
  console.log(`✅ Server: http://localhost:${port}`);
  console.log(`✅ Health: GET /`);
  console.log(`✅ Events: GET /api/events`);
  console.log(`✅ Event:  GET /api/events/:id`);
  console.log(`✅ Users:  POST /api/users`);
  console.log(`✅ Orders: POST /api/orders/create`);
  console.log(`✅ Verify: POST /api/orders/verify`);
  console.log(`✅ Scan:   POST /api/scan`);
  console.log(`✅ Webhook: GET/POST /webhook/whatsapp`);
  console.log('========================================');
}

// ------------------------------------------------------------
// Auth Middleware (Admin)
// ------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ------------------------------------------------------------
// WhatsApp Send Helpers (stubbed to console until creds added)
// ------------------------------------------------------------
async function sendWhatsAppMessage(phoneNumber, message) {
  // Validate phone number first
  if (!phoneNumber) {
    console.error('❌ sendWhatsAppMessage called with no phone number');
    return;
  }

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.log('⚠️ WhatsApp credentials not configured');
    return; // skip API when creds absent
  }

  // Format phone number with + prefix (required by WhatsApp API)
  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    console.error(`❌ Invalid phone number format: ${phoneNumber}`);
    console.error(`   Input type: ${typeof phoneNumber}, length: ${phoneNumber?.length}`);
    return;
  }

  // Log both original and formatted for debugging
  if (phoneNumber !== formattedPhone.replace('+', '')) {
    console.log(`📤 WhatsApp → ${phoneNumber} → ${formattedPhone}: ${message.substring(0, 50)}...`);
  } else {
    console.log(`📤 WhatsApp → ${formattedPhone}: ${message.substring(0, 50)}...`);
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone, // Use formatted number with + prefix
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    console.log('✅ Message sent successfully');
    return response.data;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    // Don't throw, just log the error
  }
}

async function sendButtonMessage(phoneNumber, bodyText, buttons) {
  console.log(`📤 WhatsApp buttons → ${phoneNumber}: ${bodyText}`);
  // Add API call when templates are approved
}

async function sendListMessage(phoneNumber, bodyText, buttonText, sections) {
  console.log(`📤 WhatsApp list → ${phoneNumber}: ${bodyText}`);
  // Add API call when templates are approved
}

// ------------------------------------------------------------
// Chatbot Flow
// ------------------------------------------------------------
async function updateConversationState(phoneNumber, step, data) {
  if (!phoneNumber) {
    console.error('❌ updateConversationState called with no phone number');
    return;
  }
  
  // Format phone number for database (store without + for consistency)
  const phoneForDB = phoneNumber.replace(/^\+/, ''); // Remove + if present for DB storage
  
  const request = pool.request();
  await request
    .input('phone', sql.NVarChar, phoneForDB)
    .input('step', sql.NVarChar, step)
    .input('data', sql.NVarChar, JSON.stringify(data || {}))
    .query(`
      MERGE ConversationState AS target
      USING (SELECT @phone AS PhoneNumber) AS src
      ON target.PhoneNumber = src.PhoneNumber
      WHEN MATCHED THEN
        UPDATE SET CurrentStep = @step, StateData = @data, LastInteraction = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (PhoneNumber, CurrentStep, StateData)
        VALUES (@phone, @step, @data);
    `);
}

async function handleWelcomeStep(phoneNumber) {
  await sendWhatsAppMessage(
    phoneNumber,
    'Hello! Welcome to Ultraa Events 🎉\nPlease share your full name to continue.',
  );
  await updateConversationState(phoneNumber, 'awaiting_name', {});
}

async function handleNameStep(phoneNumber, messageText, stateData) {
  const name = messageText.trim();
  if (!name || name.length < 2) {
    await sendWhatsAppMessage(phoneNumber, 'Please enter a valid name.');
    return;
  }

  // Format phone for database (without +)
  const phoneForDB = phoneNumber.replace(/^\+/, '');
  // Format phone for WhatsApp API (with +)
  const formattedPhoneForAPI = formatPhoneNumber(phoneNumber);
  
  await pool
    .request()
    .input('name', sql.NVarChar, name)
    .input('phone', sql.NVarChar, phoneForDB)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM Users WHERE PhoneNumber = @phone)
        INSERT INTO Users (FullName, PhoneNumber) VALUES (@name, @phone)
      ELSE
        UPDATE Users SET FullName = @name WHERE PhoneNumber = @phone;
    `);

  stateData.name = name;
  await sendButtonMessage(phoneNumber, `Great to meet you, ${name}!`, [
    { id: 'view_events', title: '🎉 View Events' },
    { id: 'support', title: '💬 Support' },
  ]);
  await updateConversationState(phoneNumber, 'main_menu', stateData);
}

async function handleMainMenu(phoneNumber, messageText, stateData) {
  const lower = messageText.toLowerCase();

  if (lower === 'view_events' || lower.includes('event')) {
    const events = await pool
      .request()
      .query(`
        SELECT TOP 10 * FROM Events 
        WHERE IsActive = 1 AND EventDate >= CAST(GETDATE() AS DATE)
        ORDER BY EventDate ASC;
      `);

    if (events.recordset.length === 0) {
      await sendWhatsAppMessage(phoneNumber, 'No upcoming events right now. Check back soon!');
      return;
    }

    stateData.events = events.recordset;
    const sections = [
      {
        title: 'Upcoming Events',
        rows: events.recordset.map((e) => ({
          id: `event_${e.EventID}`,
          title: e.EventName.substring(0, 20),
          description: `${new Date(e.EventDate).toLocaleDateString()} • ${e.Venue.substring(0, 35)}`,
        })),
      },
    ];

    await sendListMessage(phoneNumber, 'Choose an event to view details.', 'Select', sections);
    await updateConversationState(phoneNumber, 'viewing_events', stateData);
    return;
  }

  if (lower === 'support') {
    await sendWhatsAppMessage(
      phoneNumber,
      '📞 Support\nEmail: support@ultraaevents.com\nPhone: +91 98765 43210\nHours: 9 AM - 9 PM (Mon-Sat)',
    );
    return;
  }

  await sendWhatsAppMessage(phoneNumber, "Type 'View Events' to browse or 'Support' for help.");
}

async function handleEventSelection(phoneNumber, messageText, stateData) {
  let eventId;
  if (messageText.startsWith('event_')) {
    eventId = parseInt(messageText.replace('event_', ''), 10);
  } else {
    const idx = parseInt(messageText, 10) - 1;
    if (!Number.isNaN(idx) && stateData.events?.[idx]) {
      eventId = stateData.events[idx].EventID;
    }
  }

  if (!eventId) {
    await sendWhatsAppMessage(phoneNumber, 'Invalid selection. Please pick a valid event.');
    return;
  }

  const eventResult = await pool
    .request()
    .input('eventId', sql.Int, eventId)
    .query('SELECT * FROM Events WHERE EventID = @eventId AND IsActive = 1;');

  const ticketResult = await pool
    .request()
    .input('eventId', sql.Int, eventId)
    .query('SELECT * FROM TicketTypes WHERE EventID = @eventId ORDER BY Price ASC;');

  const event = eventResult.recordset[0];
  if (!event) {
    await sendWhatsAppMessage(phoneNumber, 'Event not found.');
    return;
  }

  stateData.selectedEventId = eventId;
  stateData.tickets = ticketResult.recordset;

  const details =
    `🎉 ${event.EventName}\n` +
    `📅 ${event.EventDate}  ⏰ ${event.EventTime}\n` +
    `📍 ${event.Venue}\n\n` +
    `${event.Description || ''}\n\n` +
    "Reply 'YES' to see tickets or 'BACK' to main menu.";

  await sendWhatsAppMessage(phoneNumber, details);
  await updateConversationState(phoneNumber, 'viewing_event_details', stateData);
}

async function handleEventDetails(phoneNumber, messageText, stateData) {
  const lower = messageText.toLowerCase();

  if (lower === 'yes' || lower === 'buy' || lower === 'purchase') {
    if (!stateData.tickets?.length) {
      await sendWhatsAppMessage(phoneNumber, 'Tickets are not available for this event.');
      return;
    }

    let msg = 'Select your ticket type:\n\n';
    stateData.tickets.forEach((t, i) => {
      msg += `${i + 1}. ${t.TicketName} - ₹${t.Price} (${t.AvailableQuantity} left)\n`;
    });
    msg += "\nReply with the ticket number.";

    await sendWhatsAppMessage(phoneNumber, msg);
    await updateConversationState(phoneNumber, 'selecting_ticket', stateData);
    return;
  }

  if (lower === 'back') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }

  await sendWhatsAppMessage(phoneNumber, "Please reply 'YES' to continue or 'BACK' to go back.");
}

async function handleTicketSelection(phoneNumber, messageText, stateData) {
  const idx = parseInt(messageText, 10) - 1;
  if (Number.isNaN(idx) || !stateData.tickets?.[idx]) {
    await sendWhatsAppMessage(phoneNumber, 'Invalid ticket choice. Please try again.');
    return;
  }

  const ticket = stateData.tickets[idx];
  stateData.selectedTicketId = ticket.TicketTypeID;
  stateData.selectedTicketPrice = ticket.Price;

  await sendWhatsAppMessage(
    phoneNumber,
    `You selected ${ticket.TicketName} - ₹${ticket.Price}\nPlease share your email to receive the ticket.`,
  );
  await updateConversationState(phoneNumber, 'awaiting_email', stateData);
}

async function handleEmailStep(phoneNumber, messageText, stateData) {
  const email = messageText.trim();
  if (!email.includes('@')) {
    await sendWhatsAppMessage(phoneNumber, 'Please provide a valid email address.');
    return;
  }

  // Format phone for database (without +)
  const phoneForDB = phoneNumber.replace(/^\+/, '');
  const userResult = await pool
    .request()
    .input('phone', sql.NVarChar, phoneForDB)
    .query('SELECT UserID FROM Users WHERE PhoneNumber = @phone;');

  if (!userResult.recordset.length) {
    await sendWhatsAppMessage(phoneNumber, "User not found. Please type 'START' to restart.");
    return;
  }

  const userId = userResult.recordset[0].UserID;
  const orderNumber = generateOrderNumber();
  const amount = stateData.selectedTicketPrice;

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: orderNumber,
  });

  await pool
    .request()
    .input('orderNumber', sql.NVarChar, orderNumber)
    .input('userId', sql.Int, userId)
    .input('eventId', sql.Int, stateData.selectedEventId)
    .input('ticketTypeId', sql.Int, stateData.selectedTicketId)
    .input('razorpayOrderId', sql.NVarChar, razorpayOrder.id)
    .input('amount', sql.Decimal(10, 2), amount)
    .input('email', sql.NVarChar, email)
    .query(`
      INSERT INTO Orders (OrderNumber, UserID, EventID, TicketTypeID, RazorpayOrderID, Amount, Status)
      VALUES (@orderNumber, @userId, @eventId, @ticketTypeId, @razorpayOrderId, @amount, 'pending');
    `);

  const paymentLink = `https://your-frontend.com/payment?orderId=${razorpayOrder.id}`;
  await sendWhatsAppMessage(
    phoneNumber,
    `Order: ${orderNumber}\nAmount: ₹${amount}\nPay securely: ${paymentLink}`,
  );

  await updateConversationState(phoneNumber, 'main_menu', {});
}

async function processWhatsAppMessage(phoneNumber, messageText, messageObj) {
  try {
    // Validate phone number - CRITICAL: Must exist and be valid
    if (!phoneNumber || phoneNumber === 'undefined' || phoneNumber.trim() === '') {
      console.error('❌ processWhatsAppMessage called with invalid phone number:', phoneNumber);
      console.error('Message object:', JSON.stringify(messageObj, null, 2));
      return; // Don't process if phone number is invalid
    }

    // Additional validation: phone number should be numeric (after removing +)
    const phoneDigits = phoneNumber.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      console.error('❌ Phone number too short:', phoneNumber);
      return;
    }

    // Interactive replies overwrite messageText
    if (messageObj?.type === 'interactive') {
      if (messageObj.interactive?.button_reply) messageText = messageObj.interactive.button_reply.id;
      if (messageObj.interactive?.list_reply) messageText = messageObj.interactive.list_reply.id;
    }

    // Format phone number for database (store without + for consistency)
    const phoneForDB = phoneNumber.replace(/^\+/, ''); // Remove + if present for DB storage

    const stateResult = await pool
      .request()
      .input('phone', sql.NVarChar, phoneForDB)
      .query('SELECT * FROM ConversationState WHERE PhoneNumber = @phone;');

    let currentStep = 'welcome';
    let stateData = {};

    if (stateResult.recordset.length) {
      currentStep = stateResult.recordset[0].CurrentStep || 'welcome';
      stateData = stateResult.recordset[0].StateData ? JSON.parse(stateResult.recordset[0].StateData) : {};
    }

    switch (currentStep) {
      case 'welcome':
        await handleWelcomeStep(phoneNumber);
        break;
      case 'awaiting_name':
        await handleNameStep(phoneNumber, messageText, stateData);
        break;
      case 'main_menu':
        await handleMainMenu(phoneNumber, messageText, stateData);
        break;
      case 'viewing_events':
        await handleEventSelection(phoneNumber, messageText, stateData);
        break;
      case 'viewing_event_details':
        await handleEventDetails(phoneNumber, messageText, stateData);
        break;
      case 'selecting_ticket':
        await handleTicketSelection(phoneNumber, messageText, stateData);
        break;
      case 'awaiting_email':
        await handleEmailStep(phoneNumber, messageText, stateData);
        break;
      default:
        if (['start', 'menu'].includes(messageText.toLowerCase())) {
          await handleWelcomeStep(phoneNumber);
        } else {
          await sendWhatsAppMessage(phoneNumber, "I didn't understand that. Type 'START' to begin.");
        }
    }
  } catch (err) {
    console.error('Chatbot error:', err.message);
    await sendWhatsAppMessage(phoneNumber, 'Something went wrong. Please type START to retry.');
  }
}

// ------------------------------------------------------------
// Routes - Health & Core APIs
// ------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Ultraa Events API Server Running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Users
app.post('/api/users', async (req, res, next) => {
  try {
    const { fullName, phoneNumber, email } = req.body;
    if (!fullName || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'Name and phone required' });
    }

    // Format phone for database (without +)
    const phoneForDB = phoneNumber.replace(/\D/g, ''); // Remove all non-digits
    const phoneForDBWithCountry = phoneForDB.startsWith('91') ? phoneForDB : `91${phoneForDB}`;
    
    const existing = await pool
      .request()
      .input('phone', sql.NVarChar, phoneForDBWithCountry)
      .query('SELECT TOP 1 * FROM Users WHERE PhoneNumber = @phone;');

    if (existing.recordset.length) {
      return res.json({ success: true, user: existing.recordset[0], isNew: false });
    }

    const result = await pool
      .request()
      .input('name', sql.NVarChar, fullName)
      .input('phone', sql.NVarChar, phoneForDBWithCountry)
      .input('email', sql.NVarChar, email || null)
      .query(`
        INSERT INTO Users (FullName, PhoneNumber, Email)
        OUTPUT INSERTED.*
        VALUES (@name, @phone, @email);
      `);

    res.json({ success: true, user: result.recordset[0], isNew: true });
  } catch (err) {
    next(err);
  }
});

// Events
app.get('/api/events', async (_req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT 
        e.*,
        COUNT(DISTINCT tt.TicketTypeID) AS TicketTypesCount,
        SUM(tt.AvailableQuantity) AS TotalAvailable
      FROM Events e
      LEFT JOIN TicketTypes tt ON e.EventID = tt.EventID
      WHERE e.IsActive = 1
      GROUP BY e.EventID, e.EventName, e.EventDate, e.EventTime, e.Venue,
               e.Description, e.ImageURL, e.IsActive, e.CreatedAt, e.UpdatedAt
      ORDER BY e.EventDate ASC;
    `);
    res.json({ success: true, events: result.recordset });
  } catch (err) {
    next(err);
  }
});

app.get('/api/events/:id', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    const event = await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query('SELECT * FROM Events WHERE EventID = @eventId AND IsActive = 1;');

    if (!event.recordset.length) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const tickets = await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query('SELECT * FROM TicketTypes WHERE EventID = @eventId ORDER BY Price ASC;');

    res.json({ success: true, event: event.recordset[0], ticketTypes: tickets.recordset });
  } catch (err) {
    next(err);
  }
});

// Orders
app.post('/api/orders/create', async (req, res, next) => {
  try {
    const { userId, eventId, ticketTypeId, email } = req.body;
    if (!userId || !eventId || !ticketTypeId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Validate Razorpay credentials
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('❌ Razorpay credentials missing in .env file');
      return res.status(500).json({ 
        success: false, 
        message: 'Payment gateway not configured. Please add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env file' 
      });
    }

    const ticket = await pool
      .request()
      .input('ticketTypeId', sql.Int, ticketTypeId)
      .query('SELECT * FROM TicketTypes WHERE TicketTypeID = @ticketTypeId;');

    if (!ticket.recordset.length) {
      return res.status(404).json({ success: false, message: 'Ticket type not found' });
    }
    if (ticket.recordset[0].AvailableQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Tickets sold out' });
    }

    const amount = parseFloat(ticket.recordset[0].Price);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid ticket price' });
    }

    const orderNumber = generateOrderNumber();
    
    // Create Razorpay order
    let razorpayOrder;
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR',
        receipt: orderNumber,
        notes: { eventId, userId, ticketTypeId },
      });
    } catch (razorpayError) {
      console.error('❌ Razorpay order creation failed:', razorpayError);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create payment order',
        error: process.env.NODE_ENV === 'development' ? razorpayError.message : undefined
      });
    }

    // Insert order into database
    const order = await pool
      .request()
      .input('orderNumber', sql.NVarChar, orderNumber)
      .input('userId', sql.Int, userId)
      .input('eventId', sql.Int, eventId)
      .input('ticketTypeId', sql.Int, ticketTypeId)
      .input('razorpayOrderId', sql.NVarChar, razorpayOrder.id)
      .input('amount', sql.Decimal(10, 2), amount)
      .input('email', sql.NVarChar, email || null)
      .query(`
        INSERT INTO Orders (OrderNumber, UserID, EventID, TicketTypeID, RazorpayOrderID, Amount, Status, Email)
        OUTPUT INSERTED.*
        VALUES (@orderNumber, @userId, @eventId, @ticketTypeId, @razorpayOrderId, @amount, 'pending', @email);
      `);

    res.json({
      success: true,
      order: order.recordset[0],
      razorpay: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    console.error('❌ Order creation error:', err);
    next(err);
  }
});

app.post('/api/orders/verify', async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(text).digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    const orderResult = await pool
      .request()
      .input('razorpayOrderId', sql.NVarChar, razorpay_order_id)
      .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId;');

    if (!orderResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orderResult.recordset[0];
    const qrData = JSON.stringify({
      orderNumber: order.OrderNumber,
      orderId: order.OrderID,
      eventId: order.EventID,
      timestamp: new Date().toISOString(),
    });
    const qrCode = await generateQRCode(qrData);

    await pool
      .request()
      .input('orderId', sql.Int, order.OrderID)
      .input('paymentId', sql.NVarChar, razorpay_payment_id)
      .input('qrCode', sql.NVarChar, qrCode)
      .query(`
        UPDATE Orders
        SET Status = 'completed',
            RazorpayPaymentID = @paymentId,
            QRCode = @qrCode,
            UpdatedAt = GETDATE()
        WHERE OrderID = @orderId;
      `);

    await pool
      .request()
      .input('ticketTypeId', sql.Int, order.TicketTypeID)
      .query('UPDATE TicketTypes SET AvailableQuantity = AvailableQuantity - 1 WHERE TicketTypeID = @ticketTypeId;');

    res.json({ success: true, message: 'Payment verified', qrCode });
  } catch (err) {
    next(err);
  }
});

app.get('/api/orders/:orderNumber', async (req, res, next) => {
  try {
    const order = await pool
      .request()
      .input('orderNumber', sql.NVarChar, req.params.orderNumber)
      .query(`
        SELECT o.*, u.FullName, u.PhoneNumber, u.Email, e.EventName, e.EventDate, e.EventTime, e.Venue, tt.TicketName
        FROM Orders o
        JOIN Users u ON o.UserID = u.UserID
        JOIN Events e ON o.EventID = e.EventID
        JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
        WHERE o.OrderNumber = @orderNumber;
      `);

    if (!order.recordset.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, order: order.recordset[0] });
  } catch (err) {
    next(err);
  }
});

// Scan ticket (entry)
app.post('/api/scan', async (req, res, next) => {
  try {
    const { qrCode, scannedBy } = req.body;
    if (!qrCode) return res.status(400).json({ success: false, message: 'QR code required' });

    let data;
    try {
      data = JSON.parse(qrCode);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid QR format' });
    }

    const orderResult = await pool
      .request()
      .input('orderNumber', sql.NVarChar, data.orderNumber)
      .query(`
        SELECT 
          o.*, u.FullName, u.PhoneNumber, e.EventName, e.EventDate, tt.TicketName
        FROM Orders o
        JOIN Users u ON o.UserID = u.UserID
        JOIN Events e ON o.EventID = e.EventID
        JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
        WHERE o.OrderNumber = @orderNumber;
      `);

    if (!orderResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Ticket invalid' });
    }

    const order = orderResult.recordset[0];
    if (order.IsScanned) {
      return res.status(400).json({ success: false, message: 'Ticket already used', scannedAt: order.ScannedAt });
    }
    if (order.Status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    await pool
      .request()
      .input('orderId', sql.Int, order.OrderID)
      .input('scannedBy', sql.NVarChar, scannedBy || 'Scanner')
      .query(`
        UPDATE Orders
        SET IsScanned = 1, ScannedAt = GETDATE(), ScannedBy = @scannedBy
        WHERE OrderID = @orderId;
      `);

    res.json({
      success: true,
      message: 'Entry granted',
      details: {
        userName: order.FullName,
        phoneNumber: order.PhoneNumber,
        eventName: order.EventName,
        ticketType: order.TicketName,
        orderNumber: order.OrderNumber,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Admin login (basic)
app.post('/api/admin/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    const adminResult = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .query('SELECT TOP 1 * FROM AdminUsers WHERE Username = @username AND IsActive = 1;');

    if (!adminResult.recordset.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const admin = adminResult.recordset[0];
    const valid = await bcrypt.compare(password, admin.PasswordHash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ adminId: admin.AdminID, role: admin.Role }, process.env.JWT_SECRET, {
      expiresIn: '24h',
    });

    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// WhatsApp Webhook
// ------------------------------------------------------------
app.get('/webhook/whatsapp', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'ultraa_secure_token_123';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  console.log('❌ WhatsApp webhook verification failed');
  return res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // immediately acknowledge

  try {
    const body = req.body;
    
    // Handle different webhook event types
    const entry = body?.entry?.[0];
    if (!entry) {
      console.log('⚠️ No entry in webhook payload');
      return;
    }

    const changes = entry.changes?.[0];
    if (!changes) {
      console.log('⚠️ No changes in webhook entry');
      return;
    }

    const value = changes.value;
    if (!value) {
      console.log('⚠️ No value in webhook changes');
      return;
    }
    
    // Check if this is a message (not a status update)
    const message = value?.messages?.[0];
    
    if (message) {
      // This is an incoming message
      // WhatsApp sends phone numbers with country code (e.g., "919876543210" or "+919876543210")
      const from = message.from;
      
      // CRITICAL: Validate that 'from' field exists and is not empty
      if (!from || from === 'undefined' || from.trim() === '') {
        console.error('❌ Invalid or missing phone number in message');
        console.error('Message object:', JSON.stringify(message, null, 2));
        console.error('Full webhook payload:', JSON.stringify(body, null, 2));
        return; // Don't process if no valid phone number
      }
      
      const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
      
      // Log the raw phone number format from WhatsApp
      console.log(`📱 Incoming WhatsApp from ${from}: ${text}`);
      
      // Process the message - formatPhoneNumber will handle the conversion
      await processWhatsAppMessage(from, text, message);
    } else if (value?.statuses?.[0]) {
      // This is a status update (message delivered, read, etc.)
      const status = value.statuses[0];
      console.log(`📊 Message status update: ${status.status} for ${status.id}`);
      // Status updates don't need processing, just log them
      return; // Explicitly return to avoid processing
    } else {
      // Unknown webhook event type
      console.log('⚠️ Unknown webhook event type:', JSON.stringify(value, null, 2));
      return; // Don't process unknown events
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    console.error('Error stack:', err.stack);
    console.error('Webhook payload:', JSON.stringify(req.body, null, 2));
  }
});

// ------------------------------------------------------------
// Database Schema (idempotent)
// ------------------------------------------------------------
async function createTables() {
  const request = pool.request();

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='Users' AND type='U')
    CREATE TABLE Users (
      UserID INT IDENTITY(1,1) PRIMARY KEY,
      FullName NVARCHAR(200) NOT NULL,
      PhoneNumber NVARCHAR(20) NOT NULL UNIQUE,
      Email NVARCHAR(150),
      CreatedAt DATETIME DEFAULT GETDATE(),
      UpdatedAt DATETIME DEFAULT GETDATE()
    );
  `);

  // Add Email column to Users if it doesn't exist (migration)
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns 
      WHERE object_id = OBJECT_ID('Users') AND name = 'Email'
    )
    ALTER TABLE Users ADD Email NVARCHAR(150) NULL;
  `);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='Events' AND type='U')
    CREATE TABLE Events (
      EventID INT IDENTITY(1,1) PRIMARY KEY,
      EventName NVARCHAR(200) NOT NULL,
      EventDate DATE NOT NULL,
      EventTime TIME NOT NULL,
      Venue NVARCHAR(300) NOT NULL,
      Description NVARCHAR(MAX),
      ImageURL NVARCHAR(500),
      IsActive BIT DEFAULT 1,
      CreatedAt DATETIME DEFAULT GETDATE(),
      UpdatedAt DATETIME DEFAULT GETDATE()
    );
  `);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='TicketTypes' AND type='U')
    CREATE TABLE TicketTypes (
      TicketTypeID INT IDENTITY(1,1) PRIMARY KEY,
      EventID INT NOT NULL REFERENCES Events(EventID) ON DELETE CASCADE,
      TicketName NVARCHAR(100) NOT NULL,
      Price DECIMAL(10,2) NOT NULL,
      AvailableQuantity INT DEFAULT 100,
      TotalQuantity INT DEFAULT 100,
      CreatedAt DATETIME DEFAULT GETDATE()
    );
  `);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='Orders' AND type='U')
    CREATE TABLE Orders (
      OrderID INT IDENTITY(1,1) PRIMARY KEY,
      OrderNumber NVARCHAR(50) NOT NULL UNIQUE,
      UserID INT NOT NULL REFERENCES Users(UserID),
      EventID INT NOT NULL REFERENCES Events(EventID),
      TicketTypeID INT NOT NULL REFERENCES TicketTypes(TicketTypeID),
      RazorpayOrderID NVARCHAR(100),
      RazorpayPaymentID NVARCHAR(100),
      Amount DECIMAL(10,2) NOT NULL,
      Status NVARCHAR(20) DEFAULT 'pending',
      QRCode NVARCHAR(MAX),
      Email NVARCHAR(150),
      IsScanned BIT DEFAULT 0,
      ScannedAt DATETIME,
      ScannedBy NVARCHAR(100),
      CreatedAt DATETIME DEFAULT GETDATE(),
      UpdatedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT chk_status CHECK (Status IN ('pending','completed','failed','cancelled'))
    );
  `);

  // Add Email column to Orders if it doesn't exist (migration)
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns 
      WHERE object_id = OBJECT_ID('Orders') AND name = 'Email'
    )
    ALTER TABLE Orders ADD Email NVARCHAR(150) NULL;
  `);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='ConversationState' AND type='U')
    CREATE TABLE ConversationState (
      StateID INT IDENTITY(1,1) PRIMARY KEY,
      PhoneNumber NVARCHAR(20) NOT NULL UNIQUE,
      CurrentStep NVARCHAR(50) DEFAULT 'welcome',
      StateData NVARCHAR(MAX),
      LastInteraction DATETIME DEFAULT GETDATE(),
      CreatedAt DATETIME DEFAULT GETDATE()
    );
  `);

  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='AdminUsers' AND type='U')
    CREATE TABLE AdminUsers (
      AdminID INT IDENTITY(1,1) PRIMARY KEY,
      Username NVARCHAR(50) NOT NULL UNIQUE,
      PasswordHash NVARCHAR(255) NOT NULL,
      FullName NVARCHAR(200),
      Email NVARCHAR(150),
      Role NVARCHAR(20) DEFAULT 'admin',
      IsActive BIT DEFAULT 1,
      CreatedAt DATETIME DEFAULT GETDATE(),
      LastLogin DATETIME
    );
  `);

  // Seed default admin
  const defaultUser = process.env.ADMIN_USERNAME || 'admin';
  const defaultPass = process.env.ADMIN_PASSWORD || 'Admin@123';
  const hash = await bcrypt.hash(defaultPass, 10);
  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM AdminUsers WHERE Username = '${defaultUser}')
      INSERT INTO AdminUsers (Username, PasswordHash, FullName, Email, Role)
      VALUES ('${defaultUser}', '${hash}', 'Administrator', 'admin@ultraaevents.com', 'superadmin');
  `);

  console.log('✅ Tables verified/created');
}

// ------------------------------------------------------------
// Error Handling
// ------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error('Stack trace:', err.stack);
  }
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ------------------------------------------------------------
// Server Startup & Shutdown
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
let server;

async function start() {
  await connectDB();
  server = app.listen(PORT, () => logStartup(PORT));
}

async function shutdown(signal) {
  console.log(`\n⏹️  ${signal} received. Closing server...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    console.log('✅ HTTP server closed');
  }
  if (pool) {
    await pool.close();
    console.log('✅ SQL connection closed');
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  shutdown('unhandledRejection');
});

start();

