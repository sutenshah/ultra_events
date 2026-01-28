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
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ------------------------------------------------------------
// Short URL Service (In-Memory Store)
// ------------------------------------------------------------
// Map short IDs to full URLs
const shortUrlMap = new Map();

// Generate short ID (6-8 characters)
function generateShortId() {
  return Math.random().toString(36).substring(2, 10); // 8 chars
}

// Create short URL
function createShortUrl(fullUrl) {
  let shortId;
  let attempts = 0;
  
  // Ensure unique short ID (max 10 attempts)
  do {
    shortId = generateShortId();
    attempts++;
  } while (shortUrlMap.has(shortId) && attempts < 10);
  
  if (attempts >= 10) {
    // Fallback: use timestamp-based ID
    shortId = Date.now().toString(36);
  }
  
  // Store mapping (expires after 24 hours - optional cleanup)
  shortUrlMap.set(shortId, {
    url: fullUrl,
    createdAt: Date.now(),
  });
  
  return shortId;
}

// ------------------------------------------------------------
// App & Middleware
// ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files (HTML forms)
app.use(express.static('public'));

// Serve favicon (redirect to icon-192.png if favicon.ico doesn't exist)
app.get('/favicon.ico', (req, res) => {
  res.redirect('/icon-192.png');
});

// ------------------------------------------------------------
// Event image upload (local filesystem)
// ------------------------------------------------------------
const uploadsDir = path.join(__dirname, 'public', 'uploads', 'events');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeName = file.originalname
      .toLowerCase()
      .replace(/[^a-z0-9\-\.]/g, '-')
      .slice(0, 40);
    cb(null, `${Date.now()}-${safeName}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Helper: generate QR for BOOK EVENT flow
async function generateEventQrDataUrl(eventCode) {
  const rawPhone = process.env.WHATSAPP_QR_PHONE || process.env.WHATSAPP_INCOMING_NUMBER || '';
  let qrTarget = '';

  if (rawPhone) {
    const phoneDigits = rawPhone.replace(/\D/g, '');
    const msg = encodeURIComponent(`BOOK EVENT ${eventCode}`);
    qrTarget = `https://wa.me/${phoneDigits}?text=${msg}`;
  } else {
    // Fallback: plain text; scanning shows text which user can send
    qrTarget = `BOOK EVENT ${eventCode}`;
  }

  return await QRCode.toDataURL(qrTarget);
}


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
/*let sqlConfig;

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
  const serverAddress = process.env.SQL_SERVER || process.env.SQL_DATA_SOURCE;
  
  // Handle server with instance name (e.g., sql.bsite.net\MSSQL2016)
  // mssql package handles instance names automatically if included in server field
  sqlConfig = {
    server: serverAddress, // Can include instance: server\instance
    database: process.env.SQL_DATABASE || process.env.SQL_INITIAL_CATALOG,
    user: process.env.SQL_USER || process.env.SQL_USER_ID,
    password: process.env.SQL_PASSWORD,
    port: parseInt(process.env.SQL_PORT || '1433', 10),
    connectionTimeout: parseInt(process.env.SQL_CONNECTION_TIMEOUT || '30000', 10), // 30 seconds default
    requestTimeout: parseInt(process.env.SQL_REQUEST_TIMEOUT || '30000', 10), // 30 seconds default
    options: {
      encrypt: process.env.SQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE !== 'false',
      enableArithAbort: true,
      // Additional options for better connectivity
      connectTimeout: parseInt(process.env.SQL_CONNECT_TIMEOUT || '30000', 10),
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000, // Time to wait for connection from pool
    },
  };
}

let pool;*/

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

// Helper function to ensure database connection is active
async function ensureDBConnection() {
  try {
    // Check if pool exists and is connected
    if (!pool || !pool.connected) {
      console.log('🔄 Database connection lost, reconnecting...');
      pool = await sql.connect(sqlConfig);
      console.log('✅ Database reconnected');
    }
    return true;
  } catch (err) {
    console.error('❌ Failed to reconnect to database:', err.message);
    // Try to reconnect
    try {
      pool = await sql.connect(sqlConfig);
      console.log('✅ Database reconnected on retry');
      return true;
    } catch (retryErr) {
      console.error('❌ Reconnection failed:', retryErr.message);
      return false;
    }
  }
}

async function connectDB() {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
      console.log(`🔄 Attempting SQL Server connection (${attempt}/${maxRetries})...`);
      console.log(`   Server: ${sqlConfig.server || 'from connection string'}`);
      console.log(`   Database: ${sqlConfig.database || 'from connection string'}`);
      
    pool = await sql.connect(sqlConfig);
      console.log('✅ SQL Server connected successfully!');
    await createTables();
      
      // Set up connection error handler
      pool.on('error', async (err) => {
        console.error('❌ SQL Pool error:', err.message);
        console.log('🔄 Attempting to reconnect...');
        try {
          pool = await sql.connect(sqlConfig);
          console.log('✅ Reconnected after pool error');
        } catch (reconnectErr) {
          console.error('❌ Reconnection failed:', reconnectErr.message);
        }
      });
      
      return; // Success, exit function
  } catch (err) {
      console.error(`❌ SQL connection attempt ${attempt} failed:`, err.message);
      
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error('❌ All connection attempts failed.');
        console.error('📋 Connection details:');
        console.error(`   Server: ${sqlConfig.server || 'from connection string'}`);
        console.error(`   Database: ${sqlConfig.database || 'from connection string'}`);
        console.error(`   User: ${sqlConfig.user || 'from connection string'}`);
        console.error(`   Port: ${sqlConfig.port || 'default (1433)'}`);
        console.error(`   Encrypt: ${sqlConfig.options?.encrypt || 'default'}`);
        console.error('\n💡 Troubleshooting tips:');
        console.error('   1. Check if SQL Server allows remote connections');
        console.error('   2. Verify firewall allows Render IP addresses');
        console.error('   3. Ensure SQL Server Authentication is enabled');
        console.error('   4. Check if server address includes instance name (e.g., server\\instance)');
        console.error('   5. Verify credentials are correct in Render environment variables');
        // Don't exit on startup failure - let server start and retry on first request
        console.error('⚠️  Server will start but database operations will fail until connection is established');
      }
    }
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
  console.log(`✅ Razorpay Webhook: POST /webhook/razorpay`);
  console.log(`✅ Payment Callback: GET /payment/callback`);
  console.log(`✅ Check Payment: GET /api/payments/check/:paymentLinkId`);
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

async function sendWhatsAppImage(phoneNumber, imageDataUrl, caption) {
  if (!phoneNumber) {
    console.error('❌ sendWhatsAppImage called with no phone number');
    return;
  }

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.log('⚠️ WhatsApp credentials not configured');
    return;
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    console.error(`❌ Invalid phone number format: ${phoneNumber}`);
    return;
  }

  try {
    // Extract base64 data from data URL
    const base64Data = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Use FormData for multipart upload (required by WhatsApp Media API)
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: 'qrcode.png',
      contentType: 'image/png',
    });
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image');
    
    // Upload image to WhatsApp Media API
    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const mediaId = uploadResponse.data.id;
    console.log('✅ Image uploaded to WhatsApp, media ID:', mediaId);
    
    // Send image message using media ID
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'image',
        image: {
          id: mediaId,
          caption: caption || 'Your QR Code',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ QR code image sent successfully');
    return response.data;
  } catch (err) {
    console.error('❌ WhatsApp image send error:', err.response?.data || err.message);
    console.error('❌ Error details:', JSON.stringify(err.response?.data, null, 2));
  }
}

async function sendButtonMessage(phoneNumber, bodyText, buttons) {
  if (!phoneNumber) {
    console.error('❌ sendButtonMessage called with no phone number');
    return;
  }

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.log('⚠️ WhatsApp credentials not configured');
    return;
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    console.error(`❌ Invalid phone number format: ${phoneNumber}`);
    return;
  }

  // WhatsApp Button Message (max 3 buttons)
  // Note: WhatsApp only supports "reply" type buttons in button messages
  // URL buttons are NOT supported - URLs must be in message body (auto-detected)
  const buttonArray = buttons.slice(0, 3)
    .filter(btn => !btn.url) // Filter out URL buttons (not supported)
    .map((btn, index) => ({
      type: 'reply',
      reply: {
        id: btn.id || `btn_${index}`,
        title: btn.title || btn,
      },
    }));

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: bodyText,
          },
          action: {
            buttons: buttonArray,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    console.log('✅ Button message sent successfully');
    return response.data;
  } catch (err) {
    console.error('WhatsApp button message error:', err.response?.data || err.message);
    // Fallback to text message if button message fails
    await sendWhatsAppMessage(phoneNumber, `${bodyText}\n\n${buttons.map(b => `• ${b.title || b}`).join('\n')}`);
  }
}

async function sendListMessage(phoneNumber, bodyText, buttonText, sections) {
  if (!phoneNumber) {
    console.error('❌ sendListMessage called with no phone number');
    return;
  }

  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.log('⚠️ WhatsApp credentials not configured');
    return;
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  if (!formattedPhone) {
    console.error(`❌ Invalid phone number format: ${phoneNumber}`);
    return;
  }

  // WhatsApp List Message (max 10 items per section, max 1 section for simplicity)
  const listSections = sections.slice(0, 1).map((section) => ({
    title: section.title || 'Options',
    rows: section.rows.slice(0, 10).map((row) => ({
      id: row.id || `row_${Math.random()}`,
      title: row.title || row,
      description: row.description || '',
    })),
  }));

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: bodyText,
          },
          footer: {
            text: 'Select an option from the list',
          },
          action: {
            button: buttonText || 'Select',
            sections: listSections,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    console.log('✅ List message sent successfully');
    return response.data;
  } catch (err) {
    console.error('WhatsApp list message error:', err.response?.data || err.message);
    // Fallback to text message if list message fails
    const textOptions = sections[0]?.rows.map(r => `• ${r.title}`).join('\n') || '';
    await sendWhatsAppMessage(phoneNumber, `${bodyText}\n\n${textOptions}`);
  }
}

// ------------------------------------------------------------
// Chatbot Flow
// ------------------------------------------------------------
async function updateConversationState(phoneNumber, step, data) {
  if (!phoneNumber) {
    console.error('❌ updateConversationState called with no phone number');
    return;
  }
  
  // Ensure database connection is active
  const isConnected = await ensureDBConnection();
  if (!isConnected) {
    console.error('❌ Cannot update conversation state - database not connected');
    return;
  }
  
  try {
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
  } catch (err) {
    console.error('❌ Error updating conversation state:', err.message);
    // Try to reconnect and retry once
    if (err.message.includes('not connected') || err.message.includes('timeout')) {
      console.log('🔄 Attempting to reconnect and retry...');
      const reconnected = await ensureDBConnection();
      if (reconnected) {
        try {
          const phoneForDB = phoneNumber.replace(/^\+/, '');
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
        } catch (retryErr) {
          console.error('❌ Retry also failed:', retryErr.message);
        }
      }
    }
    throw err; // Re-throw to be caught by caller
  }
}

async function handleWelcomeStep(phoneNumber) {
  // Send welcome message
  await sendWhatsAppMessage(
    phoneNumber,
    '👋 Hello! Welcome to Ultraa Events 🎉\n\nWe\'re excited to have you here! Let me show you our upcoming events.\n\n💡 Tip: Type "START" anytime to restart the conversation.',
  );

  // Fetch and send event catalog immediately
  try {
    // Ensure database connection
    const isConnected = await ensureDBConnection();
    if (!isConnected) {
      console.error('❌ Cannot fetch events - database not connected');
  await sendWhatsAppMessage(
    phoneNumber,
    'Hello! Welcome to Ultraa Events 🎉\nPlease share your full name to continue.',
  );
  await updateConversationState(phoneNumber, 'awaiting_name', {});
      return;
    }

    let events;
    try {
      events = await pool
        .request()
        .query(`
          SELECT TOP 5 * FROM Events 
          WHERE IsActive = 1 AND EventDate >= CAST(GETDATE() AS DATE)
          ORDER BY EventDate ASC;
        `);
    } catch (dbErr) {
      console.error('❌ Error fetching events:', dbErr.message);
      if (dbErr.message.includes('not connected') || dbErr.message.includes('timeout') || dbErr.message.includes('Failed to connect')) {
        const reconnected = await ensureDBConnection();
        if (reconnected) {
          try {
            events = await pool
              .request()
              .query(`
                SELECT TOP 5 * FROM Events 
                WHERE IsActive = 1 AND EventDate >= CAST(GETDATE() AS DATE)
                ORDER BY EventDate ASC;
              `);
          } catch (retryErr) {
            console.error('❌ Retry failed:', retryErr.message);
            // Fall through to fallback message
            events = { recordset: [] };
          }
        } else {
          // Fall through to fallback message
          events = { recordset: [] };
        }
      } else {
        throw dbErr;
      }
    }

    if (events.recordset.length > 0) {
      // Format events for list message
      const eventRows = events.recordset.map((e, index) => {
        const eventDate = new Date(e.EventDate);
        const formattedDate = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        // Format time - Use time string directly from database
        let eventTime = '';
        if (e.EventTime) {
          // Get time as string from database (format: HH:MM:SS or HH:MM)
          const timeStr = e.EventTime.toString().trim();
          // Remove seconds if present (HH:MM:SS -> HH:MM)
          if (timeStr.includes(':')) {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
              eventTime = `${parts[0]}:${parts[1]}`; // Just HH:MM
            } else {
              eventTime = timeStr;
            }
          } else {
            eventTime = timeStr;
          }
        }
        
        // Add emoji based on event name or use default
        let emoji = '🎉';
        if (e.EventName.toLowerCase().includes('festival')) emoji = '🎉';
        else if (e.EventName.toLowerCase().includes('dream')) emoji = '🎵';
        else if (e.EventName.toLowerCase().includes('new year') || e.EventName.toLowerCase().includes('bash')) emoji = '🎆';
        else if (e.EventName.toLowerCase().includes('electronic')) emoji = '🎵';
        
        // WhatsApp limits: title max 24 chars, description max 72 chars
        let eventTitle = `${emoji} ${e.EventName}`;
        // Truncate title if too long (max 24 chars)
        if (eventTitle.length > 24) {
          eventTitle = eventTitle.substring(0, 21) + '...';
        }
        
        // Description: date, time, venue (max 72 chars)
        // Build description parts
        const datePart = `📅 ${formattedDate}`;
        const timePart = eventTime ? `⏰ ${eventTime}` : '';
        const venuePart = `📍 ${e.Venue}`;
        
        // Combine parts with separators
        let eventDesc = datePart;
        if (timePart) {
          eventDesc = eventDesc + ' • ' + timePart;
        }
        
        // Calculate available space for venue
        const separator = ' • ';
        const venueWithSeparator = separator + venuePart;
        const maxDescLength = 72;
        
        // Check if we can add venue
        if ((eventDesc + venueWithSeparator).length <= maxDescLength) {
          eventDesc = eventDesc + venueWithSeparator;
        } else {
          // Calculate how much space is left for venue
          const availableSpace = maxDescLength - eventDesc.length - separator.length;
          if (availableSpace > 5) { // Only add venue if we have at least 5 chars
            const truncatedVenue = venuePart.substring(0, availableSpace);
            eventDesc = eventDesc + separator + truncatedVenue;
          }
          // If no space, just keep date and time
        }
        
        // Final safety check: ensure description is exactly <= 72 chars
        if (eventDesc.length > maxDescLength) {
          eventDesc = eventDesc.substring(0, maxDescLength - 3) + '...';
        }
        
        return {
          id: `event_${e.EventID}`,
          title: eventTitle,
          description: eventDesc,
        };
      });

      // Send event catalog as list message
      await sendListMessage(
        phoneNumber,
        '🎊 Here are our upcoming events:\n\nSelect an event to view details and book tickets!',
        'View Events',
        [
          {
            title: 'Upcoming Events',
            rows: eventRows,
          },
        ],
      );

      // Store events in state for later use
      await updateConversationState(phoneNumber, 'awaiting_name', { events: events.recordset });
    } else {
      // No events available
      await sendWhatsAppMessage(
        phoneNumber,
        '📭 No upcoming events right now. Check back soon!\n\nPlease share your full name to continue.',
      );
      await updateConversationState(phoneNumber, 'awaiting_name', {});
    }
  } catch (err) {
    console.error('Error fetching events in welcome:', err);
    // Fallback to simple welcome message
  await sendWhatsAppMessage(
    phoneNumber,
    'Hello! Welcome to Ultraa Events 🎉\nPlease share your full name to continue.',
  );
  await updateConversationState(phoneNumber, 'awaiting_name', {});
  }
}

async function handleNameStep(phoneNumber, messageText, stateData) {
  // Check if user is selecting an event instead of providing name
  // This happens when user selects event from list while in "awaiting_name" state
  if (messageText.startsWith('event_')) {
    // User selected an event, handle it instead of treating as name
    await handleEventSelection(phoneNumber, messageText, stateData);
    return;
  }
  
  const name = messageText.trim();
  if (!name || name.length < 2) {
    await sendWhatsAppMessage(phoneNumber, 'Please enter a valid name.');
    return;
  }

  // Ensure database connection
  const isConnected = await ensureDBConnection();
  if (!isConnected) {
    await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
    return;
  }

  // Format phone for database (without +)
  const phoneForDB = phoneNumber.replace(/^\+/, '');
  // Format phone for WhatsApp API (with +)
  const formattedPhoneForAPI = formatPhoneNumber(phoneNumber);
  
  try {
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
  } catch (dbErr) {
    console.error('❌ Error saving user:', dbErr.message);
    if (dbErr.message.includes('not connected') || dbErr.message.includes('timeout') || dbErr.message.includes('Failed to connect')) {
      const reconnected = await ensureDBConnection();
      if (reconnected) {
        try {
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
        } catch (retryErr) {
          console.error('❌ Retry failed:', retryErr.message);
          throw retryErr;
        }
      } else {
        throw dbErr;
      }
    } else {
      throw dbErr;
    }
  }

  stateData.name = name;
  
  // Send personalized greeting with buttons
  await sendButtonMessage(phoneNumber, `Great! Nice to meet you, ${name}! 👋\n\nHow can we help you today?`, [
    { id: 'view_events', title: '📅 View Events' },
    { id: 'support', title: '💬 Support' },
  ]);
  await updateConversationState(phoneNumber, 'main_menu', stateData);
}

async function handleMainMenu(phoneNumber, messageText, stateData) {
  const lower = messageText.toLowerCase();

  if (lower === 'view_events' || lower.includes('event') || lower === 'view_events') {
    // Ensure database connection
    const isConnected = await ensureDBConnection();
    if (!isConnected) {
      await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
      return;
    }

    let events;
    try {
      events = await pool
      .request()
      .query(`
        SELECT TOP 10 * FROM Events 
        WHERE IsActive = 1 AND EventDate >= CAST(GETDATE() AS DATE)
        ORDER BY EventDate ASC;
      `);
    } catch (dbErr) {
      console.error('❌ Error fetching events:', dbErr.message);
      if (dbErr.message.includes('not connected') || dbErr.message.includes('timeout') || dbErr.message.includes('Failed to connect')) {
        const reconnected = await ensureDBConnection();
        if (reconnected) {
          try {
            events = await pool
              .request()
              .query(`
                SELECT TOP 10 * FROM Events 
                WHERE IsActive = 1 AND EventDate >= CAST(GETDATE() AS DATE)
                ORDER BY EventDate ASC;
              `);
          } catch (retryErr) {
            console.error('❌ Retry failed:', retryErr.message);
            await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
            return;
          }
        } else {
          await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
          return;
        }
      } else {
        throw dbErr;
      }
    }

    if (events.recordset.length === 0) {
      await sendWhatsAppMessage(phoneNumber, '📭 No upcoming events right now. Check back soon!');
      return;
    }

    stateData.events = events.recordset;
    
    // Format events with emojis and nice descriptions
    // WhatsApp limits: title max 24 chars, description max 72 chars
    const eventRows = events.recordset.map((e) => {
      const eventDate = new Date(e.EventDate);
      const formattedDate = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      // Format time - Use time string directly from database
      let eventTime = '';
      if (e.EventTime) {
        // Get time as string from database (format: HH:MM:SS or HH:MM)
        const timeStr = e.EventTime.toString().trim();
        // Remove seconds if present (HH:MM:SS -> HH:MM)
        if (timeStr.includes(':')) {
          const parts = timeStr.split(':');
          if (parts.length >= 2) {
            eventTime = `${parts[0]}:${parts[1]}`; // Just HH:MM
          } else {
            eventTime = timeStr;
          }
        } else {
          eventTime = timeStr;
        }
      }
      
      // Add emoji based on event name
      let emoji = '🎉';
      if (e.EventName.toLowerCase().includes('festival')) emoji = '🎉';
      else if (e.EventName.toLowerCase().includes('dream')) emoji = '🎵';
      else if (e.EventName.toLowerCase().includes('new year') || e.EventName.toLowerCase().includes('bash')) emoji = '🎆';
      else if (e.EventName.toLowerCase().includes('electronic')) emoji = '🎵';
      
      // Title: emoji + event name (max 24 chars)
      let eventTitle = `${emoji} ${e.EventName}`;
      if (eventTitle.length > 24) {
        // Remove emoji if name is too long, or truncate
        const nameOnly = e.EventName.length > 24 ? e.EventName.substring(0, 21) + '...' : e.EventName;
        eventTitle = nameOnly.length > 24 ? nameOnly.substring(0, 21) + '...' : nameOnly;
      }
      
      // Description: date, time, venue (max 72 chars)
      // Build description parts
      const datePart = `📅 ${formattedDate}`;
      const timePart = eventTime ? `⏰ ${eventTime}` : '';
      const venuePart = `📍 ${e.Venue}`;
      
      // Combine parts with separators
      let eventDesc = datePart;
      if (timePart) {
        eventDesc = eventDesc + ' • ' + timePart;
      }
      
      // Calculate available space for venue
      const separator = ' • ';
      const venueWithSeparator = separator + venuePart;
      const maxDescLength = 72;
      
      // Check if we can add venue
      if ((eventDesc + venueWithSeparator).length <= maxDescLength) {
        eventDesc = eventDesc + venueWithSeparator;
      } else {
        // Calculate how much space is left for venue
        const availableSpace = maxDescLength - eventDesc.length - separator.length;
        if (availableSpace > 5) { // Only add venue if we have at least 5 chars
          const truncatedVenue = venuePart.substring(0, availableSpace);
          eventDesc = eventDesc + separator + truncatedVenue;
        }
        // If no space, just keep date and time
      }
      
      // Final safety check: ensure description is exactly <= 72 chars
      if (eventDesc.length > maxDescLength) {
        eventDesc = eventDesc.substring(0, maxDescLength - 3) + '...';
      }
      
      return {
        id: `event_${e.EventID}`,
        title: eventTitle,
        description: eventDesc,
      };
    });

    const sections = [
      {
        title: 'Upcoming Events',
        rows: eventRows,
      },
    ];

    await sendListMessage(phoneNumber, '🎊 Here are our upcoming events:\n\nSelect an event to view details and book tickets!', 'Select Event', sections);
    await updateConversationState(phoneNumber, 'viewing_events', stateData);
    return;
  }

  if (lower === 'support') {
    await sendWhatsAppMessage(
      phoneNumber,
      '💬 Contact Support\n\n📧 Email: support@ultraaevents.com\n📞 Phone: +91 98765 43210\n⏰ Hours: 9 AM - 9 PM (Mon-Sat)\n\nWe\'re here to help!',
    );
    return;
  }

  await sendButtonMessage(phoneNumber, "How can we help you today?", [
    { id: 'view_events', title: '📅 View Events' },
    { id: 'support', title: '💬 Support' },
  ]);
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
    await sendWhatsAppMessage(phoneNumber, '❌ Event not found.');
    return;
  }

  stateData.selectedEventId = eventId;
  stateData.tickets = ticketResult.recordset;

  // Format event details nicely with emojis
  const eventDate = new Date(event.EventDate);
  const formattedDate = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  // Format time - EventTime is now a string in database, use it directly
  let eventTime = '';
  if (event.EventTime) {
    const timeStr = String(event.EventTime).trim();
    // Remove seconds if present (HH:MM:SS -> HH:MM)
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      if (parts.length >= 2) {
        eventTime = `${parts[0]}:${parts[1]}`;
      } else {
        eventTime = timeStr;
      }
    } else {
      eventTime = timeStr;
    }
  }
  
  // Add emoji based on event name
  let emoji = '🎉';
  if (event.EventName.toLowerCase().includes('festival')) emoji = '🎉';
  else if (event.EventName.toLowerCase().includes('dream')) emoji = '🎵';
  else if (event.EventName.toLowerCase().includes('new year') || event.EventName.toLowerCase().includes('bash')) emoji = '🎆';
  else if (event.EventName.toLowerCase().includes('electronic')) emoji = '🎵';

  const details =
    `${emoji} *${event.EventName}*\n\n` +
    `📅 Date: ${formattedDate}\n` +
    `⏰ Time: ${eventTime}\n` +
    `📍 Venue: ${event.Venue}\n\n` +
    `${event.Description || '🎊 Experience the ultimate party with live DJs, premium bars, and electrifying atmosphere!'}\n\n` +
    `Would you like to purchase a ticket?`;

  // Send event details with buttons
  await sendButtonMessage(phoneNumber, details, [
    { id: 'yes_buy_ticket', title: '✅ Yes, Buy Ticket' },
    { id: 'view_other_events', title: '📅 View Other Events' },
  ]);
  await updateConversationState(phoneNumber, 'viewing_event_details', stateData);
}

async function handleEventDetails(phoneNumber, messageText, stateData) {
  const lower = messageText.toLowerCase();

  if (lower === 'yes' || lower === 'buy' || lower === 'purchase' || lower === 'yes_buy_ticket') {
    if (!stateData.tickets?.length) {
      await sendWhatsAppMessage(phoneNumber, '❌ Tickets are not available for this event.');
      return;
    }

    // WhatsApp Button Messages support max 3 buttons per message
    // Split tickets into groups of 3 and send multiple button messages
    const tickets = stateData.tickets;
    const maxButtonsPerMessage = 3;
    
    // Send tickets as button messages (like React component)
    for (let i = 0; i < tickets.length; i += maxButtonsPerMessage) {
      const ticketGroup = tickets.slice(i, i + maxButtonsPerMessage);
      
      // Format buttons (max 20 chars per button title for WhatsApp)
      // Match React component format: "Ticket Name - ₹Price"
      const buttons = ticketGroup.map((t) => {
        // Try to include price in button text
        const priceStr = `₹${t.Price}`;
        const nameOnly = t.TicketName;
        
        // Calculate space needed: " - " (3 chars) + price
        const spaceNeeded = 3 + priceStr.length;
        const maxNameLength = 20 - spaceNeeded;
        
        let buttonText;
        if (nameOnly.length <= maxNameLength) {
          // Full name + price fits
          buttonText = `${nameOnly} - ${priceStr}`;
        } else {
          // Name too long, try shorter format
          // Option 1: Abbreviate common words
          let shortName = nameOnly
            .replace('Regular - ', 'Reg - ')
            .replace('VIP - ', 'VIP - ')
            .replace('Stag Male', 'Stag M')
            .replace('Stag Female', 'Stag F');
          
          if (shortName.length <= maxNameLength) {
            buttonText = `${shortName} - ${priceStr}`;
          } else {
            // Option 2: Just show abbreviated name, price in description
            if (shortName.length > 20) {
              shortName = shortName.substring(0, 17) + '...';
            }
            buttonText = shortName;
          }
        }
        
        // Final check: ensure button text is max 20 chars
        if (buttonText.length > 20) {
          buttonText = buttonText.substring(0, 17) + '...';
        }
        
        return {
          id: `ticket_${t.TicketTypeID}`,
          title: buttonText,
        };
      });
      
      // First message includes instruction, others are continuation
      const bodyText = i === 0 
        ? '🎫 Great! Please select your ticket type:'
        : 'More ticket options:';
      
      await sendButtonMessage(phoneNumber, bodyText, buttons);
      
      // Small delay between messages to avoid rate limiting
      if (i + maxButtonsPerMessage < tickets.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Add "Back to Menu" option after all ticket buttons
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendButtonMessage(phoneNumber, '💡 Or go back to the main menu:', [
      { id: 'back_to_menu', title: '🏠 Back to Menu' },
    ]);
    
    await updateConversationState(phoneNumber, 'selecting_ticket', stateData);
    return;
  }

  if (lower === 'back' || lower === 'view_other_events' || messageText === 'back_to_menu') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }

  await sendButtonMessage(phoneNumber, "Would you like to purchase a ticket?", [
    { id: 'yes_buy_ticket', title: '✅ Yes, Buy Ticket' },
    { id: 'view_other_events', title: '📅 View Other Events' },
    { id: 'back_to_menu', title: '🏠 Back to Menu' },
  ]);
}

async function handleTicketSelection(phoneNumber, messageText, stateData) {
  // Handle "Back to Menu" button
  if (messageText === 'back_to_menu' || messageText.toLowerCase() === 'back to menu') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }

  // Handle button reply (ticket_123) from button message
  let ticketId = null;
  
  if (messageText.startsWith('ticket_')) {
    // From button message selection
    ticketId = parseInt(messageText.replace('ticket_', ''), 10);
    const ticket = stateData.tickets?.find(t => t.TicketTypeID === ticketId);
    if (ticket) {
      stateData.selectedTicketId = ticket.TicketTypeID;
      stateData.selectedTicketPrice = ticket.Price;
    }
  } else {
    // Try to parse as number (fallback for text input)
    const idx = parseInt(messageText, 10) - 1;
    if (!Number.isNaN(idx) && stateData.tickets?.[idx]) {
  const ticket = stateData.tickets[idx];
  stateData.selectedTicketId = ticket.TicketTypeID;
  stateData.selectedTicketPrice = ticket.Price;
      ticketId = ticket.TicketTypeID;
    }
  }

  if (!stateData.selectedTicketId || !stateData.selectedTicketPrice) {
    await sendWhatsAppMessage(phoneNumber, '❌ Invalid ticket choice. Please try again.');
    // Resend ticket options
    const tickets = stateData.tickets;
    const maxButtonsPerMessage = 3;
    
    for (let i = 0; i < tickets.length; i += maxButtonsPerMessage) {
      const ticketGroup = tickets.slice(i, i + maxButtonsPerMessage);
      // Format buttons (max 20 chars per button title for WhatsApp)
      const buttons = ticketGroup.map((t) => {
        const priceStr = `₹${t.Price}`;
        const nameOnly = t.TicketName;
        const spaceNeeded = 3 + priceStr.length; // " - " + price
        const maxNameLength = 20 - spaceNeeded;
        
        let buttonText;
        if (nameOnly.length <= maxNameLength) {
          buttonText = `${nameOnly} - ${priceStr}`;
        } else {
          // Abbreviate common words
          let shortName = nameOnly
            .replace('Regular - ', 'Reg - ')
            .replace('Stag Male', 'Stag M')
            .replace('Stag Female', 'Stag F');
          
          if (shortName.length <= maxNameLength) {
            buttonText = `${shortName} - ${priceStr}`;
          } else {
            shortName = shortName.length > 20 ? shortName.substring(0, 17) + '...' : shortName;
            buttonText = shortName;
          }
        }
        
        if (buttonText.length > 20) {
          buttonText = buttonText.substring(0, 17) + '...';
        }
        
        return {
          id: `ticket_${t.TicketTypeID}`,
          title: buttonText,
        };
      });
      const bodyText = i === 0 
        ? '🎫 Please select your ticket type:\n\n💡 Tip: Type "START" anytime to restart'
        : 'More ticket options:';
      await sendButtonMessage(phoneNumber, bodyText, buttons);
      if (i + maxButtonsPerMessage < tickets.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return;
  }

  const selectedTicket = stateData.tickets.find(t => t.TicketTypeID === stateData.selectedTicketId);

  // Generate a unique session ID for this booking
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  stateData.sessionId = sessionId;
  
  // Get backend URL - prioritize BACKEND_URL, then RENDER_EXTERNAL_URL, then FRONTEND_URL
  // For Render.com, use the service URL from environment
  let backendUrl = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL;
  
  // If still not set, try to construct from common patterns
  if (!backendUrl) {
    // Check if we're on Render
    if (process.env.RENDER) {
      backendUrl = `https://${process.env.RENDER_SERVICE_NAME || 'ultraa-events'}.onrender.com`;
    } else {
      // Fallback - should be set in production via environment variable
      console.warn('⚠️ BACKEND_URL not set, using fallback');
      backendUrl = 'https://ultraa-events.onrender.com';
    }
  }
  
  // Ensure URL doesn't have trailing slash
  backendUrl = backendUrl.replace(/\/$/, '');
  
  // Create full form URL
  const fullFormUrl = `${backendUrl}/user-form.html?sessionId=${encodeURIComponent(sessionId)}&ticketName=${encodeURIComponent(selectedTicket.TicketName)}&ticketAmount=${encodeURIComponent(selectedTicket.Price)}`;
  
  // Create short URL for cleaner display
  const shortId = createShortUrl(fullFormUrl);
  const shortUrl = `${backendUrl}/s/${shortId}`;
  
  console.log('🔗 Form URL generated:', fullFormUrl);
  console.log('🔗 Short URL created:', shortUrl);
  
  // Store form URL in state for button click handler
  stateData.formUrl = fullFormUrl;
  
  // WhatsApp doesn't support URL buttons in button messages
  // Solution: Put URL in message body (WhatsApp auto-detects and makes it clickable)
  // Use short URL for cleaner appearance
  await sendButtonMessage(
    phoneNumber,
    `✅ Perfect choice!\n\n🎫 *${selectedTicket.TicketName}*\n💰 Amount: ₹${selectedTicket.Price}\n\n📝 *Complete Your Booking*\n\n🔗 *Complete SignUp:*\n${shortUrl}\n\nTap the link above to open the sign-up form.`,
    [
      { id: 'back_to_menu', title: '🏠 Back to Home' },
    ]
  );
  
  await updateConversationState(phoneNumber, 'awaiting_form_submit', stateData);
}

async function handleFullNameStep(phoneNumber, messageText, stateData) {
  // Handle "Back to Menu" button
  if (messageText === 'back_to_menu' || messageText.toLowerCase() === 'back to menu' || messageText.toLowerCase() === 'start') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }
  
  const fullName = messageText.trim();
  if (fullName.length < 2) {
    await sendWhatsAppMessage(phoneNumber, 'Please provide a valid full name (at least 2 characters).\n\n💡 Or type "START" to go back to the main menu.');
    return;
  }
  
  stateData.userFullName = fullName;
  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Name saved: ${fullName}\n\n📱 Now please provide your *Phone Number* (with country code, e.g., +919876543210):\n\n💡 Or type "START" to go back to the main menu.`
  );
  await updateConversationState(phoneNumber, 'awaiting_phone', stateData);
}

async function handlePhoneStep(phoneNumber, messageText, stateData) {
  // Handle "Back to Menu" button
  if (messageText === 'back_to_menu' || messageText.toLowerCase() === 'back to menu' || messageText.toLowerCase() === 'start') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }
  
  let userPhone = messageText.trim();
  // Remove spaces and format
  userPhone = userPhone.replace(/\s+/g, '');
  
  // Validate phone number (should be 10+ digits)
  const digitsOnly = userPhone.replace(/\D/g, '');
  if (digitsOnly.length < 10) {
    await sendWhatsAppMessage(phoneNumber, 'Please provide a valid phone number (at least 10 digits).\n\n💡 Or type "START" to go back to the main menu.');
    return;
  }
  
  // Ensure + prefix
  if (!userPhone.startsWith('+')) {
    if (userPhone.startsWith('91') && digitsOnly.length >= 12) {
      userPhone = '+' + userPhone;
    } else if (digitsOnly.length === 10) {
      userPhone = '+91' + digitsOnly;
    } else {
      userPhone = '+' + digitsOnly;
    }
  }
  
  stateData.userPhone = userPhone;
  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Phone saved: ${userPhone}\n\n📧 Now please provide your *Email Address*:\n\n💡 Or type "START" to go back to the main menu.`
  );
  await updateConversationState(phoneNumber, 'awaiting_email', stateData);
}

async function handleEmailStep(phoneNumber, messageText, stateData) {
  // Handle "Back to Menu" button
  if (messageText === 'back_to_menu' || messageText.toLowerCase() === 'back to menu' || messageText.toLowerCase() === 'start') {
    await handleMainMenu(phoneNumber, 'view_events', stateData);
    return;
  }
  
  const email = messageText.trim();
  if (!email.includes('@') || !email.includes('.')) {
    await sendWhatsAppMessage(phoneNumber, 'Please provide a valid email address.\n\n💡 Or type "START" to go back to the main menu.');
    return;
  }

  stateData.userEmail = email;

  // Format phone for database (without +)
  const phoneForDB = phoneNumber.replace(/^\+/, '');
  const userPhoneForDB = (stateData.userPhone || phoneNumber).replace(/^\+/, '');
  const fullName = stateData.userFullName || 'Customer';
  const userEmail = email;
  
  // Insert or update user in Users table
  let userId;
  const existingUser = await pool
    .request()
    .input('phone', sql.NVarChar, phoneForDB)
    .query('SELECT UserID, FullName, Email FROM Users WHERE PhoneNumber = @phone;');

  if (existingUser.recordset.length > 0) {
    // Update existing user
    userId = existingUser.recordset[0].UserID;
    await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('fullName', sql.NVarChar, fullName)
      .input('email', sql.NVarChar, userEmail)
        .input('phone', sql.NVarChar, userPhoneForDB)
        .query(`
          UPDATE Users 
          SET FullName = @fullName, 
              Email = @email,
              PhoneNumber = @phone
          WHERE UserID = @userId;
        `);
    console.log('✅ User updated:', userId);
  } else {
    // Create new user
    const newUser = await pool
      .request()
      .input('fullName', sql.NVarChar, fullName)
      .input('email', sql.NVarChar, userEmail)
      .input('phone', sql.NVarChar, userPhoneForDB)
      .query(`
        INSERT INTO Users (FullName, Email, PhoneNumber, CreatedAt)
        OUTPUT INSERTED.UserID
        VALUES (@fullName, @email, @phone, GETDATE());
      `);
    userId = newUser.recordset[0].UserID;
    console.log('✅ New user created:', userId);
  }

  const orderNumber = generateOrderNumber();
  const amount = stateData.selectedTicketPrice;

  // Get user details for payment link
  const userDetails = await pool
    .request()
    .input('userId', sql.Int, userId)
    .query('SELECT FullName, PhoneNumber, Email FROM Users WHERE UserID = @userId;');
  
  const userName = userDetails.recordset[0]?.FullName || fullName;
  const userPhone = userDetails.recordset[0]?.PhoneNumber || userPhoneForDB;
  const userEmailForPayment = userDetails.recordset[0]?.Email || userEmail;

  // Create Razorpay Payment Link using Payment Links API
  let paymentLink;
  let razorpayPaymentLinkId = null;
  
  try {
    // Calculate expiry time (24 hours from now)
    const expireBy = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours in seconds
    
    // Create payment link using Razorpay Payment Links API directly
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    const paymentLinkPayload = {
      amount: Math.round(amount * 100), // Amount in paise
      currency: 'INR',
      accept_partial: false,
      expire_by: expireBy,
      reference_id: orderNumber,
      description: `Event Ticket Purchase - Order ${orderNumber}`,
      customer: {
        name: userName,
        email: userEmailForPayment,
        contact: userPhone.startsWith('+') ? userPhone : `+${userPhone}`,
      },
      notify: {
        sms: true,
        email: true,
      },
      reminder_enable: true,
      notes: {
        order_number: orderNumber,
        user_id: userId.toString(),
        event_id: stateData.selectedEventId?.toString() || '',
        ticket_type_id: stateData.selectedTicketId?.toString() || '',
      },
      callback_url: process.env.PAYMENT_CALLBACK_URL || `${process.env.BACKEND_URL || process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app'}/payment/callback`,
      callback_method: 'get',
    };

    // Call Razorpay Payment Links API using axios
    const paymentLinkResponse = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      paymentLinkPayload,
      {
        auth: {
          username: keyId,
          password: keySecret,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    paymentLink = paymentLinkResponse.data.short_url || paymentLinkResponse.data.url;
    razorpayPaymentLinkId = paymentLinkResponse.data.id;
    
    console.log('✅ Razorpay Payment Link created:', paymentLink);
    console.log('📋 Payment Link ID:', razorpayPaymentLinkId);
  } catch (razorpayError) {
    console.error('❌ Razorpay Payment Link creation failed:', razorpayError.response?.data || razorpayError.message);
    // Fallback: Create order and use frontend payment page
  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: orderNumber,
  });
    
    const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
    paymentLink = `${frontendUrl}/payment?orderId=${razorpayOrder.id}&amount=${Math.round(amount * 100)}&key=${process.env.RAZORPAY_KEY_ID}&email=${encodeURIComponent(userEmailForPayment)}`;

  await pool
    .request()
    .input('orderNumber', sql.NVarChar, orderNumber)
    .input('userId', sql.Int, userId)
    .input('eventId', sql.Int, stateData.selectedEventId)
    .input('ticketTypeId', sql.Int, stateData.selectedTicketId)
    .input('razorpayOrderId', sql.NVarChar, razorpayOrder.id)
    .input('amount', sql.Decimal(10, 2), amount)
      .input('email', sql.NVarChar, userEmailForPayment)
    .query(`
        INSERT INTO Orders (OrderNumber, UserID, EventID, TicketTypeID, RazorpayOrderID, Amount, Status, Email)
        VALUES (@orderNumber, @userId, @eventId, @ticketTypeId, @razorpayOrderId, @amount, 'pending', @email);
      `);
  }

  // Store order in database
  // Use payment link ID if available, otherwise use order ID
  const razorpayReferenceId = razorpayPaymentLinkId || `payment_link_${orderNumber}`;
  
  console.log('💾 Storing order with RazorpayOrderID:', razorpayReferenceId);
  
  await pool
    .request()
    .input('orderNumber', sql.NVarChar, orderNumber)
    .input('userId', sql.Int, userId)
    .input('eventId', sql.Int, stateData.selectedEventId)
    .input('ticketTypeId', sql.Int, stateData.selectedTicketId)
    .input('razorpayOrderId', sql.NVarChar, razorpayReferenceId)
    .input('amount', sql.Decimal(10, 2), amount)
    .input('email', sql.NVarChar, userEmailForPayment)
    .query(`
      INSERT INTO Orders (OrderNumber, UserID, EventID, TicketTypeID, RazorpayOrderID, Amount, Status, Email)
      VALUES (@orderNumber, @userId, @eventId, @ticketTypeId, @razorpayOrderId, @amount, 'pending', @email);
    `);
  
  console.log('✅ Order stored:', orderNumber);
  
  // Send WhatsApp message with valid Razorpay payment link
  await sendWhatsAppMessage(
    phoneNumber,
    `✅ Order Created!\n\n📦 Order: ${orderNumber}\n💰 Amount: ₹${amount}\n\n💳 *Pay Now:*\n${paymentLink}\n\nClick the link above to complete your payment securely via Razorpay.\n\n✅ You'll receive confirmation once payment is successful.`,
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

    // Check for restart commands (START, MENU, RESTART) - works from ANY state
    const restartCommands = ['start', 'menu', 'restart', 'begin', 'home', 'back to menu', 'back to start'];
    const messageLower = messageText.toLowerCase().trim();
    if (restartCommands.includes(messageLower) || messageLower === 'back_to_menu' || messageLower === 'back_to_start') {
      console.log(`🔄 Restart command detected: "${messageText}" - Resetting conversation`);
      const phoneForDB = phoneNumber.replace(/^\+/, '');
      try {
        // Clear conversation state
        await pool
      .request()
          .input('phone', sql.NVarChar, phoneForDB)
          .query('DELETE FROM ConversationState WHERE PhoneNumber = @phone;');
        console.log('✅ Conversation state cleared');
      } catch (err) {
        console.error('⚠️ Error clearing state:', err.message);
      }
      // Start fresh
      await handleWelcomeStep(phoneNumber);
      return;
    }

    // Event QR deep-link: messages like "BOOK EVENT EVT-1005"
    // Be tolerant of extra spaces / prefixes by using a regex on the ORIGINAL text
    const bookEventMatch = messageText && messageText.match(/book\s+event\s+([a-z0-9\-]+)/i);
    if (bookEventMatch && bookEventMatch[1]) {
      const rawCode = bookEventMatch[1].trim();
      const eventCode = rawCode.toUpperCase();
      console.log(`📩 BOOK EVENT detected from ${phoneNumber}:`, messageText, '→ code:', eventCode);

      const phoneForDB = phoneNumber.replace(/^\+/, '');

      // Make sure DB connection is ready before querying
      const ok = await ensureDBConnection();
      if (!ok) {
        console.error('❌ Cannot process BOOK EVENT - database not connected');
        await sendWhatsAppMessage(phoneNumber, '⚠️ Temporary issue fetching event details. Please try again in a moment.');
        return;
      }

      const eventResult = await pool
        .request()
        .input('code', sql.NVarChar, eventCode)
        .query('SELECT TOP 1 * FROM Events WHERE EventCode = @code AND IsActive = 1;');

      if (!eventResult.recordset.length) {
        await sendWhatsAppMessage(phoneNumber, '⚠️ Sorry, this event is not available. Please try again later.');
        return;
      }

      const event = eventResult.recordset[0];
      const eventId = event.EventID;

      // Re‑use existing selection flow so tickets + state are set correctly
      // This will:
      //  - load ticket types
      //  - send event details with buttons
      //  - update ConversationState to 'viewing_event_details'
      const stateData = { events: [{ EventID: eventId }] };
      await handleEventSelection(phoneNumber, `event_${eventId}`, stateData);
      return;
    }

    // Ensure database connection is active
    const isConnected = await ensureDBConnection();
    if (!isConnected) {
      console.error('❌ Cannot process message - database not connected');
      await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
      return;
    }

    // Format phone number for database (store without + for consistency)
    const phoneForDB = phoneNumber.replace(/^\+/, ''); // Remove + if present for DB storage

    let stateResult;
    try {
      stateResult = await pool
        .request()
        .input('phone', sql.NVarChar, phoneForDB)
      .query('SELECT * FROM ConversationState WHERE PhoneNumber = @phone;');
    } catch (dbErr) {
      console.error('❌ Database query error:', dbErr.message);
      // Try to reconnect and retry once
      if (dbErr.message.includes('not connected') || dbErr.message.includes('timeout') || dbErr.message.includes('Failed to connect')) {
        console.log('🔄 Attempting to reconnect and retry query...');
        const reconnected = await ensureDBConnection();
        if (reconnected) {
          try {
            stateResult = await pool
              .request()
              .input('phone', sql.NVarChar, phoneForDB)
              .query('SELECT * FROM ConversationState WHERE PhoneNumber = @phone;');
          } catch (retryErr) {
            console.error('❌ Retry query failed:', retryErr.message);
            await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
            return;
          }
        } else {
          await sendWhatsAppMessage(phoneNumber, '⚠️ Database connection issue. Please try again in a moment.');
          return;
        }
      } else {
        throw dbErr;
      }
    }

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
        // Handle list reply (event_123) or text reply
        if (messageText.startsWith('event_')) {
        await handleEventSelection(phoneNumber, messageText, stateData);
        } else {
          // Try to parse as number
          const eventNum = parseInt(messageText, 10);
          if (!Number.isNaN(eventNum) && stateData.events?.[eventNum - 1]) {
            const eventId = stateData.events[eventNum - 1].EventID;
            await handleEventSelection(phoneNumber, `event_${eventId}`, stateData);
          } else {
            await handleEventSelection(phoneNumber, messageText, stateData);
          }
        }
        break;
      case 'viewing_event_details':
        await handleEventDetails(phoneNumber, messageText, stateData);
        break;
      case 'selecting_ticket':
        await handleTicketSelection(phoneNumber, messageText, stateData);
        break;
      case 'awaiting_form_submit':
        // Handle button click or text commands
        if (messageText === 'open_signup_form' || messageText.toLowerCase() === 'complete signup' || messageText.toLowerCase() === 'signup') {
          // Button clicked - do nothing (silent)
          // The URL is already in the previous message and clickable
          // User can tap the URL directly from the message
          return; // Don't send any response
        } else if (messageText.toLowerCase() === 'start' || messageText.toLowerCase() === 'menu' || messageText === 'back_to_menu') {
          await handleMainMenu(phoneNumber, 'view_events', stateData);
        } else {
          // If user sends any other message, remind them about the form (without duplicate URL)
          await sendWhatsAppMessage(
            phoneNumber,
            '📝 Please use the form link from the previous message to complete your booking.\n\n💡 Or type "START" to go back to the main menu.'
          );
        }
        break;
      case 'awaiting_full_name':
        await handleFullNameStep(phoneNumber, messageText, stateData);
        break;
      case 'awaiting_phone':
        await handlePhoneStep(phoneNumber, messageText, stateData);
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
// ------------------------------------------------------------
// Short URL Redirect Endpoint
// ------------------------------------------------------------
app.get('/s/:shortId', (req, res) => {
  const { shortId } = req.params;
  const urlData = shortUrlMap.get(shortId);
  
  if (urlData) {
    // Redirect to the full URL
    console.log(`🔗 Short URL redirect: /s/${shortId} -> ${urlData.url}`);
    return res.redirect(urlData.url);
  } else {
    // Short URL not found
    console.warn(`⚠️ Short URL not found: /s/${shortId}`);
    return res.status(404).send(`
      <html>
        <head><title>Link Not Found</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>Link Not Found</h1>
          <p>This link has expired or is invalid.</p>
          <p>Please request a new link from WhatsApp.</p>
        </body>
      </html>
    `);
  }
});

// ------------------------------------------------------------
// Health & Core Routes
// ------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Ultraa Events API Server Running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// WhatsApp User Form Submission Handler
app.post('/api/whatsapp/user-form-submit', async (req, res, next) => {
  try {
    console.log('📥 Form submission received:', JSON.stringify(req.body, null, 2));
    const { sessionId, fullName, phoneNumber, email } = req.body;
    
    if (!sessionId || !fullName || !phoneNumber || !email) {
      console.warn('⚠️ Missing required fields:', { sessionId: !!sessionId, fullName: !!fullName, phoneNumber: !!phoneNumber, email: !!email });
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    // Find conversation state by sessionId
    console.log('🔍 Searching for session:', sessionId);
    const stateResult = await pool
      .request()
      .input('sessionId', sql.NVarChar, sessionId)
      .query(`
        SELECT TOP 1 cs.* 
        FROM ConversationState cs
        WHERE cs.StateData LIKE '%' + @sessionId + '%'
        ORDER BY cs.StateID DESC;
      `);
    
    console.log('📋 Found conversation states:', stateResult.recordset.length);
    
    if (!stateResult.recordset.length) {
      console.warn('⚠️ Session not found:', sessionId);
      return res.status(404).json({ 
        success: false, 
        message: 'Session not found. Please start over by selecting a ticket again.' 
      });
    }
    
    const stateRecord = stateResult.recordset[0];
    const stateData = JSON.parse(stateRecord.StateData || '{}');
    const phoneNumberFromDB = stateRecord.PhoneNumber;
    
    // Format phone for database (without +)
    const phoneForDB = phoneNumber.replace(/^\+/, '').replace(/\D/g, '');
    const phoneForDBWithCountry = phoneForDB.startsWith('91') ? phoneForDB : `91${phoneForDB}`;
    
    // Insert or update user in Users table
    let userId;
    const existingUser = await pool
      .request()
      .input('phone', sql.NVarChar, phoneForDBWithCountry)
      .query('SELECT UserID, FullName, Email FROM Users WHERE PhoneNumber = @phone;');

    if (existingUser.recordset.length > 0) {
      // Update existing user
      userId = existingUser.recordset[0].UserID;
      await pool
        .request()
        .input('userId', sql.Int, userId)
        .input('fullName', sql.NVarChar, fullName)
        .input('email', sql.NVarChar, email)
        .input('phone', sql.NVarChar, phoneForDBWithCountry)
        .query(`
          UPDATE Users 
          SET FullName = @fullName, 
              Email = @email,
              PhoneNumber = @phone
          WHERE UserID = @userId;
        `);
      console.log('✅ User updated via form:', userId);
    } else {
      // Create new user
      const newUser = await pool
        .request()
        .input('fullName', sql.NVarChar, fullName)
        .input('email', sql.NVarChar, email)
        .input('phone', sql.NVarChar, phoneForDBWithCountry)
        .query(`
          INSERT INTO Users (FullName, Email, PhoneNumber, CreatedAt)
          OUTPUT INSERTED.UserID
          VALUES (@fullName, @email, @phone, GETDATE());
        `);
      userId = newUser.recordset[0].UserID;
      console.log('✅ New user created via form:', userId);
    }
    
    // Update state data with user info
    stateData.userFullName = fullName;
    stateData.userPhone = phoneNumber;
    stateData.userEmail = email;
    stateData.formSubmitted = true;
    
    // Update conversation state
    await pool
      .request()
      .input('phone', sql.NVarChar, phoneNumberFromDB)
      .input('stateData', sql.NVarChar, JSON.stringify(stateData))
      .input('currentStep', sql.NVarChar, 'form_submitted')
      .query(`
        UPDATE ConversationState
        SET StateData = @stateData,
            CurrentStep = @currentStep
        WHERE PhoneNumber = @phone;
      `);
    
    // Now create the order and payment link
    const orderNumber = generateOrderNumber();
    const amount = stateData.selectedTicketPrice || 0;
    
    // Get user details for payment link
    const userDetails = await pool
      .request()
      .input('userId', sql.Int, userId)
      .query('SELECT FullName, PhoneNumber, Email FROM Users WHERE UserID = @userId;');
    
    const userName = userDetails.recordset[0]?.FullName || fullName;
    const userPhone = userDetails.recordset[0]?.PhoneNumber || phoneForDBWithCountry;
    const userEmailForPayment = userDetails.recordset[0]?.Email || email;
    
    // Create Razorpay Payment Link
    let paymentLink;
    let razorpayPaymentLinkId = null;
    
    try {
      const expireBy = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      
      const paymentLinkResponse = await axios.post(
        'https://api.razorpay.com/v1/payment_links',
        {
          amount: Math.round(amount * 100),
          currency: 'INR',
          accept_partial: false,
          expire_by: expireBy,
          reference_id: orderNumber,
          description: `Event Ticket Purchase - Order ${orderNumber}`,
          customer: {
            name: userName,
            email: userEmailForPayment,
            contact: userPhone.startsWith('+') ? userPhone : `+${userPhone}`,
          },
          notify: {
            sms: true,
            email: true,
          },
          reminder_enable: true,
          notes: {
            order_number: orderNumber,
            user_id: userId.toString(),
            event_id: stateData.selectedEventId?.toString() || '',
            ticket_type_id: stateData.selectedTicketId?.toString() || '',
          },
          callback_url: process.env.PAYMENT_CALLBACK_URL || `${process.env.BACKEND_URL || process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app'}/payment/callback`,
          callback_method: 'get',
        },
        {
          auth: {
            username: keyId,
            password: keySecret,
          },
        }
      );
      
      paymentLink = paymentLinkResponse.data.short_url || paymentLinkResponse.data.url;
      razorpayPaymentLinkId = paymentLinkResponse.data.id;
      
      console.log('✅ Razorpay Payment Link created via form:', paymentLink);
    } catch (razorpayError) {
      console.error('❌ Razorpay Payment Link creation failed:', razorpayError.response?.data || razorpayError.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to create payment link. Please try again.' 
      });
    }
    
    // Store order in database
    await pool
      .request()
      .input('orderNumber', sql.NVarChar, orderNumber)
      .input('userId', sql.Int, userId)
      .input('eventId', sql.Int, stateData.selectedEventId)
      .input('ticketTypeId', sql.Int, stateData.selectedTicketId)
      .input('razorpayOrderId', sql.NVarChar, razorpayPaymentLinkId)
      .input('amount', sql.Decimal(10, 2), amount)
      .input('email', sql.NVarChar, userEmailForPayment)
      .query(`
        INSERT INTO Orders (OrderNumber, UserID, EventID, TicketTypeID, RazorpayOrderID, Amount, Status, Email)
        VALUES (@orderNumber, @userId, @eventId, @ticketTypeId, @razorpayOrderId, @amount, 'pending', @email);
      `);
    
    console.log('✅ Order created via form:', orderNumber);
    
    // Send payment link via WhatsApp
    const formattedPhone = phoneNumberFromDB.startsWith('+') ? phoneNumberFromDB : `+${phoneNumberFromDB}`;
    await sendWhatsAppMessage(
      formattedPhone,
      `✅ Order Created!\n\n📦 Order: ${orderNumber}\n💰 Amount: ₹${amount}\n\n💳 *Pay Now:*\n${paymentLink}\n\nClick the link above to complete your payment securely via Razorpay.\n\n✅ You'll receive confirmation once payment is successful.`,
    );
    
    console.log('✅ Form submission successful, order created:', orderNumber);
    
    res.json({ 
      success: true, 
      message: 'Information saved successfully! Payment link sent to WhatsApp.',
      orderNumber: orderNumber
    });
    
  } catch (err) {
    console.error('❌ Form submission error:', err);
    console.error('❌ Error stack:', err.stack);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Internal server error. Please try again.' 
    });
  }
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
    
    // Check if already completed
    if (order.Status === 'completed') {
      return res.json({ success: true, message: 'Payment already verified', order });
    }
    
    // Generate QR code based on OrderNumber (one QR per order)
    const qrData = JSON.stringify({
      orderNumber: order.OrderNumber,
      orderId: order.OrderID,
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

    // Get user and event details for WhatsApp confirmation
    const orderDetails = await pool
      .request()
      .input('orderId', sql.Int, order.OrderID)
      .query(`
        SELECT o.*, u.FullName, u.PhoneNumber, u.Email, e.EventName, e.EventDate, e.EventTime, e.Venue, tt.TicketName
        FROM Orders o
        JOIN Users u ON o.UserID = u.UserID
        JOIN Events e ON o.EventID = e.EventID
        JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
        WHERE o.OrderID = @orderId;
      `);

    if (orderDetails.recordset.length > 0) {
      const orderInfo = orderDetails.recordset[0];
      const userPhone = orderInfo.PhoneNumber;
      
      // Format event date and time
      const eventDate = new Date(orderInfo.EventDate);
      const formattedDate = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      let eventTime = '';
      if (orderInfo.EventTime) {
        const timeStr = orderInfo.EventTime.toString().trim();
        if (timeStr.includes(':')) {
          const parts = timeStr.split(':');
          if (parts.length >= 2) {
            eventTime = `${parts[0]}:${parts[1]}`;
          }
        }
      }
      
      // Send WhatsApp confirmation message
      const confirmationMessage = 
        `🎉 *Payment Successful!*\n\n` +
        `✅ Your ticket has been confirmed!\n\n` +
        `📦 *Order Details:*\n` +
        `Order Number: ${orderInfo.OrderNumber}\n` +
        `Event: ${orderInfo.EventName}\n` +
        `Ticket: ${orderInfo.TicketName}\n` +
        `Date: ${formattedDate}\n` +
        `${eventTime ? `Time: ${eventTime}\n` : ''}` +
        `Venue: ${orderInfo.Venue}\n\n` +
        `🎫 *Your QR Code:*\n` +
        `Show this QR code at the venue for entry.\n\n` +
        `Thank you for choosing Ultraa Events! 🎊`;
      
      try {
        await sendWhatsAppMessage(userPhone, confirmationMessage);
        console.log(`✅ Payment confirmation sent to ${userPhone}`);
      } catch (whatsappErr) {
        console.error('⚠️ Failed to send WhatsApp confirmation:', whatsappErr.message);
        // Don't fail the verification if WhatsApp fails
      }
    }

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

// Manual payment check endpoint (for testing/debugging)
app.get('/api/payments/check/:paymentLinkId', async (req, res, next) => {
  try {
    const { paymentLinkId } = req.params;
    
    console.log('🔍 Checking payment for link:', paymentLinkId);
    
    // Find order by payment link ID
    const orderResult = await pool
      .request()
      .input('razorpayOrderId', sql.NVarChar, paymentLinkId)
      .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId;');
    
    if (!orderResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    const order = orderResult.recordset[0];
    
    // Check payment status via Razorpay API
    try {
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      
      // Get payment link details
      const paymentLinkResponse = await axios.get(
        `https://api.razorpay.com/v1/payment_links/${paymentLinkId}`,
        {
          auth: {
            username: keyId,
            password: keySecret,
          },
        }
      );
      
      const paymentLink = paymentLinkResponse.data;
      const payments = paymentLink.payments || [];
      
      if (payments.length > 0 && payments[0].status === 'captured') {
        // Payment is successful, process it
        const paymentId = payments[0].id;
        console.log('✅ Payment found and successful:', paymentId);
        
        if (order.Status === 'pending') {
          await processPaymentSuccess(order.OrderID, paymentId);
          return res.json({ 
            success: true, 
            message: 'Payment verified and processed',
            order: { ...order, Status: 'completed' }
          });
        } else {
          return res.json({ 
            success: true, 
            message: 'Payment already processed',
            order 
          });
        }
      } else {
        return res.json({ 
          success: false, 
          message: 'Payment not completed yet',
          order,
          paymentLinkStatus: paymentLink.status,
          payments: payments.map(p => ({ id: p.id, status: p.status }))
        });
      }
    } catch (razorpayErr) {
      console.error('❌ Razorpay API error:', razorpayErr.response?.data || razorpayErr.message);
      return res.json({ 
        success: false, 
        message: 'Could not check payment status',
        order,
        error: razorpayErr.message 
      });
    }
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

// ============================================================
// ADMIN AUTHENTICATION & MIDDLEWARE
// ============================================================

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify admin still exists and is active
    const adminResult = await pool
      .request()
      .input('adminId', sql.Int, decoded.adminId)
      .query('SELECT AdminID, Username, FullName, Email, Role FROM AdminUsers WHERE AdminID = @adminId AND IsActive = 1;');

    if (!adminResult.recordset.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    req.admin = adminResult.recordset[0];
    req.admin.role = decoded.role;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    next(err);
  }
};

// Role-based access control middleware
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.admin || !allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
};

// Admin login
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
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    await pool
      .request()
      .input('adminId', sql.Int, admin.AdminID)
      .query('UPDATE AdminUsers SET LastLogin = GETDATE() WHERE AdminID = @adminId;');

    const token = jwt.sign(
      { adminId: admin.AdminID, role: admin.Role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        adminId: admin.AdminID,
        username: admin.Username,
        fullName: admin.FullName,
        email: admin.Email,
        role: admin.Role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get current admin profile
app.get('/api/admin/me', authenticateAdmin, async (req, res, next) => {
  try {
    res.json({
      success: true,
      admin: req.admin,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ADMIN DASHBOARD ENDPOINTS
// ============================================================

// Dashboard - Get KPIs and statistics
app.get('/api/admin/dashboard', authenticateAdmin, async (req, res, next) => {
  try {
    const isScanner = req.admin.role === 'scanner';
    const today = new Date().toISOString().split('T')[0];

    if (isScanner) {
      // Scanner role: Show only upcoming and current events
      const eventsResult = await pool
        .request()
        .input('today', sql.Date, today)
        .query(`
          SELECT 
            e.EventID,
            e.EventName,
            e.EventDate,
            e.EventTime,
            e.Venue,
            e.Description,
            e.ImageURL,
            COUNT(DISTINCT CASE WHEN o.Status = 'completed' THEN o.OrderID END) as TicketsSold,
            COUNT(DISTINCT CASE WHEN o.Status = 'completed' AND o.IsScanned = 1 THEN o.OrderID END) as TicketsScanned
          FROM Events e
          LEFT JOIN Orders o ON e.EventID = o.EventID
          WHERE e.IsActive = 1 AND e.EventDate >= @today
          GROUP BY e.EventID, e.EventName, e.EventDate, e.EventTime, e.Venue, e.Description, e.ImageURL
          ORDER BY e.EventDate ASC, e.EventTime ASC;
        `);

      const events = eventsResult.recordset.map(event => ({
        id: event.EventID,
        name: event.EventName,
        date: new Date(event.EventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: event.EventTime,
        venue: event.Venue,
        description: event.Description,
        imageURL: event.ImageURL,
        ticketsSold: parseInt(event.TicketsSold || 0),
        ticketsScanned: parseInt(event.TicketsScanned || 0),
      }));

      res.json({
        success: true,
        stats: {
          upcomingEvents: events.length,
        },
        events,
      });
    } else {
      // Admin role: Show full dashboard stats
      // Total Events
      const eventsResult = await pool
        .request()
        .query('SELECT COUNT(*) as total FROM Events WHERE IsActive = 1;');
      const totalEvents = eventsResult.recordset[0]?.total || 0;

      // Tickets Sold (from completed orders)
      const ticketsResult = await pool
        .request()
        .query(`
          SELECT COUNT(*) as total 
          FROM Orders 
          WHERE Status = 'completed';
        `);
      const ticketsSold = ticketsResult.recordset[0]?.total || 0;

      // Total Revenue (from completed orders)
      const revenueResult = await pool
        .request()
        .query(`
          SELECT ISNULL(SUM(Amount), 0) as total 
          FROM Orders 
          WHERE Status = 'completed';
        `);
      const totalRevenue = parseFloat(revenueResult.recordset[0]?.total || 0);

      // Pending Orders
      const pendingResult = await pool
        .request()
        .query('SELECT COUNT(*) as total FROM Orders WHERE Status = \'pending\';');
      const pendingOrders = pendingResult.recordset[0]?.total || 0;

      // Recent Events with stats
      const recentEventsResult = await pool
        .request()
        .query(`
          SELECT TOP 10
            e.EventID,
            e.EventName,
            e.EventDate,
            e.EventTime,
            e.Venue,
            COUNT(DISTINCT CASE WHEN o.Status = 'completed' THEN o.OrderID END) as Tickets,
            ISNULL(SUM(CASE WHEN o.Status = 'completed' THEN o.Amount ELSE 0 END), 0) as Revenue
          FROM Events e
          LEFT JOIN Orders o ON e.EventID = o.EventID
          WHERE e.IsActive = 1
          GROUP BY e.EventID, e.EventName, e.EventDate, e.EventTime, e.Venue
          ORDER BY e.EventDate DESC;
        `);

      const recentEvents = recentEventsResult.recordset.map(event => ({
        id: event.EventID,
        name: event.EventName,
        date: new Date(event.EventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        tickets: parseInt(event.Tickets || 0),
        revenue: parseFloat(event.Revenue || 0),
      }));

      res.json({
        success: true,
        stats: {
          totalEvents: parseInt(totalEvents),
          ticketsSold: parseInt(ticketsSold),
          totalRevenue: totalRevenue,
          pendingOrders: parseInt(pendingOrders),
        },
        recentEvents,
      });
    }
  } catch (err) {
    next(err);
  }
});

// ============================================================
// EVENTS MANAGEMENT ENDPOINTS
// ============================================================

// Get all events
app.get('/api/admin/events', authenticateAdmin, async (req, res, next) => {
  try {
    const result = await pool
      .request()
      .query(`
        SELECT 
          e.EventID,
          e.EventName,
          e.EventCode,
          MAX(e.EventQR) as EventQR,
          e.EventDate,
          e.EventTime,
          e.Venue,
          e.Description,
          e.ImageURL,
          e.IsActive,
          COUNT(DISTINCT CASE WHEN o.Status = 'completed' THEN o.OrderID END) as TicketsSold,
          ISNULL(SUM(CASE WHEN o.Status = 'completed' THEN o.Amount ELSE 0 END), 0) as Revenue
        FROM Events e
        LEFT JOIN Orders o ON e.EventID = o.EventID
        GROUP BY e.EventID, e.EventName, e.EventCode, e.EventDate, e.EventTime, e.Venue, e.Description, e.ImageURL, e.IsActive
        ORDER BY e.EventDate DESC;
      `);

    const events = result.recordset.map(event => ({
      id: event.EventID,
      name: event.EventName,
      eventCode: event.EventCode,
      eventQr: event.EventQR,
      date: new Date(event.EventDate).toISOString().split('T')[0],
      time: event.EventTime,
      venue: event.Venue,
      description: event.Description,
      imageURL: event.ImageURL,
      isActive: event.IsActive,
      ticketsSold: parseInt(event.TicketsSold || 0),
      revenue: parseFloat(event.Revenue || 0),
    }));

    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
});

// Get single event by ID
app.get('/api/admin/events/:id', authenticateAdmin, async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    if (!eventId) {
      return res.status(400).json({ success: false, message: 'Invalid event ID' });
    }

    const eventResult = await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query(`
        SELECT * FROM Events WHERE EventID = @eventId;
      `);

    if (!eventResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const event = eventResult.recordset[0];

    // Ensure this event has an EventCode and EventQR; if missing, generate and persist
    let eventCode = event.EventCode;
    if (!eventCode) {
      eventCode = `EVT-${event.EventID}`;
    }
    
    // Generate QR if missing
    let eventQr = event.EventQR;
    if (!eventQr) {
      try {
        eventQr = await generateEventQrDataUrl(eventCode);
        console.log(`✅ Generated EventQR for event ${event.EventID} (${eventCode})`);
      } catch (err) {
        console.error(`❌ Error generating EventQR for event ${event.EventID}:`, err.message);
        eventQr = null;
      }
    }
    
    // Update database if EventCode or EventQR is missing
    if (!event.EventCode || !event.EventQR) {
      try {
        await pool
          .request()
          .input('eventId', sql.Int, event.EventID)
          .input('eventCode', sql.NVarChar, eventCode)
          .input('eventQr', sql.NVarChar, eventQr)
          .query('UPDATE Events SET EventCode = @eventCode, EventQR = @eventQr WHERE EventID = @eventId;');
        console.log(`✅ Updated EventCode and EventQR for event ${event.EventID} in database`);
        event.EventCode = eventCode;
        event.EventQR = eventQr;
      } catch (err) {
        console.error(`❌ Error updating EventCode/EventQR in database for event ${event.EventID}:`, err.message);
        // Still use generated values in response even if UPDATE fails
        event.EventCode = eventCode;
        event.EventQR = eventQr;
      }
    }

    // Get ticket types for this event
    const ticketsResult = await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query('SELECT * FROM TicketTypes WHERE EventID = @eventId ORDER BY Price ASC;');

    res.json({
      success: true,
      event: {
        id: event.EventID,
        name: event.EventName,
        eventCode: event.EventCode || eventCode,
        eventQr: event.EventQR || eventQr,
        date: new Date(event.EventDate).toISOString().split('T')[0],
        time: event.EventTime,
        venue: event.Venue,
        description: event.Description,
        imageURL: event.ImageURL,
        isActive: event.IsActive,
      },
      ticketTypes: ticketsResult.recordset.map(t => ({
        id: t.TicketTypeID,
        name: t.TicketName,
        price: parseFloat(t.Price),
        availableQuantity: t.AvailableQuantity,
        totalQuantity: t.TotalQuantity,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Create new event
app.post('/api/admin/events', authenticateAdmin, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { name, date, time, venue, description, imageURL, ticketTypes } = req.body;

    if (!name || !date || !time || !venue) {
      return res.status(400).json({ success: false, message: 'Event name, date, time, and venue are required' });
    }

    // Insert event
    const eventResult = await pool
      .request()
      .input('name', sql.NVarChar, name)
      .input('date', sql.Date, date)
      .input('time', sql.NVarChar, time)
      .input('venue', sql.NVarChar, venue)
      .input('description', sql.NVarChar, description || '')
      .input('imageURL', sql.NVarChar, imageURL || '')
      .query(`
        INSERT INTO Events (EventName, EventDate, EventTime, Venue, Description, ImageURL)
        OUTPUT INSERTED.EventID
        VALUES (@name, @date, @time, @venue, @description, @imageURL);
      `);

    const eventId = eventResult.recordset[0].EventID;

    // Generate event code (e.g., EVT-1001) and save
    const eventCode = `EVT-${eventId}`;
    let eventQr;
    try {
      eventQr = await generateEventQrDataUrl(eventCode);
      console.log(`✅ Generated EventQR for new event ${eventId} (${eventCode})`);
    } catch (err) {
      console.error(`❌ Error generating EventQR for new event ${eventId}:`, err.message);
      eventQr = null;
    }
    
    if (eventQr) {
      try {
        await pool
          .request()
          .input('eventId', sql.Int, eventId)
          .input('eventCode', sql.NVarChar, eventCode)
          .input('eventQr', sql.NVarChar, eventQr)
          .query('UPDATE Events SET EventCode = @eventCode, EventQR = @eventQr WHERE EventID = @eventId;');
        console.log(`✅ Saved EventCode and EventQR for new event ${eventId} in database`);
      } catch (err) {
        console.error(`❌ Error saving EventCode/EventQR for new event ${eventId}:`, err.message);
      }
    }

    // Insert ticket types if provided
    if (ticketTypes && Array.isArray(ticketTypes) && ticketTypes.length > 0) {
      for (const ticket of ticketTypes) {
        if (ticket.name && ticket.price !== undefined) {
          await pool
            .request()
            .input('eventId', sql.Int, eventId)
            .input('ticketName', sql.NVarChar, ticket.name)
            .input('price', sql.Decimal(10, 2), ticket.price)
            .input('availableQuantity', sql.Int, ticket.availableQuantity || 100)
            .input('totalQuantity', sql.Int, ticket.totalQuantity || ticket.availableQuantity || 100)
            .query(`
              INSERT INTO TicketTypes (EventID, TicketName, Price, AvailableQuantity, TotalQuantity)
              VALUES (@eventId, @ticketName, @price, @availableQuantity, @totalQuantity);
            `);
        }
      }
    }

    res.json({
      success: true,
      message: 'Event created successfully',
      eventId,
      eventCode,
    });
  } catch (err) {
    next(err);
  }
});

// Upload event image (returns URL)
app.post(
  '/api/admin/events/upload-image',
  authenticateAdmin,
  requireRole('admin', 'superadmin'),
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file uploaded' });
      }

      const relativePath = `/uploads/events/${req.file.filename}`;
      return res.json({
        success: true,
        url: relativePath,
      });
    } catch (err) {
      next(err);
    }
  }
);

// Update event (and optionally its ticket types)
app.put('/api/admin/events/:id', authenticateAdmin, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const { name, date, time, venue, description, imageURL, isActive, ticketTypes } = req.body;

    if (!eventId) {
      return res.status(400).json({ success: false, message: 'Invalid event ID' });
    }

    // Build update query dynamically
    const updates = [];
    const request = pool.request().input('eventId', sql.Int, eventId);

    if (name !== undefined) {
      updates.push('EventName = @name');
      request.input('name', sql.NVarChar, name);
    }
    if (date !== undefined) {
      updates.push('EventDate = @date');
      request.input('date', sql.Date, date);
    }
    if (time !== undefined) {
      updates.push('EventTime = @time');
      request.input('time', sql.NVarChar, time);
    }
    if (venue !== undefined) {
      updates.push('Venue = @venue');
      request.input('venue', sql.NVarChar, venue);
    }
    if (description !== undefined) {
      updates.push('Description = @description');
      request.input('description', sql.NVarChar, description);
    }
    if (imageURL !== undefined) {
      updates.push('ImageURL = @imageURL');
      request.input('imageURL', sql.NVarChar, imageURL);
    }
    if (isActive !== undefined) {
      updates.push('IsActive = @isActive');
      request.input('isActive', sql.Bit, isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updates.push('UpdatedAt = GETDATE()');

    await request.query(`
      UPDATE Events 
      SET ${updates.join(', ')}
      WHERE EventID = @eventId;
    `);

    // Refresh event code and QR after update - ensure they exist
    const eventResult = await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query('SELECT EventCode, EventQR FROM Events WHERE EventID = @eventId;');

    if (eventResult.recordset.length) {
      let { EventCode: eventCode, EventQR: eventQr } = eventResult.recordset[0];
      if (!eventCode) {
        eventCode = `EVT-${eventId}`;
      }
      if (!eventQr) {
        try {
          eventQr = await generateEventQrDataUrl(eventCode);
          console.log(`✅ Generated EventQR for event ${eventId} (${eventCode}) during update`);
        } catch (err) {
          console.error(`❌ Error generating EventQR for event ${eventId}:`, err.message);
          eventQr = null;
        }
      }
      
      if (eventQr) {
        try {
          await pool
            .request()
            .input('eventId', sql.Int, eventId)
            .input('eventCode', sql.NVarChar, eventCode)
            .input('eventQr', sql.NVarChar, eventQr)
            .query('UPDATE Events SET EventCode = @eventCode, EventQR = @eventQr WHERE EventID = @eventId;');
          console.log(`✅ Updated EventCode and EventQR for event ${eventId} in database`);
        } catch (err) {
          console.error(`❌ Error updating EventCode/EventQR in database for event ${eventId}:`, err.message);
        }
      }
    }

    // If ticketTypes array is provided, upsert ticket types for this event
    if (ticketTypes && Array.isArray(ticketTypes)) {
      // Get existing ticket types for this event
      const existingResult = await pool
        .request()
        .input('eventId', sql.Int, eventId)
        .query('SELECT TicketTypeID FROM TicketTypes WHERE EventID = @eventId;');

      const existingIds = new Set(existingResult.recordset.map(r => r.TicketTypeID));
      const seenIds = new Set();

      for (const ticket of ticketTypes) {
        if (!ticket.name || ticket.price === undefined || ticket.price === null) {
          continue;
        }

        const totalQty = ticket.totalQuantity != null ? ticket.totalQuantity : (ticket.availableQuantity != null ? ticket.availableQuantity : 100);
        const availableQty = ticket.availableQuantity != null ? ticket.availableQuantity : totalQty;

        if (ticket.id && existingIds.has(ticket.id)) {
          // Update existing ticket type
          await pool
            .request()
            .input('ticketTypeId', sql.Int, ticket.id)
            .input('ticketName', sql.NVarChar, ticket.name)
            .input('price', sql.Decimal(10, 2), ticket.price)
            .input('availableQuantity', sql.Int, availableQty)
            .input('totalQuantity', sql.Int, totalQty)
            .query(`
              UPDATE TicketTypes
              SET TicketName = @ticketName,
                  Price = @price,
                  AvailableQuantity = @availableQuantity,
                  TotalQuantity = @totalQuantity
              WHERE TicketTypeID = @ticketTypeId;
            `);

          seenIds.add(ticket.id);
        } else {
          // Insert new ticket type
          await pool
            .request()
            .input('eventId', sql.Int, eventId)
            .input('ticketName', sql.NVarChar, ticket.name)
            .input('price', sql.Decimal(10, 2), ticket.price)
            .input('availableQuantity', sql.Int, availableQty)
            .input('totalQuantity', sql.Int, totalQty)
            .query(`
              INSERT INTO TicketTypes (EventID, TicketName, Price, AvailableQuantity, TotalQuantity)
              VALUES (@eventId, @ticketName, @price, @availableQuantity, @totalQuantity);
            `);
        }
      }

      // Optionally remove ticket types that are no longer present in payload
      const idsToKeep = Array.from(seenIds);
      if (idsToKeep.length > 0) {
        const placeholders = idsToKeep.map((_, idx) => `@keepId${idx}`).join(', ');
        const deleteRequest = pool.request().input('eventId', sql.Int, eventId);
        idsToKeep.forEach((id, idx) => {
          deleteRequest.input(`keepId${idx}`, sql.Int, id);
        });

        await deleteRequest.query(`
          DELETE FROM TicketTypes
          WHERE EventID = @eventId
          AND TicketTypeID NOT IN (${placeholders});
        `);
      }
    }

    res.json({ success: true, message: 'Event updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Delete event (soft delete by setting IsActive = 0)
app.delete('/api/admin/events/:id', authenticateAdmin, requireRole('superadmin'), async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    if (!eventId) {
      return res.status(400).json({ success: false, message: 'Invalid event ID' });
    }

    await pool
      .request()
      .input('eventId', sql.Int, eventId)
      .query('UPDATE Events SET IsActive = 0, UpdatedAt = GETDATE() WHERE EventID = @eventId;');

    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ORDERS MANAGEMENT ENDPOINTS
// ============================================================

// Get all orders (completed, sorted by date)
app.get('/api/admin/orders', authenticateAdmin, async (req, res, next) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT 
        o.OrderID,
        o.OrderNumber,
        o.Status,
        o.Amount,
        o.CreatedAt,
        o.UpdatedAt,
        o.IsScanned,
        o.ScannedAt,
        o.ScannedBy,
        u.FullName as CustomerName,
        u.PhoneNumber,
        u.Email,
        e.EventName,
        tt.TicketName
      FROM Orders o
      JOIN Users u ON o.UserID = u.UserID
      JOIN Events e ON o.EventID = e.EventID
      JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
    `;

    const request = pool.request();

    if (status) {
      query += ' WHERE o.Status = @status';
      request.input('status', sql.NVarChar, status);
    } else {
      // Default: show completed orders
      query += ' WHERE o.Status = \'completed\'';
    }

    query += ' ORDER BY e.EventName ASC, o.UpdatedAt DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;';
    request.input('offset', sql.Int, parseInt(offset));
    request.input('limit', sql.Int, parseInt(limit));

    const result = await request.query(query);

    const orders = result.recordset.map(order => ({
      id: order.OrderID,
      orderNumber: order.OrderNumber,
      customer: order.CustomerName,
      event: order.EventName,
      ticketType: order.TicketName,
      amount: parseFloat(order.Amount),
      status: order.Status,
      isScanned: order.IsScanned,
      scannedAt: order.ScannedAt,
      scannedBy: order.ScannedBy,
      createdAt: order.CreatedAt,
      updatedAt: order.UpdatedAt,
    }));

    res.json({ success: true, orders });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// QR SCAN ENDPOINTS
// ============================================================

// Scan QR code and validate ticket (validate only, don't mark as scanned)
app.post('/api/admin/scan', authenticateAdmin, async (req, res, next) => {
  try {
    const { qrData } = req.body;

    if (!qrData) {
      return res.status(400).json({ success: false, message: 'QR data is required' });
    }

    // Parse QR data - should contain orderNumber
    let orderNumber;
    console.log('📥 Received QR data:', qrData);
    
    try {
      // Try to parse as JSON first
      const qrJson = JSON.parse(qrData);
      console.log('✅ Parsed QR as JSON:', qrJson);
      orderNumber = qrJson.orderNumber;
    } catch (e) {
      // Not JSON, try as plain string (orderNumber or URL)
      console.log('⚠️ QR data is not JSON, trying as string...');
      orderNumber = qrData.trim();
      
      // Extract order number from URL if present
      if (qrData.includes('OrderNumber=')) {
        const match = qrData.match(/OrderNumber=([^&]+)/);
        if (match) orderNumber = decodeURIComponent(match[1]);
      } else if (qrData.includes('order=')) {
        const match = qrData.match(/order=([^&]+)/);
        if (match) orderNumber = decodeURIComponent(match[1]);
      }
    }

    if (!orderNumber) {
      console.error('❌ No orderNumber found in QR data');
      return res.status(400).json({ success: false, message: 'Invalid QR code format. QR code must contain order number.' });
    }
    
    console.log('🔍 Looking up order by orderNumber:', orderNumber);

    // Find the specific order by order number
    const orderResult = await pool
      .request()
      .input('orderNumber', sql.NVarChar, orderNumber)
      .query(`
        SELECT TOP 1
          o.OrderID,
          o.OrderNumber,
          o.UserID,
          o.EventID,
          o.TicketTypeID,
          o.RazorpayOrderID,
          o.RazorpayPaymentID,
          o.Amount,
          o.Status,
          o.QRCode,
          o.Email,
          o.IsScanned,
          o.ScannedAt,
          o.ScannedBy,
          o.CreatedAt,
          o.UpdatedAt,
          u.FullName as CustomerName,
          u.PhoneNumber,
          u.Email as UserEmail,
          e.EventName,
          e.EventDate,
          e.EventTime,
          e.Venue,
          tt.TicketName
        FROM Orders o
        JOIN Users u ON o.UserID = u.UserID
        JOIN Events e ON o.EventID = e.EventID
        JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
        WHERE o.OrderNumber = @orderNumber
        ORDER BY o.OrderID DESC;
      `);

    if (!orderResult.recordset.length) {
      console.error('❌ Order not found for orderNumber:', orderNumber);
      return res.status(404).json({ success: false, message: 'Ticket not found. Invalid QR code.' });
    }

    const order = orderResult.recordset[0];
    console.log('✅ Order found:', {
      OrderID: order.OrderID,
      OrderNumber: order.OrderNumber,
      Status: order.Status,
      IsScanned: order.IsScanned
    });

    // Check if order is completed
    if (order.Status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Ticket payment not completed',
        order: {
          orderNumber: order.OrderNumber,
          status: order.Status,
        },
      });
    }

    // Check if this specific order has been scanned
    if (order.IsScanned === true || order.IsScanned === 1) {
      // Handle arrays - take the last value (most recent scan)
      let scannedBy = order.ScannedBy;
      let scannedAt = order.ScannedAt;
      
      if (Array.isArray(scannedBy)) {
        scannedBy = scannedBy[scannedBy.length - 1] || scannedBy[0] || 'Unknown';
        console.log('⚠️ ScannedBy was array, using last value:', scannedBy);
      }
      
      if (Array.isArray(scannedAt)) {
        scannedAt = scannedAt[scannedAt.length - 1] || scannedAt[0] || null;
        console.log('⚠️ ScannedAt was array, using last value:', scannedAt);
      }
      
      // Format scanned date/time for display
      let scannedAtFormatted = 'N/A';
      if (scannedAt) {
        try {
          const scannedDate = new Date(scannedAt);
          if (!isNaN(scannedDate.getTime())) {
            scannedAtFormatted = scannedDate.toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            });
          } else {
            scannedAtFormatted = String(scannedAt);
          }
        } catch (e) {
          console.error('❌ Error formatting scannedAt:', e);
          scannedAtFormatted = String(scannedAt);
        }
      }

      console.log('📤 Sending already-scanned response:', {
        orderNumber: order.OrderNumber,
        scannedBy: scannedBy,
        scannedAt: scannedAt,
        scannedAtFormatted: scannedAtFormatted,
        IsScanned: order.IsScanned
      });
      
      return res.json({
        success: true,
        message: 'QR code already scanned. This ticket has been used.',
        scanned: true,
        order: {
          orderId: order.OrderID,
          orderNumber: order.OrderNumber,
          customerName: order.CustomerName,
          phoneNumber: order.PhoneNumber,
          email: order.Email,
          eventName: order.EventName,
          eventDate: order.EventDate,
          eventTime: order.EventTime,
          venue: order.Venue,
          ticketType: order.TicketName,
          amount: parseFloat(order.Amount),
          totalAmount: parseFloat(order.Amount),
          totalTicketsPurchased: 1, // One order = one ticket
          scannedAt: scannedAt,
          scannedAtFormatted: scannedAtFormatted,
          scannedBy: scannedBy || 'Unknown',
        },
      });
    }

    // Return order details without marking as scanned (scanner will confirm)
    const responseData = {
      success: true,
      message: 'Ticket validated successfully',
      scanned: false,
      order: {
        orderId: order.OrderID,
        orderNumber: order.OrderNumber,
        customerName: order.CustomerName,
        phoneNumber: order.PhoneNumber,
        email: order.Email,
        eventName: order.EventName,
        eventDate: order.EventDate,
        eventTime: order.EventTime,
        venue: order.Venue,
        ticketType: order.TicketName,
        amount: parseFloat(order.Amount),
        totalTicketsPurchased: 1, // One order = one ticket
        totalAmount: parseFloat(order.Amount),
      },
    };
    
    console.log('📤 Sending scan response:', JSON.stringify(responseData, null, 2));
    res.json(responseData);
  } catch (err) {
    next(err);
  }
});

// Confirm scan - mark THIS specific order as scanned (one-time scan per order)
app.post('/api/admin/scan/confirm', authenticateAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    // Get the specific order
    const orderResult = await pool
      .request()
      .input('orderId', sql.Int, orderId)
      .query(`
        SELECT OrderID, OrderNumber, Status, IsScanned
        FROM Orders
        WHERE OrderID = @orderId;
      `);

    if (!orderResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orderResult.recordset[0];

    if (order.Status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Payment not completed' });
    }

    // Check if already scanned
    if (order.IsScanned === true || order.IsScanned === 1) {
      return res.status(400).json({ 
        success: false, 
        message: 'QR code already scanned. This ticket has been used.' 
      });
    }

    const scannedBy = req.admin.Username || req.admin.FullName || 'Scanner';

    // Mark THIS order as scanned
    await pool
      .request()
      .input('orderId', sql.Int, orderId)
      .input('scannedBy', sql.NVarChar, scannedBy)
      .query(`
        UPDATE Orders 
        SET IsScanned = 1, 
            ScannedAt = GETDATE(), 
            ScannedBy = @scannedBy
        WHERE OrderID = @orderId;
      `);

    res.json({
      success: true,
      message: 'Entry confirmed successfully',
      order: {
        orderNumber: order.OrderNumber,
        scannedAt: new Date(),
        scannedBy: scannedBy,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// USER MANAGEMENT ENDPOINTS (Create Scanner Users)
// ============================================================

// Get all admin users
app.get('/api/admin/users', authenticateAdmin, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const result = await pool
      .request()
      .query(`
        SELECT 
          AdminID,
          Username,
          FullName,
          Email,
          Role,
          IsActive,
          CreatedAt,
          LastLogin
        FROM AdminUsers
        ORDER BY CreatedAt DESC;
      `);

    const users = result.recordset.map(user => ({
      id: user.AdminID,
      username: user.Username,
      fullName: user.FullName,
      email: user.Email,
      role: user.Role,
      isActive: user.IsActive,
      createdAt: user.CreatedAt,
      lastLogin: user.LastLogin,
    }));

    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
});

// Create new user (scanner or admin)
app.post('/api/admin/users', authenticateAdmin, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const { username, password, fullName, email, role = 'scanner' } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    // Validate role
    if (!['admin', 'superadmin', 'scanner'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be admin, superadmin, or scanner' });
    }

    // Check if username already exists
    const existingUser = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .query('SELECT AdminID FROM AdminUsers WHERE Username = @username;');

    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .input('passwordHash', sql.NVarChar, passwordHash)
      .input('fullName', sql.NVarChar, fullName || '')
      .input('email', sql.NVarChar, email || '')
      .input('role', sql.NVarChar, role)
      .query(`
        INSERT INTO AdminUsers (Username, PasswordHash, FullName, Email, Role)
        OUTPUT INSERTED.AdminID
        VALUES (@username, @passwordHash, @fullName, @email, @role);
      `);

    res.json({
      success: true,
      message: 'User created successfully',
      userId: result.recordset[0].AdminID,
    });
  } catch (err) {
    next(err);
  }
});

// Update user
app.put('/api/admin/users/:id', authenticateAdmin, requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const { fullName, email, role, isActive, password } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const updates = [];
    const request = pool.request().input('userId', sql.Int, userId);

    if (fullName !== undefined) {
      updates.push('FullName = @fullName');
      request.input('fullName', sql.NVarChar, fullName);
    }
    if (email !== undefined) {
      updates.push('Email = @email');
      request.input('email', sql.NVarChar, email);
    }
    if (role !== undefined) {
      if (!['admin', 'superadmin', 'scanner'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }
      updates.push('Role = @role');
      request.input('role', sql.NVarChar, role);
    }
    if (isActive !== undefined) {
      updates.push('IsActive = @isActive');
      request.input('isActive', sql.Bit, isActive ? 1 : 0);
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('PasswordHash = @passwordHash');
      request.input('passwordHash', sql.NVarChar, passwordHash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    await request.query(`
      UPDATE AdminUsers 
      SET ${updates.join(', ')}
      WHERE AdminID = @userId;
    `);

    res.json({ success: true, message: 'User updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Delete user (soft delete)
app.delete('/api/admin/users/:id', authenticateAdmin, requireRole('superadmin'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    // Don't allow deleting yourself
    if (userId === req.admin.adminId) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    await pool
      .request()
      .input('userId', sql.Int, userId)
      .query('UPDATE AdminUsers SET IsActive = 0 WHERE AdminID = @userId;');

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------
// Razorpay Webhook & Payment Callback
// ------------------------------------------------------------
app.post('/webhook/razorpay', async (req, res) => {
  console.log('📥 Razorpay webhook received - Full payload:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200); // Immediately acknowledge
  
  try {
    const body = req.body;
    const event = body.event;
    const payload = body.payload;
    
    console.log('📥 Razorpay webhook event:', event);
    console.log('📥 Razorpay webhook payload:', JSON.stringify(payload, null, 2));
    
    // Handle payment.paid event (payment successful)
    if (event === 'payment_link.paid' || event === 'payment.captured') {
      let paymentLinkId = null;
      let paymentId = null;
      let orderId = null;
      
      if (event === 'payment_link.paid') {
        // Payment Link webhook
        paymentLinkId = payload.payment_link?.entity?.id;
        paymentId = payload.payment?.entity?.id;
        orderId = payload.payment?.entity?.order_id;
      } else if (event === 'payment.captured') {
        // Regular payment webhook
        paymentId = payload.payment?.entity?.id;
        orderId = payload.payment?.entity?.order_id;
      }
      
      if (!paymentId) {
        console.error('❌ No payment ID in webhook');
        return;
      }
      
      console.log('🔍 Looking for order with:', { paymentLinkId, paymentId, orderId });
      
      // Find order by payment link ID (stored in RazorpayOrderID column)
      let orderResult = null;
      
      // Try payment link ID first (this is what we stored)
      if (paymentLinkId) {
        console.log('🔍 Searching by payment link ID:', paymentLinkId);
        orderResult = await pool
          .request()
          .input('razorpayOrderId', sql.NVarChar, paymentLinkId)
          .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId AND Status = \'pending\';');
        
        if (orderResult.recordset.length > 0) {
          console.log('✅ Found order by payment link ID');
        }
      }
      
      // If not found, try searching all pending orders and match by reference_id in notes
      if (!orderResult || !orderResult.recordset.length) {
        console.log('🔍 Searching all pending orders...');
        const allPendingOrders = await pool
          .request()
          .query('SELECT * FROM Orders WHERE Status = \'pending\' ORDER BY OrderID DESC;');
        
        console.log(`📋 Found ${allPendingOrders.recordset.length} pending orders`);
        
        // Try to match by payment link ID pattern
        if (paymentLinkId) {
          for (const order of allPendingOrders.recordset) {
            if (order.RazorpayOrderID === paymentLinkId || order.RazorpayOrderID?.includes(paymentLinkId)) {
              orderResult = { recordset: [order] };
              console.log('✅ Found order by matching payment link ID');
              break;
            }
          }
        }
      }
      
      if (orderResult && orderResult.recordset.length > 0) {
        const order = orderResult.recordset[0];
        console.log('✅ Processing payment for order:', order.OrderNumber);
        await processPaymentSuccess(order.OrderID, paymentId);
        console.log('✅ Payment processed via webhook');
      } else {
        console.warn('⚠️ Order not found for payment:', { paymentId, paymentLinkId, orderId });
        console.warn('⚠️ Available pending orders:', allPendingOrders?.recordset?.map(o => ({ 
          OrderNumber: o.OrderNumber, 
          RazorpayOrderID: o.RazorpayOrderID 
        })) || 'none');
      }
    }
  } catch (err) {
    console.error('❌ Razorpay webhook error:', err.message);
    console.error('Webhook payload:', JSON.stringify(req.body, null, 2));
  }
});

// Payment callback handler (for payment links) - Razorpay redirects here after payment
app.get('/payment/callback', async (req, res) => {
  console.log('📥 Payment callback received from Razorpay:', JSON.stringify(req.query, null, 2));
  console.log('📥 Full request:', JSON.stringify({ query: req.query, params: req.params, body: req.body }, null, 2));
  
  try {
    // Razorpay sends these parameters in the callback URL
    const { 
      payment_id, 
      payment_link_id, 
      order_id,
      razorpay_payment_id,
      razorpay_payment_link_id,
      razorpay_order_id,
      status,
      razorpay_signature
    } = req.query;
    
    // Support multiple parameter name formats
    const actualPaymentId = payment_id || razorpay_payment_id;
    const actualPaymentLinkId = payment_link_id || razorpay_payment_link_id;
    const actualOrderId = order_id || razorpay_order_id;
    const paymentStatus = status;
    
    console.log('🔍 Extracted params:', { 
      actualPaymentId, 
      actualPaymentLinkId, 
      actualOrderId, 
      paymentStatus 
    });
    
    // If payment failed or cancelled
    if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
      console.log('❌ Payment failed or cancelled:', paymentStatus);
      const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
      return res.redirect(`${frontendUrl}/payment/error?status=${paymentStatus}`);
    }
    
    // Find order by payment link ID (this is what we stored)
    let orderResult = null;
    
    if (actualPaymentLinkId) {
      console.log('🔍 Searching order by payment link ID:', actualPaymentLinkId);
      orderResult = await pool
        .request()
        .input('razorpayOrderId', sql.NVarChar, actualPaymentLinkId)
        .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId AND Status = \'pending\';');
      
      if (orderResult.recordset.length > 0) {
        console.log('✅ Found order by payment link ID');
      }
    }
    
    // If not found, search all recent pending orders
    if (!orderResult || !orderResult.recordset.length) {
      console.log('🔍 Searching all pending orders...');
      const allPendingOrders = await pool
        .request()
        .query('SELECT * FROM Orders WHERE Status = \'pending\' ORDER BY OrderID DESC;');
      
      console.log(`📋 Found ${allPendingOrders.recordset.length} pending orders`);
      
      if (actualPaymentLinkId) {
        for (const order of allPendingOrders.recordset) {
          if (order.RazorpayOrderID === actualPaymentLinkId || 
              order.RazorpayOrderID?.includes(actualPaymentLinkId) ||
              order.RazorpayOrderID?.endsWith(actualPaymentLinkId)) {
            orderResult = { recordset: [order] };
            console.log('✅ Found order by matching payment link ID:', order.OrderNumber);
            break;
          }
        }
      }
    }
    
    if (orderResult && orderResult.recordset.length > 0) {
      const order = orderResult.recordset[0];
      
      console.log('✅ Order found! Processing payment IMMEDIATELY:', order.OrderNumber);
      
      // Process payment immediately (callback means payment was successful)
      // Don't wait for verification - process in background and redirect immediately
      if (actualPaymentId) {
        // Process payment immediately in background (non-blocking)
        processPaymentSuccess(order.OrderID, actualPaymentId).catch(err => {
          console.error('❌ Error processing payment:', err.message);
        });
        
        // Redirect immediately (don't wait)
        const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
        return res.redirect(`${frontendUrl}/payment/success?order=${order.OrderNumber}`);
      } else {
        // If no payment ID, still try to process (maybe payment link status changed)
        console.log('⚠️ No payment ID, checking payment link status...');
        try {
          const keyId = process.env.RAZORPAY_KEY_ID;
          const keySecret = process.env.RAZORPAY_KEY_SECRET;
          
          const paymentLinkResponse = await axios.get(
            `https://api.razorpay.com/v1/payment_links/${actualPaymentLinkId}`,
            {
              auth: {
                username: keyId,
                password: keySecret,
              },
            }
          );
          
          const paymentLink = paymentLinkResponse.data;
          if (paymentLink.status === 'paid' && paymentLink.payments?.length > 0) {
            const paymentId = paymentLink.payments[0].id;
            processPaymentSuccess(order.OrderID, paymentId).catch(err => {
              console.error('❌ Error processing payment:', err.message);
            });
          }
        } catch (err) {
          console.error('❌ Error checking payment link:', err.message);
        }
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
        return res.redirect(`${frontendUrl}/payment/success?order=${order.OrderNumber}`);
      }
    } else {
      console.warn('⚠️ Order not found for payment callback');
      console.warn('⚠️ Payment link ID:', actualPaymentLinkId);
      console.warn('⚠️ Payment ID:', actualPaymentId);
    }
    
    // If order not found or payment failed
    const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
    return res.redirect(`${frontendUrl}/payment/error`);
  } catch (err) {
    console.error('❌ Payment callback error:', err.message);
    console.error('❌ Error stack:', err.stack);
    const frontendUrl = process.env.FRONTEND_URL || 'https://ultraa-events.vercel.app';
    return res.redirect(`${frontendUrl}/payment/error`);
  }
});

// Function to check payment status from Razorpay and process if successful
async function checkAndProcessPayment(paymentLinkId, orderNumber) {
  try {
    console.log(`🔍 Checking payment status for link: ${paymentLinkId}, order: ${orderNumber}`);
    
    // Find order
    const orderResult = await pool
      .request()
      .input('razorpayOrderId', sql.NVarChar, paymentLinkId)
      .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId;');
    
    if (!orderResult.recordset.length) {
      console.log('⚠️ Order not found for payment link:', paymentLinkId);
      return;
    }
    
    const order = orderResult.recordset[0];
    
    // Skip if already processed
    if (order.Status === 'completed') {
      console.log('✅ Order already completed:', orderNumber);
      return;
    }
    
    // Check payment status via Razorpay API
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    try {
      const paymentLinkResponse = await axios.get(
        `https://api.razorpay.com/v1/payment_links/${paymentLinkId}`,
        {
          auth: {
            username: keyId,
            password: keySecret,
          },
        }
      );
      
      const paymentLink = paymentLinkResponse.data;
      console.log(`📊 Payment link status: ${paymentLink.status}`);
      
      // Check if payment link is paid
      if (paymentLink.status === 'paid') {
        const payments = paymentLink.payments || [];
        
        if (payments.length > 0) {
          const successfulPayment = payments.find(p => p.status === 'captured') || payments[0];
          
          if (successfulPayment && successfulPayment.status === 'captured') {
            const paymentId = successfulPayment.id;
            console.log(`✅ Payment successful! Processing order ${orderNumber} with payment ID: ${paymentId}`);
            // Remove from check attempts map since payment is successful
            paymentCheckAttempts.delete(order.OrderID);
            await processPaymentSuccess(order.OrderID, paymentId);
            return;
          }
        }
      }
      
      console.log(`⏳ Payment not completed yet for order ${orderNumber}. Status: ${paymentLink.status}`);
    } catch (razorpayErr) {
      console.error('❌ Error checking Razorpay payment:', razorpayErr.response?.data || razorpayErr.message);
    }
  } catch (err) {
    console.error('❌ Error in checkAndProcessPayment:', err.message);
  }
}

// In-memory tracking of check attempts (persists during server runtime)
// Key: OrderID, Value: number of checks
const paymentCheckAttempts = new Map();

// Background job: Periodically check pending payments (fallback only)
// This is a backup in case callback/webhook fails
// Each payment will be checked maximum 10 times, then marked as failed
async function checkPendingPayments() {
  try {
    // Get ALL pending orders with payment links (older than 1 minute to avoid checking brand new orders)
    const pendingOrders = await pool
      .request()
      .query(`
        SELECT OrderID, OrderNumber, RazorpayOrderID, CreatedAt
        FROM Orders 
        WHERE Status = 'pending' 
          AND RazorpayOrderID LIKE 'plink_%'
          AND CreatedAt > DATEADD(hour, -24, GETDATE())
          AND CreatedAt < DATEADD(minute, -1, GETDATE())
        ORDER BY CreatedAt ASC;
      `);
    
    if (pendingOrders.recordset.length === 0) {
      return; // No pending payments to check
    }
    
    console.log(`🔄 Background check: Found ${pendingOrders.recordset.length} pending orders (checking all)`);
    
    let processedCount = 0;
    let failedCount = 0;
    
    for (const order of pendingOrders.recordset) {
      try {
        // Get current check count for this order
        const currentAttempts = paymentCheckAttempts.get(order.OrderID) || 0;
        
        // If already checked 10 times, mark as failed
        if (currentAttempts >= 10) {
          // Check if already marked as failed
          const orderCheck = await pool
            .request()
            .input('orderId', sql.Int, order.OrderID)
            .query('SELECT Status FROM Orders WHERE OrderID = @orderId;');
          
          if (orderCheck.recordset[0]?.Status === 'pending') {
            // Mark as failed after 10 attempts
            await pool
              .request()
              .input('orderId', sql.Int, order.OrderID)
              .query('UPDATE Orders SET Status = \'failed\' WHERE OrderID = @orderId;');
            
            console.log(`❌ Order ${order.OrderNumber} marked as failed after 10 check attempts`);
            failedCount++;
            // Remove from tracking
            paymentCheckAttempts.delete(order.OrderID);
          }
          continue;
        }
        
        // Increment check count
        paymentCheckAttempts.set(order.OrderID, currentAttempts + 1);
        
        const orderAge = Math.floor((new Date() - new Date(order.CreatedAt)) / 1000 / 60); // Age in minutes
        console.log(`🔍 Checking order ${order.OrderNumber} (${orderAge} min old, attempt ${currentAttempts + 1}/10)`);
        
        await checkAndProcessPayment(order.RazorpayOrderID, order.OrderNumber);
        processedCount++;
        
        // Small delay between checks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`❌ Error checking order ${order.OrderNumber}:`, err.message);
      }
    }
    
    if (processedCount > 0 || failedCount > 0) {
      console.log(`✅ Background check completed: Processed ${processedCount} orders, Failed ${failedCount} orders (max attempts reached)`);
    }
  } catch (err) {
    console.error('❌ Error in checkPendingPayments:', err.message);
  }
}

// Run payment check every 1 minute (fallback - in case callback doesn't work)
// Checks all pending orders older than 1 minute
setInterval(() => {
  checkPendingPayments().catch(err => {
    console.error('❌ Background payment check error:', err.message);
  });
}, 60000); // 1 minute - check all pending payments

// Helper function to process successful payment
async function processPaymentSuccess(orderId, paymentId) {
  try {
    // Get order details
    const orderResult = await pool
      .request()
      .input('orderId', sql.Int, orderId)
      .query('SELECT * FROM Orders WHERE OrderID = @orderId;');
    
    if (!orderResult.recordset.length) {
      console.error('❌ Order not found:', orderId);
      return;
    }
    
    const order = orderResult.recordset[0];
    
    // Check if already processed
    if (order.Status === 'completed') {
      console.log('✅ Payment already processed for order:', order.OrderNumber);
      // Clean up tracking
      paymentCheckAttempts.delete(orderId);
      return;
    }
    
    // Clean up tracking since payment is being processed
    paymentCheckAttempts.delete(orderId);
    
    // Generate QR code based on OrderNumber (one QR per order)
    const qrData = JSON.stringify({
      orderNumber: order.OrderNumber,
      orderId: order.OrderID,
      timestamp: new Date().toISOString(),
    });
    const qrCode = await generateQRCode(qrData);
    
    // Get user email from Users table to update Orders
    const userEmailResult = await pool
      .request()
      .input('userId', sql.Int, order.UserID)
      .query('SELECT Email FROM Users WHERE UserID = @userId;');
    
    const userEmail = userEmailResult.recordset[0]?.Email || null;
    
    // Update order with payment ID and email
    await pool
      .request()
      .input('orderId', sql.Int, orderId)
      .input('paymentId', sql.NVarChar, paymentId)
      .input('qrCode', sql.NVarChar, qrCode)
      .input('email', sql.NVarChar, userEmail)
      .query(`
        UPDATE Orders
        SET Status = 'completed',
            RazorpayPaymentID = @paymentId,
            Email = COALESCE(@email, Email),
            QRCode = @qrCode
        WHERE OrderID = @orderId;
      `);
    
    // Decrease ticket quantity
    await pool
      .request()
      .input('ticketTypeId', sql.Int, order.TicketTypeID)
      .query('UPDATE TicketTypes SET AvailableQuantity = AvailableQuantity - 1 WHERE TicketTypeID = @ticketTypeId;');
    
    // Get user and event details for WhatsApp confirmation
    const orderDetails = await pool
      .request()
      .input('orderId', sql.Int, orderId)
      .query(`
        SELECT o.*, u.FullName, u.PhoneNumber, u.Email, e.EventName, e.EventDate, e.EventTime, e.Venue, tt.TicketName
        FROM Orders o
        JOIN Users u ON o.UserID = u.UserID
        JOIN Events e ON o.EventID = e.EventID
        JOIN TicketTypes tt ON o.TicketTypeID = tt.TicketTypeID
        WHERE o.OrderID = @orderId;
      `);
    
    if (orderDetails.recordset.length > 0) {
      const orderInfo = orderDetails.recordset[0];
      const userPhone = orderInfo.PhoneNumber;
      
      // Format event date and time
      const eventDate = new Date(orderInfo.EventDate);
      const formattedDate = eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      let eventTime = '';
      if (orderInfo.EventTime) {
        try {
          let timeStr = String(orderInfo.EventTime).trim();
          // Handle Date object or date string with 1970
          if (timeStr.includes('1970') || timeStr.includes('GMT') || timeStr.includes('Jan 01 1970')) {
            const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
              const hours = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
              const minutes = timeMatch[2];
              eventTime = `${hours}:${minutes}`;
            }
          } else if (timeStr.includes(':')) {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
              const hours = String(parseInt(parts[0], 10)).padStart(2, '0');
              const minutes = parts[1];
              eventTime = `${hours}:${minutes}`;
            }
          }
        } catch (err) {
          console.warn('⚠️ Error formatting time in confirmation:', err.message);
        }
      }
      
      // Send WhatsApp confirmation message (text first)
      const confirmationMessage = 
        `🎉 *Payment Successful!*\n\n` +
        `✅ Your ticket has been confirmed!\n\n` +
        `📦 *Order Details:*\n` +
        `Order Number: ${orderInfo.OrderNumber}\n` +
        `Event: ${orderInfo.EventName}\n` +
        `Ticket: ${orderInfo.TicketName}\n` +
        `Date: ${formattedDate}\n` +
        `${eventTime ? `Time: ${eventTime}\n` : ''}` +
        `Venue: ${orderInfo.Venue}\n\n` +
        `🎫 *Your QR Code:*\n` +
        `Show this QR code at the venue for entry.\n\n` +
        `Thank you for choosing Ultraa Events! 🎊`;
      
      try {
        await sendWhatsAppMessage(userPhone, confirmationMessage);
        console.log(`✅ Payment confirmation sent to ${userPhone}`);
        
        // Send QR code as image
        if (qrCode) {
          await sendWhatsAppImage(userPhone, qrCode, 'Your Event Ticket QR Code');
          console.log(`✅ QR code image sent to ${userPhone}`);
        }
      } catch (whatsappErr) {
        console.error('⚠️ Failed to send WhatsApp confirmation:', whatsappErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Error processing payment success:', err.message);
    throw err;
  }
}

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
      EventCode NVARCHAR(50) NULL,
      EventDate DATE NOT NULL,
      EventTime TIME NOT NULL,
      Venue NVARCHAR(300) NOT NULL,
      Description NVARCHAR(MAX),
      ImageURL NVARCHAR(500),
      EventQR NVARCHAR(MAX),
      IsActive BIT DEFAULT 1,
      CreatedAt DATETIME DEFAULT GETDATE(),
      UpdatedAt DATETIME DEFAULT GETDATE()
    );
  `);

  // Add EventCode column to Events if it doesn't exist (migration)
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('Events') AND name = 'EventCode'
    )
    ALTER TABLE Events ADD EventCode NVARCHAR(50) NULL;
  `);

  // Add EventQR column if it doesn't exist (for printed event QR codes)
  await request.query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('Events') AND name = 'EventQR'
    )
    ALTER TABLE Events ADD EventQR NVARCHAR(MAX) NULL;
  `);

  // Ensure existing rows have an EventCode
  await request.query(`
    UPDATE Events
    SET EventCode = CONCAT('EVT-', EventID)
    WHERE EventCode IS NULL;
  `);

  // Populate EventQR for existing events that don't have it
  try {
    const eventsWithoutQr = await pool
      .request()
      .query('SELECT EventID, EventCode FROM Events WHERE EventQR IS NULL;');
    
    if (eventsWithoutQr.recordset.length > 0) {
      console.log(`📋 Found ${eventsWithoutQr.recordset.length} events without EventQR. Generating QR codes...`);
      for (const event of eventsWithoutQr.recordset) {
        const eventCode = event.EventCode || `EVT-${event.EventID}`;
        try {
          const eventQr = await generateEventQrDataUrl(eventCode);
          await pool
            .request()
            .input('eventId', sql.Int, event.EventID)
            .input('eventQr', sql.NVarChar, eventQr)
            .query('UPDATE Events SET EventQR = @eventQr WHERE EventID = @eventId;');
          console.log(`✅ Generated and saved EventQR for event ${event.EventID} (${eventCode})`);
        } catch (err) {
          console.error(`❌ Error generating EventQR for event ${event.EventID}:`, err.message);
        }
      }
      console.log(`✅ Finished populating EventQR for existing events`);
    }
  } catch (err) {
    console.error('❌ Error populating EventQR for existing events:', err.message);
  }

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
      Email NVARCHAR(100),
      Role NVARCHAR(20) DEFAULT 'admin' CHECK (Role IN ('admin', 'superadmin', 'scanner')),
      IsActive BIT DEFAULT 1,
      CreatedAt DATETIME DEFAULT GETDATE(),
      LastLogin DATETIME
    );
  `);

  // Create OrderScans table to track individual scans (one QR can be scanned multiple times)
  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='OrderScans' AND type='U')
    CREATE TABLE OrderScans (
      ScanID INT IDENTITY(1,1) PRIMARY KEY,
      OrderID INT NOT NULL,
      ScannedBy NVARCHAR(100),
      ScannedAt DATETIME DEFAULT GETDATE(),
      CONSTRAINT FK_OrderScans_Orders FOREIGN KEY (OrderID) REFERENCES Orders(OrderID) ON DELETE CASCADE
    );
  `);

  // Create index on OrderScans if it doesn't exist
  await request.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_OrderScans_OrderID' AND object_id = OBJECT_ID('OrderScans'))
    CREATE INDEX IX_OrderScans_OrderID ON OrderScans(OrderID);
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

