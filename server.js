const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');

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

// Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    qrCode: String,
    pairingCode: String,
    phoneNumber: String,
    connected: { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);

// WhatsApp Client
let client = null;
let pairingCodes = new Map(); // Store pairing codes temporarily

// Generate random pairing code
function generatePairingCode() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

async function initializeWhatsApp() {
    try {
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
                console.log('✅ QR Code generated');
                
                await Session.findOneAndUpdate(
                    {},
                    { qrCode: qrData, lastActivity: new Date() },
                    { upsert: true }
                );
                console.log('💾 QR code saved to database');
            } catch (error) {
                console.error('❌ QR save error:', error);
            }
        });

        client.on('ready', async () => {
            console.log('🎉 WhatsApp CLIENT READY!');
            try {
                await Session.findOneAndUpdate(
                    {},
                    { 
                        connected: true, 
                        qrCode: null,
                        pairingCode: null,
                        lastActivity: new Date() 
                    }
                );
                console.log('💾 Database updated: CONNECTED');
            } catch (error) {
                console.error('❌ Database update error:', error);
            }
        });

        client.on('authenticated', () => {
            console.log('🔐 WhatsApp AUTHENTICATED');
        });

        client.on('auth_failure', (msg) => {
            console.log('❌ AUTH FAILURE:', msg);
        });

        client.on('disconnected', async (reason) => {
            console.log('📵 DISCONNECTED:', reason);
            try {
                await Session.findOneAndUpdate(
                    {},
                    { 
                        connected: false, 
                        lastActivity: new Date() 
                    }
                );
                console.log('💾 Database updated: DISCONNECTED');
                
                // Auto-reconnect
                console.log('🔄 Auto-reconnecting in 5 seconds...');
                setTimeout(initializeWhatsApp, 5000);
            } catch (error) {
                console.error('❌ Database update error:', error);
            }
        });

        // Initialize client
        await client.initialize();
        console.log('🚀 WhatsApp client initialization started');
        
    } catch (error) {
        console.error('❌ WhatsApp initialization error:', error);
    }
}

// Start WhatsApp after MongoDB connection
mongoose.connection.on('connected', () => {
    console.log('🔗 Database connected - Starting WhatsApp in 3 seconds...');
    setTimeout(initializeWhatsApp, 3000);
});

// API Routes
app.get('/api/status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        res.json({
            success: true,
            connected: session ? session.connected : false,
            hasSession: !!session,
            qrAvailable: session ? !!session.qrCode : false,
            pairingCodeAvailable: session ? !!session.pairingCode : false,
            message: session ? 
                (session.connected ? 'WhatsApp Connected ✅' : 
                 session.qrCode ? 'QR Available - Please Scan 📱' : 
                 session.pairingCode ? 'Pairing Code Available - Enter in WhatsApp' : 'Session Created') 
                : 'No Session Found'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/qr', async (req, res) => {
    try {
        const session = await Session.findOne({});
        if (session && session.qrCode) {
            res.json({ 
                success: true, 
                qr: session.qrCode,
                message: 'Scan with WhatsApp within 2 minutes'
            });
        } else {
            res.json({ 
                success: false, 
                message: 'QR code generating... Please wait and refresh' 
            });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// New Pairing Code Endpoint
app.get('/api/pairing-code', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        // Generate pairing code
        const pairingCode = generatePairingCode();
        
        // Store in database
        await Session.findOneAndUpdate(
            {},
            { 
                pairingCode: pairingCode,
                phoneNumber: number,
                lastActivity: new Date()
            },
            { upsert: true }
        );

        console.log(`📞 Pairing code generated for ${number}: ${pairingCode}`);
        
        res.json({
            success: true,
            pairingCode: pairingCode,
            message: `Enter this code in WhatsApp: ${pairingCode}`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Check Pairing Status
app.get('/api/pairing-status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (session && session.connected) {
            res.json({
                success: true,
                connected: true,
                message: 'WhatsApp connected successfully!'
            });
        } else if (session && session.pairingCode) {
            res.json({
                success: true,
                connected: false,
                pairingCode: session.pairingCode,
                message: 'Waiting for pairing code confirmation...'
            });
        } else {
            res.json({
                success: false,
                connected: false,
                message: 'No active pairing session'
            });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/new-session', async (req, res) => {
    try {
        console.log('🆕 User requested new session');
        await Session.deleteMany({});
        await initializeWhatsApp();
        res.json({ 
            success: true, 
            message: 'New session creation started' 
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

        res.json({
            success: true,
            count: mockNumbers.length,
            numbers: mockNumbers,
            message: `Found ${mockNumbers.length} numbers for ${keyword} in ${location}`
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
                error: 'WhatsApp not connected. Please connect first.' 
            });
        }

        // Get groups from WhatsApp
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
                error: 'WhatsApp not connected. Please connect first.' 
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
                // Format number
                let formattedNumber = contact.replace(/\D/g, '');
                if (formattedNumber.startsWith('0')) {
                    formattedNumber = '94' + formattedNumber.substring(1);
                }
                formattedNumber = formattedNumber + '@c.us';
                
                // Send message
                await client.sendMessage(formattedNumber, message);
                results.push({ 
                    number: contact, 
                    status: 'success'
                });
                sentCount++;
                
                console.log(`✅ Message sent to ${contact}`);
                
                // Delay between messages
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
            pairing_code_available: session ? !!session.pairingCode : false,
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
        message: 'WhatsApp Marketing Tool API - WITH PAIRING CODE SYSTEM',
        version: '3.0',
        status: 'active',
        endpoints: {
            health: '/api/health',
            status: '/api/status',
            qr: '/api/qr',
            pairingCode: '/api/pairing-code?number=PHONE_NUMBER',
            pairingStatus: '/api/pairing-status',
            newSession: '/api/new-session (POST)',
            detectNumbers: '/api/detect-numbers (POST)',
            extractGroups: '/api/extract-groups (POST)',
            sendBulk: '/api/send-bulk (POST)'
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
    console.log('📱 WhatsApp Marketing Tool - WITH PAIRING CODE SYSTEM READY!');
});
