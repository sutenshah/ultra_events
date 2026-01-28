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

    try {
        console.log(`📤 API Call: ${API_BASE}${endpoint}`);
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {}),
            },
        });

        console.log(`📥 Response status: ${response.status} ${response.statusText}`);

        if (response.status === 401) {
            console.error('❌ Unauthorized - logging out');
            logout();
            return null;
        }

        if (!response.ok) {
            console.error(`❌ Response not OK: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error('❌ Error response body:', errorText);
            throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`✅ API response received for ${endpoint}:`, data);
        return data;
    } catch (error) {
        console.error(`❌ API call error for ${endpoint}:`, error);
        throw error;
    }
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

// ===== Events =====
let currentTicketTypes = [];

function renderTicketTypes() {
    const container = document.getElementById('ticketTypesContainer');
    if (!container) return;

    if (!currentTicketTypes || currentTicketTypes.length === 0) {
        container.innerHTML = `
            <div class="booking-info-item full-width" style="text-align:center;background:#f9fafb;">
                <label>No ticket types yet</label>
                <span style="font-size:12px;color:#6b7280;">Click “+ Add Ticket Type” to add tickets for this event.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = currentTicketTypes.map((t, index) => `
        <div class="booking-info-item">
            <label>Ticket Name</label>
            <span>
                <input
                    type="text"
                    value="${t.name || ''}"
                    data-index="${index}"
                    data-field="name"
                    style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid #d1d5db;font-size:12px;"
                />
            </span>
        </div>
        <div class="booking-info-item">
            <label>Price (₹)</label>
            <span>
                <input
                    type="number"
                    min="0"
                    value="${t.price ?? ''}"
                    data-index="${index}"
                    data-field="price"
                    style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid #d1d5db;font-size:12px;"
                />
            </span>
        </div>
        <div class="booking-info-item">
            <label>Total Quantity</label>
            <span style="display:flex;gap:6px;align-items:center;">
                <input
                    type="number"
                    min="1"
                    value="${t.totalQuantity ?? t.availableQuantity ?? 100}"
                    data-index="${index}"
                    data-field="totalQuantity"
                    style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #d1d5db;font-size:12px;"
                />
                <button type="button"
                    class="btn btn-secondary"
                    style="padding:4px 8px;font-size:11px;"
                    onclick="removeTicketTypeRow(${index})"
                >✕</button>
            </span>
        </div>
    `).join('');

    // Attach change listeners
    container.querySelectorAll('input[data-index]').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            const field = e.target.getAttribute('data-field');
            let value = e.target.value;

            if (field === 'price' || field === 'totalQuantity') {
                value = value === '' ? null : Number(value);
            }

            currentTicketTypes[idx] = {
                ...currentTicketTypes[idx],
                [field]: value,
            };
        });
    });
}

function addTicketTypeRow() {
    currentTicketTypes.push({
        id: null,
        name: '',
        price: null,
        availableQuantity: null,
        totalQuantity: 100,
    });
    renderTicketTypes();
}

function removeTicketTypeRow(index) {
    currentTicketTypes.splice(index, 1);
    renderTicketTypes();
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
    currentTicketTypes = [];
    renderTicketTypes();
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

async function editEvent(eventId) {
    const data = await apiCall(`/api/admin/events/${eventId}`);
    if (!data || !data.success) return;

    const event = data.event;
    currentTicketTypes = (data.ticketTypes || []).map(t => ({
        id: t.id,
        name: t.name,
        price: t.price,
        availableQuantity: t.availableQuantity,
        totalQuantity: t.totalQuantity,
    }));

    document.getElementById('eventModalTitle').textContent = 'Edit Event';
    document.getElementById('eventId').value = event.id;
    document.getElementById('eventName').value = event.name;
    document.getElementById('eventDate').value = event.date;
    document.getElementById('eventTime').value = event.time;
    document.getElementById('eventVenue').value = event.venue;
    document.getElementById('eventDescription').value = event.description || '';
    document.getElementById('eventImageURL').value = event.imageURL || '';

    renderTicketTypes();
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeEventModal() {
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const eventId = document.getElementById('eventId').value;

    // Prepare ticket types payload
    const cleanedTicketTypes = (currentTicketTypes || [])
        .filter(t => t.name && t.price != null && t.price !== '')
        .map(t => ({
            id: t.id,
            name: t.name.trim(),
            price: Number(t.price),
            totalQuantity: t.totalQuantity ? Number(t.totalQuantity) : 100,
            availableQuantity: t.totalQuantity ? Number(t.totalQuantity) : 100,
        }));

    const eventData = {
        name: document.getElementById('eventName').value,
        date: document.getElementById('eventDate').value,
        time: document.getElementById('eventTime').value,
        venue: document.getElementById('eventVenue').value,
        description: document.getElementById('eventDescription').value,
        imageURL: document.getElementById('eventImageURL').value,
        ticketTypes: cleanedTicketTypes,
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
    const resultDiv = document.getElementById('scanResult');

    // Check if jsQR is loaded
    if (typeof jsQR === 'undefined') {
        resultDiv.style.display = 'block';
        resultDiv.className = 'scan-result error';
        resultDiv.textContent = 'QR scanner library not loaded. Please refresh the page.';
        console.error('jsQR library not found');
        return;
    }

    // Clear previous results
    resultDiv.style.display = 'none';
    resultDiv.textContent = '';

    navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
        } 
    })
        .then(stream => {
            scannerStream = stream;
            video.srcObject = stream;
            video.style.display = 'block';
            document.getElementById('startScannerBtn').style.display = 'none';
            document.getElementById('stopScannerBtn').style.display = 'inline-block';

            // Show scanning indicator
            resultDiv.style.display = 'block';
            resultDiv.className = 'scan-result';
            resultDiv.textContent = '📷 Scanning... Point camera at QR code';
            resultDiv.style.background = '#e0f2fe';
            resultDiv.style.color = '#1e40af';

            let scanAttempts = 0;
            // QR scanning with jsQR library
            scannerInterval = setInterval(() => {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    try {
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        
                        // Use jsQR to scan QR code
                        const code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'dontInvert',
                        });
                        
                        scanAttempts++;
                        if (scanAttempts % 10 === 0) {
                            // Update status every 2 seconds
                            resultDiv.textContent = `📷 Scanning... (${Math.floor(scanAttempts / 5)}s) Point camera at QR code`;
                        }
                        
                        if (code) {
                            console.log('✅ QR Code detected!');
                            console.log('📄 QR Code data:', code.data);
                            console.log('📄 QR Code data type:', typeof code.data);
                            console.log('📄 QR Code data length:', code.data.length);
                            
                            // Show detection feedback
                            resultDiv.textContent = '✅ QR Code detected! Processing...';
                            resultDiv.style.background = '#d1fae5';
                            resultDiv.style.color = '#065f46';
                            
                            stopScanner(); // Stop camera first
                            
                            // Small delay to show feedback
                            setTimeout(() => {
                                scanQRCode(code.data);
                            }, 300);
                        }
                    } catch (error) {
                        console.error('Error during QR scan:', error);
                        resultDiv.className = 'scan-result error';
                        resultDiv.textContent = 'Error scanning: ' + error.message;
                    }
                }
            }, 200); // Check every 200ms for faster detection
        })
        .catch(err => {
            console.error('Camera error:', err);
            resultDiv.style.display = 'block';
            resultDiv.className = 'scan-result error';
            
            if (err.name === 'NotAllowedError') {
                resultDiv.textContent = 'Camera permission denied. Please allow camera access and try again.';
            } else if (err.name === 'NotFoundError') {
                resultDiv.textContent = 'No camera found. Please use manual input below.';
            } else {
                resultDiv.textContent = 'Failed to access camera: ' + err.message + '. Please use manual input below.';
            }
            
            document.getElementById('startScannerBtn').style.display = 'inline-block';
            document.getElementById('stopScannerBtn').style.display = 'none';
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
    if (!qrData || qrData.trim() === '') {
        alert('Please enter or scan a QR code');
        return;
    }

    const resultDiv = document.getElementById('scanResult');
    resultDiv.style.display = 'block';
    resultDiv.textContent = '🔍 Validating QR code...';
    resultDiv.className = 'scan-result';
    
    // Hide booking details if open
    document.getElementById('bookingDetails').style.display = 'none';
    currentScannedOrder = null;

    console.log('📱 Scanning QR data:', qrData);
    console.log('📱 QR data type:', typeof qrData);
    console.log('📱 QR data length:', qrData.length);

    console.log('📤 Making API call to /api/admin/scan');
    console.log('📤 QR Data being sent:', qrData.trim());
    console.log('📤 API_BASE:', API_BASE);
    
    apiCall('/api/admin/scan', {
        method: 'POST',
        body: JSON.stringify({ qrData: qrData.trim() }),
    }).then(data => {
        console.log('🎉🎉🎉 THEN BLOCK EXECUTED - RESPONSE RECEIVED 🎉🎉🎉');
        console.log('✅ Scan response received:', data);
        console.log('✅ Response type:', typeof data);
        console.log('✅ Response keys:', data ? Object.keys(data) : 'null');
        console.log('✅ Full response:', JSON.stringify(data, null, 2));
        
        if (!data) {
            console.error('❌ No data received in response');
            resultDiv.className = 'scan-result error';
            resultDiv.textContent = 'Error: No response from server. Please try again.';
            return;
        }
        
        if (data && data.success) {
            console.log('✅✅✅ SUCCESS FLAG IS TRUE - PROCEEDING TO DISPLAY');
            console.log('✅ Success flag is true');
            console.log('✅ Scanned flag:', data.scanned);
            console.log('✅ Order data:', data.order);
            
            // TEMPORARY DEBUG: Alert to confirm we're in the right branch
            if (data.scanned) {
                alert('DEBUG: Already scanned branch - Order: ' + (data.order?.orderNumber || 'N/A'));
            }
            
            if (data.scanned) {
                // Already scanned - show full booking details but mark as scanned
                console.log('📋 Showing already-scanned booking details');
                console.log('📋 Order data received:', JSON.stringify(data.order, null, 2));
                console.log('📋 ScannedBy:', data.order?.scannedBy);
                console.log('📋 ScannedAt:', data.order?.scannedAt);
                console.log('📋 ScannedAtFormatted:', data.order?.scannedAtFormatted);
                
                // Ensure we have all required fields
                if (!data.order || !data.order.orderNumber) {
                    console.error('❌ Invalid order data in response:', data);
                    resultDiv.className = 'scan-result error';
                    resultDiv.textContent = 'Error: Invalid order data received. Please try again.';
                    return;
                }
                
                currentScannedOrder = data.order;
                currentScannedOrder.isAlreadyScanned = true; // Flag to disable accept button
                
                // Hide the result div and show booking details modal
                resultDiv.style.display = 'none';
                
                // Immediately show booking details
                console.log('🎯 About to call showBookingDetails with isAlreadyScanned=true');
                console.log('🎯 Current view:', currentView);
                console.log('🎯 Checking if bookingDetails element exists...');
                
                const bookingDetailsCheck = document.getElementById('bookingDetails');
                console.log('🎯 bookingDetails element found:', !!bookingDetailsCheck);
                
                try {
                    showBookingDetails(data.order, true); // Pass true to indicate already scanned
                    console.log('✅ showBookingDetails called successfully');
                    
                    // Double-check modal is visible after a short delay
                    setTimeout(() => {
                        const modal = document.getElementById('bookingDetails');
                        const computedStyle = window.getComputedStyle(modal);
                        console.log('🔍 Modal check after 200ms:');
                        console.log('  - display:', computedStyle.display);
                        console.log('  - visibility:', computedStyle.visibility);
                        console.log('  - opacity:', computedStyle.opacity);
                        console.log('  - offsetHeight:', modal.offsetHeight);
                        console.log('  - offsetWidth:', modal.offsetWidth);
                        
                        if (computedStyle.display === 'none' || modal.offsetHeight === 0) {
                            console.error('❌ Modal is still not visible! Forcing display...');
                            modal.style.display = 'block';
                            modal.style.visibility = 'visible';
                            modal.style.opacity = '1';
                        }
                    }, 200);
                } catch (error) {
                    console.error('❌ Error calling showBookingDetails:', error);
                    console.error('❌ Error stack:', error.stack);
                    resultDiv.style.display = 'block';
                    resultDiv.className = 'scan-result error';
                    resultDiv.textContent = 'Error displaying booking details: ' + error.message;
                }
            } else {
                // Valid ticket - show booking details
                console.log('📋 Showing valid booking details');
                console.log('📋 Order data received:', data.order);
                
                // Ensure we have all required fields
                if (!data.order || !data.order.orderNumber) {
                    console.error('❌ Invalid order data in response:', data);
                    resultDiv.className = 'scan-result error';
                    resultDiv.textContent = 'Error: Invalid order data received. Please try again.';
                    return;
                }
                
                currentScannedOrder = data.order;
                currentScannedOrder.isAlreadyScanned = false;
                
                // Hide the result div and show booking details modal
                resultDiv.style.display = 'none';
                
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    showBookingDetails(data.order, false);
                }, 100);
            }
        } else {
            console.error('❌ Response success is false or missing');
            resultDiv.className = 'scan-result error';
            const errorMsg = data?.message || 'Invalid QR code. Please try again.';
            resultDiv.textContent = errorMsg;
            console.error('❌ Scan failed:', data);
            console.error('❌ Error details:', JSON.stringify(data, null, 2));
            
            // Show more helpful error message
            if (errorMsg.includes('not found') || errorMsg.includes('Invalid')) {
                resultDiv.innerHTML = `
                    <strong>❌ ${errorMsg}</strong><br>
                    <p style="margin-top: 10px; font-size: 12px; color: #666;">
                        Make sure you're scanning a valid QR code from Ultraa Events.<br>
                        If this is a new QR code format, try refreshing the page.
                    </p>
                `;
            }
        }
    }).catch(err => {
        console.error('❌ API call error:', err);
        resultDiv.className = 'scan-result error';
        resultDiv.textContent = 'Error scanning ticket. Please check your connection and try again.';
        console.error('Scan error:', err);
        
        // Show more details in console for debugging
        if (err.message) {
            console.error('Error message:', err.message);
        }
        if (err.response) {
            console.error('Error response:', err.response);
        }
    });
}

// Show booking details modal
function showBookingDetails(order, isAlreadyScanned = false) {
    console.log('🎯 showBookingDetails called with:', { order, isAlreadyScanned });
    
    const bookingInfo = document.getElementById('bookingInfo');
    const bookingDetails = document.getElementById('bookingDetails');
    
    if (!bookingInfo) {
        console.error('❌ bookingInfo element not found!');
        alert('Error: Booking info element not found. Please refresh the page.');
        return;
    }
    
    if (!bookingDetails) {
        console.error('❌ bookingDetails element not found!');
        alert('Error: Booking details modal not found. Please refresh the page.');
        return;
    }
    
    console.log('✅ Found bookingInfo and bookingDetails elements');
    
    const totalAmount = order.totalAmount || order.amount || 0;
    
    // Format scanned date/time if available
    let scannedAtFormatted = 'N/A';
    if (order.scannedAt) {
        try {
            scannedAtFormatted = new Date(order.scannedAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            scannedAtFormatted = order.scannedAtFormatted || String(order.scannedAt);
        }
    }
    
    bookingInfo.innerHTML = `
        ${isAlreadyScanned ? `
        <div class="booking-info-item" style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 12px;">
            <label style="color: #991b1b; font-weight: bold; font-size: 16px;">⚠️ This QR Already Scanned</label>
        </div>
        <div class="booking-info-item">
            <label>Scanned By:</label>
            <span><strong>${order.scannedBy || 'Unknown'}</strong></span>
        </div>
        <div class="booking-info-item">
            <label>Scanned At:</label>
            <span><strong>${scannedAtFormatted}</strong></span>
        </div>
        ` : ''}
        <div class="booking-info-item">
            <label>Order Number:</label>
            <span><strong>${order.orderNumber || 'N/A'}</strong></span>
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
            <label>Total Amount Paid:</label>
            <span><strong>${formatCurrency(totalAmount)}</strong></span>
        </div>
    `;
    
    // Store order data for confirmation (ensure all required fields are present)
    console.log('📋 Booking details shown for order:', order);
    console.log('📋 Order has orderId:', order.orderId);
    console.log('📋 Order has orderNumber:', order.orderNumber);
    console.log('📋 Is already scanned:', isAlreadyScanned);
    
    // Set accept button based on scan status
    const confirmBtn = document.getElementById('confirmBtn');
    const rejectBtn = document.getElementById('rejectBtn');
    
    if (isAlreadyScanned) {
        // Disable accept button if already scanned
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⚠️ Already Scanned';
        confirmBtn.style.opacity = '0.6';
        confirmBtn.style.cursor = 'not-allowed';
    } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '✅ Accept Entry';
        confirmBtn.style.opacity = '1';
        confirmBtn.style.cursor = 'pointer';
    }
    
    // Hide reject button if already scanned (no point rejecting)
    if (isAlreadyScanned) {
        rejectBtn.style.display = 'none';
    } else {
        rejectBtn.style.display = 'inline-block';
        rejectBtn.disabled = false;
    }
    
    console.log('🎯 Displaying booking details modal');
    console.log('🎯 bookingDetails element:', bookingDetails);
    console.log('🎯 Current display style:', bookingDetails.style.display);
    console.log('🎯 bookingInfo innerHTML length:', bookingInfo.innerHTML.length);
    
    // Force display
    bookingDetails.style.display = 'block';
    bookingDetails.style.visibility = 'visible';
    bookingDetails.style.opacity = '1';
    
    // Make sure it's not hidden by CSS
    bookingDetails.classList.remove('hidden');
    bookingDetails.removeAttribute('hidden');
    
    console.log('✅ Modal display set to block');
    console.log('✅ Modal computed style:', window.getComputedStyle(bookingDetails).display);
    console.log('✅ Modal offsetHeight:', bookingDetails.offsetHeight);
    console.log('✅ Modal offsetWidth:', bookingDetails.offsetWidth);
    console.log('✅ Modal is visible:', bookingDetails.offsetHeight > 0 && bookingDetails.offsetWidth > 0);
    
    // Force a reflow to ensure display
    void bookingDetails.offsetHeight;
    
    // Scroll to top of modal to ensure it's visible
    setTimeout(() => {
        try {
            bookingDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            console.error('Error scrolling to modal:', e);
        }
    }, 100);
}

// Close booking details
function closeBookingDetails() {
    document.getElementById('bookingDetails').style.display = 'none';
    currentScannedOrder = null;
    stopScanner();
}

// Confirm entry
async function confirmEntry() {
    console.log('🔍 Attempting to confirm entry...');
    console.log('🔍 currentScannedOrder:', currentScannedOrder);
    
    if (!currentScannedOrder) {
        console.error('❌ No currentScannedOrder object');
        alert('No order to confirm. Please scan the QR code again.');
        return;
    }
    
    if (!currentScannedOrder.orderId) {
        console.error('❌ Missing orderId');
        console.error('❌ Full order object:', JSON.stringify(currentScannedOrder, null, 2));
        alert('Invalid order data. Please scan the QR code again.');
        return;
    }

    const confirmBtn = document.getElementById('confirmBtn');
    const rejectBtn = document.getElementById('rejectBtn');
    confirmBtn.disabled = true;
    rejectBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';

    const result = await apiCall('/api/admin/scan/confirm', {
        method: 'POST',
        body: JSON.stringify({ 
            orderId: currentScannedOrder.orderId
        }),
    });

    if (result && result.success) {
        const resultDiv = document.getElementById('scanResult');
        resultDiv.style.display = 'block';
        resultDiv.className = 'scan-result success';
        
        resultDiv.innerHTML = `
            <strong>✅ Entry Confirmed!</strong><br>
            <p style="margin-top: 10px;">
                Order: ${currentScannedOrder.orderNumber}<br>
                Customer: ${currentScannedOrder.customerName}<br>
                Entry granted successfully.<br>
                QR code has been used and cannot be scanned again.
            </p>
        `;
        
        // Close the modal after 3 seconds
        setTimeout(() => {
            document.getElementById('bookingDetails').style.display = 'none';
            currentScannedOrder = null;
        }, 3000);
    } else {
        alert(result?.message || 'Failed to confirm entry');
        confirmBtn.disabled = false;
        rejectBtn.disabled = false;
        confirmBtn.textContent = '✅ Accept Entry';
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

// Test QR scan function for debugging
function testQRScan() {
    const testData = prompt('Enter test QR data (JSON format with userId and eventId, or orderNumber):');
    if (testData) {
        console.log('🧪 Testing QR scan with data:', testData);
        scanQRCode(testData);
    }
}

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

    // Check if jsQR library is loaded
    setTimeout(() => {
        if (typeof jsQR === 'undefined') {
            console.error('⚠️ jsQR library not loaded! QR scanning will not work.');
            console.log('Please check if the jsQR script is loaded in the HTML file.');
        } else {
            console.log('✅ jsQR library loaded successfully');
        }
    }, 1000);

    // Add Enter key support for manual QR input
    const manualInput = document.getElementById('manualQRInput');
    if (manualInput) {
        manualInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                scanQRCode(manualInput.value);
            }
        });
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopScanner();
});

