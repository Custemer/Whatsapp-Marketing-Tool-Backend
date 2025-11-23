const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { getWhatsAppClient } = require("./pair");
const Contact = require("../models/Contact");
const Session = require("../models/Session");

const router = express.Router();

// Configure multer for multiple file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads/marketing';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Advanced bulk messaging with images to active numbers
router.post("/bulk-with-images", upload.array('images', 10), async (req, res) => {
    try {
        const { 
            contacts, 
            message, 
            delayMs = 2000,
            sendTo = 'active', // 'active', 'all', 'new'
            imageRotation = 'sequential' // 'sequential', 'random', 'first'
        } = req.body;
        
        const images = req.files;
        
        if (!message) {
            return res.json({ 
                success: false, 
                error: 'Message is required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        let contactList = [];
        
        if (contacts && contacts.length > 0) {
            // Use provided contacts
            contactList = Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '');
        } else {
            // Use contacts from database based on selection
            let query = {};
            if (sendTo === 'active') {
                query = { status: 'active' };
            } else if (sendTo === 'new') {
                query = { messageCount: 0 };
            }
            
            const dbContacts = await Contact.find(query);
            contactList = dbContacts.map(contact => contact.phoneNumber);
        }

        const results = [];
        let successCount = 0;
        let imageIndex = 0;

        for (let i = 0; i < contactList.length; i++) {
            const number = contactList[i].trim();
            
            try {
                // Verify number is active (optional - for extra safety)
                const formattedNumber = number.replace(/\D/g, '') + '@s.whatsapp.net';
                const [whatsappCheck] = await client.onWhatsApp(formattedNumber);
                
                if (sendTo === 'active' && (!whatsappCheck || !whatsappCheck.exists)) {
                    results.push({ number, status: 'skipped', reason: 'Not on WhatsApp' });
                    continue;
                }

                let messageOptions = { text: message };
                
                // Add image if available
                if (images && images.length > 0) {
                    let selectedImage;
                    
                    if (imageRotation === 'sequential') {
                        selectedImage = images[imageIndex % images.length];
                        imageIndex++;
                    } else if (imageRotation === 'random') {
                        selectedImage = images[Math.floor(Math.random() * images.length)];
                    } else {
                        selectedImage = images[0]; // Use first image
                    }
                    
                    messageOptions = {
                        image: { url: selectedImage.path },
                        caption: message
                    };
                }
                
                await client.sendMessage(formattedNumber, messageOptions);
                results.push({ number, status: 'success' });
                successCount++;
                
                // Update contact in database
                await Contact.findOneAndUpdate(
                    { phoneNumber: number },
                    {
                        phoneNumber: number,
                        lastContacted: new Date(),
                        $inc: { messageCount: 1 },
                        status: 'active'
                    },
                    { upsert: true, new: true }
                );
                
                // Add delay between messages
                if (i < contactList.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, parseInt(delayMs)));
                }
                
            } catch (error) {
                results.push({ number, status: 'error', error: error.message });
                
                // Mark as inactive if message fails
                if (error.message.includes('not on WhatsApp')) {
                    await Contact.findOneAndUpdate(
                        { phoneNumber: number },
                        { status: 'inactive' },
                        { upsert: true }
                    );
                }
            }
        }

        // Update session stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': successCount }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contactList.length - successCount,
            totalContacts: contactList.length,
            imagesUsed: images ? images.length : 0,
            message: `Bulk messaging completed: ${successCount}/${contactList.length} sent successfully`
        });

    } catch (error) {
        console.error('Advanced bulk messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk messaging failed: ' + error.message 
        });
    }
});

// Smart messaging with personalization
router.post("/smart-bulk", upload.array('images', 5), async (req, res) => {
    try {
        const { 
            messageTemplate,
            delayMs = 3000,
            personalization = true
        } = req.body;
        
        const images = req.files;
        
        if (!messageTemplate) {
            return res.json({ 
                success: false, 
                error: 'Message template is required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        // Get active contacts from database
        const contacts = await Contact.find({ status: 'active' });
        const results = [];
        let successCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            try {
                const formattedNumber = contact.phoneNumber + '@s.whatsapp.net';
                
                // Personalize message
                let personalizedMessage = messageTemplate;
                if (personalization) {
                    personalizedMessage = personalizeMessage(messageTemplate, contact);
                }
                
                let messageOptions = { text: personalizedMessage };
                
                // Add random image if available
                if (images && images.length > 0) {
                    const randomImage = images[Math.floor(Math.random() * images.length)];
                    messageOptions = {
                        image: { url: randomImage.path },
                        caption: personalizedMessage
                    };
                }
                
                await client.sendMessage(formattedNumber, messageOptions);
                results.push({ 
                    number: contact.phoneNumber, 
                    status: 'success',
                    personalized: personalization
                });
                successCount++;
                
                // Update contact
                contact.lastContacted = new Date();
                contact.messageCount += 1;
                await contact.save();
                
                // Add delay
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, parseInt(delayMs)));
                }
                
            } catch (error) {
                results.push({ 
                    number: contact.phoneNumber, 
                    status: 'error', 
                    error: error.message 
                });
            }
        }

        // Update stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': successCount }
            }
        );

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contacts.length - successCount,
            personalization: personalization,
            message: `Smart messaging completed: ${successCount} personalized messages sent`
        });

    } catch (error) {
        console.error('Smart bulk messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Smart messaging failed: ' + error.message 
        });
    }
});

// Helper function to personalize messages
function personalizeMessage(template, contact) {
    let message = template;
    
    // Replace placeholders with contact data
    message = message.replace(/{{name}}/g, contact.name || 'there');
    message = message.replace(/{{phone}}/g, contact.phoneNumber);
    message = message.replace(/{{location}}/g, contact.location || 'your area');
    message = message.replace(/{{business}}/g, contact.businessType || 'business');
    
    return message;
}

// Schedule bulk messaging
router.post("/schedule", upload.array('images', 5), async (req, res) => {
    try {
        const { 
            contacts, 
            message, 
            scheduledTime,
            timezone = 'Asia/Colombo'
        } = req.body;
        
        const images = req.files;
        
        if (!contacts || !message || !scheduledTime) {
            return res.json({ 
                success: false, 
                error: 'Contacts, message and scheduled time are required' 
            });
        }

        // Calculate delay until scheduled time
        const scheduledDate = new Date(scheduledTime);
        const now = new Date();
        const delayMs = scheduledDate.getTime() - now.getTime();

        if (delayMs < 0) {
            return res.json({ 
                success: false, 
                error: 'Scheduled time must be in the future' 
            });
        }

        // Schedule the message
        setTimeout(async () => {
            try {
                const client = getWhatsAppClient();
                if (!client || !client.user) return;

                const contactList = Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '');
                
                for (const number of contactList) {
                    try {
                        const formattedNumber = number + '@s.whatsapp.net';
                        
                        let messageOptions = { text: message };
                        
                        if (images && images.length > 0) {
                            const randomImage = images[Math.floor(Math.random() * images.length)];
                            messageOptions = {
                                image: { url: randomImage.path },
                                caption: message
                            };
                        }
                        
                        await client.sendMessage(formattedNumber, messageOptions);
                        
                        // Update contact
                        await Contact.findOneAndUpdate(
                            { phoneNumber: number },
                            {
                                lastContacted: new Date(),
                                $inc: { messageCount: 1 }
                            },
                            { upsert: true }
                        );
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                    } catch (error) {
                        console.error(`Scheduled message failed for ${number}:`, error);
                    }
                }
                
                console.log(`Scheduled bulk messaging completed at ${new Date()}`);
                
            } catch (error) {
                console.error('Scheduled messaging error:', error);
            }
        }, delayMs);

        res.json({
            success: true,
            message: `Bulk messaging scheduled for ${scheduledTime}`,
            scheduledTime: scheduledTime,
            totalContacts: Array.isArray(contacts) ? contacts.length : contacts.split('\n').filter(num => num.trim() !== '').length
        });

    } catch (error) {
        console.error('Schedule messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Scheduling failed: ' + error.message 
        });
    }
});

module.exports = router;
