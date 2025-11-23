const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const axios = require('axios');

// Import Baileys components
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://darkslframexteam_db_user:Mongodb246810@cluster0.cdgkgic.mongodb.net/darkslframex?retryWrites=true&w=majority&appName=Cluster0';

console.log('🔧 Starting WhatsApp Marketing Tool with RAWANA MD Integration...');

// MongoDB Connection
mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
})
.catch((error) => {
    console.error('❌ MongoDB Connection Failed:', error.message);
});

// Enhanced Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    sessionData: Object,
    qrCode: String,
    pairingCode: String,
    phoneNumber: String,
    connected: { type: Boolean, default: false },
    connectionType: { type: String, default: 'qr' },
    lastActivity: { type: Date, default: Date.now },
    manualSession: Object,
    pairingCodeExpiry: Date,
    rawanaSession: Object,
    rawanaSessionId: String
}, {
    timestamps: true
});

const Session = mongoose.model('Session', sessionSchema);

// Global variables
let sock = null;
let isInitializing = false;
const SESSION_BASE_PATH = './sessions';

// Ensure sessions directory exists
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Utility Functions
function generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to fetch session from RAWANA MD
async function fetchRawanaSession(phoneNumber) {
    try {
        console.log('🔄 Fetching session from RAWANA MD for:', phoneNumber);
        
        const response = await axios.get(`https://rawana-md-web-pair.onrender.com/code?number=${phoneNumber}`, {
            timeout: 30000
        });
        
        console.log('✅ RAWANA MD Response:', response.data);
        
        if (response.data && response.data.code) {
            return {
                success: true,
                pairingCode: response.data.code,
                sessionId: `rawana-${Date.now()}`,
                source: 'rawana-md'
            };
        } else {
            return {
                success: false,
                error: 'No pairing code received from RAWANA MD'
            };
        }
        
    } catch (error) {
        console.error('❌ RAWANA MD fetch error:', error.message);
        return {
            success: false,
            error: 'Failed to connect to RAWANA MD: ' + error.message
        };
    }
}

// Enhanced WhatsApp Initialization
async function initializeWhatsApp(manualData = null, pairingCode = null, phoneNumber = null) {
    if (isInitializing) {
        console.log('⚠️ WhatsApp initialization already in progress');
        return;
    }

    try {
        isInitializing = true;
        console.log('🔄 Initializing WhatsApp...');

        const sessionId = manualData?.sessionId || pairingCode?.sessionId || 'baileys-session-' + Date.now();
        const sessionPath = path.join(SESSION_BASE_PATH, sessionId);

        let state;
        let saveCredsFunction = null;

        if (manualData) {
            // Use manual session data
            console.log('🔧 Using manual session data');
            state = {
                creds: manualData.creds || {
                    noiseKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                    signedIdentityKey: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                    signedPreKey: {
                        keyId: 1,
                        keyPair: { private: Buffer.alloc(32), public: Buffer.alloc(32) },
                        signature: Buffer.alloc(64)
                    },
                    registrationId: 123,
                    advSecretKey: 'default',
                    me: { id: 'manual@session', name: 'Manual Session' }
                },
                keys: {
                    get: (type, ids) => []
                }
            };
        } else {
            // Use multi-file auth state
            console.log('🔧 Using multi-file auth state');
            const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);
            state = authState;
            saveCredsFunction = saveCreds;
        }

        // Get latest version
        const { version } = await fetchLatestBaileysVersion();
        
        // Create socket with enhanced configuration
        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 2000,
            maxRetries: 5,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
        });

        // Store credentials updates
        if (saveCredsFunction) {
            sock.ev.on('creds.update', saveCredsFunction);
        }

        // Enhanced Connection Handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect, isNewLogin, receivedPendingNotifications } = update;
            
            console.log('🔗 Connection update:', {
                connection,
                qr: qr ? 'QR Received' : 'No QR',
                isNewLogin,
                receivedPendingNotifications
            });

            if (qr) {
                console.log('📱 QR Code received');
                try {
                    const qrData = await qrcode.toDataURL(qr);
                    
                    await Session.findOneAndUpdate(
                        {},
                        { 
                            qrCode: qrData, 
                            sessionId: sessionId,
                            connectionType: 'qr',
                            lastActivity: new Date(),
                            pairingCode: null
                        },
                        { upsert: true, new: true }
                    );
                    console.log('💾 QR code saved to database');
                } catch (error) {
                    console.error('❌ QR save error:', error);
                }
            }

            if (connection === 'open') {
                console.log('🎉 WhatsApp CONNECTED SUCCESSFULLY!');
                console.log('👤 User:', sock.user);
                
                try {
                    const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
                    
                    await Session.findOneAndUpdate(
                        {},
                        { 
                            connected: true, 
                            qrCode: null,
                            pairingCode: null,
                            phoneNumber: userPhone,
                            connectionType: 'paired',
                            lastActivity: new Date()
                        },
                        { upsert: true, new: true }
                    );
                    
                    console.log('💾 Database updated: CONNECTED as ' + userPhone);
                    isInitializing = false;
                    
                } catch (error) {
                    console.error('❌ Database update error:', error);
                }
            }

            if (connection === 'close') {
                console.log('📵 Connection closed');
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                console.log('🔍 Disconnect reason:', statusCode);
                console.log('🔍 Disconnect error:', lastDisconnect?.error);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Device logged out, clearing session...');
                    try {
                        await fs.remove(sessionPath);
                    } catch (error) {
                        console.log('No session files to remove');
                    }
                    await Session.deleteMany({});
                }
                
                isInitializing = false;
                console.log('🔄 Attempting to reconnect in 10 seconds...');
                setTimeout(() => initializeWhatsApp(), 10000);
            }
        });

        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            if (m.messages && m.messages[0] && !m.messages[0].key.fromMe) {
                console.log('📩 New message received from:', m.messages[0].key.remoteJid);
            }
        });

        console.log('🚀 WhatsApp client initialization completed');

    } catch (error) {
        console.error('❌ WhatsApp initialization error:', error);
        isInitializing = false;
        
        console.log('🔄 Retrying initialization in 5 seconds...');
        setTimeout(() => initializeWhatsApp(), 5000);
    }
}

// ==================== RAWANA MD INTEGRATION API ====================

// Get Pairing Code from RAWANA MD
app.get('/api/rawana-pairing', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        console.log('📱 Getting pairing code from RAWANA MD for:', number);

        const formattedNumber = formatPhoneNumber(number);
        
        // Fetch from RAWANA MD
        const rawanaResult = await fetchRawanaSession(formattedNumber);
        
        if (rawanaResult.success) {
            console.log('✅ RAWANA MD pairing code:', rawanaResult.pairingCode);
            
            // Save to database
            await Session.findOneAndUpdate(
                {},
                {
                    sessionId: rawanaResult.sessionId,
                    pairingCode: rawanaResult.pairingCode,
                    phoneNumber: formattedNumber,
                    connected: false,
                    connectionType: 'rawana-pairing',
                    pairingCodeExpiry: new Date(Date.now() + 2 * 60 * 1000),
                    rawanaSession: rawanaResult,
                    lastActivity: new Date()
                },
                { upsert: true, new: true }
            );

            // Initialize WhatsApp
            await initializeWhatsApp();

            res.json({
                success: true,
                pairingCode: rawanaResult.pairingCode,
                source: 'rawana-md',
                message: `RAWANA MD pairing code: ${rawanaResult.pairingCode}`,
                instructions: 'Open WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number',
                expiry: '2 minutes'
            });

        } else {
            // Fallback to our own system
            console.log('🔄 Using fallback pairing system');
            const fallbackCode = generatePairingCode();
            
            await Session.findOneAndUpdate(
                {},
                {
                    sessionId: 'fallback-' + Date.now(),
                    pairingCode: fallbackCode,
                    phoneNumber: formattedNumber,
                    connected: false,
                    connectionType: 'pairing',
                    pairingCodeExpiry: new Date(Date.now() + 2 * 60 * 1000),
                    lastActivity: new Date()
                },
                { upsert: true, new: true }
            );

            await initializeWhatsApp();

            res.json({
                success: true,
                pairingCode: fallbackCode,
                source: 'fallback',
                message: `Fallback pairing code: ${fallbackCode}`,
                instructions: 'Open WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number',
                expiry: '2 minutes'
            });
        }

    } catch (error) {
        console.error('❌ RAWANA MD pairing error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to get pairing code: ' + error.message 
        });
    }
});

// Direct RAWANA MD Integration
app.get('/api/connect-rawana', async (req, res) => {
    try {
        const { sessionId, phoneNumber } = req.body;

        if (!sessionId) {
            return res.json({
                success: false,
                error: 'Session ID is required'
            });
        }

        console.log('🔗 Connecting RAWANA MD session:', sessionId);

        // Save RAWANA session data
        await Session.findOneAndUpdate(
            {},
            {
                sessionId: sessionId,
                phoneNumber: phoneNumber,
                connected: false,
                connectionType: 'rawana-session',
                rawanaSessionId: sessionId,
                lastActivity: new Date(),
                rawanaSession: {
                    sessionId: sessionId,
                    source: 'rawana-md-direct',
                    connectedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        console.log('💾 RAWANA MD session saved');

        // Try to initialize with RAWANA session data
        const rawanaData = {
            sessionId: sessionId,
            creds: {
                me: { 
                    id: (phoneNumber ? formatPhoneNumber(phoneNumber) : 'rawana') + '@s.whatsapp.net',
                    name: 'RAWANA MD User'
                }
            }
        };

        await initializeWhatsApp(rawanaData);

        res.json({
            success: true,
            message: 'RAWANA MD session connected successfully!',
            sessionId: sessionId
        });

    } catch (error) {
        console.error('❌ RAWANA MD connection error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// ==================== MANUAL SESSION API ====================

app.post('/api/manual-session', async (req, res) => {
    try {
        const { 
            sessionId, 
            sessionToken, 
            clientId, 
            serverToken, 
            encKey, 
            macKey,
            phoneNumber 
        } = req.body;

        console.log('📱 Manual session connection request');

        if (!sessionId) {
            return res.json({
                success: false,
                error: 'Session ID is required'
            });
        }

        // Save manual session data
        await Session.findOneAndUpdate(
            {},
            {
                sessionId: sessionId,
                connected: false,
                connectionType: 'manual',
                phoneNumber: phoneNumber,
                lastActivity: new Date(),
                manualSession: {
                    sessionId: sessionId,
                    sessionToken: sessionToken,
                    clientId: clientId,
                    serverToken: serverToken,
                    encKey: encKey,
                    macKey: macKey
                }
            },
            { upsert: true, new: true }
        );

        console.log('💾 Manual session data saved');

        // Initialize with manual data
        const manualData = {
            sessionId: sessionId,
            creds: {
                me: { 
                    id: (phoneNumber ? formatPhoneNumber(phoneNumber) : 'manual') + '@s.whatsapp.net',
                    name: 'Manual Session User'
                }
            }
        };

        await initializeWhatsApp(manualData);

        res.json({
            success: true,
            message: 'Manual session data received. Trying to connect...',
            sessionId: sessionId
        });

    } catch (error) {
        console.error('❌ Manual session error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// ==================== EXISTING API ROUTES ====================

// Status Check
app.get('/api/status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        const isConnected = sock && sock.user;
        
        res.json({
            success: true,
            connected: isConnected,
            hasSession: !!session,
            qrAvailable: session ? !!session.qrCode : false,
            pairingCodeAvailable: session ? !!session.pairingCode : false,
            connectionType: session?.connectionType || 'none',
            phoneNumber: session?.phoneNumber,
            user: sock?.user,
            message: isConnected ? 'WhatsApp Connected ✅' : 
                     session?.qrCode ? 'QR Available - Please Scan 📱' : 
                     session?.pairingCode ? 'Pairing Code Available 🔑' :
                     session?.connectionType === 'manual' ? 'Manual Session Configured ⚙️' :
                     session?.connectionType === 'rawana-pairing' ? 'RAWANA MD Pairing Active 🔄' :
                     'Initializing...'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// QR Code
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
            // Start new QR session
            await initializeWhatsApp();
            res.json({ 
                success: false, 
                message: 'QR code generating... Please wait and refresh' 
            });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Verify Pairing Status
app.get('/api/pairing-status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (!session) {
            return res.json({
                success: false,
                paired: false,
                message: 'No active session'
            });
        }

        // Check if pairing code expired
        if (session.pairingCodeExpiry && new Date() > session.pairingCodeExpiry) {
            await Session.deleteMany({});
            return res.json({
                success: false,
                paired: false,
                expired: true,
                message: 'Pairing code expired'
            });
        }

        res.json({
            success: true,
            paired: session.connected,
            pairingCode: session.pairingCode,
            phoneNumber: session.phoneNumber,
            connectionType: session.connectionType,
            expiry: session.pairingCodeExpiry
        });

    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// New Session
app.post('/api/new-session', async (req, res) => {
    try {
        console.log('🆕 User requested new session');
        
        // Clean up old session files
        try {
            const files = await fs.readdir(SESSION_BASE_PATH);
            for (const file of files) {
                await fs.remove(path.join(SESSION_BASE_PATH, file));
            }
        } catch (error) {
            console.log('No previous sessions to clean');
        }

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

// Send Message
app.post('/api/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;
        
        if (!sock || !sock.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        if (!number || !message) {
            return res.json({ 
                success: false, 
                error: 'Number and message are required' 
            });
        }

        const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
        
        await sock.sendMessage(formattedNumber, { text: message });
        
        res.json({
            success: true,
            message: 'Message sent successfully'
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to send message: ' + error.message 
        });
    }
});

// Bulk Messaging
app.post('/api/send-bulk', async (req, res) => {
    try {
        const { contacts, message, delayMs = 2000 } = req.body;
        
        if (!sock || !sock.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        if (!contacts || !message) {
            return res.json({ 
                success: false, 
                error: 'Contacts and message are required' 
            });
        }

        const results = [];
        let successCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const number = contacts[i];
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                await sock.sendMessage(formattedNumber, { text: message });
                results.push({ number, status: 'success' });
                successCount++;
                
                // Add delay between messages
                if (i < contacts.length - 1) {
                    await delay(delayMs);
                }
            } catch (error) {
                results.push({ number, status: 'error', error: error.message });
            }
        }

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contacts.length - successCount,
            message: `Sent ${successCount}/${contacts.length} messages successfully`
        });

    } catch (error) {
        console.error('Bulk send error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk send failed: ' + error.message 
        });
    }
});

// Health Check
app.get('/api/health', async (req, res) => {
    try {
        const session = await Session.findOne({});
        const dbStatus = mongoose.connection.readyState;
        const whatsappStatus = sock && sock.user ? 'connected' : 'disconnected';
        
        res.json({
            status: 'running',
            database: dbStatus === 1 ? 'connected' : 'disconnected',
            whatsapp: whatsappStatus,
            connection_type: session?.connectionType || 'none',
            qr_available: session ? !!session.qrCode : false,
            pairing_code_available: session ? !!session.pairingCode : false,
            rawana_session: !!session?.rawanaSessionId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'error',
            error: error.message
        });
    }
});

// Session Info
app.get('/api/session-info', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (!session) {
            return res.json({
                success: false,
                message: 'No active session'
            });
        }

        res.json({
            success: true,
            sessionId: session.sessionId,
            phoneNumber: session.phoneNumber,
            connected: session.connected,
            connectionType: session.connectionType,
            lastActivity: session.lastActivity,
            hasManualData: !!session.manualSession,
            hasRawanaSession: !!session.rawanaSessionId
        });

    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`📱 RAWANA MD Integration: http://localhost:${PORT}/api/rawana-pairing?number=94771234567`);
    console.log('✅ RAWANA MD Integration');
    console.log('✅ Manual Session Support');
    console.log('✅ QR Code Generation');
    console.log('✅ Bulk Messaging');
    
    // Wait a bit for MongoDB to connect
    setTimeout(() => {
        initializeWhatsApp();
    }, 2000);
});
