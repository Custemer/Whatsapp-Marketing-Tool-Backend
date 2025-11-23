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

// Simple CORS configuration - CORS error solve කරන්න
app.use(cors({
    origin: true, // සියලුම origins allow කරන්න
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

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

// Browser configuration fix - windows method නැති නිසා custom එක use කරන්න
const getBrowserConfig = () => {
    // Check if Browsers.windows exists, otherwise use alternative
    if (Browsers.windows) {
        return Browsers.windows('Chrome');
    } else if (Browsers.ubuntu) {
        return Browsers.ubuntu('Chrome');
    } else {
        // Custom browser configuration
        return ['Windows', 'Chrome', '110.0.0.0'];
    }
};

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

        // Fixed browser configuration
        const browserConfig = getBrowserConfig();
        console.log('🔧 Using browser config:', browserConfig);

        // Create socket with fixed configuration
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: browserConfig, // Fixed browser config
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        if (saveCredsFunction) {
            sock.ev.on('creds.update', saveCredsFunction);
        }

        // Enhanced Connection Handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect, isNewLogin } = update;
            
            console.log('🔗 Connection update:', connection);

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

        console.log('🚀 WhatsApp client initialization started');

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

// Start WhatsApp after MongoDB connection
mongoose.connection.on('connected', () => {
    console.log('🔗 Database connected - Starting WhatsApp in 3 seconds...');
    setTimeout(initializeWhatsApp, 3000);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log('📱 WhatsApp Marketing Tool with Manual Session Support - READY!');
    console.log('✅ Fixed Browser Configuration');
    console.log('✅ Fixed CORS Issues');
    console.log('✅ Manual Session Input');
    console.log('✅ Pairing Code Support');
    console.log('✅ QR Code Generation');
    console.log('✅ Bulk Messaging');
});
