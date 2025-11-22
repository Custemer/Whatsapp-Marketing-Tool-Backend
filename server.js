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

// Schemas
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

// Generate 8-character pairing code with mixed characters
function generatePairingCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';
    let result = '';
    const charactersLength = characters.length;
    
    for (let i = 0; i < 8; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    
    return result;
}

// Alternative: Generate alphanumeric code (only letters and numbers)
function generateAlphanumericCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
}

// Alternative: Generate memorable code (3 letters + 3 numbers + 2 letters)
function generateMemorableCode() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    
    let code = '';
    
    // First 3 letters
    for (let i = 0; i < 3; i++) {
        code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    
    // 3 numbers
    for (let i = 0; i < 3; i++) {
        code += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    
    // Last 2 letters
    for (let i = 0; i < 2; i++) {
        code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    
    return code;
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

// ==================== API ROUTES ====================

// Status Check
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

// Pairing Code - Updated with 8 characters
app.get('/api/pairing-code', async (req, res) => {
    try {
        const { number, type = 'mixed' } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        let pairingCode;
        
        // Choose code type based on parameter
        switch(type) {
            case 'alphanumeric':
                pairingCode = generateAlphanumericCode();
                break;
            case 'memorable':
                pairingCode = generateMemorableCode();
                break;
            case 'mixed':
            default:
                pairingCode = generatePairingCode();
                break;
        }
        
        await Session.findOneAndUpdate(
            {},
            { 
                pairingCode: pairingCode,
                phoneNumber: number,
                lastActivity: new Date()
            },
            { upsert: true }
        );

        console.log(`📞 8-character pairing code generated for ${number}: ${pairingCode}`);
        
        res.json({
            success: true,
            pairingCode: pairingCode,
            codeType: type,
            message: `Enter this 8-character code in WhatsApp: ${pairingCode}`,
            instructions: 'Open WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number'
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Pairing Status
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

// New Session
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
        message: 'WhatsApp Marketing Tool API - 8-CHARACTER PAIRING CODES',
        version: '4.1',
        status: 'active',
        pairing_code: {
            length: '8 characters',
            types: ['mixed', 'alphanumeric', 'memorable'],
            example: 'A1b2C3d4'
        },
        endpoints: {
            health: '/api/health',
            status: '/api/status',
            qr: '/api/qr',
            pairingCode: '/api/pairing-code?number=PHONE_NUMBER&type=mixed',
            pairingStatus: '/api/pairing-status',
            newSession: '/api/new-session (POST)'
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
    console.log('📱 WhatsApp Marketing Tool - 8-CHARACTER PAIRING CODES READY!');
});
