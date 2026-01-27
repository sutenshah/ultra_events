// Admin Dashboard JavaScript
const API_BASE = window.location.origin;
let currentView = 'dashboard';
let scannerStream = null;
let scannerInterval = null;

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('adminToken');
    if (!token) {
        window.location.href = 'admin-login.html';
        return false;
    }
    return true;
}

// API Helper
async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('adminToken');
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        logout();
        return null;
    }

    return await response.json();
}

// Format currency
function formatCurrency(amount) {
    return `₹${parseInt(amount).toLocaleString('en-IN')}`;
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.getAttribute('data-view');
            switchView(view);
            document.getElementById('sidebar').classList.remove('show');
        });
    });

    document.querySelector('.nav-item[data-action="logout"]').addEventListener('click', logout);
    document.getElementById('menuToggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('show');
    });
}

function switchView(view) {
    currentView = view;
    
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    
    // Show selected view
    document.getElementById(`${view}View`).style.display = 'block';
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    
    // Load data for view
    switch(view) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'events':
            loadEvents();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'scanner':
            stopScanner(); // Stop scanner if running
            break;
        case 'users':
            loadUsers();
            break;
    }
}

// Dashboard
async function loadDashboard() {
    const data = await apiCall('/api/admin/dashboard');
    if (!data || !data.success) {
        document.getElementById('recentEventsTable').innerHTML = '<tr><td colspan="4" class="empty-state">Failed to load dashboard</td></tr>';
        return;
    }

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const isScanner = adminInfo.role === 'scanner';

    if (isScanner) {
        // Scanner view: Show upcoming events
        document.getElementById('statTotalEvents').textContent = data.stats.upcomingEvents || 0;
        document.getElementById('statTicketsSold').textContent = '-';
        document.getElementById('statTotalRevenue').textContent = '-';
        document.getElementById('statPendingOrders').textContent = '-';

        // Update table headers
        document.getElementById('eventsTableTitle').textContent = 'Upcoming & Current Events';
        document.getElementById('eventsTableCol3').textContent = 'Venue';
        document.getElementById('eventsTableCol4').textContent = 'Tickets Status';

        // Show events as table rows
        const tbody = document.getElementById('recentEventsTable');
        if (data.events && data.events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No upcoming events found</td></tr>';
        } else {
            tbody.innerHTML = data.events.map(event => `
                <tr>
                    <td><strong>${event.name}</strong></td>
                    <td>${event.date} ${event.time || ''}</td>
                    <td>${event.venue || 'TBA'}</td>
                    <td>${event.ticketsSold || 0} sold, ${event.ticketsScanned || 0} scanned</td>
                </tr>
            `).join('');
        }
    } else {
        // Reset table headers for admin
        document.getElementById('eventsTableTitle').textContent = 'Recent Events';
        document.getElementById('eventsTableCol3').textContent = 'Tickets';
        document.getElementById('eventsTableCol4').textContent = 'Revenue';
        // Admin view: Show full stats
        document.getElementById('statTotalEvents').textContent = data.stats.totalEvents;
        document.getElementById('statTicketsSold').textContent = data.stats.ticketsSold;
        document.getElementById('statTotalRevenue').textContent = formatCurrency(data.stats.totalRevenue);
        document.getElementById('statPendingOrders').textContent = data.stats.pendingOrders;

        // Update recent events table
        const tbody = document.getElementById('recentEventsTable');
        if (data.recentEvents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No events found</td></tr>';
        } else {
            tbody.innerHTML = data.recentEvents.map(event => `
                <tr>
                    <td>${event.name}</td>
                    <td>${event.date}</td>
                    <td>${event.tickets}</td>
                    <td>${formatCurrency(event.revenue)}</td>
                </tr>
            `).join('');
        }
    }
}

// Events
async function loadEvents() {
    const data = await apiCall('/api/admin/events');
    if (!data || !data.success) {
        document.getElementById('eventsGrid').innerHTML = '<div class="empty-state">Failed to load events</div>';
        return;
    }

    const grid = document.getElementById('eventsGrid');
    if (data.events.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><p>No events found. Create your first event!</p></div>';
    } else {
        grid.innerHTML = data.events.map(event => `
            <div class="event-card">
                <div class="event-banner">📅</div>
                <div class="event-content">
                    <h3>${event.name}</h3>
                    <p style="color: #666; margin-bottom: 12px;">📅 ${formatDate(event.date)}</p>
                    <div class="event-meta">
                        <span>Tickets: <strong>${event.ticketsSold}</strong></span>
                        <span class="event-revenue">${formatCurrency(event.revenue)}</span>
                    </div>
                    <button class="btn btn-primary" style="width: 100%;" onclick="editEvent(${event.id})">Manage Event</button>
                </div>
            </div>
        `).join('');
    }
}

function showCreateEvent() {
    document.getElementById('eventModalTitle').textContent = 'Create Event';
    document.getElementById('eventForm').reset();
    document.getElementById('eventId').value = '';
    document.getElementById('eventModal').classList.add('show');
}

async function editEvent(eventId) {
    const data = await apiCall(`/api/admin/events/${eventId}`);
    if (!data || !data.success) return;

    const event = data.event;
    document.getElementById('eventModalTitle').textContent = 'Edit Event';
    document.getElementById('eventId').value = event.id;
    document.getElementById('eventName').value = event.name;
    document.getElementById('eventDate').value = event.date;
    document.getElementById('eventTime').value = event.time;
    document.getElementById('eventVenue').value = event.venue;
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventImageURL').value = event.imageURL || '';
    document.getElementById('eventModal').classList.add('show');
}

function closeEventModal() {
    document.getElementById('eventModal').classList.remove('show');
}

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const eventId = document.getElementById('eventId').value;
    const eventData = {
        name: document.getElementById('eventName').value,
        date: document.getElementById('eventDate').value,
        time: document.getElementById('eventTime').value,
        venue: document.getElementById('eventVenue').value,
        description: document.getElementById('eventDescription').value,
        imageURL: document.getElementById('eventImageURL').value,
    };

    let result;
    if (eventId) {
        result = await apiCall(`/api/admin/events/${eventId}`, {
            method: 'PUT',
            body: JSON.stringify(eventData),
        });
    } else {
        result = await apiCall('/api/admin/events', {
            method: 'POST',
            body: JSON.stringify(eventData),
        });
    }

    if (result && result.success) {
        alert(eventId ? 'Event updated successfully!' : 'Event created successfully!');
        closeEventModal();
        loadEvents();
        if (currentView === 'dashboard') loadDashboard();
    } else {
        alert(result?.message || 'Failed to save event');
    }
});

// Orders
async function loadOrders() {
    const data = await apiCall('/api/admin/orders?status=completed&limit=100');
    if (!data || !data.success) {
        document.getElementById('ordersTable').innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load orders</td></tr>';
        return;
    }

    const tbody = document.getElementById('ordersTable');
    if (data.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No orders found</td></tr>';
    } else {
        tbody.innerHTML = data.orders.map(order => `
            <tr>
                <td>#${order.id}</td>
                <td>${order.customer}</td>
                <td>${order.event}</td>
                <td>${order.ticketType}</td>
                <td>${formatCurrency(order.amount)}</td>
                <td><span class="badge badge-success">${order.status}</span></td>
            </tr>
        `).join('');
    }
}

// QR Scanner
function startScanner() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            scannerStream = stream;
            video.srcObject = stream;
            video.style.display = 'block';
            document.getElementById('startScannerBtn').style.display = 'none';
            document.getElementById('stopScannerBtn').style.display = 'inline-block';

            // QR scanning with jsQR library
            scannerInterval = setInterval(() => {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    
                    // Use jsQR to scan QR code
                    if (typeof jsQR !== 'undefined') {
                        const code = jsQR(imageData.data, imageData.width, imageData.height);
                        if (code) {
                            console.log('QR Code detected:', code.data);
                            scanQRCode(code.data);
                            stopScanner(); // Stop after successful scan
                        }
                    } else {
                        console.warn('jsQR library not loaded. Please refresh the page.');
                    }
                }
            }, 200); // Check every 200ms for faster detection
        })
        .catch(err => {
            console.error('Camera error:', err);
            alert('Failed to access camera. Please check permissions or use manual input.');
        });
}

function stopScanner() {
    if (scannerStream) {
        scannerStream.getTracks().forEach(track => track.stop());
        scannerStream = null;
    }
    if (scannerInterval) {
        clearInterval(scannerInterval);
        scannerInterval = null;
    }
    document.getElementById('video').style.display = 'none';
    document.getElementById('startScannerBtn').style.display = 'inline-block';
    document.getElementById('stopScannerBtn').style.display = 'none';
    document.getElementById('scanResult').classList.remove('success', 'error');
    document.getElementById('scanResult').style.display = 'none';
}

// Store current scanned order
let currentScannedOrder = null;

// Manual QR input (for testing or when camera not available)
function scanQRCode(qrData) {
    const resultDiv = document.getElementById('scanResult');
    resultDiv.style.display = 'block';
    resultDiv.textContent = 'Scanning...';
    resultDiv.className = 'scan-result';
    
    // Hide booking details if open
    document.getElementById('bookingDetails').style.display = 'none';
    currentScannedOrder = null;

    apiCall('/api/admin/scan', {
        method: 'POST',
        body: JSON.stringify({ qrData }),
    }).then(data => {
        if (data && data.success) {
            if (data.scanned) {
                // Already scanned
                resultDiv.className = 'scan-result error';
                resultDiv.innerHTML = `
                    <strong>⚠️ ${data.message}</strong><br>
                    <p style="margin-top: 10px;">
                        This ticket was already scanned on ${data.order.scannedAt ? new Date(data.order.scannedAt).toLocaleString() : 'N/A'}<br>
                        Scanned by: ${data.order.scannedBy || 'Unknown'}
                    </p>
                `;
            } else {
                // Valid ticket - show booking details
                currentScannedOrder = data.order;
                showBookingDetails(data.order);
                resultDiv.style.display = 'none';
            }
        } else {
            resultDiv.className = 'scan-result error';
            resultDiv.textContent = data?.message || 'Scan failed';
        }
    }).catch(err => {
        resultDiv.className = 'scan-result error';
        resultDiv.textContent = 'Error scanning ticket. Please try again.';
        console.error('Scan error:', err);
    });
}

// Show booking details modal
function showBookingDetails(order) {
    const bookingInfo = document.getElementById('bookingInfo');
    const totalTickets = order.totalTicketsPurchased || 1;
    const ticketsScanned = order.ticketsScanned || 0;
    const remainingTickets = order.remainingScans !== undefined ? order.remainingScans : (totalTickets - ticketsScanned);
    
    bookingInfo.innerHTML = `
        <div class="booking-info-item" style="background: #e0f2fe; border-left: 4px solid #3b82f6;">
            <label style="font-size: 16px; color: #1e40af;">📊 Ticket Summary:</label>
            <span style="font-size: 16px; font-weight: bold; color: #1e40af;">
                ${ticketsScanned} / ${totalTickets} scanned
            </span>
        </div>
        <div class="booking-info-item" style="background: ${remainingTickets > 0 ? '#d1fae5' : '#fee2e2'};">
            <label>Remaining Entries:</label>
            <span style="font-weight: bold; color: ${remainingTickets > 0 ? '#065f46' : '#991b1b'};">
                ${remainingTickets} ${remainingTickets === 1 ? 'person' : 'people'} can enter
            </span>
        </div>
        <div class="booking-info-item">
            <label>Order Number:</label>
            <span><strong>${order.orderNumber}</strong></span>
        </div>
        <div class="booking-info-item">
            <label>Customer Name:</label>
            <span>${order.customerName || 'N/A'}</span>
        </div>
        <div class="booking-info-item">
            <label>Phone Number:</label>
            <span>${order.phoneNumber || 'N/A'}</span>
        </div>
        <div class="booking-info-item">
            <label>Email:</label>
            <span>${order.email || 'N/A'}</span>
        </div>
        <div class="booking-info-item">
            <label>Event:</label>
            <span>${order.eventName || 'N/A'}</span>
        </div>
        <div class="booking-info-item">
            <label>Date & Time:</label>
            <span>${order.eventDate ? new Date(order.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'} ${order.eventTime || ''}</span>
        </div>
        <div class="booking-info-item">
            <label>Venue:</label>
            <span>${order.venue || 'TBA'}</span>
        </div>
        <div class="booking-info-item">
            <label>Ticket Type:</label>
            <span>${order.ticketType || 'N/A'}</span>
        </div>
        <div class="booking-info-item">
            <label>Amount Paid:</label>
            <span><strong>${formatCurrency(order.amount || 0)}</strong></span>
        </div>
    `;
    
    // Disable accept button if all tickets already scanned
    const confirmBtn = document.getElementById('confirmBtn');
    if (remainingTickets <= 0) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⚠️ All Tickets Scanned';
        confirmBtn.style.opacity = '0.6';
    } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `✅ Accept Entry (${remainingTickets} remaining)`;
        confirmBtn.style.opacity = '1';
    }
    
    document.getElementById('bookingDetails').style.display = 'block';
    document.getElementById('rejectBtn').disabled = false;
}

// Close booking details
function closeBookingDetails() {
    document.getElementById('bookingDetails').style.display = 'none';
    currentScannedOrder = null;
    stopScanner();
}

// Confirm entry
async function confirmEntry() {
    if (!currentScannedOrder || !currentScannedOrder.orderId) {
        alert('No order to confirm');
        return;
    }

    const totalTickets = currentScannedOrder.totalTicketsPurchased || 1;
    const ticketsScanned = currentScannedOrder.ticketsScanned || 0;
    const remainingTickets = totalTickets - ticketsScanned;

    if (remainingTickets <= 0) {
        alert('All tickets from this order have already been scanned. No more entries allowed.');
        return;
    }

    const confirmBtn = document.getElementById('confirmBtn');
    const rejectBtn = document.getElementById('rejectBtn');
    confirmBtn.disabled = true;
    rejectBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';

    const result = await apiCall('/api/admin/scan/confirm', {
        method: 'POST',
        body: JSON.stringify({ orderId: currentScannedOrder.orderId }),
    });

    if (result && result.success) {
        const resultDiv = document.getElementById('scanResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'scan-result success';
        
        const newScanCount = result.order.scanCount || (ticketsScanned + 1);
        const newRemaining = result.order.remainingScans !== undefined ? result.order.remainingScans : (remainingTickets - 1);
        
        resultDiv.innerHTML = `
            <strong>✅ Entry Confirmed!</strong><br>
            <p style="margin-top: 10px;">
                Order: ${currentScannedOrder.orderNumber}<br>
                Customer: ${currentScannedOrder.customerName}<br>
                Entry granted successfully.<br>
                <strong>${newRemaining} ${newRemaining === 1 ? 'entry' : 'entries'} remaining for this QR code</strong>
            </p>
        `;
        
        // Update the order object with new scan data
        currentScannedOrder.ticketsScanned = newScanCount;
        currentScannedOrder.remainingScans = newRemaining;
        
        // Update the modal to reflect new count
        showBookingDetails(currentScannedOrder);
        
        // Auto-close after 3 seconds if all tickets scanned
        if (newRemaining <= 0) {
            setTimeout(() => {
                document.getElementById('bookingDetails').style.display = 'none';
                currentScannedOrder = null;
            }, 3000);
        }
    } else {
        alert(result?.message || 'Failed to confirm entry');
        confirmBtn.disabled = false;
        rejectBtn.disabled = false;
        const remaining = totalTickets - ticketsScanned;
        confirmBtn.textContent = remaining > 0 ? `✅ Accept Entry (${remaining} remaining)` : '⚠️ All Tickets Scanned';
    }
}

// Reject entry
function rejectEntry() {
    if (!currentScannedOrder) {
        alert('No order to reject');
        return;
    }

    if (confirm('Are you sure you want to reject this entry? The ticket will remain unscanned.')) {
        const resultDiv = document.getElementById('scanResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'scan-result error';
        resultDiv.textContent = 'Entry rejected. Ticket remains valid for scanning.';
        
        document.getElementById('bookingDetails').style.display = 'none';
        currentScannedOrder = null;
    }
}

// Add manual QR input field
document.addEventListener('DOMContentLoaded', () => {
    const scannerContainer = document.querySelector('.scanner-container');
    const manualInput = document.createElement('div');
    manualInput.innerHTML = `
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="margin-bottom: 10px; color: #666;">Or enter QR code manually:</p>
            <input type="text" id="manualQRInput" placeholder="Paste QR code data here" 
                   style="width: 100%; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; margin-bottom: 10px;">
            <button class="btn btn-primary" onclick="scanQRCode(document.getElementById('manualQRInput').value)">Scan</button>
        </div>
    `;
    scannerContainer.appendChild(manualInput);
});

// Users
async function loadUsers() {
    const data = await apiCall('/api/admin/users');
    if (!data || !data.success) {
        document.getElementById('usersTable').innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load users</td></tr>';
        return;
    }

    const tbody = document.getElementById('usersTable');
    if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users found</td></tr>';
    } else {
        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td>${user.username}</td>
                <td>${user.fullName || '-'}</td>
                <td>${user.email || '-'}</td>
                <td><span class="badge">${user.role}</span></td>
                <td><span class="badge ${user.isActive ? 'badge-success' : 'badge-pending'}">${user.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" 
                            onclick="editUser(${user.id})">Edit</button>
                </td>
            </tr>
        `).join('');
    }
}

function showCreateUser() {
    document.getElementById('userForm').reset();
    document.getElementById('userModal').classList.add('show');
}

function closeUserModal() {
    document.getElementById('userModal').classList.remove('show');
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const userData = {
        username: document.getElementById('userUsername').value,
        password: document.getElementById('userPassword').value,
        fullName: document.getElementById('userFullName').value,
        email: document.getElementById('userEmail').value,
        role: document.getElementById('userRole').value,
    };

    const result = await apiCall('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(userData),
    });

    if (result && result.success) {
        alert('User created successfully!');
        closeUserModal();
        loadUsers();
    } else {
        alert(result?.message || 'Failed to create user');
    }
});

// Logout
function logout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminInfo');
    window.location.href = 'admin-login.html';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    // Load admin info
    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    document.getElementById('userName').textContent = adminInfo.fullName || adminInfo.username || 'Admin';

    // Check role and show/hide menus
    if (adminInfo.role === 'admin' || adminInfo.role === 'superadmin') {
        document.getElementById('usersNav').style.display = 'block';
    }

    // Hide Events and Orders for scanner role
    if (adminInfo.role === 'scanner') {
        document.getElementById('eventsNav').style.display = 'none';
        document.getElementById('ordersNav').style.display = 'none';
    }

    // Initialize navigation
    initNavigation();
    
    // Check URL params for view
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam) {
        switchView(viewParam);
    } else {
        // Load initial view
        loadDashboard();
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered: ', registration);
            })
            .catch((registrationError) => {
                console.log('SW registration failed: ', registrationError);
            });
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopScanner();
});

