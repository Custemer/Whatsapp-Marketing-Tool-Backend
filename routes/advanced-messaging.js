const express = require("express");
const { delay } = require("@whiskeysockets/baileys");

const Session = require("../models/Session");
const Contact = require("../models/Contact");
const { getWhatsAppClient } = require("./pair");

const router = express.Router();

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

// Advanced bulk messaging
router.post("/bulk-with-images", async (req, res) => {
    try {
        const { 
            contacts, 
            message, 
            delayMs = 2000,
            sendTo = 'active'
        } = req.body;
        
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

        for (let i = 0; i < contactList.length; i++) {
            const number = contactList[i].trim();
            
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                await client.sendMessage(formattedNumber, { text: message });
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
router.post("/smart-bulk", async (req, res) => {
    try {
        const { 
            messageTemplate,
            personalization = true
        } = req.body;
        
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
        const contacts = await Contact.find({ status: 'active' }).limit(20);
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
                
                await client.sendMessage(formattedNumber, { text: personalizedMessage });
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
                    await new Promise(resolve => setTimeout(resolve, 2000));
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

// Add this new endpoint to advanced-messaging.js

// Category-based messaging
router.post("/category-bulk", async (req, res) => {
    try {
        const { 
            categoryId,
            message,
            delayMs = 2000,
            personalization = true
        } = req.body;
        
        if (!categoryId || !message) {
            return res.json({ 
                success: false, 
                error: 'Category ID and message are required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        // Get category and its contacts
        const Category = require('../models/Category');
        const category = await Category.findById(categoryId);
        
        if (!category) {
            return res.json({ 
                success: false, 
                error: 'Category not found' 
            });
        }

        // Build filter query based on category filters
        const filterQuery = buildFilterQuery(category.filters);
        filterQuery.categories = categoryId; // Include category filter

        const contacts = await Contact.find(filterQuery);
        
        if (contacts.length === 0) {
            return res.json({ 
                success: false, 
                error: 'No contacts found in this category' 
            });
        }

        const results = [];
        let successCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            try {
                const formattedNumber = contact.phoneNumber + '@s.whatsapp.net';
                
                // Personalize message
                let personalizedMessage = message;
                if (personalization) {
                    personalizedMessage = personalizeMessage(message, contact);
                }
                
                await client.sendMessage(formattedNumber, { text: personalizedMessage });
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
            category: category.name,
            results: results,
            sent: successCount,
            failed: contacts.length - successCount,
            totalContacts: contacts.length,
            personalization: personalization,
            message: `Category messaging completed: ${successCount}/${contacts.length} messages sent to ${category.name}`
        });

    } catch (error) {
        console.error('Category bulk messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Category messaging failed: ' + error.message 
        });
    }
});

// Helper function to build filter query (same as in categories.js)
function buildFilterQuery(filters) {
    const query = {};
    
    if (filters.businessType && filters.businessType.length > 0) {
        query.businessType = { $in: filters.businessType };
    }
    
    if (filters.location && filters.location.length > 0) {
        query.location = { $in: filters.location };
    }
    
    if (filters.status) {
        query.status = filters.status;
    }
    
    if (filters.minMessages !== undefined) {
        query.messageCount = { $gte: filters.minMessages };
    }
    
    if (filters.maxMessages !== undefined) {
        if (query.messageCount) {
            query.messageCount.$lte = filters.maxMessages;
        } else {
            query.messageCount = { $lte: filters.maxMessages };
        }
    }
    
    if (filters.lastContacted && filters.lastContacted.from) {
        query.lastContacted = { $gte: new Date(filters.lastContacted.from) };
        
        if (filters.lastContacted.to) {
            query.lastContacted.$lte = new Date(filters.lastContacted.to);
        }
    }
    
    return query;
}

    
    return message;
}

module.exports = router;
