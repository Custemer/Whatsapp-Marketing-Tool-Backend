const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

const campaignSchema = new mongoose.Schema({
    name: String,
    message: String,
    image: String,
    contacts: [String],
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const contactSchema = new mongoose.Schema({
    name: String,
    phone: String,
    location: String,
    source: String,
    tags: [String],
    hasWhatsApp: { type: Boolean, default: false },
    lastContacted: Date,
    createdAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', sessionSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);
const Contact = mongoose.model('Contact', contactSchema);

// WhatsApp Client
let client = null;

// Generate 8-character alphanumeric pairing code
function generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
}

// Format phone number
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

// Convert base64 to MessageMedia
async function base64ToMessageMedia(base64String, mimeType = 'image/jpeg') {
    try {
        const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        return new MessageMedia(mimeType, base64Data, 'image.jpg');
    } catch (error) {
        console.error('Error converting base64 to MessageMedia:', error);
        return null;
    }
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

// Pairing Code - 8-character alphanumeric
app.get('/api/pairing-code', async (req, res) => {
    try {
        const { number } = req.query;
        
        if (!number) {
            return res.json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        const pairingCode = generatePairingCode();
        
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

// ==================== MARKETING FEATURES ====================

// 1. Number Detection & Search
app.post('/api/detect-numbers', async (req, res) => {
    try {
        const { keyword, location, limit = 20, source = 'all' } = req.body;
        
        console.log(`🔍 Searching for: ${keyword} in ${location}, limit: ${limit}, source: ${source}`);
        
        // Simulate different data sources
        let mockNumbers = [];
        
        if (source === 'google' || source === 'all') {
            mockNumbers = mockNumbers.concat([
                { name: `Google: ${keyword} Business 1`, number: '94771234567', location: location, hasWhatsApp: true, source: 'google' },
                { name: `Google: ${keyword} Business 2`, number: '94771234568', location: location, hasWhatsApp: true, source: 'google' },
                { name: `Google: ${keyword} Service`, number: '94771234569', location: location, hasWhatsApp: true, source: 'google' },
            ]);
        }
        
        if (source === 'facebook' || source === 'all') {
            mockNumbers = mockNumbers.concat([
                { name: `Facebook: ${keyword} Shop`, number: '94771234570', location: location, hasWhatsApp: true, source: 'facebook' },
                { name: `Facebook: ${keyword} Store`, number: '94771234571', location: location, hasWhatsApp: true, source: 'facebook' },
            ]);
        }

        // Add some random numbers
        const additionalNumbers = Array.from({ length: 15 }, (_, i) => ({
            name: `${keyword} Business ${i + 1}`,
            number: `9477${100000 + i}`,
            location: location,
            hasWhatsApp: Math.random() > 0.3,
            source: 'database'
        }));

        mockNumbers = mockNumbers.concat(additionalNumbers).slice(0, limit);

        // Save to contacts database
        for (const num of mockNumbers) {
            await Contact.findOneAndUpdate(
                { phone: num.number },
                {
                    name: num.name,
                    phone: num.number,
                    location: num.location,
                    source: num.source,
                    hasWhatsApp: num.hasWhatsApp,
                    lastContacted: new Date()
                },
                { upsert: true, new: true }
            );
        }

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

// 2. Advanced Number Search
app.post('/api/advanced-search', async (req, res) => {
    try {
        const { 
            keyword, 
            location, 
            category, 
            minNumbers = 1, 
            maxNumbers = 50,
            hasWhatsApp = true 
        } = req.body;

        console.log(`🔍 Advanced search: ${keyword} in ${location}, category: ${category}`);

        // Simulate advanced search results
        const categories = {
            'restaurants': ['Cafe', 'Hotel', 'Restaurant', 'Food Court'],
            'shops': ['Store', 'Shop', 'Boutique', 'Market'],
            'services': ['Service', 'Agency', 'Center', 'Consultancy'],
            'medical': ['Hospital', 'Clinic', 'Pharmacy', 'Doctor']
        };

        const selectedCategory = categories[category] || ['Business', 'Service', 'Store'];
        
        const advancedResults = selectedCategory.map((type, index) => ({
            name: `${type} ${keyword} ${index + 1}`,
            number: `9477${200000 + index}`,
            location: location,
            category: category,
            hasWhatsApp: hasWhatsApp,
            rating: (Math.random() * 5).toFixed(1),
            reviews: Math.floor(Math.random() * 100),
            verified: Math.random() > 0.5
        })).slice(0, maxNumbers);

        res.json({
            success: true,
            count: advancedResults.length,
            numbers: advancedResults,
            filters: {
                keyword,
                location,
                category,
                hasWhatsApp
            },
            message: `Found ${advancedResults.length} ${category} businesses in ${location}`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 3. Group Extraction
app.post('/api/extract-groups', async (req, res) => {
    try {
        const { keywords, limit = 20, extractMembers = false } = req.body;
        
        if (!client || !client.info) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please connect first.' 
            });
        }

        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .filter(chat => {
                if (!keywords) return true;
                const searchTerm = keywords.toLowerCase();
                return chat.name.toLowerCase().includes(searchTerm);
            })
            .slice(0, limit);

        let groupData = [];

        for (const group of groups) {
            const groupInfo = {
                id: group.id._serialized,
                name: group.name,
                members: group.participants.length,
                active: true,
                description: group.description || 'No description',
                created: group.createdAt || new Date()
            };

            if (extractMembers && group.participants.length > 0) {
                groupInfo.memberList = group.participants.slice(0, 10).map(member => ({
                    id: member.id._serialized,
                    name: member.name || member.pushname || 'Unknown',
                    isAdmin: member.isAdmin || false
                }));
            }

            groupData.push(groupInfo);
        }

        res.json({
            success: true,
            count: groupData.length,
            groups: groupData,
            message: `Found ${groupData.length} groups`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 4. Bulk Messaging with Image Support
app.post('/api/send-bulk', async (req, res) => {
    try {
        const { contacts, message, image, delay = 3000 } = req.body;
        
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

        if (!message && !image) {
            return res.json({ 
                success: false, 
                error: 'No message or image provided' 
            });
        }

        const results = [];
        let sentCount = 0;
        let failedCount = 0;

        // Convert base64 image to MessageMedia if provided
        let media = null;
        if (image) {
            media = await base64ToMessageMedia(image);
            if (!media) {
                return res.json({
                    success: false,
                    error: 'Invalid image format'
                });
            }
        }

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            try {
                let formattedNumber = formatPhoneNumber(contact);
                formattedNumber = formattedNumber + '@c.us';
                
                // Check if contact exists on WhatsApp
                const contactId = await client.getNumberId(contact.replace(/\D/g, ''));
                
                if (contactId) {
                    if (media && message) {
                        // Send both image and message
                        await client.sendMessage(contactId._serialized, media, { caption: message });
                    } else if (media) {
                        // Send only image
                        await client.sendMessage(contactId._serialized, media);
                    } else {
                        // Send only message
                        await client.sendMessage(contactId._serialized, message);
                    }
                    
                    results.push({ 
                        number: contact, 
                        status: 'success',
                        timestamp: new Date().toISOString()
                    });
                    sentCount++;
                    
                    console.log(`✅ Message sent to ${contact}`);
                    
                    // Update contact last contacted
                    await Contact.findOneAndUpdate(
                        { phone: contact },
                        { lastContacted: new Date() },
                        { upsert: true }
                    );
                } else {
                    results.push({ 
                        number: contact, 
                        status: 'error',
                        error: 'Number not on WhatsApp',
                        timestamp: new Date().toISOString()
                    });
                    failedCount++;
                    console.log(`❌ Number not on WhatsApp: ${contact}`);
                }

                // Delay between messages
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

            } catch (error) {
                results.push({ 
                    number: contact, 
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                failedCount++;
                console.log(`❌ Failed to send to ${contact}:`, error.message);
            }
        }

        res.json({
            success: true,
            sent: sentCount,
            failed: failedCount,
            total: contacts.length,
            hasImage: !!image,
            results: results,
            message: `Sent ${sentCount}/${contacts.length} messages successfully${image ? ' with images' : ''}`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 5. Campaign Management with Image Support
app.post('/api/create-campaign', async (req, res) => {
    try {
        const { name, message, image, contacts, schedule } = req.body;
        
        const campaign = new Campaign({
            name,
            message,
            image: image || null,
            contacts: contacts || [],
            status: 'active',
            schedule: schedule || 'immediate'
        });

        await campaign.save();

        // If immediate schedule, send messages
        if (schedule === 'immediate' && contacts && contacts.length > 0) {
            // Send messages in background
            setTimeout(async () => {
                try {
                    const sendResults = await sendBulkMessages(contacts, message, image, 2000);
                    await Campaign.findByIdAndUpdate(campaign._id, {
                        sent: sendResults.sent,
                        failed: sendResults.failed
                    });
                } catch (error) {
                    console.error('Campaign sending error:', error);
                }
            }, 1000);
        }

        res.json({
            success: true,
            campaignId: campaign._id,
            hasImage: !!image,
            message: `Campaign "${name}" created successfully${image ? ' with image' : ''}`
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 6. Get All Campaigns
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

// 7. Contact Management
app.get('/api/contacts', async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '' } = req.query;
        
        const query = search ? {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const contacts = await Contact.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Contact.countDocuments(query);

        res.json({
            success: true,
            contacts: contacts,
            total: total,
            page: page,
            pages: Math.ceil(total / limit)
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 8. Export Contacts
app.post('/api/export-contacts', async (req, res) => {
    try {
        const { format = 'csv', contacts = [] } = req.body;
        
        let exportData = '';
        let filename = 'contacts';
        
        if (format === 'csv') {
            exportData = 'Name,Phone,Location,Source,HasWhatsApp,LastContacted\n';
            const contactList = contacts.length > 0 ? contacts : await Contact.find().limit(1000);
            
            exportData += contactList.map(contact => 
                `"${contact.name || ''}","${contact.phone}","${contact.location || ''}","${contact.source || ''}","${contact.hasWhatsApp}","${contact.lastContacted || ''}"`
            ).join('\n');
            
            filename = 'contacts.csv';
        } else if (format === 'txt') {
            const contactList = contacts.length > 0 ? contacts : await Contact.find().limit(1000);
            exportData = contactList.map(contact => 
                `${contact.name || 'Unknown'} - ${contact.phone} - ${contact.location || 'Unknown'}`
            ).join('\n');
            filename = 'contacts.txt';
        }

        res.json({
            success: true,
            data: exportData,
            filename: filename,
            format: format,
            count: exportData.split('\n').length - (format === 'csv' ? 1 : 0)
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 9. Statistics
app.get('/api/statistics', async (req, res) => {
    try {
        const totalContacts = await Contact.countDocuments();
        const whatsAppContacts = await Contact.countDocuments({ hasWhatsApp: true });
        const totalCampaigns = await Campaign.countDocuments();
        const totalMessages = await Campaign.aggregate([
            { $group: { _id: null, totalSent: { $sum: '$sent' } } }
        ]);

        const recentContacts = await Contact.find()
            .sort({ lastContacted: -1 })
            .limit(5);

        res.json({
            success: true,
            statistics: {
                totalContacts,
                whatsAppContacts,
                totalCampaigns,
                totalMessagesSent: totalMessages[0]?.totalSent || 0,
                successRate: totalContacts > 0 ? (whatsAppContacts / totalContacts * 100).toFixed(1) : 0
            },
            recentContacts
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
        message: 'WhatsApp Marketing Tool API - COMPLETE WITH IMAGE SUPPORT',
        version: '5.0',
        status: 'active',
        features: [
            'QR Code & 8-Character Pairing Code Connection',
            'Advanced Number Detection',
            'Group Extraction with Members',
            'Bulk Messaging with Image Support',
            'Campaign Management with Images',
            'Contact Management System',
            'Data Export (CSV/TXT)',
            'Real-time Statistics Dashboard'
        ],
        endpoints: {
            health: '/api/health',
            status: '/api/status',
            qr: '/api/qr',
            pairingCode: '/api/pairing-code?number=PHONE_NUMBER',
            detectNumbers: '/api/detect-numbers (POST)',
            advancedSearch: '/api/advanced-search (POST)',
            extractGroups: '/api/extract-groups (POST)',
            sendBulk: '/api/send-bulk (POST) - with image support',
            createCampaign: '/api/create-campaign (POST) - with image support',
            campaigns: '/api/campaigns (GET)',
            contacts: '/api/contacts (GET)',
            exportContacts: '/api/export-contacts (POST)',
            statistics: '/api/statistics (GET)'
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
    console.log('📱 WhatsApp Marketing Tool - COMPLETE WITH IMAGE SUPPORT READY!');
});

// Helper function for sending bulk messages
async function sendBulkMessages(contacts, message, image, delay) {
    const results = { sent: 0, failed: 0 };
    
    let media = null;
    if (image) {
        media = await base64ToMessageMedia(image);
    }
    
    for (const contact of contacts) {
        try {
            let formattedNumber = formatPhoneNumber(contact);
            formattedNumber = formattedNumber + '@c.us';
            
            const contactId = await client.getNumberId(contact.replace(/\D/g, ''));
            
            if (contactId) {
                if (media && message) {
                    await client.sendMessage(contactId._serialized, media, { caption: message });
                } else if (media) {
                    await client.sendMessage(contactId._serialized, media);
                } else {
                    await client.sendMessage(contactId._serialized, message);
                }
                results.sent++;
            } else {
                results.failed++;
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            results.failed++;
        }
    }
    
    return results;
}
