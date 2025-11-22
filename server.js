const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const { PhoneNumberUtil } = require('google-libphonenumber');
const phoneUtil = PhoneNumberUtil.getInstance();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://darkslframexteam_db_user:Mongodb246810@cluster0.cdgkgic.mongodb.net/darkslframex?retryWrites=true&w=majority&appName=Cluster0';

console.log('🔧 MongoDB URI:', MONGODB_URI ? 'Configured' : 'Not configured');

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
})
.catch((error) => {
    console.error('❌ MongoDB Connection Failed:', error.message);
});

// Schemas
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    qrCode: String,
    connected: { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now }
});

const campaignSchema = new mongoose.Schema({
    name: String,
    message: String,
    contacts: [String],
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);

// WhatsApp Client
let client = null;
let isInitializing = false;
let currentQR = null;

async function initializeWhatsApp() {
    if (isInitializing) {
        console.log('⚠️ WhatsApp initialization already in progress');
        return;
    }
    
    try {
        isInitializing = true;
        console.log('🔄 Initializing WhatsApp...');

        const sessionId = 'whatsapp-session-' + Date.now();
        
        console.log('🎯 Creating new session:', sessionId);
        
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionId
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        // Delete existing sessions and create new one
        await Session.deleteMany({});
        
        const newSession = new Session({
            sessionId: sessionId,
            connected: false,
            lastActivity: new Date()
        });
        await newSession.save();
        
        console.log('💾 New session saved to MongoDB');

        // WhatsApp Events
        client.on('qr', async (qr) => {
            console.log('📱 QR Code received - Generating...');
            try {
                const qrData = await qrcode.toDataURL(qr);
                currentQR = qrData; // Store QR in memory
                console.log('✅ QR Code generated');
                
                await Session.findOneAndUpdate(
                    {},
                    { 
                        qrCode: qrData, 
                        connected: false,
                        lastActivity: new Date() 
                    },
                    { upsert: true }
                );
                console.log('💾 QR code saved to database');
            } catch (error) {
                console.error('❌ QR save error:', error);
            }
        });

        client.on('ready', async () => {
            console.log('🎉 WhatsApp CLIENT READY!');
            currentQR = null; // Clear QR after connection
            try {
                await Session.findOneAndUpdate(
                    {},
                    { 
                        connected: true, 
                        qrCode: null, 
                        lastActivity: new Date() 
                    }
                );
                console.log('💾 Database updated: CONNECTED');
                isInitializing = false;
            } catch (error) {
                console.error('❌ Database update error:', error);
            }
        });

        client.on('authenticated', () => {
            console.log('🔐 WhatsApp AUTHENTICATED');
            currentQR = null;
        });

        client.on('auth_failure', (msg) => {
            console.log('❌ AUTH FAILURE:', msg);
            currentQR = null;
            isInitializing = false;
        });

        client.on('disconnected', async (reason) => {
            console.log('📵 DISCONNECTED:', reason);
            currentQR = null;
            try {
                await Session.findOneAndUpdate(
                    {},
                    { 
                        connected: false, 
                        qrCode: null,
                        lastActivity: new Date() 
                    }
                );
                console.log('💾 Database updated: DISCONNECTED');
                isInitializing = false;
                
                // Auto-reconnect
                console.log('🔄 Auto-reconnecting in 10 seconds...');
                setTimeout(initializeWhatsApp, 10000);
            } catch (error) {
                console.error('❌ Database update error:', error);
            }
        });

        // Initialize client
        await client.initialize();
        console.log('🚀 WhatsApp client initialization started');
        
    } catch (error) {
        console.error('❌ WhatsApp initialization error:', error);
        isInitializing = false;
        currentQR = null;
    }
}

// Start WhatsApp after MongoDB connection
mongoose.connection.on('connected', () => {
    console.log('🔗 Database connected - Starting WhatsApp in 3 seconds...');
    setTimeout(initializeWhatsApp, 3000);
});

// Utility Functions
function formatPhoneNumber(number) {
    try {
        const cleaned = number.toString().replace(/\D/g, '');
        
        if (cleaned.startsWith('0')) {
            return '94' + cleaned.substring(1);
        }
        
        if (cleaned.length === 9) {
            return '94' + cleaned;
        }
        
        return cleaned;
    } catch (error) {
        return number;
    }
}

// API Routes - FIXED QR ENDPOINT
app.get('/api/status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        const connected = session ? session.connected : false;
        const qrAvailable = session ? !!session.qrCode : false;
        
        res.json({
            success: true,
            connected: connected,
            hasSession: !!session,
            qrAvailable: qrAvailable,
            message: connected ? 'WhatsApp Connected ✅' : 
                     qrAvailable ? 'QR Available - Please Scan 📱' : 
                     'Initializing... Please wait'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// FIXED QR ENDPOINT - Always returns current QR
app.get('/api/qr', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (session && session.qrCode) {
            console.log('📱 Returning QR code to frontend');
            res.json({ 
                success: true, 
                qr: session.qrCode,
                message: 'Scan this QR code with WhatsApp mobile app',
                timestamp: new Date().toISOString()
            });
        } else if (currentQR) {
            console.log('📱 Returning current QR from memory');
            res.json({ 
                success: true, 
                qr: currentQR,
                message: 'Scan this QR code with WhatsApp mobile app',
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('📱 No QR available, checking connection status');
            const session = await Session.findOne({});
            if (session && session.connected) {
                res.json({ 
                    success: true, 
                    connected: true,
                    message: 'WhatsApp is already connected! ✅'
                });
            } else {
                res.json({ 
                    success: false, 
                    message: 'QR code not available yet. Please wait...' 
                });
            }
        }
    } catch (error) {
        console.error('QR endpoint error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/new-session', async (req, res) => {
    try {
        console.log('🆕 User requested new session');
        currentQR = null;
        await Session.deleteMany({});
        await initializeWhatsApp();
        res.json({ 
            success: true, 
            message: 'New session creation started. Check for QR code in a few seconds.' 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Number Detection API
app.post('/api/detect-numbers', async (req, res) => {
    try {
        const { keyword, location, limit = 10 } = req.body;
        
        console.log(`🔍 Searching for: ${keyword} in ${location}, limit: ${limit}`);
        
        // Simulate number detection
        const mockNumbers = [
            { name: `${keyword} Business 1`, number: '94771234567', location: location, hasWhatsApp: true },
            { name: `${keyword} Business 2`, number: '94771234568', location: location, hasWhatsApp: true },
            { name: `${keyword} Service`, number: '94771234569', location: location, hasWhatsApp: true },
            { name: `${keyword} Shop`, number: '94771234570', location: location, hasWhatsApp: true },
            { name: `${keyword} Center`, number: '94771234571', location: location, hasWhatsApp: true },
        ].slice(0, limit);

        const formattedNumbers = mockNumbers.map(item => ({
            ...item,
            formattedNumber: formatPhoneNumber(item.number) + '@c.us'
        }));

        res.json({
            success: true,
            count: formattedNumbers.length,
            numbers: formattedNumbers,
            message: `Found ${formattedNumbers.length} numbers for ${keyword} in ${location}`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Group Extraction API
app.post('/api/extract-groups', async (req, res) => {
    try {
        const { keywords, limit = 10 } = req.body;
        
        if (!client || !client.info) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please scan QR code first.' 
            });
        }

        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .filter(chat => {
                if (!keywords) return true;
                return chat.name.toLowerCase().includes(keywords.toLowerCase());
            })
            .slice(0, limit)
            .map(group => ({
                id: group.id._serialized,
                name: group.name,
                members: group.participants.length,
                active: true
            }));

        res.json({
            success: true,
            count: groups.length,
            groups: groups,
            message: `Found ${groups.length} groups`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Bulk Messaging API
app.post('/api/send-bulk', async (req, res) => {
    try {
        const { contacts, message, delay = 5000 } = req.body;
        
        if (!client || !client.info) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please scan QR code first.' 
            });
        }

        if (!contacts || contacts.length === 0) {
            return res.json({ 
                success: false, 
                error: 'No contacts provided' 
            });
        }

        if (!message) {
            return res.json({ 
                success: false, 
                error: 'No message provided' 
            });
        }

        const results = [];
        let sentCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            try {
                const formattedNumber = formatPhoneNumber(contact) + '@c.us';
                
                const contactId = await client.getNumberId(contact);
                
                if (contactId) {
                    await client.sendMessage(contactId._serialized, message);
                    results.push({ 
                        number: contact, 
                        status: 'success',
                        formattedNumber: formattedNumber
                    });
                    sentCount++;
                    
                    console.log(`✅ Message sent to ${contact}`);
                } else {
                    results.push({ 
                        number: contact, 
                        status: 'error',
                        error: 'Number not on WhatsApp'
                    });
                    console.log(`❌ Number not on WhatsApp: ${contact}`);
                }

                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

            } catch (error) {
                results.push({ 
                    number: contact, 
                    status: 'error',
                    error: error.message
                });
                console.log(`❌ Failed to send to ${contact}:`, error.message);
            }
        }

        res.json({
            success: true,
            sent: sentCount,
            failed: contacts.length - sentCount,
            results: results,
            message: `Sent ${sentCount}/${contacts.length} messages successfully`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Campaign Management API
app.post('/api/create-campaign', async (req, res) => {
    try {
        const { name, message, contacts, schedule } = req.body;
        
        const campaign = new Campaign({
            name,
            message,
            contacts: contacts || [],
            status: 'active'
        });

        await campaign.save();

        res.json({
            success: true,
            campaignId: campaign._id,
            message: `Campaign "${name}" created successfully`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Export Numbers API
app.post('/api/export-numbers', async (req, res) => {
    try {
        const { numbers, format = 'txt' } = req.body;
        
        if (!numbers || numbers.length === 0) {
            return res.json({ 
                success: false, 
                error: 'No numbers to export' 
            });
        }

        let exportData = '';
        
        if (format === 'txt') {
            exportData = numbers.map(num => 
                typeof num === 'object' ? num.number || num : num
            ).join('\n');
        } else if (format === 'csv') {
            exportData = 'Number,Name,Location,HasWhatsApp\n';
            exportData += numbers.map(num => 
                typeof num === 'object' ? 
                `"${num.number || num}","${num.name || ''}","${num.location || ''}","${num.hasWhatsApp || false}"` : 
                `"${num}","","",""`
            ).join('\n');
        }

        res.json({
            success: true,
            count: numbers.length,
            format: format,
            data: exportData,
            message: `Exported ${numbers.length} numbers in ${format.toUpperCase()} format`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get Campaigns API
app.get('/api/campaigns', async (req, res) => {
    try {
        const campaigns = await Campaign.find().sort({ createdAt: -1 });
        res.json({
            success: true,
            campaigns: campaigns
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Health Check
app.get('/api/health', async (req, res) => {
    try {
        const session = await Session.findOne({});
        const dbStatus = mongoose.connection.readyState;
        
        res.json({
            status: 'running',
            database: dbStatus === 1 ? 'connected' : 'disconnected',
            whatsapp: session ? (session.connected ? 'connected' : 'disconnected') : 'no_session',
            qr_available: session ? !!session.qrCode : false,
            session_id: session ? session.sessionId : 'none',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'error',
            error: error.message
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'WhatsApp Marketing Tool API - FIXED QR CODE VERSION',
        version: '4.0',
        status: 'active',
        endpoints: {
            health: '/api/health',
            status: '/api/status',
            qr: '/api/qr',
            newSession: '/api/new-session (POST)',
            detectNumbers: '/api/detect-numbers (POST)',
            extractGroups: '/api/extract-groups (POST)',
            sendBulk: '/api/send-bulk (POST)',
            createCampaign: '/api/create-campaign (POST)',
            exportNumbers: '/api/export-numbers (POST)',
            campaigns: '/api/campaigns (GET)'
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
    console.log(`🔗 QR Code: http://localhost:${PORT}/api/qr`);
    console.log('📱 WhatsApp Marketing Tool - QR CODE FIXED!');
});
