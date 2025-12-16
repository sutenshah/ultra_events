# 💳 Razorpay Payment Flow Guide

## Understanding the Payment Process

### ⚠️ Important: `razorpay_payment_id` is NULL by Design!

When you call `/api/orders/create`, you get:
- ✅ `razorpay_order_id` - Created immediately
- ❌ `razorpay_payment_id` - **NULL** (payment hasn't happened yet)
- ❌ `razorpay_signature` - **Not available** (payment hasn't happened yet)

**This is normal!** Payment ID and signature only come AFTER the user completes payment.

---

## 🔄 Complete Payment Flow

### Step 1: Create Order (Backend)

**API:** `POST /api/orders/create`

**Request:**
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
    "RazorpayOrderID": "order_Mxxxxxxxxxxxxx",
    "RazorpayPaymentID": null,  // ← NULL because payment not done yet
    "Status": "pending",
    "Amount": 500.00
  },
  "razorpay": {
    "orderId": "order_Mxxxxxxxxxxxxx",  // ← Use this in frontend
    "amount": 50000,  // Amount in paise
    "currency": "INR",
    "keyId": "rzp_test_xxxxxxxxxxxxx"  // ← Use this in frontend
  }
}
```

**What you get:**
- `razorpay.orderId` - Razorpay order ID
- `razorpay.keyId` - Your Razorpay key ID
- `razorpay.amount` - Amount in paise

**What you DON'T get yet:**
- `razorpay_payment_id` - Will come after payment
- `razorpay_signature` - Will come after payment

---

### Step 2: Initialize Razorpay Checkout (Frontend)

Use the values from Step 1 to initialize Razorpay checkout in your frontend:

**HTML Example:**
```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
    <button onclick="payNow()">Pay Now</button>

    <script>
        function payNow() {
            // Get these values from /api/orders/create response
            const options = {
                key: "rzp_test_xxxxxxxxxxxxx",  // razorpay.keyId from Step 1
                amount: 50000,  // razorpay.amount from Step 1 (in paise)
                currency: "INR",
                name: "Ultraa Events",
                description: "Event Ticket Purchase",
                order_id: "order_Mxxxxxxxxxxxxx",  // razorpay.orderId from Step 1
                handler: function (response) {
                    // ✅ Payment successful!
                    // response contains payment_id and signature
                    console.log("Payment ID:", response.razorpay_payment_id);
                    console.log("Order ID:", response.razorpay_order_id);
                    console.log("Signature:", response.razorpay_signature);
                    
                    // Send to backend for verification
                    verifyPayment(response);
                },
                prefill: {
                    name: "John Doe",
                    email: "customer@example.com",
                    contact: "9876543210"
                },
                theme: {
                    color: "#3399cc"
                }
            };

            const razorpay = new Razorpay(options);
            razorpay.open();
        }

        async function verifyPayment(response) {
            // Send to your backend
            const result = await fetch('http://localhost:3000/api/orders/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature
                })
            });
            
            const data = await result.json();
            console.log("Verification result:", data);
        }
    </script>
</body>
</html>
```

**React Example:**
```jsx
import { useEffect } from 'react';
import Razorpay from 'razorpay';

function PaymentButton({ orderData }) {
  const handlePayment = () => {
    const options = {
      key: orderData.razorpay.keyId,
      amount: orderData.razorpay.amount,
      currency: 'INR',
      name: 'Ultraa Events',
      description: 'Event Ticket',
      order_id: orderData.razorpay.orderId,
      handler: async (response) => {
        // ✅ Payment successful - response contains:
        // response.razorpay_payment_id
        // response.razorpay_order_id
        // response.razorpay_signature
        
        // Verify payment
        const verifyResponse = await fetch('http://localhost:3000/api/orders/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          })
        });
        
        const result = await verifyResponse.json();
        if (result.success) {
          alert('Payment verified! QR code generated.');
        }
      },
      prefill: {
        name: 'John Doe',
        email: 'customer@example.com'
      }
    };

    const razorpay = new Razorpay(options);
    razorpay.open();
  };

  return <button onClick={handlePayment}>Pay ₹{orderData.order.Amount}</button>;
}
```

---

### Step 3: User Completes Payment

When user clicks "Pay" and completes payment:
1. Razorpay shows payment form
2. User enters card details (or uses UPI/wallet)
3. Payment is processed
4. Razorpay calls the `handler` function with payment details

**Handler receives:**
```javascript
{
  razorpay_payment_id: "pay_Mxxxxxxxxxxxxx",  // ← Payment ID
  razorpay_order_id: "order_Mxxxxxxxxxxxxx",   // ← Order ID
  razorpay_signature: "abc123def456..."        // ← Signature for verification
}
```

---

### Step 4: Verify Payment (Backend)

**API:** `POST /api/orders/verify`

**Request:**
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
  "qrCode": "data:image/png;base64,iVBORw0KGgo..."
}
```

**What happens:**
1. ✅ Signature is verified
2. ✅ Order status changes to `completed`
3. ✅ QR code is generated
4. ✅ Ticket quantity is decremented
5. ✅ Payment ID is saved to database

---

## 📍 Where to Find Payment ID & Signature

### ✅ From Razorpay Handler (Frontend)

After payment, Razorpay calls your handler function with:

```javascript
handler: function (response) {
    // response contains:
    const paymentId = response.razorpay_payment_id;    // ← Payment ID
    const orderId = response.razorpay_order_id;        // ← Order ID
    const signature = response.razorpay_signature;      // ← Signature
    
    // Send these to your backend
    verifyPayment(response);
}
```

### ✅ From Razorpay Dashboard

1. Go to https://dashboard.razorpay.com
2. Navigate to **Payments** → **All Payments**
3. Find your payment
4. Click to view details
5. You'll see:
   - Payment ID: `pay_Mxxxxxxxxxxxxx`
   - Order ID: `order_Mxxxxxxxxxxxxx`
   - Signature: (not shown, only available in callback)

### ✅ From Webhook (Optional)

If you set up Razorpay webhooks, you'll receive payment details via webhook.

---

## 🧪 Testing Without Frontend

### Option 1: Use Razorpay Test Cards

1. Create order via Postman: `POST /api/orders/create`
2. Copy `razorpay.orderId` and `razorpay.keyId`
3. Open Razorpay test checkout:
   ```
   https://razorpay.com/payment-button/pl_xxxxxxxxxxxxx/test/
   ```
4. Complete payment with test card:
   - Card: `4111 1111 1111 1111`
   - CVV: `123`
   - Expiry: `12/25`
5. After payment, get payment details from Razorpay dashboard
6. Use those details in `POST /api/orders/verify`

### Option 2: Mock Payment Verification (For Testing)

**⚠️ This bypasses actual payment - use only for testing!**

Create a test endpoint that simulates payment:

```javascript
// Add this temporarily for testing
app.post('/api/orders/test-verify', async (req, res) => {
  const { razorpay_order_id } = req.body;
  
  // Get order
  const order = await pool.request()
    .input('razorpayOrderId', sql.NVarChar, razorpay_order_id)
    .query('SELECT * FROM Orders WHERE RazorpayOrderID = @razorpayOrderId;');
  
  if (!order.recordset.length) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  
  // Generate mock signature
  const mockPaymentId = 'pay_TEST_' + Date.now();
  const text = `${razorpay_order_id}|${mockPaymentId}`;
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(text)
    .digest('hex');
  
  // Verify with mock data
  const verifyResponse = await fetch('http://localhost:3000/api/orders/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      razorpay_order_id,
      razorpay_payment_id: mockPaymentId,
      razorpay_signature: signature
    })
  });
  
  const result = await verifyResponse.json();
  res.json(result);
});
```

---

## 🔍 Common Questions

### Q: Why is `razorpay_payment_id` NULL after creating order?

**A:** Because payment hasn't happened yet! The order is created first, then user pays, then payment ID is generated.

### Q: Where do I get `razorpay_signature`?

**A:** From Razorpay's payment handler callback in your frontend. It's automatically generated by Razorpay after successful payment.

### Q: Can I get payment ID without frontend?

**A:** Yes, but you need to:
1. Complete payment via Razorpay dashboard test mode
2. Or set up Razorpay webhooks
3. Or use Razorpay API to check payment status

### Q: How do I test payment flow without frontend?

**A:** Use Razorpay test cards in Razorpay's test checkout page, or use the mock verification endpoint above.

---

## 📝 Summary

1. **Create Order** → Get `orderId` and `keyId` (payment_id is NULL ✅)
2. **Initialize Razorpay** → Use `orderId` and `keyId` in frontend
3. **User Pays** → Razorpay returns `payment_id` and `signature` in handler
4. **Verify Payment** → Send `payment_id` and `signature` to backend
5. **Order Completed** → QR code generated, ticket quantity updated

---

## 🚀 Next Steps

1. **Build Frontend** - Create payment page with Razorpay checkout
2. **Test Payment** - Use Razorpay test cards
3. **Handle Callback** - Send payment details to `/api/orders/verify`
4. **Show QR Code** - Display QR code after successful verification

---

**Need help? Check Razorpay Docs:** https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/

