const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();

// CORS - Allow all origins for now
app.use(cors());
app.use(express.json());

// Store QR code globally
let currentQR = null;
let isConnected = false;

// Basic API routes - TEST THESE FIRST
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'WhatsApp Marketing Backend',
        whatsapp: isConnected ? 'connected' : 'disconnected',
        qr_available: !!currentQR,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'Backend is working perfectly!',
        version: '1.0'
    });
});

app.get('/api/qr', (req, res) => {
    if (currentQR) {
        res.json({ qr: currentQR });
    } else {
        res.json({ qr: null, message: 'No QR code available' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ 
        connected: isConnected,
        qr_available: !!currentQR 
    });
});

// WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    console.log('QR Code received');
    currentQR = await qrcode.toDataURL(qr);
    console.log('QR Code stored');
});

client.on('ready', () => {
    console.log('WhatsApp is ready!');
    isConnected = true;
    currentQR = null;
});

client.on('disconnected', () => {
    console.log('WhatsApp disconnected');
    isConnected = false;
});

// Initialize WhatsApp
client.initialize();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Health: https://whatsapp-marketing-backend.onrender.com/api/health`);
    console.log(`🔗 Test: https://whatsapp-marketing-backend.onrender.com/api/test`);
});
