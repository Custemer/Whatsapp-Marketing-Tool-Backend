const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection - ඔබගේ connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://darkslframexteam_db_user:Mongodb246810@cluster0.cdgkgic.mongodb.net/darkslframex?retryWrites=true&w=majority&appName=Cluster0';

console.log('🔧 MongoDB URI:', MONGODB_URI ? 'Configured' : 'Not configured');

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('✅ MongoDB Connected Successfully!');
    console.log('📊 Database: darkslframex');
    console.log('👤 User: darkslframexteam_db_user');
})
.catch((error) => {
    console.error('❌ MongoDB Connection Failed:', error.message);
    console.log('🔧 Troubleshooting:');
    console.log('   1. Check MongoDB Atlas Network Access');
    console.log('   2. Verify password is correct');
    console.log('   3. Check if IP is whitelisted');
});

// Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    qrCode: String,
    connected: { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);

// WhatsApp Client
let client = null;

async function initializeWhatsApp() {
    try {
        console.log('🔄 Initializing WhatsApp...');

        // Always create new session for testing
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
            message: session ? 
                (session.connected ? 'WhatsApp Connected ✅' : 
                 session.qrCode ? 'QR Available - Please Scan 📱' : 'Session Created') 
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

app.post('/api/new-session', async (req, res) => {
    try {
        console.log('🆕 User requested new session');
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
        message: 'WhatsApp Marketing Tool API',
        version: '2.0',
        endpoints: {
            health: '/api/health',
            status: '/api/status',
            qr: '/api/qr',
            newSession: '/api/new-session (POST)'
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
    console.log('📱 Waiting for MongoDB connection...');
});
