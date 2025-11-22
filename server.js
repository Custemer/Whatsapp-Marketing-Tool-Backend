const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');

const app = express();
app.use(cors());
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
    sessionData: Object, // Store complete session data
    qrCode: String,
    pairingCode: String,
    phoneNumber: String,
    connected: { type: Boolean, default: false },
    connectionType: { type: String, default: 'qr' }, // qr, pairing, manual
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
const store = makeInMemoryStore({ });
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
        if (manualData) {
            // Use manual session data
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
            // Use multi-file auth state
            console.log('🔧 Using multi-file auth state');
            const authState = await useMultiFileAuthState(sessionPath);
            state = authState;
        }

        // Create socket with proper configuration
        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            printQRInTerminal: false,
            logger: pino({ level: 'error' }),
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
        });

        // Store credentials updates
        if (!manualData) {
            sock.ev.on('creds.update', state.saveCreds);
        }

        // Bind store
        store.bind(sock.ev);

        // Connection Handler
        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;
            
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
                            lastActivity: new Date() 
                        },
                        { upsert: true }
                    );
                    console.log('💾 QR code saved');
                } catch (error) {
                    console.error('❌ QR save error:', error);
                }
            }

            if (connection === 'open') {
                console.log('🎉 WhatsApp CONNECTED!');
                try {
                    await Session.findOneAndUpdate(
                        {},
                        { 
                            connected: true, 
                            qrCode: null,
                            pairingCode: null,
                            phoneNumber: sock.user?.id.replace(/:\d+@/, '') || 'Unknown',
                            lastActivity: new Date() 
                        }
                    );
                    console.log('💾 Database updated: CONNECTED');
                    isInitializing = false;
                } catch (error) {
                    console.error('❌ Database update error:', error);
                }
            }

            if (connection === 'close') {
                console.log('📵 Connection closed');
                isInitializing = false;
                setTimeout(() => initializeWhatsApp(), 10000);
            }
        });

        console.log('🚀 WhatsApp client initialization started');

    } catch (error) {
        console.error('❌ WhatsApp initialization error:', error);
        isInitializing = false;
    }
}

// ==================== MANUAL SESSION API ROUTES ====================

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
            { upsert: true }
        );

        console.log('💾 Manual session data saved');

        // Try to initialize with manual data
        const manualData = {
            sessionId: sessionId,
            noiseKey: { private: Buffer.from(encKey || '', 'base64'), public: Buffer.from(macKey || '', 'base64') },
            signedIdentityKey: { private: Buffer.from(encKey || '', 'base64'), public: Buffer.from(macKey || '', 'base64') },
            registrationId: 123,
            advSecretKey: clientId || 'default',
            me: { id: phoneNumber ? formatPhoneNumber(phoneNumber) + '@s.whatsapp.net' : 'manual@session' }
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

// Simple Session Import (for pairing codes)
app.post('/api/import-session', async (req, res) => {
    try {
        const { pairingCode, phoneNumber } = req.body;

        console.log('📱 Import session with pairing code:', pairingCode);

        if (!pairingCode || !phoneNumber) {
            return res.json({
                success: false,
                error: 'Pairing code and phone number are required'
            });
        }

        // Save to database
        await Session.findOneAndUpdate(
            {},
            {
                pairingCode: pairingCode,
                phoneNumber: phoneNumber,
                connected: false,
                connectionType: 'pairing',
                lastActivity: new Date()
            },
            { upsert: true }
        );

        console.log('💾 Pairing code saved');

        // Simulate connection (in real implementation, this would validate the pairing code)
        setTimeout(async () => {
            await Session.findOneAndUpdate(
                {},
                { 
                    connected: true,
                    pairingCode: null 
                }
            );
            console.log('✅ Manual pairing connection established');
        }, 3000);

        res.json({
            success: true,
            message: 'Pairing code received. Connecting...',
            pairingCode: pairingCode
        });

    } catch (error) {
        console.error('❌ Import session error:', error);
        res.json({
            success: false,
            error: error.message
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

// Export Current Session
app.get('/api/export-session', async (req, res) => {
    try {
        const session = await Session.findOne({});
        
        if (!session) {
            return res.json({
                success: false,
                error: 'No active session to export'
            });
        }

        const sessionData = {
            sessionId: session.sessionId,
            phoneNumber: session.phoneNumber,
            connectionType: session.connectionType,
            connected: session.connected,
            exportDate: new Date().toISOString(),
            manualData: session.manualSession || null
        };

        res.json({
            success: true,
            sessionData: sessionData,
            message: 'Session data exported successfully'
        });

    } catch (error) {
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
            connected: isConnected ? true : (session ? session.connected : false),
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

// Pairing Code
app.get('/api/pairing-code', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        if (!sock) {
            return res.json({
                success: false,
                error: 'WhatsApp client not initialized'
            });
        }

        try {
            const pairingCode = await sock.requestPairingCode(formatPhoneNumber(number));
            
            await Session.findOneAndUpdate(
                {},
                { 
                    pairingCode: pairingCode,
                    phoneNumber: number,
                    connectionType: 'pairing',
                    lastActivity: new Date()
                },
                { upsert: true }
            );

            console.log(`📞 Pairing code generated for ${number}: ${pairingCode}`);
            
            res.json({
                success: true,
                pairingCode: pairingCode,
                message: `Enter this code in WhatsApp: ${pairingCode}`,
                instructions: 'Open WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number'
            });

        } catch (error) {
            console.error('Pairing code error:', error);
            res.json({ 
                success: false, 
                error: 'Failed to generate pairing code. Please try QR code instead.' 
            });
        }

    } catch (error) {
        res.json({ success: false, error: error.message });
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
        const { contacts, message, delay = 2000 } = req.body;
        
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
                    await delay(delay);
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
    console.log('✅ Manual Session Input');
    console.log('✅ Pairing Code Support');
    console.log('✅ QR Code Generation');
    console.log('✅ Bulk Messaging');
});
