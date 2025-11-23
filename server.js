const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

// Import Baileys components
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();

// Enhanced CORS configuration for Safari and all browsers
app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:10000',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:10000',
            'https://yourdomain.com'
        ];
        
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

// Safari compatibility middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://darkslframexteam_db_user:Mongodb246810@cluster0.cdgkgic.mongodb.net/darkslframex?retryWrites=true&w=majority&appName=Cluster0';

console.log('🔧 Starting WhatsApp Marketing Tool with Manual Session Support...');

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
    manualSession: {
        sessionId: String,
        sessionToken: String,
        clientId: String,
        serverToken: String,
        encKey: String,
        macKey: String
    }
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

// Delay function for bulk messaging
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize WhatsApp with Baileys
async function initializeWhatsApp(manualData = null) {
    if (isInitializing) {
        console.log('⚠️ WhatsApp initialization already in progress');
        return;
    }

    try {
        isInitializing = true;
        console.log('🔄 Initializing WhatsApp...');

        const sessionId = manualData?.sessionId || 'baileys-session-' + Date.now();
        const sessionPath = path.join(SESSION_BASE_PATH, sessionId);

        let state;
        let saveCredsFunction = null;

        if (manualData) {
            console.log('🔧 Using manual session data');
            state = {
                creds: {
                    noiseKey: manualData.noiseKey,
                    signedIdentityKey: manualData.signedIdentityKey,
                    signedPreKey: manualData.signedPreKey,
                    registrationId: manualData.registrationId,
                    advSecretKey: manualData.advSecretKey,
                    processedHistoryMessages: manualData.processedHistoryMessages || [],
                    nextPreKeyId: manualData.nextPreKeyId || 1,
                    firstUnuploadedPreKeyId: manualData.firstUnuploadedPreKeyId || 1,
                    accountSettings: manualData.accountSettings || {},
                    me: manualData.me,
                    signalIdentities: manualData.signalIdentities || [],
                    platform: manualData.platform || 'web'
                },
                keys: {
                    get: (type, ids) => {
                        if (type === 'pre-key' && manualData.preKeys) {
                            return manualData.preKeys.filter(pk => ids.includes(pk.keyId));
                        }
                        return [];
                    }
                }
            };
        } else {
            console.log('🔧 Using multi-file auth state');
            const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);
            state = authState;
            saveCredsFunction = saveCreds;
        }

        // Create socket with Chrome Windows configuration
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'), // Changed to Chrome Windows
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 3000,
            maxRetries: 5,
            fireInitQueries: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
        });

        if (saveCredsFunction) {
            sock.ev.on('creds.update', saveCredsFunction);
        }

        // Enhanced Connection Handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect, isNewLogin } = update;
            
            console.log('🔗 Connection update:', connection, lastDisconnect?.error?.message);

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
                            connected: false
                        },
                        { upsert: true, new: true }
                    );
                    console.log('💾 QR code saved');
                } catch (error) {
                    console.error('❌ QR save error:', error);
                }
            }

            if (connection === 'open') {
                console.log('🎉 WhatsApp CONNECTED SUCCESSFULLY!');
                try {
                    const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
                    await Session.findOneAndUpdate(
                        {},
                        { 
                            connected: true, 
                            qrCode: null,
                            pairingCode: null,
                            phoneNumber: userPhone,
                            lastActivity: new Date(),
                            connectionType: 'qr'
                        },
                        { upsert: true, new: true }
                    );
                    console.log('✅ Database updated: CONNECTED');
                    isInitializing = false;
                } catch (error) {
                    console.error('❌ Database update error:', error);
                }
            }

            if (connection === 'close') {
                console.log('📵 Connection closed');
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message;
                
                console.log('🔍 Disconnect reason:', {
                    statusCode,
                    errorMessage,
                    isNewLogin
                });
                
                if (statusCode === DisconnectReason.loggedOut || isNewLogin) {
                    console.log('❌ Device logged out, clearing session...');
                    try {
                        await fs.remove(sessionPath);
                        console.log('🗑️ Session files removed');
                    } catch (error) {
                        console.log('ℹ️ No session files to remove');
                    }
                    await Session.deleteMany({});
                    console.log('🗑️ Database session cleared');
                }
                
                isInitializing = false;
                
                const retryDelay = 10000;
                console.log(`🔄 Attempting to reconnect in ${retryDelay/1000} seconds...`);
                
                setTimeout(() => {
                    console.log('🔄 Starting reconnection...');
                    initializeWhatsApp();
                }, retryDelay);
            }

            if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
                await Session.findOneAndUpdate(
                    {},
                    { 
                        connected: false,
                        lastActivity: new Date()
                    },
                    { upsert: true, new: true }
                );
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.messages && m.messages[0] && !m.messages[0].key.fromMe) {
                console.log('📩 New message received');
            }
        });

        console.log('🚀 WhatsApp client initialization started with Chrome Windows');

    } catch (error) {
        console.error('❌ WhatsApp initialization error:', error);
        isInitializing = false;
        
        console.log('🔄 Retrying initialization in 5 seconds...');
        setTimeout(() => initializeWhatsApp(), 5000);
    }
}

// ==================== MANUAL SESSION & PAIRING CODE APIs ====================

// Manual Session Connection
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

        const manualData = {
            sessionId: sessionId,
            noiseKey: { 
                private: Buffer.from(encKey || 'default', 'base64'), 
                public: Buffer.from(macKey || 'default', 'base64') 
            },
            signedIdentityKey: { 
                private: Buffer.from(encKey || 'default', 'base64'), 
                public: Buffer.from(macKey || 'default', 'base64') 
            },
            signedPreKey: {
                keyId: 1,
                keyPair: {
                    private: Buffer.from(encKey || 'default', 'base64'),
                    public: Buffer.from(macKey || 'default', 'base64')
                },
                signature: Buffer.from('signature', 'utf8')
            },
            registrationId: 123,
            advSecretKey: clientId || 'default',
            me: { 
                id: phoneNumber ? formatPhoneNumber(phoneNumber) + '@s.whatsapp.net' : 'manual@session',
                name: 'Manual Session User'
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

// Simple Pairing Code Input
app.post('/api/input-pairing', async (req, res) => {
    try {
        const { pairingCode, phoneNumber } = req.body;

        console.log('📱 Manual pairing input received:', { 
            pairingCode, 
            phoneNumber 
        });

        if (!pairingCode || !phoneNumber) {
            return res.json({
                success: false,
                error: 'Pairing code and phone number are required'
            });
        }

        if (!/^[A-Z0-9]{6,8}$/.test(pairingCode)) {
            return res.json({
                success: false,
                error: 'Invalid pairing code format. Should be 6-8 alphanumeric characters.'
            });
        }

        await Session.findOneAndUpdate(
            {},
            {
                pairingCode: pairingCode.trim().toUpperCase(),
                phoneNumber: formatPhoneNumber(phoneNumber),
                connected: false,
                connectionType: 'pairing',
                lastActivity: new Date(),
                qrCode: null
            },
            { upsert: true, new: true }
        );

        console.log('💾 Pairing code saved to database');

        await initializeWhatsApp();

        res.json({
            success: true,
            message: 'Pairing code received successfully!',
            pairingCode: pairingCode,
            nextSteps: [
                'WhatsApp connection is being initialized...',
                'Check status endpoint for connection updates',
                'If connection fails, try QR code method'
            ]
        });

    } catch (error) {
        console.error('❌ Manual pairing input error:', error);
        res.json({
            success: false,
            error: 'Failed to process pairing code: ' + error.message
        });
    }
});

// Get Session Info
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
            hasManualData: !!session.manualSession
        });

    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ENHANCED API ROUTES ====================

// Safari-optimized status endpoint
app.get('/api/safari-status', async (req, res) => {
    try {
        const session = await Session.findOne({});
        const isConnected = sock && sock.user;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        const response = {
            success: true,
            connected: isConnected,
            hasSession: !!session,
            qrAvailable: session ? !!session.qrCode : false,
            pairingCodeAvailable: session ? !!session.pairingCode : false,
            connectionType: session?.connectionType || 'none',
            timestamp: Date.now(),
            safariCompatible: true,
            message: isConnected ? 'WhatsApp Connected ✅' : 
                     session?.qrCode ? 'QR Available - Please Scan 📱' : 
                     session?.pairingCode ? 'Pairing Code Available 🔑' :
                     session?.connectionType === 'manual' ? 'Manual Session Configured ⚙️' :
                     'Initializing...'
        };
        
        res.json(response);

    } catch (error) {
        res.json({ 
            success: false, 
            error: error.message,
            safariTip: 'Clear browser cache and try again'
        });
    }
});

// Enhanced QR code endpoint for Safari
app.get('/api/qr-safari', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (session && session.qrCode) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache');
            
            res.json({ 
                success: true, 
                qr: session.qrCode,
                message: 'Scan with WhatsApp within 2 minutes',
                timestamp: new Date().toISOString(),
                refreshIn: 20000
            });
        } else {
            res.json({ 
                success: false, 
                message: 'QR code generating... Please wait and refresh',
                retryAfter: 5000
            });
        }
    } catch (error) {
        console.error('QR code error:', error);
        res.json({ 
            success: false, 
            error: 'QR generation failed',
            safariTip: 'Try refreshing the page or using a different browser'
        });
    }
});

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
            message: isConnected ? 'WhatsApp Connected ✅' : 
                     session?.qrCode ? 'QR Available - Please Scan 📱' : 
                     session?.pairingCode ? 'Pairing Code Available 🔑' :
                     session?.connectionType === 'manual' ? 'Manual Session Configured ⚙️' :
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
            res.json({ 
                success: false, 
                message: 'QR code generating... Please wait and refresh' 
            });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Pairing Code Generation
app.get('/api/pairing-code', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        if (!sock || isInitializing) {
            await initializeWhatsApp();
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        if (!sock) {
            return res.json({
                success: false,
                error: 'WhatsApp client not initialized. Please try again.'
            });
        }

        try {
            const formattedNumber = formatPhoneNumber(number);
            console.log(`📞 Generating pairing code for: ${formattedNumber}`);
            
            const pairingCode = await sock.requestPairingCode(formattedNumber);
            
            await Session.findOneAndUpdate(
                {},
                { 
                    pairingCode: pairingCode,
                    phoneNumber: formattedNumber,
                    connectionType: 'pairing',
                    lastActivity: new Date(),
                    connected: false,
                    qrCode: null
                },
                { upsert: true, new: true }
            );

            console.log(`✅ Pairing code generated for ${formattedNumber}: ${pairingCode}`);
            
            res.json({
                success: true,
                pairingCode: pairingCode,
                message: `Pairing code generated successfully!`,
                instructions: [
                    '1. Open WhatsApp on your phone',
                    '2. Go to Settings → Linked Devices → Link a Device',
                    '3. Select "Link with phone number"', 
                    '4. Enter this code: ' + pairingCode,
                    '5. Wait for connection confirmation'
                ]
            });

        } catch (error) {
            console.error('❌ Pairing code generation error:', error);
            
            res.json({ 
                success: false, 
                error: 'Pairing code generation failed. Please use QR code method.',
                fallback: true
            });
        }

    } catch (error) {
        console.error('❌ Pairing endpoint error:', error);
        res.json({ 
            success: false, 
            error: 'Server error: ' + error.message 
        });
    }
});

// New Session
app.post('/api/new-session', async (req, res) => {
    try {
        console.log('🆕 User requested new session');
        
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

// Test connection endpoint
app.get('/api/test-connection', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        res.json({
            success: true,
            sessionExists: !!session,
            currentSession: session ? {
                phoneNumber: session.phoneNumber,
                connected: session.connected,
                connectionType: session.connectionType,
                hasPairingCode: !!session.pairingCode,
                hasQRCode: !!session.qrCode
            } : null,
            whatsappState: sock ? {
                initialized: true,
                connected: !!sock.user,
                user: sock.user ? 'Logged in' : 'Not logged in'
            } : {
                initialized: false,
                connected: false
            },
            recommendations: session ? 
                (session.connected ? 
                    '✅ Everything is working!' : 
                    (session.pairingCode ? 
                        '⏳ Waiting for pairing confirmation...' : 
                        '📱 Please scan QR code or enter pairing code')) :
                '🔧 Please initialize a new session'
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
        const whatsappStatus = sock && sock.user ? 'connected' : 'disconnected';
        
        res.json({
            status: 'running',
            database: dbStatus === 1 ? 'connected' : 'disconnected',
            whatsapp: whatsappStatus,
            connection_type: session?.connectionType || 'none',
            qr_available: session ? !!session.qrCode : false,
            pairing_code_available: session ? !!session.pairingCode : false,
            manual_session: !!session?.manualSession,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'error',
            error: error.message
        });
    }
});

// Serve a simple HTML page that works well with Safari
app.get('/safari-interface', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Tool - Safari Compatible</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .status {
                padding: 15px;
                border-radius: 5px;
                margin: 10px 0;
                text-align: center;
            }
            .connected { background: #d4edda; color: #155724; }
            .disconnected { background: #f8d7da; color: #721c24; }
            .qr-container {
                text-align: center;
                margin: 20px 0;
            }
            button {
                background: #007bff;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                margin: 5px;
            }
            button:hover { background: #0056b3; }
            .refresh-btn { background: #28a745; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📱 WhatsApp Connection Tool</h1>
            <p><em>Safari Optimized Version</em></p>
            
            <div id="status" class="status disconnected">
                Loading status...
            </div>
            
            <div id="qrContainer" class="qr-container" style="display: none;">
                <h3>Scan QR Code</h3>
                <img id="qrImage" src="" alt="QR Code">
                <p>Open WhatsApp → Settings → Linked Devices → Scan QR Code</p>
            </div>
            
            <div id="pairingContainer" style="display: none;">
                <h3>Pairing Code</h3>
                <div id="pairingCode"></div>
                <p>Open WhatsApp → Settings → Linked Devices → Link with Phone Number</p>
            </div>
            
            <div style="margin-top: 20px;">
                <button onclick="getQRCode()">Get QR Code</button>
                <button onclick="getStatus()" class="refresh-btn">Refresh Status</button>
                <button onclick="newSession()">New Session</button>
            </div>
            
            <div id="manualPairing" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
                <h4>Manual Pairing Code Input</h4>
                <input type="text" id="pairingInput" placeholder="Enter pairing code (e.g., 4SHRJQRX)" style="padding: 8px; width: 200px;">
                <input type="text" id="phoneInput" placeholder="Phone number (e.g., 94769424903)" style="padding: 8px; width: 200px; margin: 0 10px;">
                <button onclick="submitPairing()">Submit Pairing Code</button>
            </div>
        </div>

        <script>
            async function getStatus() {
                try {
                    const response = await fetch('/api/safari-status?t=' + Date.now());
                    const data = await response.json();
                    
                    const statusDiv = document.getElementById('status');
                    statusDiv.textContent = data.message;
                    statusDiv.className = 'status ' + (data.connected ? 'connected' : 'disconnected');
                    
                    if (data.qrAvailable) {
                        getQRCode();
                    }
                    
                } catch (error) {
                    document.getElementById('status').textContent = 'Error loading status';
                }
            }
            
            async function getQRCode() {
                try {
                    const response = await fetch('/api/qr-safari?t=' + Date.now());
                    const data = await response.json();
                    
                    if (data.success) {
                        document.getElementById('qrImage').src = data.qr;
                        document.getElementById('qrContainer').style.display = 'block';
                    }
                } catch (error) {
                    console.error('QR code error:', error);
                }
            }
            
            async function submitPairing() {
                const pairingCode = document.getElementById('pairingInput').value;
                const phoneNumber = document.getElementById('phoneInput').value;
                
                if (!pairingCode || !phoneNumber) {
                    alert('Please enter both pairing code and phone number');
                    return;
                }
                
                try {
                    const response = await fetch('/api/input-pairing', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            pairingCode: pairingCode,
                            phoneNumber: phoneNumber
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        alert('Pairing code submitted successfully!');
                        getStatus();
                    } else {
                        alert('Error: ' + data.error);
                    }
                } catch (error) {
                    alert('Network error: ' + error.message);
                }
            }
            
            async function newSession() {
                try {
                    const response = await fetch('/api/new-session', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        alert('New session started!');
                        getStatus();
                    }
                } catch (error) {
                    alert('Error starting new session');
                }
            }
            
            // Auto-refresh every 10 seconds
            setInterval(getStatus, 10000);
            
            // Initial load
            getStatus();
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Start WhatsApp after MongoDB connection
mongoose.connection.on('connected', () => {
    console.log('🔗 Database connected - Starting WhatsApp in 3 seconds...');
    setTimeout(initializeWhatsApp, 3000);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`📱 Safari Interface: http://localhost:${PORT}/safari-interface`);
    console.log('📱 WhatsApp Marketing Tool with Manual Session Support - READY!');
    console.log('✅ Chrome Windows Configuration');
    console.log('✅ Safari Browser Support');
    console.log('✅ Manual Session Input');
    console.log('✅ Pairing Code Support');
    console.log('✅ QR Code Generation');
    console.log('✅ Bulk Messaging');
});
