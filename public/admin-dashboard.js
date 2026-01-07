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

    // Update stats
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

            // QR scanning with jsQR library (if available) or manual input
            scannerInterval = setInterval(() => {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    
                    // Try jsQR if available
                    if (typeof jsQR !== 'undefined') {
                        const code = jsQR(imageData.data, imageData.width, imageData.height);
                        if (code) {
                            scanQRCode(code.data);
                            stopScanner(); // Stop after successful scan
                        }
                    }
                }
            }, 300);
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

// Manual QR input (for testing or when camera not available)
function scanQRCode(qrData) {
    const resultDiv = document.getElementById('scanResult');
    resultDiv.style.display = 'block';
    resultDiv.textContent = 'Scanning...';
    resultDiv.className = 'scan-result';

    apiCall('/api/admin/scan', {
        method: 'POST',
        body: JSON.stringify({ qrData }),
    }).then(data => {
        if (data && data.success) {
            resultDiv.className = 'scan-result success';
            if (data.scanned) {
                resultDiv.innerHTML = `
                    <strong>✅ ${data.message}</strong><br>
                    <p style="margin-top: 10px;">
                        Order: ${data.order.orderNumber}<br>
                        Customer: ${data.order.customerName}<br>
                        Event: ${data.order.eventName}<br>
                        Ticket: ${data.order.ticketType}
                    </p>
                `;
            }
        } else {
            resultDiv.className = 'scan-result error';
            resultDiv.textContent = data?.message || 'Scan failed';
        }
    });
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

    // Check role and show/hide users menu
    if (adminInfo.role === 'admin' || adminInfo.role === 'superadmin') {
        document.getElementById('usersNav').style.display = 'block';
    }

    // Initialize navigation
    initNavigation();
    
    // Load initial view
    loadDashboard();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopScanner();
});

